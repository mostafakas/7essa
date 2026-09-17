import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, WorkspaceCtx } from '../common/context';
import { CurrentUser, RequirePermission, Ws } from '../common/decorators';
import { canAssignRole, permissionsOf, ROLES, type RoleName } from '../common/permissions';
import { maskPhone, normalizeEgyptPhone } from '../common/phone';
import { wsScope } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const MAX_OWNED_WORKSPACES = 5;
const TRIAL_DAYS = 30;

class CreateWorkspaceDto {
  @IsIn(['CENTER', 'TEACHER'])
  type!: 'CENTER' | 'TEACHER';

  @IsString()
  @Length(2, 80)
  name!: string;
}

class UpdateWorkspaceDto {
  @IsOptional() @IsString() @Length(2, 80)
  name?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  receptionMaxDiscountPct?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120)
  lateAfterMinutes?: number;
}

class InviteDto {
  @IsString() @MaxLength(32)
  phone!: string;

  @IsString() @Length(2, 80)
  name!: string;

  @IsIn(ROLES)
  role!: RoleName;

  /** مطلوب للمساعد: عضوية المدرس الذي يتبعه */
  @IsOptional() @IsUUID()
  supervisorMembershipId?: string;
}

class UpdateMemberDto {
  @IsOptional() @IsIn(ROLES)
  role?: RoleName;

  @IsOptional() @IsEnum({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' })
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional() @IsUUID()
  supervisorMembershipId?: string;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: CreateWorkspaceDto) {
    const owned = await this.prisma.scoped({ userId: user.id }, (tx) =>
      tx.membership.count({ where: { userId: user.id, role: 'OWNER' } }),
    );
    if (owned >= MAX_OWNED_WORKSPACES) throw new ForbiddenException('وصلت للحد الأقصى من مساحات العمل');

    // جدول المساحات بلا RLS؛ العضوية تُنشأ داخل سياق المساحة الجديدة
    const workspace = await this.prisma.workspace.create({
      data: { type: dto.type, name: dto.name.trim(), trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) },
    });
    const membership = await this.prisma.scoped({ userId: user.id, workspaceId: workspace.id }, async (tx) => {
      const m = await tx.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' } });
      await this.audit.log(tx, { workspaceId: workspace.id, actorUserId: user.id, action: 'workspace.create', entity: 'workspace', entityId: workspace.id });
      return m;
    });
    return { workspace, membershipId: membership.id, role: membership.role };
  }

  async current(ws: WorkspaceCtx) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
    return {
      workspace,
      me: { membershipId: ws.membershipId, role: ws.role, teacherScopeId: ws.teacherScopeId, permissions: permissionsOf(ws.role) },
    };
  }

  async update(ws: WorkspaceCtx, dto: UpdateWorkspaceDto) {
    const workspace = await this.prisma.workspace.update({
      where: { id: ws.workspaceId },
      data: { name: dto.name?.trim(), receptionMaxDiscountPct: dto.receptionMaxDiscountPct, lateAfterMinutes: dto.lateAfterMinutes },
    });
    await this.audit.log(null, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'workspace.update', entity: 'workspace', entityId: ws.workspaceId, meta: { ...dto }, ip: ws.ip });
    return workspace;
  }

  members(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.membership.findMany({
        where: { workspaceId: ws.workspaceId },
        include: { user: { select: { id: true, name: true, phone: true, phoneVerifiedAt: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map((m) => ({
        membershipId: m.id,
        role: m.role,
        status: m.status,
        supervisorMembershipId: m.supervisorMembershipId,
        name: m.user.name,
        phone: maskPhone(m.user.phone),
        activated: Boolean(m.user.phoneVerifiedAt),
        isMe: m.userId === ws.userId,
      }));
    });
  }

  /** دعوة موظف أو مدرس برقمه: إن لم يكن له حساب يُنشأ حساب غير مفعّل حتى أول دخول بالرمز */
  async invite(ws: WorkspaceCtx, dto: InviteDto) {
    if (!canAssignRole(ws.role, dto.role)) throw new ForbiddenException('لا يمكنك منح هذا الدور');
    const phone = normalizeEgyptPhone(dto.phone);
    if (!phone) throw new BadRequestException('رقم الموبايل غير صحيح');
    if (dto.role === 'ASSISTANT' && !dto.supervisorMembershipId) throw new BadRequestException('حدد المدرس الذي يتبعه المساعد');

    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, name: dto.name.trim() },
    });

    const membership = await this.prisma.scoped(wsScope(ws), async (tx) => {
      if (dto.supervisorMembershipId) await this.assertTeacher(tx, ws.workspaceId, dto.supervisorMembershipId);
      const existing = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: ws.workspaceId, userId: user.id } } });
      if (existing) throw new BadRequestException('هذا الرقم عضو بالفعل في مساحة العمل');
      const m = await tx.membership.create({
        data: {
          workspaceId: ws.workspaceId,
          userId: user.id,
          role: dto.role,
          supervisorMembershipId: dto.role === 'ASSISTANT' ? dto.supervisorMembershipId : null,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'member.invite', entity: 'membership', entityId: m.id, meta: { role: dto.role }, ip: ws.ip });
      return m;
    });

    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { name: true } });
    await this.notify.notify({
      kind: 'welcome',
      userIds: [user.id],
      workspaceId: ws.workspaceId,
      title: `تمت إضافتك إلى ${workspace.name}`,
      body: 'سجّل الدخول برقم موبايلك لتبدأ.',
    });
    return { membershipId: membership.id, role: membership.role };
  }

  async updateMember(ws: WorkspaceCtx, membershipId: string, dto: UpdateMemberDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const target = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: ws.workspaceId } });
      if (!target) throw new NotFoundException('العضو غير موجود');
      if (target.userId === ws.userId) throw new ForbiddenException('لا يمكنك تعديل دورك أو إيقاف حسابك بنفسك');
      if (!canAssignRole(ws.role, target.role)) throw new ForbiddenException('لا يمكنك تعديل هذا العضو');
      if (dto.role && !canAssignRole(ws.role, dto.role)) throw new ForbiddenException('لا يمكنك منح هذا الدور');

      const nextRole = dto.role ?? target.role;
      if (target.role === 'OWNER' && (nextRole !== 'OWNER' || dto.status === 'DISABLED')) {
        const owners = await tx.membership.count({ where: { workspaceId: ws.workspaceId, role: 'OWNER', status: 'ACTIVE' } });
        if (owners <= 1) throw new BadRequestException('يجب أن يبقى مالك واحد نشط على الأقل');
      }
      if (nextRole === 'ASSISTANT') {
        const sup = dto.supervisorMembershipId ?? target.supervisorMembershipId;
        if (!sup) throw new BadRequestException('حدد المدرس الذي يتبعه المساعد');
        await this.assertTeacher(tx, ws.workspaceId, sup);
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: {
          role: dto.role,
          status: dto.status,
          supervisorMembershipId: nextRole === 'ASSISTANT' ? (dto.supervisorMembershipId ?? target.supervisorMembershipId) : null,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'member.update', entity: 'membership', entityId: target.id, meta: { from: target.role, ...dto }, ip: ws.ip });
      // لا حاجة لإنهاء جلسات العضو الموقوف: العضوية تُفحص مع كل طلب (WorkspaceGuard)
      return { membershipId: updated.id, role: updated.role, status: updated.status };
    });
  }

  auditLog(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { workspaceId: ws.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
      const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
      const names = new Map(actors.map((a) => [a.id, a.name]));
      return rows.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        actor: r.actorUserId ? (names.get(r.actorUserId) ?? '—') : 'النظام',
        meta: r.meta,
        createdAt: r.createdAt,
      }));
    });
  }

  private async assertTeacher(tx: Tx, workspaceId: string, membershipId: string) {
    const t = await tx.membership.findFirst({ where: { id: membershipId, workspaceId, role: { in: ['TEACHER', 'OWNER'] }, status: 'ACTIVE' } });
    if (!t) throw new BadRequestException('المدرس المحدد غير موجود في مساحة العمل');
  }
}

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly svc: WorkspacesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.svc.create(user, dto);
  }

  @Get('current')
  @RequirePermission('workspace.view')
  current(@Ws() ws: WorkspaceCtx) {
    return this.svc.current(ws);
  }

  @Patch('current')
  @RequirePermission('workspace.manage')
  update(@Ws() ws: WorkspaceCtx, @Body() dto: UpdateWorkspaceDto) {
    return this.svc.update(ws, dto);
  }

  /** قائمة مختصرة للمدرسين تحتاجها شاشات المجموعات والتسويات */
  @Get('current/teachers')
  @RequirePermission('academics.read')
  async teachers(@Ws() ws: WorkspaceCtx) {
    const all = await this.svc.members(ws);
    return all
      .filter((m) => (m.role === 'TEACHER' || m.role === 'OWNER') && m.status === 'ACTIVE')
      .filter((m) => !ws.teacherScopeId || m.membershipId === ws.teacherScopeId)
      .map(({ membershipId, name, role }) => ({ membershipId, name, role }));
  }

  @Get('current/members')
  @RequirePermission('staff.manage')
  members(@Ws() ws: WorkspaceCtx) {
    return this.svc.members(ws);
  }

  @Post('current/members')
  @RequirePermission('staff.manage')
  invite(@Ws() ws: WorkspaceCtx, @Body() dto: InviteDto) {
    return this.svc.invite(ws, dto);
  }

  @Patch('current/members/:id')
  @RequirePermission('staff.manage')
  updateMember(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.svc.updateMember(ws, id, dto);
  }

  @Get('current/audit')
  @RequirePermission('staff.manage')
  audit(@Ws() ws: WorkspaceCtx) {
    return this.svc.auditLog(ws);
  }
}

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService] })
export class WorkspacesModule {}

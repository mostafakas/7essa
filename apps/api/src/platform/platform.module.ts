import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, UseGuards,
} from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { WorkspaceStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, HessaRequest } from '../common/context';
import { CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** مالك المنصة فقط، مع إعادة التحقق من القاعدة (لا يُكتفى بما في رمز الدخول) */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<HessaRequest>().user;
    if (!user?.isPlatformAdmin) throw new ForbiddenException();
    const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { isPlatformAdmin: true } });
    if (!row?.isPlatformAdmin) throw new ForbiddenException();
    return true;
  }
}

class UpdateWorkspaceDto {
  @IsOptional() @IsIn(Object.values(WorkspaceStatus)) status?: WorkspaceStatus;
  @IsOptional() @IsString() @Length(2, 30) plan?: string;
  @IsOptional() @IsDateString() trialEndsAt?: string;
}

interface StatRow {
  workspace_id: string;
  members: bigint;
  active_students: bigint;
  receipts_30d: bigint;
}

/**
 * لوحة مالك المنصة: بيانات تشغيلية مجمعة فقط.
 * لا وصول لبيانات الطلاب أو المبالغ داخل السناتر (الدالة تعيد أعدادًا فقط).
 */
@Controller('platform')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const workspaces = await this.prisma.workspace.findMany({
      select: { id: true, name: true, type: true, status: true, plan: true, trialEndsAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const stats = await this.prisma.scoped({ userId: user.id }, (tx) =>
      tx.$queryRaw<StatRow[]>`SELECT workspace_id::text, members, active_students, receipts_30d FROM app_platform_workspace_stats()`,
    );
    const byId = new Map(stats.map((s) => [s.workspace_id, s]));
    const users = await this.prisma.user.count();
    const rows = workspaces.map((w) => {
      const s = byId.get(w.id);
      return {
        ...w,
        members: Number(s?.members ?? 0),
        activeStudents: Number(s?.active_students ?? 0),
        receipts30d: Number(s?.receipts_30d ?? 0),
      };
    });
    const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
    return {
      totals: {
        users,
        workspaces: rows.length,
        centers: count((r) => r.type === 'CENTER'),
        teachers: count((r) => r.type === 'TEACHER'),
        active: count((r) => r.status === 'ACTIVE'),
        trial: count((r) => r.status === 'TRIAL'),
        suspended: count((r) => r.status === 'SUSPENDED'),
        activeStudents: rows.reduce((t, r) => t + r.activeStudents, 0),
        // مساحة "نشطة فعليًا" = أصدرت إيصالًا خلال 30 يومًا
        engaged: count((r) => r.receipts30d > 0),
      },
      workspaces: rows,
    };
  }

  @Patch('workspaces/:id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkspaceDto) {
    const exists = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('المساحة غير موجودة');
    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { status: dto.status, plan: dto.plan, trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : undefined },
    });
    await this.audit.log(null, { workspaceId: id, actorUserId: user.id, action: 'platform.workspace_update', entity: 'workspace', entityId: id, meta: { ...dto } });
    return updated;
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformAdminGuard] })
export class PlatformModule {}

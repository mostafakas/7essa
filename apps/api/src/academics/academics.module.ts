import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length,
  Matches, Max, MaxLength, Min,
} from 'class-validator';
import { EducationSystem } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { formatCairo } from '../common/format';
import { toDecimalString, toPiasters } from '../common/money';
import { groupFamilyIds } from '../common/recipients';
import { assertGroupInScope, groupScope, lockKeys, wsScope } from '../common/scope';
import { addDays, cairoMonthRange, cairoToUtc } from '../common/time';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { billableHours, findConflicts, generateSlots, type Slot } from './schedule';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

class HallDto {
  @IsString() @Length(1, 60)
  name!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  capacity!: number;
}

class GroupDto {
  @IsString() @Length(2, 80)
  name!: string;

  @IsString() @Length(2, 60)
  subject!: string;

  @IsString() @Length(1, 40)
  grade!: string;

  @IsOptional() @IsEnum(EducationSystem)
  system?: EducationSystem;

  @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  capacity!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000)
  monthlyFee!: number;

  @IsOptional() @IsUUID()
  teacherMembershipId?: string;

  @IsOptional() @IsUUID()
  defaultHallId?: string;
}

class UpdateGroupDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) capacity?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) monthlyFee?: number;
  @IsOptional() @IsUUID() defaultHallId?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

class ScheduleDto {
  @Matches(DATE) startDate!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(26) weeks!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weekdays!: number[];
  @Matches(TIME) startTime!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(360) durationMin!: number;
  @IsOptional() @IsUUID() hallId?: string;
}

class SessionDto {
  @IsUUID() groupId!: string;
  @Matches(DATE) date!: string;
  @Matches(TIME) startTime!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(360) durationMin!: number;
  @IsOptional() @IsUUID() hallId?: string;
}

class RescheduleDto {
  @Matches(DATE) date!: string;
  @Matches(TIME) startTime!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(360) durationMin!: number;
  @IsOptional() @IsUUID() hallId?: string;
}

class CancelDto {
  @IsString() @Length(3, 200) reason!: string;
}

class RangeQuery {
  @Matches(DATE) from!: string;
  @Matches(DATE) to!: string;
}

class MonthQuery {
  @Matches(MONTH) month!: string;
}

class ArchivedQuery {
  @IsOptional() @IsString() @MaxLength(5) archived?: string;
}

@Injectable()
export class AcademicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── القاعات

  halls(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), (tx) => tx.hall.findMany({ orderBy: { name: 'asc' } }));
  }

  createHall(ws: WorkspaceCtx, dto: HallDto) {
    return this.prisma.scoped(wsScope(ws), (tx) =>
      tx.hall.create({ data: { workspaceId: ws.workspaceId, name: dto.name.trim(), capacity: dto.capacity } }),
    );
  }

  updateHall(ws: WorkspaceCtx, id: string, dto: HallDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      await this.hallOrThrow(tx, id);
      return tx.hall.update({ where: { id }, data: { name: dto.name.trim(), capacity: dto.capacity } });
    });
  }

  deleteHall(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      await this.hallOrThrow(tx, id);
      const used = await tx.classSession.count({ where: { hallId: id } });
      if (used) throw new ConflictException('القاعة مستخدمة في حصص مسجلة، لا يمكن حذفها');
      await tx.hall.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** نسبة إشغال كل قاعة في شهر (ساعات محجوزة من 12 ساعة يوميًا) */
  occupancy(ws: WorkspaceCtx, month: string) {
    const { start, end } = cairoMonthRange(month);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const halls = await tx.hall.findMany({ orderBy: { name: 'asc' } });
      const sessions = await tx.classSession.findMany({
        where: { hallId: { not: null }, status: { not: 'CANCELLED' }, startsAt: { gte: start, lt: end } },
        select: { hallId: true, startsAt: true, endsAt: true },
      });
      return halls.map((h) => {
        const hours = billableHours(sessions.filter((s) => s.hallId === h.id));
        return { hallId: h.id, name: h.name, hours, occupancyPct: Math.round((hours / (days * 12)) * 100) };
      });
    });
  }

  // ───────── المجموعات

  groups(ws: WorkspaceCtx, archived: boolean) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.group.findMany({
        where: { archived, ...groupScope(ws) },
        include: {
          teacher: { select: { id: true, user: { select: { name: true } } } },
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: [{ grade: 'asc' }, { name: 'asc' }],
      });
      const waitlist = await tx.enrollment.groupBy({
        by: ['groupId'],
        where: { status: 'WAITLIST', groupId: { in: rows.map((r) => r.id) } },
        _count: true,
      });
      const wl = new Map(waitlist.map((w) => [w.groupId, w._count]));
      return rows.map((g) => ({
        id: g.id,
        name: g.name,
        subject: g.subject,
        grade: g.grade,
        system: g.system,
        capacity: g.capacity,
        monthlyFee: g.monthlyFee,
        defaultHallId: g.defaultHallId,
        archived: g.archived,
        teacherMembershipId: g.teacher.id,
        teacherName: g.teacher.user.name,
        activeStudents: g._count.enrollments,
        waitlist: wl.get(g.id) ?? 0,
      }));
    });
  }

  createGroup(ws: WorkspaceCtx, dto: GroupDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const teacherMembershipId = dto.teacherMembershipId ?? ws.teacherScopeId ?? (await this.selfIfTeacherWorkspace(tx, ws));
      const teacher = await tx.membership.findFirst({
        where: { id: teacherMembershipId, workspaceId: ws.workspaceId, status: 'ACTIVE', role: { in: ['TEACHER', 'OWNER'] } },
      });
      if (!teacher) throw new BadRequestException('اختر مدرسًا من مساحة العمل');
      if (dto.defaultHallId) await this.hallOrThrow(tx, dto.defaultHallId);
      const group = await tx.group.create({
        data: {
          workspaceId: ws.workspaceId,
          teacherMembershipId: teacher.id,
          name: dto.name.trim(),
          subject: dto.subject.trim(),
          grade: dto.grade.trim(),
          system: dto.system ?? 'GENERAL',
          capacity: dto.capacity,
          monthlyFee: toDecimalString(toPiasters(dto.monthlyFee)),
          defaultHallId: dto.defaultHallId,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'group.create', entity: 'group', entityId: group.id, ip: ws.ip });
      return group;
    });
  }

  updateGroup(ws: WorkspaceCtx, id: string, dto: UpdateGroupDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const group = await tx.group.findUnique({ where: { id } });
      assertGroupInScope(ws, group);
      if (dto.defaultHallId) await this.hallOrThrow(tx, dto.defaultHallId);
      const updated = await tx.group.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          capacity: dto.capacity,
          monthlyFee: dto.monthlyFee === undefined ? undefined : toDecimalString(toPiasters(dto.monthlyFee)),
          defaultHallId: dto.defaultHallId,
          archived: dto.archived,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'group.update', entity: 'group', entityId: id, meta: { ...dto }, ip: ws.ip });
      return updated;
    });
  }

  // ───────── الحصص

  /** توليد حصص أسبوعية لمجموعة مع رفض كامل عند أي تعارض (قاعة أو مدرس) */
  schedule(ws: WorkspaceCtx, groupId: string, dto: ScheduleDto) {
    let slots: Slot[];
    try {
      slots = generateSlots(dto);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      assertGroupInScope(ws, group);
      if (group!.archived) throw new BadRequestException('المجموعة مؤرشفة');
      const hallId = dto.hallId ?? group!.defaultHallId ?? null;
      if (hallId) await this.hallOrThrow(tx, hallId);

      await this.assertNoConflicts(tx, slots, hallId, group!.teacherMembershipId);
      await tx.classSession.createMany({
        data: slots.map((s) => ({ workspaceId: ws.workspaceId, groupId, hallId, startsAt: s.startsAt, endsAt: s.endsAt })),
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'session.schedule', entity: 'group', entityId: groupId, meta: { count: slots.length, ...dto }, ip: ws.ip });
      return { created: slots.length, first: slots[0]?.startsAt, last: slots.at(-1)?.startsAt };
    });
  }

  createSession(ws: WorkspaceCtx, dto: SessionDto) {
    const startsAt = cairoToUtc(dto.date, dto.startTime);
    const slot = { startsAt, endsAt: new Date(startsAt.getTime() + dto.durationMin * 60_000) };
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const group = await tx.group.findUnique({ where: { id: dto.groupId } });
      assertGroupInScope(ws, group);
      const hallId = dto.hallId ?? group!.defaultHallId ?? null;
      if (hallId) await this.hallOrThrow(tx, hallId);
      await this.assertNoConflicts(tx, [slot], hallId, group!.teacherMembershipId);
      const session = await tx.classSession.create({ data: { workspaceId: ws.workspaceId, groupId: group!.id, hallId, ...slot } });
      const recipients = await groupFamilyIds(tx, group!.id);
      await this.notify.notify({
        kind: 'session_changed',
        userIds: recipients,
        workspaceId: ws.workspaceId,
        title: `حصة إضافية: ${group!.name}`,
        body: `موعدها ${formatCairo(slot.startsAt)}`,
      });
      return session;
    });
  }

  sessions(ws: WorkspaceCtx, q: RangeQuery) {
    const start = cairoToUtc(q.from, '00:00');
    const end = cairoToUtc(addDays(q.to, 1), '00:00');
    if (end <= start || end.getTime() - start.getTime() > 43 * 86_400_000) {
      throw new BadRequestException('الفترة يجب ألا تتجاوز 6 أسابيع');
    }
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.classSession.findMany({
        where: { startsAt: { gte: start, lt: end }, group: groupScope(ws) },
        include: {
          group: { select: { id: true, name: true, subject: true, grade: true, teacher: { select: { user: { select: { name: true } } } } } },
          hall: { select: { id: true, name: true } },
          _count: { select: { attendance: true } },
        },
        orderBy: { startsAt: 'asc' },
      });
      return rows.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        cancelReason: s.cancelReason,
        hall: s.hall,
        group: { id: s.group.id, name: s.group.name, subject: s.group.subject, grade: s.group.grade },
        teacherName: s.group.teacher.user.name,
        attendanceCount: s._count.attendance,
      }));
    });
  }

  reschedule(ws: WorkspaceCtx, id: string, dto: RescheduleDto) {
    const startsAt = cairoToUtc(dto.date, dto.startTime);
    const slot = { startsAt, endsAt: new Date(startsAt.getTime() + dto.durationMin * 60_000) };
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await tx.classSession.findUnique({ where: { id }, include: { group: true } });
      if (!session) throw new NotFoundException('الحصة غير موجودة');
      assertGroupInScope(ws, session.group);
      if (session.status !== 'SCHEDULED') throw new BadRequestException('لا يمكن تغيير موعد حصة بدأت أو أُلغيت');
      const hallId = dto.hallId ?? session.hallId;
      if (hallId) await this.hallOrThrow(tx, hallId);
      await this.assertNoConflicts(tx, [slot], hallId, session.group.teacherMembershipId, session.id);
      const updated = await tx.classSession.update({ where: { id }, data: { ...slot, hallId } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'session.reschedule', entity: 'session', entityId: id, meta: { from: session.startsAt.toISOString(), to: slot.startsAt.toISOString(), hallId }, ip: ws.ip });
      await this.notify.notify({
        kind: 'session_changed',
        userIds: await groupFamilyIds(tx, session.groupId),
        workspaceId: ws.workspaceId,
        title: `تغيير موعد حصة ${session.group.name}`,
        body: `الموعد الجديد ${formatCairo(slot.startsAt)}`,
      });
      return updated;
    });
  }

  cancel(ws: WorkspaceCtx, id: string, reason: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await tx.classSession.findUnique({ where: { id }, include: { group: true } });
      if (!session) throw new NotFoundException('الحصة غير موجودة');
      assertGroupInScope(ws, session.group);
      if (session.status !== 'SCHEDULED') throw new BadRequestException('لا يمكن إلغاء حصة بدأت أو انتهت');
      const updated = await tx.classSession.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason.trim() } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'session.cancel', entity: 'session', entityId: id, meta: { reason }, ip: ws.ip });
      await this.notify.notify({
        kind: 'session_cancelled',
        userIds: await groupFamilyIds(tx, session.groupId),
        workspaceId: ws.workspaceId,
        title: `إلغاء حصة ${session.group.name}`,
        body: `حصة ${formatCairo(session.startsAt)} أُلغيت. السبب: ${reason.trim()}`,
      });
      return updated;
    });
  }

  // ───────── مساعدات

  private async hallOrThrow(tx: Tx, id: string) {
    const hall = await tx.hall.findUnique({ where: { id } });
    if (!hall) throw new NotFoundException('القاعة غير موجودة');
    return hall;
  }

  private async selfIfTeacherWorkspace(tx: Tx, ws: WorkspaceCtx): Promise<string> {
    const w = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { type: true } });
    if (w.type !== 'TEACHER') throw new BadRequestException('اختر المدرس المسؤول عن المجموعة');
    return ws.membershipId;
  }

  private async assertNoConflicts(tx: Tx, slots: Slot[], hallId: string | null, teacherId: string, excludeId?: string) {
    if (!slots.length) return;
    await lockKeys(tx, [hallId ? `hall:${hallId}` : '', `teacher:${teacherId}`].filter(Boolean));
    const from = slots[0].startsAt;
    const to = slots.reduce((m, s) => (s.endsAt > m ? s.endsAt : m), slots[0].endsAt);
    const existing = await tx.classSession.findMany({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        status: { not: 'CANCELLED' },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [...(hallId ? [{ hallId }] : []), { group: { teacherMembershipId: teacherId } }],
      },
      select: { id: true, startsAt: true, endsAt: true, hallId: true, group: { select: { name: true } } },
    });
    let conflicts;
    try {
      conflicts = findConflicts(slots, existing);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (conflicts.length) {
      throw new ConflictException({
        message: `يوجد تعارض في ${conflicts.length} موعد مع حصص قائمة`,
        conflicts: conflicts.slice(0, 20).map((c) => ({
          requested: c.slot.startsAt,
          existingSessionId: c.with.id,
          group: c.with.group.name,
          reason: c.with.hallId && c.with.hallId === hallId ? 'القاعة محجوزة' : 'المدرس مشغول',
        })),
      });
    }
  }
}

@Controller('academics')
export class AcademicsController {
  constructor(private readonly svc: AcademicsService) {}

  @Get('halls')
  @RequirePermission('academics.read')
  halls(@Ws() ws: WorkspaceCtx) {
    return this.svc.halls(ws);
  }

  @Get('halls/occupancy')
  @RequirePermission('academics.read')
  occupancy(@Ws() ws: WorkspaceCtx, @Query() q: MonthQuery) {
    return this.svc.occupancy(ws, q.month);
  }

  @Post('halls')
  @RequirePermission('academics.write')
  createHall(@Ws() ws: WorkspaceCtx, @Body() dto: HallDto) {
    return this.svc.createHall(ws, dto);
  }

  @Patch('halls/:id')
  @RequirePermission('academics.write')
  updateHall(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HallDto) {
    return this.svc.updateHall(ws, id, dto);
  }

  @Delete('halls/:id')
  @RequirePermission('academics.write')
  deleteHall(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteHall(ws, id);
  }

  @Get('groups')
  @RequirePermission('academics.read')
  groups(@Ws() ws: WorkspaceCtx, @Query() q: ArchivedQuery) {
    return this.svc.groups(ws, q.archived === 'true');
  }

  @Post('groups')
  @RequirePermission('academics.write')
  createGroup(@Ws() ws: WorkspaceCtx, @Body() dto: GroupDto) {
    return this.svc.createGroup(ws, dto);
  }

  @Patch('groups/:id')
  @RequirePermission('academics.write')
  updateGroup(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.svc.updateGroup(ws, id, dto);
  }

  @Post('groups/:id/schedule')
  @RequirePermission('academics.write')
  schedule(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto) {
    return this.svc.schedule(ws, id, dto);
  }

  @Get('sessions')
  @RequirePermission('academics.read')
  sessions(@Ws() ws: WorkspaceCtx, @Query() q: RangeQuery) {
    return this.svc.sessions(ws, q);
  }

  @Post('sessions')
  @RequirePermission('academics.write')
  createSession(@Ws() ws: WorkspaceCtx, @Body() dto: SessionDto) {
    return this.svc.createSession(ws, dto);
  }

  @Patch('sessions/:id')
  @RequirePermission('academics.write')
  reschedule(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto) {
    return this.svc.reschedule(ws, id, dto);
  }

  @Post('sessions/:id/cancel')
  @HttpCode(200)
  @RequirePermission('academics.write')
  cancel(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(ws, id, dto.reason);
  }
}

@Module({ controllers: [AcademicsController], providers: [AcademicsService] })
export class AcademicsModule {}

import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Logger, Module,
  NotFoundException, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength,
  ValidateNested,
} from 'class-validator';
import type { ClassSession, Group } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { formatCairo } from '../common/format';
import { familyIds } from '../common/recipients';
import { assertGroupInScope, groupScope, lockKeys, wsScope } from '../common/scope';
import { addDays, cairoDateOf, cairoMonthOf, cairoToUtc } from '../common/time';
import { env } from '../config/env';
import { attendanceStatusAt, scanWindowOpen } from '../finance/dues';
import { dueViews, type DueView } from '../finance/dues.repo';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { verifyToken } from './qr-token';

const OFFLINE_MAX_AGE_MS = 7 * 86_400_000;
const ARRIVAL_NOTIFY_MAX_AGE_MS = 2 * 3_600_000;

class ScanDto {
  @IsUUID() sessionId!: string;
  /** محتوى الـQR (كارنيه مطبوع أو رمز متغير من التطبيق) */
  @IsOptional() @IsString() @MaxLength(160) token?: string;
  /** أو الكود الرقمي للطالب */
  @IsOptional() @Matches(/^\d{6}$/) code?: string;
}

class OfflineOpDto extends ScanDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) clientOpId!: string;
  @IsDateString() scannedAt!: string;
}

class SyncDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OfflineOpDto)
  ops!: OfflineOpDto[];
}

class ManualDto {
  @IsUUID() studentId!: string;
  @IsIn(['PRESENT', 'LATE', 'ABSENT']) status!: 'PRESENT' | 'LATE' | 'ABSENT';
}

type SessionWithGroup = ClassSession & { group: Group };

export interface ScanResult {
  ok: true;
  duplicate: boolean;
  studentId: string;
  studentName: string;
  group: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT';
  enrollmentStatus: string;
  due?: DueView;
}

interface RecordOpts {
  at: Date;
  offline: boolean;
  clientOpId?: string;
  method: 'QR_DYNAMIC' | 'QR_CARD' | 'CODE';
}

@Injectable()
export class AttendanceService {
  private readonly log = new Logger('Attendance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  /** حصص اليوم لاختيار الكشف في محطة الاستقبال */
  today(ws: WorkspaceCtx) {
    const date = cairoDateOf(new Date());
    const start = cairoToUtc(date, '00:00');
    const end = cairoToUtc(addDays(date, 1), '00:00');
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.classSession.findMany({
        where: { startsAt: { gte: start, lt: end }, group: groupScope(ws) },
        include: {
          group: { select: { name: true, subject: true, grade: true, teacher: { select: { user: { select: { name: true } } } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } },
          hall: { select: { name: true } },
          _count: { select: { attendance: { where: { status: { not: 'ABSENT' } } } } },
        },
        orderBy: { startsAt: 'asc' },
      });
      return rows.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        hall: s.hall?.name ?? null,
        group: s.group.name,
        subject: s.group.subject,
        grade: s.group.grade,
        teacherName: s.group.teacher.user.name,
        enrolled: s.group._count.enrollments,
        present: s._count.attendance,
      }));
    });
  }

  async scan(ws: WorkspaceCtx, dto: ScanDto): Promise<ScanResult> {
    const pending: NotificationJob[] = [];
    const result = await this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await this.sessionForScan(tx, ws, dto.sessionId, new Date());
      const { studentId, method } = await this.resolveStudent(tx, ws.workspaceId, dto);
      return this.record(tx, ws, session, studentId, { at: new Date(), offline: false, method }, pending);
    });
    await this.flush(pending);
    return result;
  }

  /** مزامنة عمليات وضع عدم الاتصال: كل عملية في معاملة مستقلة ولا تتكرر بفضل clientOpId */
  async sync(ws: WorkspaceCtx, ops: OfflineOpDto[]) {
    const results: ({ clientOpId: string } & ({ ok: true; result: ScanResult } | { ok: false; error: string }))[] = [];
    const now = Date.now();
    for (const op of ops) {
      const pending: NotificationJob[] = [];
      try {
        const at = new Date(Math.min(new Date(op.scannedAt).getTime(), now));
        if (now - at.getTime() > OFFLINE_MAX_AGE_MS) throw new BadRequestException('العملية أقدم من 7 أيام');
        const result = await this.prisma.scoped(wsScope(ws), async (tx) => {
          const prior = await tx.attendance.findUnique({ where: { clientOpId: op.clientOpId }, include: { student: true, session: { include: { group: true } } } });
          if (prior) {
            return {
              ok: true as const, duplicate: true, studentId: prior.studentId, studentName: prior.student.fullName,
              group: prior.session.group.name, status: prior.status, enrollmentStatus: 'ACTIVE',
            };
          }
          const session = await this.sessionForScan(tx, ws, op.sessionId, at);
          const { studentId, method } = await this.resolveStudent(tx, ws.workspaceId, op, at);
          return this.record(tx, ws, session, studentId, { at, offline: true, clientOpId: op.clientOpId, method }, pending);
        });
        await this.flush(pending);
        results.push({ clientOpId: op.clientOpId, ok: true, result });
      } catch (e) {
        results.push({ clientOpId: op.clientOpId, ok: false, error: (e as Error).message });
      }
    }
    return { synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  manual(ws: WorkspaceCtx, sessionId: string, dto: ManualDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await this.sessionOrThrow(tx, ws, sessionId);
      if (session.status === 'CANCELLED') throw new BadRequestException('الحصة ملغاة');
      const enrollment = await tx.enrollment.findUnique({ where: { groupId_studentId: { groupId: session.groupId, studentId: dto.studentId } } });
      if (!enrollment) throw new NotFoundException('الطالب غير مسجل في هذه المجموعة');
      const row = await tx.attendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: dto.studentId } },
        create: { workspaceId: ws.workspaceId, sessionId, studentId: dto.studentId, status: dto.status, method: 'MANUAL', recordedById: ws.userId },
        update: { status: dto.status, method: 'MANUAL', recordedById: ws.userId, recordedAt: new Date() },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'attendance.manual', entity: 'attendance', entityId: row.id, meta: { status: dto.status }, ip: ws.ip });
      return row;
    });
  }

  open(ws: WorkspaceCtx, sessionId: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await this.sessionOrThrow(tx, ws, sessionId);
      if (session.status !== 'SCHEDULED') throw new BadRequestException('الكشف مفتوح أو مغلق بالفعل');
      if (!scanWindowOpen(session.startsAt, session.endsAt, new Date())) throw new BadRequestException('لا يُفتح الكشف إلا قبل الحصة بربع ساعة');
      return tx.classSession.update({ where: { id: sessionId }, data: { status: 'OPEN', openedAt: new Date() } });
    });
  }

  /** إغلاق الكشف: من لم يحضر يُسجل غائبًا ويُبلَّغ ولي أمره */
  async close(ws: WorkspaceCtx, sessionId: string) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`session:${sessionId}`]);
      const session = await this.sessionOrThrow(tx, ws, sessionId);
      if (session.status === 'CLOSED' || session.status === 'CANCELLED') throw new BadRequestException('الكشف مغلق بالفعل');
      if (session.startsAt > new Date()) throw new BadRequestException('لا يمكن إغلاق كشف حصة لم تبدأ');

      const enrollments = await tx.enrollment.findMany({
        where: { groupId: session.groupId, status: 'ACTIVE' },
        include: { student: { select: { id: true, fullName: true, guardianUserId: true, studentUserId: true } } },
      });
      const recorded = await tx.attendance.findMany({ where: { sessionId }, select: { studentId: true } });
      const seen = new Set(recorded.map((r) => r.studentId));
      const absent = enrollments.filter((e) => !seen.has(e.studentId));

      await tx.attendance.createMany({
        data: absent.map((e) => ({ workspaceId: ws.workspaceId, sessionId, studentId: e.studentId, status: 'ABSENT' as const, method: 'AUTO' as const })),
        skipDuplicates: true,
      });
      await tx.classSession.update({ where: { id: sessionId }, data: { status: 'CLOSED', closedAt: new Date(), openedAt: session.openedAt ?? session.startsAt } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'attendance.close', entity: 'session', entityId: sessionId, meta: { absent: absent.length, present: seen.size }, ip: ws.ip });

      for (const e of absent) {
        pending.push({
          kind: 'absence',
          userIds: familyIds(e.student),
          workspaceId: ws.workspaceId,
          title: `غياب ${e.student.fullName}`,
          body: `لم يحضر حصة ${session.group.name} (${formatCairo(session.startsAt)}).`,
        });
      }
      return { present: seen.size, absent: absent.length };
    });
    await this.flush(pending);
    return out;
  }

  /** الكشف الحي: كل طالب وحالته وحالة اشتراكه (المبالغ لأدوار المالية فقط) */
  sheet(ws: WorkspaceCtx, sessionId: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const session = await tx.classSession.findUnique({
        where: { id: sessionId },
        include: { group: true, hall: { select: { name: true } } },
      });
      if (!session) throw new NotFoundException('الحصة غير موجودة');
      assertGroupInScope(ws, session.group);
      const enrollments = await tx.enrollment.findMany({
        where: { groupId: session.groupId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        include: { student: { select: { id: true, fullName: true } }, group: { select: { monthlyFee: true } } },
        orderBy: { student: { fullName: 'asc' } },
      });
      const attendance = await tx.attendance.findMany({ where: { sessionId } });
      const byStudent = new Map(attendance.map((a) => [a.studentId, a]));
      const dues = await dueViews(tx, ws, enrollments, cairoMonthOf(session.startsAt));
      const rows = enrollments.map((e) => {
        const a = byStudent.get(e.studentId);
        return {
          studentId: e.studentId,
          fullName: e.student.fullName,
          code: e.code,
          enrollmentStatus: e.status,
          attendance: a ? { status: a.status, method: a.method, at: a.recordedAt, offline: a.offline } : null,
          due: dues.get(e.id),
        };
      });
      return {
        session: {
          id: session.id, startsAt: session.startsAt, endsAt: session.endsAt, status: session.status,
          group: session.group.name, subject: session.group.subject, hall: session.hall?.name ?? null,
        },
        counts: {
          enrolled: rows.length,
          present: attendance.filter((a) => a.status === 'PRESENT').length,
          late: attendance.filter((a) => a.status === 'LATE').length,
          absent: attendance.filter((a) => a.status === 'ABSENT').length,
        },
        rows,
      };
    });
  }

  // ───────── مساعدات

  private async sessionOrThrow(tx: Tx, ws: WorkspaceCtx, id: string): Promise<SessionWithGroup> {
    const session = await tx.classSession.findUnique({ where: { id }, include: { group: true } });
    if (!session) throw new NotFoundException('الحصة غير موجودة');
    assertGroupInScope(ws, session.group);
    return session;
  }

  /** يتحقق أن الحصة تقبل التسجيل في لحظة المسح، ويفتح الكشف تلقائيًا عند أول مسح */
  private async sessionForScan(tx: Tx, ws: WorkspaceCtx, id: string, at: Date): Promise<SessionWithGroup> {
    const session = await this.sessionOrThrow(tx, ws, id);
    if (session.status === 'CANCELLED') throw new BadRequestException('الحصة ملغاة');
    if (session.status === 'CLOSED') {
      // عملية مسجلة دون اتصال قبل الإغلاق تُقبل
      if (!session.closedAt || at > session.closedAt) throw new BadRequestException('كشف الحصة مغلق');
      return session;
    }
    if (!scanWindowOpen(session.startsAt, session.endsAt, at)) throw new BadRequestException('خارج موعد هذه الحصة');
    if (session.status === 'SCHEDULED') {
      const opened = await tx.classSession.update({ where: { id }, data: { status: 'OPEN', openedAt: at }, include: { group: true } });
      return opened;
    }
    return session;
  }

  private async resolveStudent(tx: Tx, workspaceId: string, input: { token?: string; code?: string }, at = new Date()) {
    if (input.token) {
      const parsed = verifyToken(env().QR_SECRET, input.token, at.getTime());
      if (!parsed) throw new BadRequestException('رمز غير صالح أو منتهي، اطلب من الطالب تحديث الشاشة');
      // الطالب يظهر فقط إن كان مسجلًا في مساحة العمل الحالية (RLS)
      const student = await tx.student.findUnique({ where: { id: parsed.studentId }, select: { id: true, cardVersion: true } });
      if (!student) throw new NotFoundException('الطالب غير مسجل هنا');
      if (student.cardVersion !== parsed.cardVersion) throw new ForbiddenException('هذا الكارنيه ملغى، تم إصدار كارنيه جديد');
      return { studentId: student.id, method: parsed.kind === 'dynamic' ? ('QR_DYNAMIC' as const) : ('QR_CARD' as const) };
    }
    if (input.code) {
      const e = await tx.enrollment.findUnique({ where: { workspaceId_code: { workspaceId, code: input.code } }, select: { studentId: true } });
      if (!e) throw new NotFoundException('لا يوجد طالب بهذا الكود');
      return { studentId: e.studentId, method: 'CODE' as const };
    }
    throw new BadRequestException('أرسل رمز الـQR أو كود الطالب');
  }

  private async record(
    tx: Tx, ws: WorkspaceCtx, session: SessionWithGroup, studentId: string, opts: RecordOpts, pending: NotificationJob[],
  ): Promise<ScanResult> {
    const enrollment = await tx.enrollment.findUnique({
      where: { groupId_studentId: { groupId: session.groupId, studentId } },
      include: { student: true, group: { select: { monthlyFee: true } } },
    });
    if (!enrollment) {
      const other = await tx.enrollment.findFirst({ where: { studentId, status: 'ACTIVE' }, include: { group: { select: { name: true } } } });
      throw new BadRequestException(other ? `الطالب مسجل في مجموعة «${other.group.name}» وليس هذه` : 'الطالب غير مسجل في هذه المجموعة');
    }
    if (enrollment.status === 'WAITLIST') throw new BadRequestException('الطالب في قائمة الانتظار ولم يُفعَّل بعد');

    const dues = await dueViews(tx, ws, [enrollment], cairoMonthOf(session.startsAt));
    const base = {
      ok: true as const,
      studentId,
      studentName: enrollment.student.fullName,
      group: session.group.name,
      enrollmentStatus: enrollment.status,
      due: dues.get(enrollment.id),
    };

    const existing = await tx.attendance.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } });
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { lateAfterMinutes: true } });
    const status = attendanceStatusAt(session.startsAt, opts.at, workspace.lateAfterMinutes);

    if (existing) {
      // غياب تلقائي سُجل عند الإغلاق بينما الطالب كان حاضرًا دون اتصال: يُصحح
      if (existing.method === 'AUTO' && existing.status === 'ABSENT' && opts.offline) {
        await tx.attendance.update({
          where: { id: existing.id },
          data: { status, method: opts.method, offline: true, recordedAt: opts.at, recordedById: ws.userId, clientOpId: opts.clientOpId },
        });
        return { ...base, duplicate: false, status };
      }
      return { ...base, duplicate: true, status: existing.status };
    }

    await tx.attendance.create({
      data: {
        workspaceId: ws.workspaceId,
        sessionId: session.id,
        studentId,
        status,
        method: opts.method,
        offline: opts.offline,
        recordedAt: opts.at,
        recordedById: ws.userId,
        clientOpId: opts.clientOpId,
      },
    });

    if (Date.now() - opts.at.getTime() <= ARRIVAL_NOTIFY_MAX_AGE_MS) {
      pending.push({
        kind: 'arrival',
        userIds: familyIds(enrollment.student),
        workspaceId: ws.workspaceId,
        title: `${enrollment.student.fullName} وصل`,
        body: `حصة ${session.group.name}${status === 'LATE' ? ' (متأخر)' : ''}`,
      });
    }
    return { ...base, duplicate: false, status };
  }

  private async flush(jobs: NotificationJob[]) {
    for (const j of jobs) await this.notify.notify(j);
    if (jobs.length) this.log.debug(`إشعارات الحضور: ${jobs.length}`);
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get('today')
  @RequirePermission('attendance.record')
  today(@Ws() ws: WorkspaceCtx) {
    return this.svc.today(ws);
  }

  @Post('scan')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  scan(@Ws() ws: WorkspaceCtx, @Body() dto: ScanDto) {
    return this.svc.scan(ws, dto);
  }

  @Post('sync')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  sync(@Ws() ws: WorkspaceCtx, @Body() dto: SyncDto) {
    return this.svc.sync(ws, dto.ops);
  }

  @Get('sessions/:id')
  @RequirePermission('attendance.record')
  sheet(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.sheet(ws, id);
  }

  @Post('sessions/:id/open')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  open(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.open(ws, id);
  }

  @Post('sessions/:id/close')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  close(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.close(ws, id);
  }

  @Post('sessions/:id/manual')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  manual(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualDto) {
    return this.svc.manual(ws, id, dto);
  }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}

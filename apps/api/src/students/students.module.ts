import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomInt } from 'node:crypto';
import { makeCardToken } from '../attendance/qr-token';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { can } from '../common/permissions';
import { maskPhone, normalizeEgyptPhone } from '../common/phone';
import { familyIds } from '../common/recipients';
import { assertCan, assertGroupInScope, groupScope, lockKeys, wsScope } from '../common/scope';
import { cairoMonthOf } from '../common/time';
import { env } from '../config/env';
import { dueViews } from '../finance/dues.repo';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const MANAGERS = new Set(['OWNER', 'MANAGER']);

class RegisterDto {
  @IsString() @Length(3, 80)
  fullName!: string;

  @IsString() @Length(1, 40)
  grade!: string;

  @IsOptional() @IsString() @MaxLength(80)
  school?: string;

  @IsString() @MaxLength(32)
  guardianPhone!: string;

  @IsString() @Length(2, 80)
  guardianName!: string;

  @IsUUID()
  groupId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  discountPct?: number;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(60)
  q?: string;

  @IsOptional() @IsUUID()
  groupId?: string;

  @IsOptional() @IsIn(['ACTIVE', 'WAITLIST', 'SUSPENDED', 'LEFT'])
  status?: 'ACTIVE' | 'WAITLIST' | 'SUSPENDED' | 'LEFT';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  page?: number;
}

class UpdateEnrollmentDto {
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'LEFT'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'LEFT';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  discountPct?: number;
}

class TransferDto {
  @IsUUID()
  groupId!: string;
}

class CodeParam {
  @Matches(/^\d{6}$/)
  code!: string;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  /**
   * تسجيل طالب في مجموعة. إن كان مسجلًا سابقًا (نفس ولي الأمر والاسم والصف)
   * في أي سنتر أو عند أي مدرس يُربط بنفس الهوية بدل إنشاء نسخة مكررة.
   */
  async register(ws: WorkspaceCtx, dto: RegisterDto) {
    const phone = normalizeEgyptPhone(dto.guardianPhone);
    if (!phone) throw new BadRequestException('رقم ولي الأمر غير صحيح');
    const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    const grade = dto.grade.trim();
    const discountPct = dto.discountPct ?? 0;
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
    this.assertDiscountAllowed(ws, discountPct, workspace.receptionMaxDiscountPct);

    const guardian = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, name: dto.guardianName.trim() },
    });

    const result = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`group:${dto.groupId}`, `guardian:${guardian.id}`]);
      const group = await tx.group.findUnique({ where: { id: dto.groupId } });
      assertGroupInScope(ws, group);
      if (group!.archived) throw new BadRequestException('المجموعة مؤرشفة');

      const [match] = await tx.$queryRaw<{ id: string | null }[]>`
        SELECT app_match_student(${guardian.id}::uuid, ${fullName}, ${grade})::text AS id`;
      let studentId = match?.id ?? null;
      const matchedExisting = Boolean(studentId);

      if (studentId) {
        const dup = await tx.enrollment.findUnique({ where: { groupId_studentId: { groupId: group!.id, studentId } } });
        if (dup) throw new ConflictException(`الطالب مسجل بالفعل في هذه المجموعة بالكود ${dup.code}`);
      } else {
        const student = await tx.student.create({
          data: { fullName, grade, school: dto.school?.trim() || null, guardianUserId: guardian.id, createdInWorkspaceId: ws.workspaceId },
        });
        studentId = student.id;
      }

      const active = await tx.enrollment.count({ where: { groupId: group!.id, status: 'ACTIVE' } });
      const status = active >= group!.capacity ? 'WAITLIST' : 'ACTIVE';
      const code = await this.newCode(tx, ws.workspaceId);
      const enrollment = await tx.enrollment.create({
        data: { workspaceId: ws.workspaceId, studentId, groupId: group!.id, code, status, discountPct },
      });

      const siblings = await tx.enrollment.count({
        where: { studentId: { not: studentId }, student: { guardianUserId: guardian.id }, status: 'ACTIVE' },
      });
      const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
      await this.audit.log(tx, {
        workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'student.register', entity: 'enrollment',
        entityId: enrollment.id, meta: { matchedExisting, status, discountPct }, ip: ws.ip,
      });
      return { enrollment, student, group: group!, matchedExisting, siblings };
    });

    await this.notify.notify({
      kind: 'consent_request',
      userIds: familyIds(result.student),
      workspaceId: ws.workspaceId,
      title: `تسجيل ${result.student.fullName} في ${workspace.name}`,
      body: `مجموعة ${result.group.name}. افتح تطبيق حصّة للموافقة على التسجيل ومتابعة الحضور والدرجات.`,
    });

    return {
      studentId: result.student.id,
      enrollmentId: result.enrollment.id,
      code: result.enrollment.code,
      status: result.enrollment.status,
      matchedExisting: result.matchedExisting,
      siblingsInWorkspace: result.siblings,
    };
  }

  list(ws: WorkspaceCtx, q: ListQuery) {
    const page = q.page ?? 1;
    const term = q.q?.trim();
    const showPhone = can(ws.role, 'students.write') || can(ws.role, 'finance.dues');
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const where = {
        group: groupScope(ws),
        groupId: q.groupId,
        status: q.status,
        ...(term
          ? /^\d{4,6}$/.test(term)
            ? { code: term }
            : { student: { fullName: { contains: term, mode: 'insensitive' as const } } }
          : {}),
      };
      const total = await tx.enrollment.count({ where });
      const rows = await tx.enrollment.findMany({
        where,
        include: {
          student: { include: { guardian: { select: { name: true, phone: true } } } },
          group: { select: { id: true, name: true, subject: true, monthlyFee: true } },
        },
        orderBy: [{ student: { fullName: 'asc' } }],
        skip: (page - 1) * 50,
        take: 50,
      });
      const dues = await dueViews(tx, ws, rows, cairoMonthOf(new Date()));
      return {
        total,
        page,
        items: rows.map((e) => ({
          enrollmentId: e.id,
          studentId: e.studentId,
          code: e.code,
          status: e.status,
          discountPct: e.discountPct,
          consent: Boolean(e.guardianConsentAt),
          fullName: e.student.fullName,
          grade: e.student.grade,
          school: e.student.school,
          guardianName: e.student.guardian.name,
          guardianPhone: showPhone ? e.student.guardian.phone : maskPhone(e.student.guardian.phone),
          group: { id: e.group.id, name: e.group.name, subject: e.group.subject },
          due: dues.get(e.id),
        })),
      };
    });
  }

  byCode(ws: WorkspaceCtx, code: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await tx.enrollment.findUnique({
        where: { workspaceId_code: { workspaceId: ws.workspaceId, code } },
        include: { group: true },
      });
      if (!e) throw new NotFoundException('لا يوجد طالب بهذا الكود');
      assertGroupInScope(ws, e.group);
      return { studentId: e.studentId, enrollmentId: e.id };
    });
  }

  profile(ws: WorkspaceCtx, studentId: string) {
    const month = cairoMonthOf(new Date());
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { studentId, group: groupScope(ws) },
        include: { group: { select: { id: true, name: true, subject: true, monthlyFee: true, teacher: { select: { user: { select: { name: true } } } } } } },
        orderBy: { createdAt: 'asc' },
      });
      if (!enrollments.length) throw new NotFoundException('الطالب غير موجود');
      const student = await tx.student.findUniqueOrThrow({
        where: { id: studentId },
        include: { guardian: { select: { name: true, phone: true } } },
      });
      const groupIds = enrollments.map((e) => e.groupId);
      const since = new Date(Date.now() - 60 * 86_400_000);
      const attendance = await tx.attendance.findMany({
        where: { studentId, recordedAt: { gte: since }, session: { groupId: { in: groupIds } } },
        include: { session: { select: { startsAt: true, group: { select: { name: true } } } } },
        orderBy: { recordedAt: 'desc' },
        take: 100,
      });
      const attempts = await tx.examAttempt.findMany({
        where: { studentId, submittedAt: { not: null }, exam: { groupId: { in: groupIds } } },
        include: { exam: { select: { title: true, closesAt: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 30,
      });
      const canSeeMoney = can(ws.role, 'finance.collect') || can(ws.role, 'finance.reports');
      const receipts = canSeeMoney
        ? await tx.receipt.findMany({
            where: { studentId },
            select: { id: true, number: true, amount: true, discountAmount: true, method: true, forMonth: true, status: true, createdAt: true, enrollmentId: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : [];
      const dues = await dueViews(tx, ws, enrollments, month);
      const showPhone = can(ws.role, 'students.write') || can(ws.role, 'finance.dues');
      const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 };
      for (const a of attendance) counts[a.status as keyof typeof counts]++;
      return {
        student: {
          id: student.id,
          fullName: student.fullName,
          grade: student.grade,
          school: student.school,
          cardVersion: student.cardVersion,
          guardianName: student.guardian.name,
          guardianPhone: showPhone ? student.guardian.phone : maskPhone(student.guardian.phone),
          sharedIdentity: student.createdInWorkspaceId !== ws.workspaceId,
        },
        enrollments: enrollments.map((e) => ({
          id: e.id,
          code: e.code,
          status: e.status,
          discountPct: e.discountPct,
          consent: Boolean(e.guardianConsentAt),
          group: { id: e.group.id, name: e.group.name, subject: e.group.subject, teacherName: e.group.teacher.user.name },
          due: dues.get(e.id),
        })),
        attendanceSummary: counts,
        attendance: attendance.map((a) => ({ id: a.id, status: a.status, method: a.method, at: a.recordedAt, sessionStartsAt: a.session.startsAt, group: a.session.group.name })),
        results: attempts.map((a) => ({ id: a.id, exam: a.exam.title, score: a.score, maxScore: a.maxScore, late: a.late, submittedAt: a.submittedAt })),
        receipts,
      };
    });
  }

  updateEnrollment(ws: WorkspaceCtx, id: string, dto: UpdateEnrollmentDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await tx.enrollment.findUnique({ where: { id }, include: { group: true } });
      if (!e) throw new NotFoundException('الاشتراك غير موجود');
      assertGroupInScope(ws, e.group);
      if (dto.discountPct !== undefined && dto.discountPct !== e.discountPct) {
        const w = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
        this.assertDiscountAllowed(ws, dto.discountPct, w.receptionMaxDiscountPct);
      }
      if (dto.status === 'ACTIVE' && e.status !== 'ACTIVE') {
        await lockKeys(tx, [`group:${e.groupId}`]);
        const active = await tx.enrollment.count({ where: { groupId: e.groupId, status: 'ACTIVE' } });
        if (active >= e.group.capacity) throw new ConflictException('المجموعة مكتملة العدد');
      }
      const updated = await tx.enrollment.update({ where: { id }, data: { status: dto.status, discountPct: dto.discountPct } });
      await this.audit.log(tx, {
        workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'enrollment.update', entity: 'enrollment', entityId: id,
        meta: { from: { status: e.status, discountPct: e.discountPct }, to: { ...dto } }, ip: ws.ip,
      });
      return updated;
    });
  }

  transfer(ws: WorkspaceCtx, id: string, groupId: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await tx.enrollment.findUnique({ where: { id }, include: { group: true } });
      if (!e) throw new NotFoundException('الاشتراك غير موجود');
      assertGroupInScope(ws, e.group);
      if (e.groupId === groupId) throw new BadRequestException('الطالب في هذه المجموعة بالفعل');
      await lockKeys(tx, [`group:${groupId}`, `group:${e.groupId}`]);
      const target = await tx.group.findUnique({ where: { id: groupId } });
      assertGroupInScope(ws, target);
      if (target!.archived) throw new BadRequestException('المجموعة مؤرشفة');
      const active = await tx.enrollment.count({ where: { groupId, status: 'ACTIVE' } });
      if (e.status === 'ACTIVE' && active >= target!.capacity) throw new ConflictException('المجموعة الجديدة مكتملة العدد');
      const updated = await tx.enrollment.update({ where: { id }, data: { groupId } });
      await this.audit.log(tx, {
        workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'enrollment.transfer', entity: 'enrollment', entityId: id,
        meta: { from: e.groupId, to: groupId }, ip: ws.ip,
      });
      return updated;
    });
  }

  /** بيانات الكارنيه المطبوع: رمز ثابت يُلغى عند إعادة الإصدار */
  card(ws: WorkspaceCtx, studentId: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { studentId, group: groupScope(ws), status: { in: ['ACTIVE', 'WAITLIST', 'SUSPENDED'] } },
        include: { group: { select: { name: true, subject: true } } },
      });
      if (!enrollments.length) throw new NotFoundException('الطالب غير موجود');
      const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { name: true } });
      return {
        workspaceName: workspace.name,
        fullName: student.fullName,
        grade: student.grade,
        cardVersion: student.cardVersion,
        token: makeCardToken(env().QR_SECRET, student.id, student.cardVersion),
        codes: enrollments.map((e) => ({ code: e.code, group: e.group.name, subject: e.group.subject })),
      };
    });
  }

  /** كارنيه مفقود: يُلغى القديم في كل الأماكن لأن الهوية موحدة */
  reissueCard(ws: WorkspaceCtx, studentId: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const enrolled = await tx.enrollment.count({ where: { studentId, group: groupScope(ws) } });
      if (!enrolled) throw new NotFoundException('الطالب غير موجود');
      const s = await tx.student.update({ where: { id: studentId }, data: { cardVersion: { increment: 1 } } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'student.card_reissue', entity: 'student', entityId: studentId, meta: { cardVersion: s.cardVersion }, ip: ws.ip });
      return { cardVersion: s.cardVersion };
    });
  }

  private assertDiscountAllowed(ws: WorkspaceCtx, pct: number, maxPct: number) {
    if (pct <= 0) return;
    assertCan(ws, 'finance.discount', 'منح الخصم غير مسموح لدورك');
    if (!MANAGERS.has(ws.role) && pct > maxPct) {
      throw new ForbiddenException(`الحد الأقصى للخصم المسموح لك ${maxPct}%، اطلب موافقة المدير`);
    }
  }

  /** كود من 6 أرقام فريد داخل مساحة العمل (القيد الفريد في القاعدة هو الضمان النهائي) */
  private async newCode(tx: Tx, workspaceId: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = String(randomInt(100_000, 1_000_000));
      const taken = await tx.enrollment.findUnique({ where: { workspaceId_code: { workspaceId, code } }, select: { id: true } });
      if (!taken) return code;
    }
    throw new ConflictException('تعذر توليد كود، حاول مرة أخرى');
  }
}

@Controller('students')
export class StudentsController {
  constructor(private readonly svc: StudentsService) {}

  @Post()
  @RequirePermission('students.write')
  register(@Ws() ws: WorkspaceCtx, @Body() dto: RegisterDto) {
    return this.svc.register(ws, dto);
  }

  @Get()
  @RequirePermission('students.read')
  list(@Ws() ws: WorkspaceCtx, @Query() q: ListQuery) {
    return this.svc.list(ws, q);
  }

  @Get('by-code/:code')
  @RequirePermission('students.read')
  byCode(@Ws() ws: WorkspaceCtx, @Param() p: CodeParam) {
    return this.svc.byCode(ws, p.code);
  }

  @Get(':id')
  @RequirePermission('students.read')
  profile(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.profile(ws, id);
  }

  @Get(':id/card')
  @RequirePermission('students.read')
  card(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.card(ws, id);
  }

  @Post(':id/card/reissue')
  @HttpCode(200)
  @RequirePermission('students.write')
  reissue(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reissueCard(ws, id);
  }

  @Patch('enrollments/:id')
  @RequirePermission('students.write')
  updateEnrollment(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.svc.updateEnrollment(ws, id, dto);
  }

  @Post('enrollments/:id/transfer')
  @HttpCode(200)
  @RequirePermission('students.write')
  transfer(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) {
    return this.svc.transfer(ws, id, dto.groupId);
  }
}

@Module({ controllers: [StudentsController], providers: [StudentsService] })
export class StudentsModule {}

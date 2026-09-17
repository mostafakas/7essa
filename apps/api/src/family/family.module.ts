import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { IsObject, IsUUID, Matches } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { makeDynamicToken, QR_STEP_SECONDS } from '../attendance/qr-token';
import type { AuthUser } from '../common/context';
import { CurrentUser } from '../common/decorators';
import { toPiasters } from '../common/money';
import { addDays, cairoMonthOf, cairoMonthRange, cairoToUtc } from '../common/time';
import { env } from '../config/env';
import { buildOrder, grade, mapAnswers, type OrderedQuestion } from '../exams/grading';
import { remainingDue } from '../finance/dues';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SUBMIT_GRACE_MS = 60_000;

class MonthQuery {
  @Matches(MONTH) month!: string;
}

class RangeQuery {
  @Matches(DATE) from!: string;
  @Matches(DATE) to!: string;
}

class StartExamDto {
  @IsUUID() studentId!: string;
}

class SubmitDto {
  /** رقم الاختيار كما ظهر للطالب لكل سؤال */
  @IsObject() answers!: Record<string, unknown>;
}

interface PaperRow {
  question_id: string;
  body: string;
  choices: string[];
  qtype: string;
  points: number;
  pos: number;
}

interface KeyRow {
  question_id: string;
  correct_index: number;
  points: number;
  choice_count: number;
}

/**
 * كل استعلامات الأسرة تعمل بسياق المستخدم فقط (بدون مساحة عمل):
 * سياسات guardian_read والدوال الضيقة في security.sql هي ما يحدد المسموح.
 */
@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(user: AuthUser, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ userId: user.id }, fn);
  }

  children(user: AuthUser) {
    const month = cairoMonthOf(new Date());
    return this.run(user, async (tx) => {
      const students = await tx.student.findMany({
        where: { OR: [{ guardianUserId: user.id }, { studentUserId: user.id }] },
        include: {
          enrollments: {
            where: { status: { not: 'LEFT' } },
            include: { group: { select: { id: true, name: true, subject: true, monthlyFee: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const enrollmentIds = students.flatMap((s) => s.enrollments.map((e) => e.id));
      const workspaceIds = [...new Set(students.flatMap((s) => s.enrollments.map((e) => e.workspaceId)))];
      const workspaces = await tx.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, name: true, type: true } });
      const wsName = new Map(workspaces.map((w) => [w.id, w]));
      const teachers = await tx.$queryRaw<{ group_id: string; teacher_name: string }[]>`
        SELECT group_id::text, teacher_name FROM app_guardian_group_teachers()`;
      const teacherOf = new Map(teachers.map((t) => [t.group_id, t.teacher_name]));
      const paid = enrollmentIds.length
        ? await tx.receipt.groupBy({
            by: ['enrollmentId'],
            where: { enrollmentId: { in: enrollmentIds }, forMonth: month, status: { in: ['VALID', 'CANCEL_REQUESTED'] } },
            _sum: { amount: true, discountAmount: true },
          })
        : [];
      const paidOf = new Map(paid.map((p) => [p.enrollmentId, p._sum]));
      const since = new Date(Date.now() - 30 * 86_400_000);
      const att = await tx.attendance.groupBy({
        by: ['studentId', 'status'],
        where: { studentId: { in: students.map((s) => s.id) }, recordedAt: { gte: since } },
        _count: true,
      });

      return students.map((s) => {
        const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 };
        for (const a of att.filter((x) => x.studentId === s.id)) counts[a.status as keyof typeof counts] = a._count;
        return {
          id: s.id,
          fullName: s.fullName,
          grade: s.grade,
          school: s.school,
          isGuardian: s.guardianUserId === user.id,
          attendance30d: counts,
          enrollments: s.enrollments.map((e) => {
            const p = paidOf.get(e.id);
            const remaining = remainingDue({
              monthlyFee: toPiasters(e.group.monthlyFee),
              discountPct: e.discountPct,
              paid: toPiasters(p?.amount),
              discounted: toPiasters(p?.discountAmount),
            });
            return {
              id: e.id,
              code: e.code,
              status: e.status,
              consentPending: !e.guardianConsentAt,
              workspace: wsName.get(e.workspaceId)?.name ?? '—',
              workspaceType: wsName.get(e.workspaceId)?.type ?? null,
              group: e.group.name,
              subject: e.group.subject,
              teacher: teacherOf.get(e.group.id) ?? null,
              month,
              remaining,
            };
          }),
        };
      });
    });
  }

  /** رمز حضور متغير كل دقيقة: صورة الشاشة لا تصلح بعد انتهاء الدقيقة */
  qr(user: AuthUser, studentId: string) {
    return this.run(user, async (tx) => {
      const s = await this.childOrThrow(tx, user, studentId);
      const now = Date.now();
      const step = QR_STEP_SECONDS * 1000;
      return {
        token: makeDynamicToken(env().QR_SECRET, s.id, s.cardVersion, now),
        refreshInSeconds: Math.max(1, Math.ceil((step - (now % step)) / 1000)),
        fullName: s.fullName,
      };
    });
  }

  attendance(user: AuthUser, studentId: string, month: string) {
    const { start, end } = cairoMonthRange(month);
    return this.run(user, async (tx) => {
      await this.childOrThrow(tx, user, studentId);
      const rows = await tx.attendance.findMany({
        where: { studentId, session: { startsAt: { gte: start, lt: end } } },
        include: { session: { select: { startsAt: true, group: { select: { name: true, subject: true } } } } },
        orderBy: { session: { startsAt: 'desc' } },
      });
      return rows.map((a) => ({ id: a.id, status: a.status, at: a.recordedAt, sessionStartsAt: a.session.startsAt, group: a.session.group.name, subject: a.session.group.subject }));
    });
  }

  receipts(user: AuthUser, studentId: string) {
    return this.run(user, async (tx) => {
      await this.childOrThrow(tx, user, studentId);
      const rows = await tx.receipt.findMany({
        where: { studentId },
        select: {
          id: true, number: true, amount: true, discountAmount: true, method: true, forMonth: true, status: true, createdAt: true, workspaceId: true,
          enrollment: { select: { group: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
      });
      const ws = await tx.workspace.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.workspaceId))] } }, select: { id: true, name: true } });
      const name = new Map(ws.map((w) => [w.id, w.name]));
      return rows.map(({ workspaceId, enrollment, ...r }) => ({ ...r, workspace: name.get(workspaceId) ?? '—', group: enrollment.group.name }));
    });
  }

  results(user: AuthUser, studentId: string) {
    return this.run(user, async (tx) => {
      await this.childOrThrow(tx, user, studentId);
      const rows = await tx.examAttempt.findMany({
        where: { studentId, submittedAt: { not: null } },
        include: { exam: { select: { title: true, showResultImmediately: true, status: true, closesAt: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 50,
      });
      return rows.map((a) => {
        const visible = this.resultVisible(a.exam);
        return {
          attemptId: a.id,
          exam: a.exam.title,
          submittedAt: a.submittedAt,
          late: a.late,
          score: visible ? a.score : null,
          maxScore: visible ? a.maxScore : null,
          pendingRelease: !visible,
        };
      });
    });
  }

  schedule(user: AuthUser, q: RangeQuery) {
    const from = cairoToUtc(q.from, '00:00');
    const to = cairoToUtc(addDays(q.to, 1), '00:00');
    if (to <= from || to.getTime() - from.getTime() > 62 * 86_400_000) throw new BadRequestException('الفترة يجب ألا تتجاوز شهرين');
    return this.run(user, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`
        SELECT session_id::text AS "sessionId", starts_at AS "startsAt", ends_at AS "endsAt", status,
               cancel_reason AS "cancelReason", group_id::text AS "groupId", group_name AS "group", subject,
               teacher_name AS "teacher", hall_name AS "hall", workspace_name AS "workspace"
        FROM app_guardian_schedule(${from}, ${to})`,
    );
  }

  consent(user: AuthUser, enrollmentId: string) {
    return this.run(user, async (tx) => {
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_guardian_consent(${enrollmentId}::uuid) AS ok`;
      if (!row?.ok) throw new NotFoundException('لا يوجد طلب موافقة معلق لهذا الاشتراك');
      await tx.auditLog.createMany({ data: [{ actorUserId: user.id, action: 'guardian.consent', entity: 'enrollment', entityId: enrollmentId }] });
      return { consented: true };
    });
  }

  // ───────── الامتحانات

  exams(user: AuthUser) {
    return this.run(user, async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { status: 'ACTIVE', student: { OR: [{ guardianUserId: user.id }, { studentUserId: user.id }] } },
        select: { groupId: true, studentId: true, student: { select: { fullName: true } } },
      });
      const exams = await tx.exam.findMany({
        where: { status: 'PUBLISHED', closesAt: { gt: new Date() }, groupId: { in: enrollments.map((e) => e.groupId) } },
        include: { group: { select: { name: true, subject: true } } },
        orderBy: { opensAt: 'asc' },
      });
      const attempts = await tx.examAttempt.findMany({
        where: { examId: { in: exams.map((e) => e.id) } },
        select: { id: true, examId: true, studentId: true, submittedAt: true, deadlineAt: true },
      });
      const now = new Date();
      return exams.flatMap((x) =>
        enrollments
          .filter((e) => e.groupId === x.groupId)
          .map((e) => {
            const a = attempts.find((t) => t.examId === x.id && t.studentId === e.studentId);
            return {
              examId: x.id,
              title: x.title,
              group: x.group?.name ?? null,
              subject: x.group?.subject ?? null,
              durationMin: x.durationMin,
              opensAt: x.opensAt,
              closesAt: x.closesAt,
              studentId: e.studentId,
              studentName: e.student.fullName,
              attemptId: a?.id ?? null,
              state: a?.submittedAt ? 'SUBMITTED' : a ? (a.deadlineAt > now ? 'IN_PROGRESS' : 'EXPIRED') : x.opensAt > now ? 'UPCOMING' : 'AVAILABLE',
            };
          }),
      );
    });
  }

  startExam(user: AuthUser, examId: string, studentId: string) {
    return this.run(user, async (tx) => {
      await this.childOrThrow(tx, user, studentId);
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam || exam.status !== 'PUBLISHED' || !exam.groupId) throw new NotFoundException('الامتحان غير متاح');
      const now = new Date();
      if (now < exam.opensAt) throw new BadRequestException('لم يبدأ الامتحان بعد');
      if (now >= exam.closesAt) throw new BadRequestException('انتهى وقت الامتحان');
      const enrollment = await tx.enrollment.findUnique({ where: { groupId_studentId: { groupId: exam.groupId, studentId } } });
      if (!enrollment || enrollment.status !== 'ACTIVE') throw new ForbiddenException('الطالب غير مسجل في مجموعة هذا الامتحان');

      const existing = await tx.examAttempt.findUnique({ where: { examId_studentId: { examId, studentId } } });
      if (existing?.submittedAt) throw new ConflictException('تم تسليم هذا الامتحان بالفعل');
      if (existing && existing.deadlineAt.getTime() + SUBMIT_GRACE_MS < now.getTime()) {
        throw new BadRequestException('انتهى وقت محاولتك في هذا الامتحان');
      }

      const paper = await this.paper(tx, examId);
      let attempt = existing;
      if (!attempt) {
        const order = buildOrder(
          paper.map((p) => ({ id: p.question_id, correctIndex: -1, points: p.points, choiceCount: p.choices.length })),
          `${examId}:${studentId}`,
          exam.shuffle,
        );
        const deadlineAt = new Date(Math.min(now.getTime() + exam.durationMin * 60_000, exam.closesAt.getTime()));
        attempt = await tx.examAttempt.create({
          data: {
            workspaceId: exam.workspaceId,
            examId,
            studentId,
            deadlineAt,
            questionOrder: order as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return this.presentPaper(attempt.id, attempt.deadlineAt, exam.title, attempt.questionOrder as unknown as OrderedQuestion[], paper);
    });
  }

  attempt(user: AuthUser, attemptId: string) {
    return this.run(user, async (tx) => {
      const a = await tx.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
      if (!a) throw new NotFoundException('المحاولة غير موجودة');
      const order = a.questionOrder as unknown as OrderedQuestion[];
      const paper = await this.paper(tx, a.examId);
      if (!a.submittedAt) {
        if (a.deadlineAt.getTime() + SUBMIT_GRACE_MS < Date.now()) {
          return { attemptId: a.id, state: 'EXPIRED' as const, title: a.exam.title };
        }
        return this.presentPaper(a.id, a.deadlineAt, a.exam.title, order, paper);
      }
      return this.presentResult(tx, a, order, paper);
    });
  }

  /**
   * التسليم يُسجل أولًا، ثم يُطلب مفتاح التصحيح (الدالة ترفض قبل التسليم)،
   * فلا يمكن الحصول على الإجابات الصحيحة قبل إغلاق المحاولة.
   */
  submit(user: AuthUser, attemptId: string, answers: Record<string, unknown>) {
    return this.run(user, async (tx) => {
      const a = await tx.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
      if (!a) throw new NotFoundException('المحاولة غير موجودة');
      if (a.submittedAt) throw new ConflictException('تم التسليم بالفعل');
      const now = new Date();
      const order = a.questionOrder as unknown as OrderedQuestion[];
      const mapped = mapAnswers(order, answers ?? {});
      const late = now.getTime() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS;

      const locked = await tx.examAttempt.updateMany({
        where: { id: a.id, submittedAt: null },
        data: { submittedAt: now, answers: mapped as Prisma.InputJsonValue, late },
      });
      if (locked.count === 0) throw new ConflictException('تم التسليم بالفعل');

      const key = await tx.$queryRaw<KeyRow[]>`
        SELECT question_id::text, correct_index, points, choice_count FROM app_exam_key(${a.id}::uuid)`;
      const g = grade(
        key.map((k) => ({ id: k.question_id, correctIndex: k.correct_index, points: k.points, choiceCount: k.choice_count })),
        mapped,
      );
      const saved = await tx.examAttempt.update({
        where: { id: a.id },
        data: { score: g.score, maxScore: g.maxScore, results: g.results as Prisma.InputJsonValue },
        include: { exam: true },
      });
      const paper = await this.paper(tx, a.examId);
      return this.presentResult(tx, saved, order, paper);
    });
  }

  // ───────── مساعدات

  private async childOrThrow(tx: Tx, user: AuthUser, studentId: string) {
    const s = await tx.student.findFirst({
      where: { id: studentId, OR: [{ guardianUserId: user.id }, { studentUserId: user.id }] },
    });
    if (!s) throw new NotFoundException('الطالب غير موجود');
    return s;
  }

  private async paper(tx: Tx, examId: string): Promise<PaperRow[]> {
    const rows = await tx.$queryRaw<PaperRow[]>`
      SELECT question_id::text, body, choices, qtype, points, pos FROM app_exam_paper(${examId}::uuid)`;
    return rows.map((r) => ({ ...r, choices: Array.isArray(r.choices) ? r.choices.map(String) : [] }));
  }

  private presentPaper(attemptId: string, deadlineAt: Date, title: string, order: OrderedQuestion[], paper: PaperRow[]) {
    const byId = new Map(paper.map((p) => [p.question_id, p]));
    return {
      attemptId,
      state: 'IN_PROGRESS' as const,
      title,
      deadlineAt,
      serverNow: new Date(),
      questions: order
        .filter((o) => byId.has(o.id))
        .map((o, i) => {
          const p = byId.get(o.id)!;
          return { id: o.id, n: i + 1, type: p.qtype, body: p.body, points: p.points, choices: o.perm.map((k) => p.choices[k]) };
        }),
    };
  }

  private resultVisible(exam: { showResultImmediately: boolean; status: string; closesAt: Date }) {
    return exam.showResultImmediately || exam.status === 'CLOSED' || exam.closesAt <= new Date();
  }

  /** النتيجة: الدرجة حسب إعداد المدرس، والإجابات النموذجية بعد إغلاق الامتحان فقط */
  private async presentResult(
    tx: Tx,
    a: { id: string; score: number | null; maxScore: number | null; late: boolean; submittedAt: Date | null; answers: Prisma.JsonValue; results: Prisma.JsonValue; exam: { title: string; showResultImmediately: boolean; status: string; closesAt: Date } },
    order: OrderedQuestion[],
    paper: PaperRow[],
  ) {
    const visible = this.resultVisible(a.exam);
    const closed = a.exam.status === 'CLOSED' || a.exam.closesAt <= new Date();
    const base = { attemptId: a.id, state: 'SUBMITTED' as const, title: a.exam.title, submittedAt: a.submittedAt, late: a.late };
    if (!visible) return { ...base, released: false };

    const results = (a.results ?? {}) as Record<string, boolean>;
    const answers = (a.answers ?? {}) as Record<string, number | null>;
    const key: KeyRow[] = closed
      ? await tx.$queryRaw<KeyRow[]>`SELECT question_id::text, correct_index, points, choice_count FROM app_exam_key(${a.id}::uuid)`
      : [];
    const keyOf = new Map<string, number>(key.map((k) => [k.question_id, k.correct_index]));
    const byId = new Map(paper.map((p) => [p.question_id, p]));
    return {
      ...base,
      released: true,
      score: a.score,
      maxScore: a.maxScore,
      questions: order
        .filter((o) => byId.has(o.id))
        .map((o, i) => {
          const p = byId.get(o.id)!;
          const chosen = answers[o.id];
          const correct = keyOf.get(o.id);
          return {
            id: o.id,
            n: i + 1,
            body: p.body,
            choices: o.perm.map((k) => p.choices[k]),
            chosen: chosen === null || chosen === undefined ? null : o.perm.indexOf(chosen),
            correct: results[o.id] ?? false,
            modelAnswer: correct === undefined ? null : o.perm.indexOf(correct),
          };
        }),
    };
  }
}

@Controller('family')
export class FamilyController {
  constructor(private readonly svc: FamilyService) {}

  @Get('children')
  children(@CurrentUser() user: AuthUser) {
    return this.svc.children(user);
  }

  @Get('children/:id/qr')
  qr(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.qr(user, id);
  }

  @Get('children/:id/attendance')
  attendance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MonthQuery) {
    return this.svc.attendance(user, id, q.month);
  }

  @Get('children/:id/receipts')
  receipts(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.receipts(user, id);
  }

  @Get('children/:id/results')
  results(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.results(user, id);
  }

  @Get('schedule')
  schedule(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.svc.schedule(user, q);
  }

  @Post('consents/:enrollmentId')
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Param('enrollmentId', ParseUUIDPipe) id: string) {
    return this.svc.consent(user, id);
  }

  @Get('exams')
  exams(@CurrentUser() user: AuthUser) {
    return this.svc.exams(user);
  }

  @Post('exams/:id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartExamDto) {
    return this.svc.startExam(user, id, dto.studentId);
  }

  @Get('attempts/:id')
  attempt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.attempt(user, id);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDto) {
    return this.svc.submit(user, id, dto.answers);
  }
}

@Module({ controllers: [FamilyController], providers: [FamilyService] })
export class FamilyModule {}

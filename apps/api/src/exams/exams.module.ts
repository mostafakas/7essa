import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { formatCairo } from '../common/format';
import { groupFamilyIds } from '../common/recipients';
import { assertGroupInScope, groupScope, wsScope } from '../common/scope';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { grade, itemAnalysis, shuffled } from './grading';

const MAX_QUESTIONS = 100;
const TRUE_FALSE = ['صح', 'خطأ'];

class QuestionDto {
  @IsIn(['MCQ', 'TRUE_FALSE']) type!: 'MCQ' | 'TRUE_FALSE';
  @IsString() @Length(3, 2000) body!: string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @IsString({ each: true }) @Length(1, 300, { each: true })
  choices?: string[];
  @Type(() => Number) @IsInt() @Min(0) @Max(5) correctIndex!: number;
  @IsString() @Length(2, 60) subject!: string;
  @IsString() @Length(1, 40) grade!: string;
  @IsOptional() @IsString() @MaxLength(80) unit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3) difficulty?: number;
  @IsOptional() @IsIn(['remember', 'understand', 'apply', 'analyze']) bloom?: string;
  @IsOptional() @IsBoolean() shared?: boolean;
}

class ImportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QuestionDto)
  questions!: QuestionDto[];
}

class BankQuery {
  @IsOptional() @IsString() @MaxLength(60) subject?: string;
  @IsOptional() @IsString() @MaxLength(40) grade?: string;
  @IsOptional() @IsString() @MaxLength(80) unit?: string;
}

class ItemDto {
  @IsUUID() questionId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) points?: number;
}

class BlueprintDto {
  @IsOptional() @IsString() @MaxLength(80) unit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3) difficulty?: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_QUESTIONS) count!: number;
}

class ExamDto {
  @IsString() @Length(3, 120) title!: string;
  @IsUUID() groupId!: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(300) durationMin!: number;
  @IsDateString() opensAt!: string;
  @IsDateString() closesAt!: string;
  @IsOptional() @IsBoolean() showResultImmediately?: boolean;
  @IsOptional() @IsBoolean() shuffle?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_QUESTIONS) @ValidateNested({ each: true }) @Type(() => ItemDto)
  items?: ItemDto[];
  /** بناء تلقائي من البنك حسب الوحدة والصعوبة */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BlueprintDto)
  blueprint?: BlueprintDto[];
}

class PaperResultDto {
  @IsUUID() studentId!: string;
  /** رقم الاختيار الأصلي لكل سؤال (الورقة غير مخلوطة) */
  @IsObject() answers!: Record<string, number | null>;
}

class UpdateExamDto {
  @IsOptional() @IsDateString() closesAt?: string;
  @IsOptional() @IsBoolean() showResultImmediately?: boolean;
}

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── بنك الأسئلة

  bank(ws: WorkspaceCtx, q: BankQuery) {
    return this.prisma.scoped(wsScope(ws), (tx) =>
      tx.question.findMany({
        where: {
          subject: q.subject,
          grade: q.grade,
          unit: q.unit,
          ...(ws.teacherScopeId ? { OR: [{ ownerMembershipId: ws.teacherScopeId }, { shared: true }] } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }

  createQuestions(ws: WorkspaceCtx, list: QuestionDto[]) {
    const data = list.map((q) => this.normalizeQuestion(ws, q));
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const r = await tx.question.createMany({ data });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'question.create', entity: 'question', meta: { count: r.count }, ip: ws.ip });
      return { created: r.count };
    });
  }

  updateQuestion(ws: WorkspaceCtx, id: string, dto: QuestionDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const q = await tx.question.findUnique({ where: { id } });
      if (!q || (ws.teacherScopeId && q.ownerMembershipId !== ws.teacherScopeId)) throw new NotFoundException('السؤال غير موجود');
      const used = await tx.examQuestion.count({ where: { questionId: id, exam: { status: { not: 'DRAFT' } } } });
      if (used) throw new ConflictException('السؤال مستخدم في امتحان منشور؛ أنشئ نسخة جديدة بدل تعديله');
      const { ownerMembershipId: _o, workspaceId: _w, ...data } = this.normalizeQuestion(ws, dto);
      return tx.question.update({ where: { id }, data });
    });
  }

  // ───────── الامتحانات

  exams(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.exam.findMany({
        where: { group: groupScope(ws) },
        include: {
          group: { select: { name: true } },
          _count: { select: { questions: true, attempts: { where: { submittedAt: { not: null } } } } },
        },
        orderBy: { opensAt: 'desc' },
        take: 200,
      });
      return rows.map((e) => ({
        id: e.id, title: e.title, status: e.status, group: e.group?.name ?? null, groupId: e.groupId,
        opensAt: e.opensAt, closesAt: e.closesAt, durationMin: e.durationMin,
        questions: e._count.questions, submitted: e._count.attempts,
      }));
    });
  }

  createExam(ws: WorkspaceCtx, dto: ExamDto) {
    const opensAt = new Date(dto.opensAt);
    const closesAt = new Date(dto.closesAt);
    if (closesAt <= opensAt) throw new BadRequestException('موعد الإغلاق يجب أن يكون بعد الفتح');
    if (closesAt.getTime() - opensAt.getTime() < dto.durationMin * 60_000) throw new BadRequestException('نافذة الامتحان أقصر من مدته');
    if (!dto.items?.length && !dto.blueprint?.length) throw new BadRequestException('اختر الأسئلة أو حدد مواصفات البناء');

    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const group = await tx.group.findUnique({ where: { id: dto.groupId } });
      assertGroupInScope(ws, group);
      const accessible = { ...(ws.teacherScopeId ? { OR: [{ ownerMembershipId: ws.teacherScopeId }, { shared: true }] } : {}) };

      const chosen: { questionId: string; points: number }[] = [];
      if (dto.items?.length) {
        const ids = [...new Set(dto.items.map((i) => i.questionId))];
        const found = await tx.question.findMany({ where: { id: { in: ids }, ...accessible }, select: { id: true } });
        if (found.length !== ids.length) throw new BadRequestException('بعض الأسئلة غير متاحة');
        const seen = new Set<string>();
        for (const i of dto.items) {
          if (seen.has(i.questionId)) continue;
          seen.add(i.questionId);
          chosen.push({ questionId: i.questionId, points: i.points ?? 1 });
        }
      }
      for (const spec of dto.blueprint ?? []) {
        const candidates = await tx.question.findMany({
          where: {
            subject: group!.subject,
            grade: group!.grade,
            unit: spec.unit,
            difficulty: spec.difficulty,
            id: { notIn: chosen.map((c) => c.questionId) },
            ...accessible,
          },
          select: { id: true },
        });
        if (candidates.length < spec.count) {
          throw new BadRequestException(`البنك لا يحتوي ${spec.count} سؤال${spec.unit ? ` في «${spec.unit}»` : ''} (المتاح ${candidates.length})`);
        }
        for (const c of shuffled(candidates, randomUUID()).slice(0, spec.count)) chosen.push({ questionId: c.id, points: 1 });
      }
      if (chosen.length > MAX_QUESTIONS) throw new BadRequestException(`الحد الأقصى ${MAX_QUESTIONS} سؤال`);

      const exam = await tx.exam.create({
        data: {
          workspaceId: ws.workspaceId,
          groupId: group!.id,
          title: dto.title.trim(),
          durationMin: dto.durationMin,
          opensAt,
          closesAt,
          showResultImmediately: dto.showResultImmediately ?? true,
          shuffle: dto.shuffle ?? true,
          createdById: ws.userId,
        },
      });
      await tx.examQuestion.createMany({
        data: chosen.map((c, position) => ({ examId: exam.id, questionId: c.questionId, workspaceId: ws.workspaceId, position, points: c.points })),
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'exam.create', entity: 'exam', entityId: exam.id, meta: { questions: chosen.length }, ip: ws.ip });
      return { ...exam, questions: chosen.length };
    });
  }

  exam(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      const items = await tx.examQuestion.findMany({ where: { examId: id }, include: { question: true }, orderBy: { position: 'asc' } });
      return {
        ...e,
        group: e.group?.name ?? null,
        questions: items.map((i) => ({
          id: i.questionId, position: i.position, points: i.points, type: i.question.type, body: i.question.body,
          choices: i.question.choices, correctIndex: i.question.correctIndex, unit: i.question.unit, difficulty: i.question.difficulty,
        })),
      };
    });
  }

  update(ws: WorkspaceCtx, id: string, dto: UpdateExamDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      if (e.status === 'CLOSED') throw new BadRequestException('الامتحان مغلق');
      if (dto.closesAt && new Date(dto.closesAt) <= e.opensAt) throw new BadRequestException('موعد الإغلاق قبل الفتح');
      return tx.exam.update({
        where: { id },
        data: { closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined, showResultImmediately: dto.showResultImmediately },
      });
    });
  }

  async publish(ws: WorkspaceCtx, id: string) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      if (e.status !== 'DRAFT') throw new BadRequestException('الامتحان منشور بالفعل');
      if (e.closesAt <= new Date()) throw new BadRequestException('موعد إغلاق الامتحان مضى');
      const count = await tx.examQuestion.count({ where: { examId: id } });
      if (!count) throw new BadRequestException('الامتحان بلا أسئلة');
      const updated = await tx.exam.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'exam.publish', entity: 'exam', entityId: id, ip: ws.ip });
      if (e.groupId) {
        pending.push({
          kind: 'exam_published',
          userIds: await groupFamilyIds(tx, e.groupId),
          workspaceId: ws.workspaceId,
          title: `امتحان جديد: ${e.title}`,
          body: `يبدأ ${formatCairo(e.opensAt)} ومدته ${e.durationMin} دقيقة.`,
        });
      }
      return updated;
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  close(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      if (e.status !== 'PUBLISHED') throw new BadRequestException('الامتحان غير منشور');
      return tx.exam.update({ where: { id }, data: { status: 'CLOSED', closesAt: e.closesAt > new Date() ? new Date() : e.closesAt } });
    });
  }

  /** إدخال نتيجة امتحان ورقي (أو ناتج قراءة البابل شيت لاحقًا) */
  paperResult(ws: WorkspaceCtx, id: string, dto: PaperResultDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      if (!e.groupId) throw new BadRequestException('الامتحان غير مرتبط بمجموعة');
      const enrolled = await tx.enrollment.findUnique({ where: { groupId_studentId: { groupId: e.groupId, studentId: dto.studentId } } });
      if (!enrolled) throw new BadRequestException('الطالب غير مسجل في مجموعة الامتحان');
      const key = await this.key(tx, id);
      const answers: Record<string, number | null> = {};
      for (const q of key) {
        const v = dto.answers[q.id];
        answers[q.id] = Number.isInteger(v) && (v as number) >= 0 && (v as number) < q.choiceCount ? (v as number) : null;
      }
      const g = grade(key, answers);
      const order = key.map((q) => ({ id: q.id, perm: Array.from({ length: q.choiceCount }, (_, i) => i) }));
      const now = new Date();
      const data = {
        answers: answers as Prisma.InputJsonValue,
        results: g.results as Prisma.InputJsonValue,
        score: g.score,
        maxScore: g.maxScore,
        submittedAt: now,
        questionOrder: order as unknown as Prisma.InputJsonValue,
        late: false,
      };
      const attempt = await tx.examAttempt.upsert({
        where: { examId_studentId: { examId: id, studentId: dto.studentId } },
        create: { workspaceId: ws.workspaceId, examId: id, studentId: dto.studentId, startedAt: now, deadlineAt: now, ...data },
        update: data,
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'exam.paper_result', entity: 'attempt', entityId: attempt.id, meta: { score: g.score }, ip: ws.ip });
      return { attemptId: attempt.id, score: g.score, maxScore: g.maxScore };
    });
  }

  results(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const e = await this.examOrThrow(tx, ws, id);
      const attempts = await tx.examAttempt.findMany({
        where: { examId: id },
        include: { student: { select: { fullName: true } } },
        orderBy: [{ score: 'desc' }, { submittedAt: 'asc' }],
      });
      const submitted = attempts.filter((a) => a.submittedAt && a.score !== null);
      const key = await this.key(tx, id);
      const analysis = itemAnalysis(
        submitted.map((a) => ({ score: a.score ?? 0, results: (a.results ?? {}) as Record<string, boolean> })),
        key.map((q) => q.id),
      );
      const bodies = await tx.question.findMany({ where: { id: { in: key.map((k) => k.id) } }, select: { id: true, body: true, unit: true } });
      const bodyOf = new Map(bodies.map((b) => [b.id, b]));
      const max = key.reduce((t, q) => t + q.points, 0);
      const buckets = [0, 0, 0, 0, 0]; // <50، 50-64، 65-74، 75-84، 85+
      for (const a of submitted) {
        const pct = max ? ((a.score ?? 0) / max) * 100 : 0;
        buckets[pct < 50 ? 0 : pct < 65 ? 1 : pct < 75 ? 2 : pct < 85 ? 3 : 4]++;
      }
      let rank = 0;
      let last: number | null = null;
      return {
        exam: { id: e.id, title: e.title, status: e.status, maxScore: max, group: e.group?.name ?? null },
        stats: {
          started: attempts.length,
          submitted: submitted.length,
          average: submitted.length ? Number((submitted.reduce((t, a) => t + (a.score ?? 0), 0) / submitted.length).toFixed(2)) : 0,
          distribution: [
            { label: 'أقل من 50%', count: buckets[0] },
            { label: '50–64%', count: buckets[1] },
            { label: '65–74%', count: buckets[2] },
            { label: '75–84%', count: buckets[3] },
            { label: '85% فأكثر', count: buckets[4] },
          ],
        },
        attempts: attempts.map((a, i) => {
          if (a.score !== null && a.score !== last) {
            rank = i + 1;
            last = a.score;
          }
          return {
            id: a.id, student: a.student.fullName, studentId: a.studentId, score: a.score, maxScore: a.maxScore,
            rank: a.score !== null ? rank : null, late: a.late, startedAt: a.startedAt, submittedAt: a.submittedAt,
          };
        }),
        items: analysis.map((x, i) => ({
          ...x,
          position: i + 1,
          body: bodyOf.get(x.questionId)?.body ?? '',
          unit: bodyOf.get(x.questionId)?.unit ?? null,
          flag: x.answered >= 5 && (x.facility < 0.2 || x.facility > 0.95 || x.discrimination < 0.1) ? 'راجع السؤال' : null,
        })),
      };
    });
  }

  // ───────── مساعدات

  private normalizeQuestion(ws: WorkspaceCtx, q: QuestionDto) {
    const choices = q.type === 'TRUE_FALSE' ? TRUE_FALSE : (q.choices ?? []).map((c) => c.trim());
    if (q.type === 'MCQ' && choices.length < 2) throw new BadRequestException('سؤال الاختيار يحتاج اختيارين على الأقل');
    if (new Set(choices).size !== choices.length) throw new BadRequestException('الاختيارات مكررة');
    if (q.correctIndex >= choices.length) throw new BadRequestException('رقم الإجابة الصحيحة خارج الاختيارات');
    return {
      workspaceId: ws.workspaceId,
      ownerMembershipId: ws.teacherScopeId ?? ws.membershipId,
      shared: q.shared ?? false,
      subject: q.subject.trim(),
      grade: q.grade.trim(),
      unit: q.unit?.trim() || null,
      type: q.type,
      body: q.body.trim(),
      choices,
      correctIndex: q.correctIndex,
      difficulty: q.difficulty ?? 2,
      bloom: q.bloom ?? null,
    };
  }

  private async examOrThrow(tx: Tx, ws: WorkspaceCtx, id: string) {
    const e = await tx.exam.findUnique({ where: { id }, include: { group: true } });
    if (!e) throw new NotFoundException('الامتحان غير موجود');
    if (ws.teacherScopeId && (!e.group || e.group.teacherMembershipId !== ws.teacherScopeId)) throw new NotFoundException('الامتحان غير موجود');
    return e;
  }

  private async key(tx: Tx, examId: string) {
    const items = await tx.examQuestion.findMany({
      where: { examId },
      include: { question: { select: { correctIndex: true, choices: true } } },
      orderBy: { position: 'asc' },
    });
    return items.map((i) => ({
      id: i.questionId,
      correctIndex: i.question.correctIndex,
      points: i.points,
      choiceCount: Array.isArray(i.question.choices) ? i.question.choices.length : 0,
    }));
  }
}

@Controller('exams')
export class ExamsController {
  constructor(private readonly svc: ExamsService) {}

  @Get('questions')
  @RequirePermission('exams.manage')
  bank(@Ws() ws: WorkspaceCtx, @Query() q: BankQuery) {
    return this.svc.bank(ws, q);
  }

  @Post('questions')
  @RequirePermission('exams.manage')
  createQuestion(@Ws() ws: WorkspaceCtx, @Body() dto: QuestionDto) {
    return this.svc.createQuestions(ws, [dto]);
  }

  @Post('questions/import')
  @RequirePermission('exams.manage')
  importQuestions(@Ws() ws: WorkspaceCtx, @Body() dto: ImportDto) {
    return this.svc.createQuestions(ws, dto.questions);
  }

  @Patch('questions/:id')
  @RequirePermission('exams.manage')
  updateQuestion(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuestionDto) {
    return this.svc.updateQuestion(ws, id, dto);
  }

  @Get()
  @RequirePermission('exams.grade')
  list(@Ws() ws: WorkspaceCtx) {
    return this.svc.exams(ws);
  }

  @Post()
  @RequirePermission('exams.manage')
  create(@Ws() ws: WorkspaceCtx, @Body() dto: ExamDto) {
    return this.svc.createExam(ws, dto);
  }

  @Get(':id')
  @RequirePermission('exams.grade')
  get(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.exam(ws, id);
  }

  @Patch(':id')
  @RequirePermission('exams.manage')
  update(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExamDto) {
    return this.svc.update(ws, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('exams.manage')
  publish(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publish(ws, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('exams.manage')
  close(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.close(ws, id);
  }

  @Post(':id/paper-results')
  @HttpCode(200)
  @RequirePermission('exams.grade')
  paper(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaperResultDto) {
    return this.svc.paperResult(ws, id, dto);
  }

  @Get(':id/results')
  @RequirePermission('exams.grade')
  results(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.results(ws, id);
  }
}

@Module({ controllers: [ExamsController], providers: [ExamsService] })
export class ExamsModule {}

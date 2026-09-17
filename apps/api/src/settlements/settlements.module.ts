import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Prisma, Settlement, TeacherContract } from '@prisma/client';
import { ContractType, PaymentMethod } from '@prisma/client';
import { billableHours } from '../academics/schedule';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { formatEgp } from '../common/format';
import { toDecimalString, toPiasters } from '../common/money';
import { can } from '../common/permissions';
import { managerIds } from '../common/recipients';
import { lockKeys, wsScope } from '../common/scope';
import { cairoMonthRange, shiftMonth } from '../common/time';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { calculateSettlement, type ContractTerms } from './settlement.calc';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = new Set(['DRAFT', 'DISPUTED']);

class ContractDto {
  @IsUUID() teacherMembershipId!: string;
  @IsIn(Object.values(ContractType)) type!: ContractType;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) teacherPct?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) hourlyRent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) perStudentAmount?: number;
  @Matches(DATE) startsOn!: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class EndContractDto {
  @Matches(DATE) endsOn!: string;
}

class AdvanceDto {
  @IsUUID() teacherMembershipId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000) amount!: number;
  @Matches(MONTH) month!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class MonthQuery {
  @Matches(MONTH) month!: string;
}

class DisputeDto {
  @IsString() @Length(5, 500) note!: string;
}

class PayDto {
  @IsIn(Object.values(PaymentMethod)) method!: PaymentMethod;
}

interface Breakdown {
  lines: { label: string; amount: number }[];
  advancesCarried: number;
  pendingCancellations: number;
  receipts: number;
  contractId: string;
}

function termsOf(c: TeacherContract): ContractTerms {
  switch (c.type) {
    case 'PERCENTAGE':
      return { type: 'PERCENTAGE', teacherPct: Number(c.teacherPct ?? 0) };
    case 'HALL_RENT_HOURLY':
      return { type: 'HALL_RENT_HOURLY', hourlyRent: toPiasters(c.hourlyRent) };
    case 'PER_STUDENT':
      return { type: 'PER_STUDENT', perStudent: toPiasters(c.perStudentAmount) };
    case 'MIXED':
      return { type: 'MIXED', teacherPct: Number(c.teacherPct ?? 0), perStudent: toPiasters(c.perStudentAmount) };
    default:
      throw new BadRequestException('صيغة تعاقد غير معروفة');
  }
}

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── العقود والسلف

  contracts(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), (tx) =>
      tx.teacherContract.findMany({
        include: { teacher: { select: { id: true, user: { select: { name: true } } } } },
        orderBy: [{ teacherMembershipId: 'asc' }, { startsOn: 'desc' }],
      }),
    );
  }

  createContract(ws: WorkspaceCtx, dto: ContractDto) {
    const needPct = dto.type === 'PERCENTAGE' || dto.type === 'MIXED';
    const needRent = dto.type === 'HALL_RENT_HOURLY';
    const needPer = dto.type === 'PER_STUDENT' || dto.type === 'MIXED';
    if ((needPct && dto.teacherPct === undefined) || (needRent && dto.hourlyRent === undefined) || (needPer && dto.perStudentAmount === undefined)) {
      throw new BadRequestException('أكمل بيانات صيغة التعاقد المختارة');
    }
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const teacher = await tx.membership.findFirst({ where: { id: dto.teacherMembershipId, workspaceId: ws.workspaceId, role: 'TEACHER' } });
      if (!teacher) throw new BadRequestException('المدرس غير موجود');
      await lockKeys(tx, [`contract:${teacher.id}`]);
      const startsOn = dateOnly(dto.startsOn);
      // العقد الجديد ينهي السابق المفتوح تلقائيًا
      const previous = await tx.teacherContract.findFirst({ where: { teacherMembershipId: teacher.id, endsOn: null }, orderBy: { startsOn: 'desc' } });
      if (previous) {
        if (previous.startsOn >= startsOn) throw new BadRequestException('تاريخ بداية العقد يجب أن يكون بعد بداية العقد الحالي');
        await tx.teacherContract.update({ where: { id: previous.id }, data: { endsOn: new Date(startsOn.getTime() - 86_400_000) } });
      }
      const c = await tx.teacherContract.create({
        data: {
          workspaceId: ws.workspaceId,
          teacherMembershipId: teacher.id,
          type: dto.type,
          teacherPct: needPct ? String(dto.teacherPct) : null,
          hourlyRent: needRent ? toDecimalString(toPiasters(dto.hourlyRent)) : null,
          perStudentAmount: needPer ? toDecimalString(toPiasters(dto.perStudentAmount)) : null,
          startsOn,
          notes: dto.notes?.trim() || null,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'contract.create', entity: 'contract', entityId: c.id, meta: { ...dto }, ip: ws.ip });
      return c;
    });
  }

  endContract(ws: WorkspaceCtx, id: string, endsOn: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const c = await tx.teacherContract.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('العقد غير موجود');
      const end = dateOnly(endsOn);
      if (end < c.startsOn) throw new BadRequestException('تاريخ الانتهاء قبل البداية');
      const updated = await tx.teacherContract.update({ where: { id }, data: { endsOn: end } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'contract.end', entity: 'contract', entityId: id, meta: { endsOn }, ip: ws.ip });
      return updated;
    });
  }

  advance(ws: WorkspaceCtx, dto: AdvanceDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const teacher = await tx.membership.findFirst({ where: { id: dto.teacherMembershipId, workspaceId: ws.workspaceId, role: 'TEACHER' } });
      if (!teacher) throw new BadRequestException('المدرس غير موجود');
      const locked = await tx.settlement.findUnique({
        where: { workspaceId_teacherMembershipId_month: { workspaceId: ws.workspaceId, teacherMembershipId: teacher.id, month: dto.month } },
      });
      if (locked && !EDITABLE.has(locked.status)) throw new BadRequestException('تسوية هذا الشهر مؤكدة، سجّل السلفة على الشهر التالي');
      const a = await tx.teacherAdvance.create({
        data: { workspaceId: ws.workspaceId, teacherMembershipId: teacher.id, amount: toDecimalString(toPiasters(dto.amount)), month: dto.month, note: dto.note?.trim() || null, createdById: ws.userId },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'advance.create', entity: 'advance', entityId: a.id, meta: { amount: dto.amount, month: dto.month }, ip: ws.ip });
      return a;
    });
  }

  advances(ws: WorkspaceCtx, month: string) {
    return this.prisma.scoped(wsScope(ws), (tx) =>
      tx.teacherAdvance.findMany({
        where: { month },
        include: { teacher: { select: { user: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  // ───────── الحساب الشهري

  async calculate(ws: WorkspaceCtx, month: string) {
    const { start, end } = cairoMonthRange(month);
    const monthStart = dateOnly(`${month}-01`);
    const monthEnd = new Date(dateOnly(`${shiftMonth(month, 1)}-01`).getTime() - 86_400_000);
    const pending: NotificationJob[] = [];

    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`settle:${ws.workspaceId}:${month}`]);
      const contracts = await tx.teacherContract.findMany({
        where: { startsOn: { lte: monthEnd }, OR: [{ endsOn: null }, { endsOn: { gte: monthStart } }] },
        include: { teacher: { select: { id: true, userId: true, user: { select: { name: true } } } } },
        orderBy: { startsOn: 'desc' },
      });
      // أحدث عقد ساري لكل مدرس في الشهر
      const byTeacher = new Map<string, (typeof contracts)[number]>();
      for (const c of contracts) if (!byTeacher.has(c.teacherMembershipId)) byTeacher.set(c.teacherMembershipId, c);

      const results: { teacher: string; status: string; net?: number; skipped?: string }[] = [];
      for (const [teacherId, contract] of byTeacher) {
        const existing = await tx.settlement.findUnique({
          where: { workspaceId_teacherMembershipId_month: { workspaceId: ws.workspaceId, teacherMembershipId: teacherId, month } },
        });
        if (existing && !EDITABLE.has(existing.status)) {
          results.push({ teacher: contract.teacher.user.name, status: existing.status, skipped: 'مؤكدة ولا يُعاد حسابها' });
          continue;
        }

        const receipts = await tx.receipt.findMany({
          where: { forMonth: month, status: 'VALID', enrollment: { group: { teacherMembershipId: teacherId } } },
          select: { amount: true, studentId: true },
        });
        const pendingCancellations = await tx.receipt.count({
          where: { forMonth: month, status: 'CANCEL_REQUESTED', enrollment: { group: { teacherMembershipId: teacherId } } },
        });
        const sessions = await tx.classSession.findMany({
          where: { status: { not: 'CANCELLED' }, hallId: { not: null }, startsAt: { gte: start, lt: end }, group: { teacherMembershipId: teacherId } },
          select: { startsAt: true, endsAt: true },
        });
        const adv = await tx.teacherAdvance.aggregate({ where: { teacherMembershipId: teacherId, month }, _sum: { amount: true } });
        const prev = await tx.settlement.findUnique({
          where: { workspaceId_teacherMembershipId_month: { workspaceId: ws.workspaceId, teacherMembershipId: teacherId, month: shiftMonth(month, -1) } },
        });
        const carried = prev ? ((prev.breakdown as unknown as Breakdown | null)?.advancesCarried ?? 0) : 0;

        const gross = receipts.reduce((t, r) => t + toPiasters(r.amount), 0);
        const payingStudents = new Set(receipts.map((r) => r.studentId)).size;
        const hoursUsed = billableHours(sessions);
        const calc = calculateSettlement({
          gross,
          payingStudents,
          hoursUsed,
          advances: toPiasters(adv._sum.amount) + carried,
          terms: termsOf(contract),
        });

        const breakdown: Breakdown = {
          lines: calc.lines,
          advancesCarried: calc.advancesCarried,
          pendingCancellations,
          receipts: receipts.length,
          contractId: contract.id,
        };
        const data = {
          contractType: contract.type,
          grossCollected: toDecimalString(calc.gross),
          payingStudents,
          hoursUsed: hoursUsed.toFixed(2),
          teacherShare: toDecimalString(calc.teacherShare),
          centerShare: toDecimalString(calc.centerShare),
          advancesDeducted: toDecimalString(calc.advancesDeducted),
          net: toDecimalString(calc.net),
          breakdown: breakdown as unknown as Prisma.InputJsonValue,
          status: 'DRAFT' as const,
          disputeNote: null,
        };
        await tx.settlement.upsert({
          where: { workspaceId_teacherMembershipId_month: { workspaceId: ws.workspaceId, teacherMembershipId: teacherId, month } },
          create: { workspaceId: ws.workspaceId, teacherMembershipId: teacherId, month, ...data },
          update: data,
        });
        results.push({ teacher: contract.teacher.user.name, status: 'DRAFT', net: calc.net });
        pending.push({
          kind: 'settlement_ready',
          userIds: [contract.teacher.userId],
          workspaceId: ws.workspaceId,
          title: `كشف تسوية ${month} جاهز`,
          body: `صافي المستحق ${formatEgp(calc.net)}. راجعه وأكّده أو اعترض عليه.`,
        });
      }
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'settlement.calculate', entity: 'settlement', meta: { month, teachers: results.length }, ip: ws.ip });
      return { month, results };
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  list(ws: WorkspaceCtx, month: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.settlement.findMany({
        where: { month },
        include: { teacher: { select: { user: { select: { name: true } } } } },
        orderBy: { net: 'desc' },
      });
      return rows.map((s) => this.view(s, s.teacher.user.name));
    });
  }

  mine(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.settlement.findMany({
        where: { teacherMembershipId: ws.membershipId },
        orderBy: { month: 'desc' },
        take: 12,
      });
      return rows.map((s) => this.view(s));
    });
  }

  get(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const s = await this.ownOrManaged(tx, ws, id);
      const teacher = await tx.membership.findUniqueOrThrow({ where: { id: s.teacherMembershipId }, include: { user: { select: { name: true } } } });
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { name: true } });
      const names = await tx.user.findMany({
        where: { id: { in: [s.approvedById, s.paidById].filter((v): v is string => Boolean(v)) } },
        select: { id: true, name: true },
      });
      const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? null;
      return {
        ...this.view(s, teacher.user.name),
        workspaceName: workspace.name,
        approvedBy: nameOf(s.approvedById),
        paidBy: nameOf(s.paidById),
        isMine: s.teacherMembershipId === ws.membershipId,
      };
    });
  }

  confirm(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const s = await this.own(tx, ws, id);
      if (!EDITABLE.has(s.status)) throw new BadRequestException('لا يمكن تأكيد هذا الكشف في حالته الحالية');
      const updated = await tx.settlement.update({ where: { id }, data: { status: 'TEACHER_CONFIRMED', confirmedAt: new Date() } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'settlement.confirm', entity: 'settlement', entityId: id, ip: ws.ip });
      return this.view(updated);
    });
  }

  async dispute(ws: WorkspaceCtx, id: string, note: string) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      const s = await this.own(tx, ws, id);
      if (s.status !== 'DRAFT') throw new BadRequestException('الاعتراض متاح على الكشف قبل تأكيده فقط');
      const updated = await tx.settlement.update({ where: { id }, data: { status: 'DISPUTED', disputeNote: note.trim() } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'settlement.dispute', entity: 'settlement', entityId: id, meta: { note }, ip: ws.ip });
      pending.push({
        kind: 'settlement_disputed',
        userIds: await managerIds(tx, ws.workspaceId),
        workspaceId: ws.workspaceId,
        title: `اعتراض على تسوية ${s.month}`,
        body: note.trim(),
      });
      return this.view(updated);
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  approve(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const s = await tx.settlement.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('الكشف غير موجود');
      if (s.status !== 'TEACHER_CONFIRMED') throw new BadRequestException('يُعتمد الكشف بعد تأكيد المدرس');
      if (s.teacherMembershipId === ws.membershipId) throw new ForbiddenException('لا تعتمد كشفك بنفسك');
      const updated = await tx.settlement.update({ where: { id }, data: { status: 'APPROVED', approvedById: ws.userId, approvedAt: new Date() } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'settlement.approve', entity: 'settlement', entityId: id, ip: ws.ip });
      return this.view(updated);
    });
  }

  /** الصرف النقدي يُسجل مصروفًا على وردية الصارف حتى تتطابق الخزنة */
  async pay(ws: WorkspaceCtx, id: string, method: PaymentMethod) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`settlement:${id}`]);
      const s = await tx.settlement.findUnique({ where: { id }, include: { teacher: { select: { userId: true, user: { select: { name: true } } } } } });
      if (!s) throw new NotFoundException('الكشف غير موجود');
      if (s.status !== 'APPROVED') throw new BadRequestException('يُصرف الكشف بعد اعتماده');
      const net = toPiasters(s.net);
      if (method === 'CASH' && net > 0) {
        const shift = await tx.cashShift.findUnique({ where: { openKey: `${ws.workspaceId}:${ws.userId}` } });
        if (!shift) throw new BadRequestException('افتح وردية أولًا للصرف النقدي');
        await tx.expense.create({
          data: {
            workspaceId: ws.workspaceId, shiftId: shift.id, amount: toDecimalString(net), category: 'تسوية مدرس',
            note: `${s.teacher.user.name} — ${s.month}`, createdById: ws.userId,
          },
        });
      }
      const updated = await tx.settlement.update({ where: { id }, data: { status: 'PAID', paidById: ws.userId, paidAt: new Date(), paymentMethod: method } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'settlement.pay', entity: 'settlement', entityId: id, meta: { net, method }, ip: ws.ip });
      pending.push({
        kind: 'settlement_ready',
        userIds: [s.teacher.userId],
        workspaceId: ws.workspaceId,
        title: `تم صرف تسوية ${s.month}`,
        body: `${formatEgp(net)} بطريقة ${method}.`,
      });
      return this.view(updated);
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  // ───────── مساعدات

  private view(s: Settlement, teacherName?: string) {
    const b = (s.breakdown as unknown as Breakdown | null) ?? null;
    return {
      id: s.id,
      month: s.month,
      teacherMembershipId: s.teacherMembershipId,
      teacherName,
      contractType: s.contractType,
      grossCollected: s.grossCollected,
      payingStudents: s.payingStudents,
      hoursUsed: s.hoursUsed,
      teacherShare: s.teacherShare,
      centerShare: s.centerShare,
      advancesDeducted: s.advancesDeducted,
      net: s.net,
      lines: b?.lines ?? [],
      advancesCarried: b?.advancesCarried ?? 0,
      pendingCancellations: b?.pendingCancellations ?? 0,
      receipts: b?.receipts ?? 0,
      status: s.status,
      disputeNote: s.disputeNote,
      confirmedAt: s.confirmedAt,
      approvedAt: s.approvedAt,
      paidAt: s.paidAt,
      paymentMethod: s.paymentMethod,
      updatedAt: s.updatedAt,
    };
  }

  private async ownOrManaged(tx: Tx, ws: WorkspaceCtx, id: string) {
    const s = await tx.settlement.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('الكشف غير موجود');
    if (s.teacherMembershipId !== ws.membershipId && !can(ws.role, 'settlements.manage')) throw new NotFoundException('الكشف غير موجود');
    return s;
  }

  private async own(tx: Tx, ws: WorkspaceCtx, id: string) {
    const s = await tx.settlement.findUnique({ where: { id } });
    if (!s || s.teacherMembershipId !== ws.membershipId) throw new NotFoundException('الكشف غير موجود');
    return s;
  }
}

@Controller('settlements')
export class SettlementsController {
  constructor(private readonly svc: SettlementsService) {}

  @Get('contracts')
  @RequirePermission('settlements.manage')
  contracts(@Ws() ws: WorkspaceCtx) {
    return this.svc.contracts(ws);
  }

  @Post('contracts')
  @RequirePermission('staff.manage')
  createContract(@Ws() ws: WorkspaceCtx, @Body() dto: ContractDto) {
    return this.svc.createContract(ws, dto);
  }

  @Post('contracts/:id/end')
  @HttpCode(200)
  @RequirePermission('staff.manage')
  endContract(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndContractDto) {
    return this.svc.endContract(ws, id, dto.endsOn);
  }

  @Get('advances')
  @RequirePermission('settlements.manage')
  advances(@Ws() ws: WorkspaceCtx, @Query() q: MonthQuery) {
    return this.svc.advances(ws, q.month);
  }

  @Post('advances')
  @RequirePermission('settlements.manage')
  advance(@Ws() ws: WorkspaceCtx, @Body() dto: AdvanceDto) {
    return this.svc.advance(ws, dto);
  }

  @Post('calculate')
  @HttpCode(200)
  @RequirePermission('settlements.manage')
  calculate(@Ws() ws: WorkspaceCtx, @Body() dto: MonthQuery) {
    return this.svc.calculate(ws, dto.month);
  }

  @Get()
  @RequirePermission('settlements.manage')
  list(@Ws() ws: WorkspaceCtx, @Query() q: MonthQuery) {
    return this.svc.list(ws, q.month);
  }

  @Get('mine')
  @RequirePermission('settlements.read.own')
  mine(@Ws() ws: WorkspaceCtx) {
    return this.svc.mine(ws);
  }

  /** المدرس يرى كشفه، والإدارة والمحاسب يرون الكل (التحقق داخل الخدمة) */
  @Get(':id')
  @RequirePermission('workspace.view')
  get(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission('settlements.read.own')
  confirm(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(ws, id);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  @RequirePermission('settlements.read.own')
  dispute(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeDto) {
    return this.svc.dispute(ws, id, dto.note);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('settlements.approve')
  approve(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ws, id);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('settlements.pay')
  pay(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.svc.pay(ws, id, dto.method);
  }
}

@Module({ controllers: [SettlementsController], providers: [SettlementsService] })
export class SettlementsModule {}

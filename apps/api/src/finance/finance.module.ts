import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { WorkspaceCtx } from '../common/context';
import { RequirePermission, Ws } from '../common/decorators';
import { formatEgp } from '../common/format';
import { dueAfterDiscount, toDecimalString, toPiasters } from '../common/money';
import { can } from '../common/permissions';
import { familyIds, managerIds } from '../common/recipients';
import { assertCan, lockKeys, wsScope } from '../common/scope';
import { addDays, cairoDateOf, cairoMonthOf, cairoMonthRange, cairoToUtc, monthWithin } from '../common/time';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.module';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { discountWithinLimit, remainingDue } from './dues';
import { LIVE_RECEIPT, paidByEnrollment } from './dues.repo';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MANAGERS = new Set(['OWNER', 'MANAGER']);
const METHODS = Object.values(PaymentMethod);

class OpenShiftDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000)
  openingBalance!: number;
}

class CloseShiftDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000)
  countedCash!: number;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

class CollectDto {
  @IsUUID() enrollmentId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000) amount!: number;
  @Matches(MONTH) forMonth!: string;
  @IsIn(METHODS) method!: PaymentMethod;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) discountAmount?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class CancelRequestDto {
  @IsString() @Length(5, 300) reason!: string;
}

class CancelDecisionDto {
  @IsBoolean() approve!: boolean;
}

class ExpenseDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000) amount!: number;
  @IsString() @Length(2, 40) category!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /** مدفوع من درج الوردية الحالية */
  @IsBoolean() fromCash!: boolean;
}

class MonthQuery {
  @Matches(MONTH) month!: string;
}

class ReceiptsQuery {
  @IsOptional() @Matches(MONTH) month?: string;
  @IsOptional() @IsIn(['VALID', 'CANCEL_REQUESTED', 'CANCELLED']) status?: 'VALID' | 'CANCEL_REQUESTED' | 'CANCELLED';
  @IsOptional() @IsUUID() shiftId?: string;
}

class DuesQuery extends MonthQuery {
  @IsOptional() @IsUUID() groupId?: string;
}

class ShiftsQuery {
  @IsOptional() @IsIn(['OPEN', 'CLOSED', 'APPROVED']) status?: 'OPEN' | 'CLOSED' | 'APPROVED';
}

const openKeyOf = (ws: WorkspaceCtx) => `${ws.workspaceId}:${ws.userId}`;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── الورديات

  openShift(ws: WorkspaceCtx, dto: OpenShiftDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const open = await tx.cashShift.findUnique({ where: { openKey: openKeyOf(ws) } });
      if (open) throw new ConflictException('لديك وردية مفتوحة بالفعل');
      const shift = await tx.cashShift.create({
        data: { workspaceId: ws.workspaceId, openedById: ws.userId, openKey: openKeyOf(ws), openingBalance: toDecimalString(toPiasters(dto.openingBalance)) },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'shift.open', entity: 'shift', entityId: shift.id, meta: { openingBalance: dto.openingBalance }, ip: ws.ip });
      return shift;
    });
  }

  currentShift(ws: WorkspaceCtx) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const shift = await tx.cashShift.findUnique({ where: { openKey: openKeyOf(ws) } });
      if (!shift) return { shift: null };
      return { shift, totals: await this.shiftTotals(tx, shift.id, toPiasters(shift.openingBalance)) };
    });
  }

  async closeShift(ws: WorkspaceCtx, id: string, dto: CloseShiftDto) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`shift:${id}`]);
      const shift = await tx.cashShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('الوردية غير موجودة');
      if (shift.status !== 'OPEN') throw new BadRequestException('الوردية مغلقة بالفعل');
      if (shift.openedById !== ws.userId && !can(ws.role, 'finance.shift.approve')) {
        throw new ForbiddenException('لا يغلق الوردية إلا صاحبها أو المدير');
      }
      const totals = await this.shiftTotals(tx, id, toPiasters(shift.openingBalance));
      const counted = toPiasters(dto.countedCash);
      const variance = counted - totals.expectedCash;
      const closed = await tx.cashShift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          openKey: null,
          closedAt: new Date(),
          expectedCash: toDecimalString(totals.expectedCash),
          countedCash: toDecimalString(counted),
          variance: toDecimalString(variance),
          closeNote: dto.note?.trim() || null,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'shift.close', entity: 'shift', entityId: id, meta: { expected: totals.expectedCash, counted, variance }, ip: ws.ip });
      if (variance !== 0) {
        pending.push({
          kind: 'shift_variance',
          userIds: await managerIds(tx, ws.workspaceId),
          workspaceId: ws.workspaceId,
          title: variance < 0 ? 'عجز في الخزنة' : 'زيادة في الخزنة',
          body: `وردية أُغلقت بفرق ${formatEgp(variance)}. راجعها قبل الاعتماد.`,
        });
      }
      return { shift: closed, totals, variance };
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  approveShift(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const shift = await tx.cashShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('الوردية غير موجودة');
      if (shift.status !== 'CLOSED') throw new BadRequestException('تُعتمد الوردية بعد إغلاقها فقط');
      await this.assertFourEyes(tx, ws, shift.openedById, 'لا يعتمد الموظف ورديته بنفسه');
      const approved = await tx.cashShift.update({ where: { id }, data: { status: 'APPROVED', approvedById: ws.userId } });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'shift.approve', entity: 'shift', entityId: id, ip: ws.ip });
      return approved;
    });
  }

  shifts(ws: WorkspaceCtx, q: ShiftsQuery) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.cashShift.findMany({ where: { status: q.status }, orderBy: { openedAt: 'desc' }, take: 100 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.openedById))] } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ ...r, openKey: undefined, openedBy: names.get(r.openedById) ?? '—' }));
    });
  }

  // ───────── التحصيل

  async collect(ws: WorkspaceCtx, dto: CollectDto) {
    if (!monthWithin(dto.forMonth, new Date(), 12, 3)) throw new BadRequestException('الشهر خارج النطاق المسموح');
    const amount = toPiasters(dto.amount);
    const discount = toPiasters(dto.discountAmount ?? 0);
    if (discount > 0) assertCan(ws, 'finance.discount', 'منح الخصم غير مسموح لدورك');
    const pending: NotificationJob[] = [];

    const receipt = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`pay:${dto.enrollmentId}:${dto.forMonth}`]);
      const enrollment = await tx.enrollment.findUnique({
        where: { id: dto.enrollmentId },
        include: { group: true, student: true },
      });
      if (!enrollment) throw new NotFoundException('الاشتراك غير موجود');
      if (enrollment.status === 'WAITLIST' || enrollment.status === 'LEFT') throw new BadRequestException('الاشتراك غير نشط');

      const shift = await tx.cashShift.findUnique({ where: { openKey: openKeyOf(ws) } });
      if (dto.method === 'CASH' && !shift) throw new BadRequestException('افتح وردية أولًا لاستلام النقدية');

      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
      const due = dueAfterDiscount(toPiasters(enrollment.group.monthlyFee), enrollment.discountPct);
      const sums = (await paidByEnrollment(tx, [enrollment.id], dto.forMonth)).get(enrollment.id) ?? { paid: 0, discounted: 0 };
      const remaining = remainingDue({ monthlyFee: toPiasters(enrollment.group.monthlyFee), discountPct: enrollment.discountPct, ...sums });
      if (remaining <= 0) throw new ConflictException('هذا الشهر مدفوع بالكامل');
      if (amount + discount > remaining) {
        throw new BadRequestException(`المبلغ أكبر من المتبقي (${formatEgp(remaining)})`);
      }
      if (discount > 0 && !MANAGERS.has(ws.role) && !discountWithinLimit(due, discount + sums.discounted, workspace.receptionMaxDiscountPct)) {
        throw new ForbiddenException(`الخصم يتجاوز الحد المسموح (${workspace.receptionMaxDiscountPct}%)، اطلب موافقة المدير`);
      }

      // ترقيم تسلسلي بلا فجوات: تحديث صف المساحة يقفله حتى نهاية المعاملة
      const { receiptSeq } = await tx.workspace.update({
        where: { id: ws.workspaceId },
        data: { receiptSeq: { increment: 1 } },
        select: { receiptSeq: true },
      });
      const created = await tx.receipt.create({
        data: {
          workspaceId: ws.workspaceId,
          number: receiptSeq,
          shiftId: shift?.id ?? null,
          studentId: enrollment.studentId,
          enrollmentId: enrollment.id,
          amount: toDecimalString(amount),
          discountAmount: toDecimalString(discount),
          method: dto.method,
          forMonth: dto.forMonth,
          note: dto.note?.trim() || null,
          issuedById: ws.userId,
        },
      });
      await this.audit.log(tx, {
        workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'receipt.issue', entity: 'receipt', entityId: created.id,
        meta: { number: receiptSeq, amount, discount, method: dto.method, forMonth: dto.forMonth }, ip: ws.ip,
      });

      pending.push({
        kind: 'receipt',
        userIds: familyIds(enrollment.student),
        workspaceId: ws.workspaceId,
        title: `إيصال رقم ${receiptSeq} — ${workspace.name}`,
        body: `تم استلام ${formatEgp(amount)} عن ${enrollment.student.fullName} (${enrollment.group.name}) لشهر ${dto.forMonth}.`,
      });
      if (discount > 0 && !MANAGERS.has(ws.role)) {
        pending.push({
          kind: 'discount_alert',
          userIds: await managerIds(tx, ws.workspaceId),
          workspaceId: ws.workspaceId,
          title: 'خصم على إيصال',
          body: `خصم ${formatEgp(discount)} على الإيصال ${receiptSeq}.`,
        });
      }
      return { ...created, remainingAfter: remaining - amount - discount };
    });
    for (const j of pending) await this.notify.notify(j);
    return receipt;
  }

  receipt(ws: WorkspaceCtx, id: string) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const r = await tx.receipt.findUnique({
        where: { id },
        include: {
          student: { select: { fullName: true, grade: true } },
          enrollment: { select: { code: true, group: { select: { name: true, subject: true, teacher: { select: { user: { select: { name: true } } } } } } } },
        },
      });
      if (!r) throw new NotFoundException('الإيصال غير موجود');
      // إعادة الطباعة متاحة لكل من يحصّل (الإيصال غير قابل للتعديل أصلًا)
      const issuer = await tx.user.findUnique({ where: { id: r.issuedById }, select: { name: true } });
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { name: true } });
      return {
        id: r.id,
        number: r.number,
        workspaceName: workspace.name,
        amount: r.amount,
        discountAmount: r.discountAmount,
        method: r.method,
        forMonth: r.forMonth,
        note: r.note,
        status: r.status,
        cancelReason: r.cancelReason,
        createdAt: r.createdAt,
        issuedBy: issuer?.name ?? '—',
        student: r.student,
        code: r.enrollment.code,
        group: r.enrollment.group.name,
        subject: r.enrollment.group.subject,
        teacher: r.enrollment.group.teacher.user.name,
      };
    });
  }

  receipts(ws: WorkspaceCtx, q: ReceiptsQuery) {
    const range = q.month ? cairoMonthRange(q.month) : null;
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const rows = await tx.receipt.findMany({
        where: {
          status: q.status,
          shiftId: q.shiftId,
          createdAt: range ? { gte: range.start, lt: range.end } : undefined,
          // من لا يملك التقارير يرى ما أصدره فقط
          issuedById: can(ws.role, 'finance.reports') || can(ws.role, 'finance.cancel.approve') ? undefined : ws.userId,
        },
        include: {
          student: { select: { fullName: true } },
          enrollment: { select: { code: true, group: { select: { name: true } } } },
        },
        orderBy: { number: 'desc' },
        take: 300,
      });
      return rows.map((r) => ({
        id: r.id, number: r.number, amount: r.amount, discountAmount: r.discountAmount, method: r.method,
        forMonth: r.forMonth, status: r.status, cancelReason: r.cancelReason, createdAt: r.createdAt,
        student: r.student.fullName, code: r.enrollment.code, group: r.enrollment.group.name,
        mine: r.issuedById === ws.userId,
      }));
    });
  }

  async requestCancel(ws: WorkspaceCtx, id: string, reason: string) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      const r = await tx.receipt.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('الإيصال غير موجود');
      if (r.status !== 'VALID') throw new BadRequestException('الإيصال عليه طلب إلغاء أو ملغى');
      const updated = await tx.receipt.update({
        where: { id },
        data: { status: 'CANCEL_REQUESTED', cancelReason: reason.trim(), cancelRequestedById: ws.userId },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'receipt.cancel_request', entity: 'receipt', entityId: id, meta: { number: r.number, reason }, ip: ws.ip });
      pending.push({
        kind: 'cancel_request',
        userIds: await managerIds(tx, ws.workspaceId),
        workspaceId: ws.workspaceId,
        title: `طلب إلغاء الإيصال ${r.number}`,
        body: `السبب: ${reason.trim()}`,
      });
      return updated;
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  async decideCancel(ws: WorkspaceCtx, id: string, approve: boolean) {
    const pending: NotificationJob[] = [];
    const out = await this.prisma.scoped(wsScope(ws), async (tx) => {
      await lockKeys(tx, [`receipt:${id}`]);
      const r = await tx.receipt.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('الإيصال غير موجود');
      if (r.status !== 'CANCEL_REQUESTED') throw new BadRequestException('لا يوجد طلب إلغاء معلق');
      await this.assertFourEyes(tx, ws, r.cancelRequestedById, 'لا يعتمد إلغاء الإيصال من طلبه');
      if (approve) await this.assertFourEyes(tx, ws, r.issuedById, 'لا يعتمد إلغاء الإيصال من أصدره');
      const updated = await tx.receipt.update({
        where: { id },
        data: approve
          ? { status: 'CANCELLED', cancelApprovedById: ws.userId, cancelledAt: new Date() }
          : { status: 'VALID', cancelReason: `${r.cancelReason ?? ''} — رُفض الطلب`.trim() },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: approve ? 'receipt.cancel_approve' : 'receipt.cancel_reject', entity: 'receipt', entityId: id, meta: { number: r.number }, ip: ws.ip });
      if (r.cancelRequestedById) {
        pending.push({
          kind: 'cancel_request',
          userIds: [r.cancelRequestedById],
          workspaceId: ws.workspaceId,
          title: `طلب إلغاء الإيصال ${r.number}`,
          body: approve ? 'تم اعتماد الإلغاء.' : 'تم رفض الإلغاء.',
        });
      }
      return updated;
    });
    for (const j of pending) await this.notify.notify(j);
    return out;
  }

  // ───────── المصروفات

  expense(ws: WorkspaceCtx, dto: ExpenseDto) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const shift = dto.fromCash ? await tx.cashShift.findUnique({ where: { openKey: openKeyOf(ws) } }) : null;
      if (dto.fromCash && !shift) throw new BadRequestException('افتح وردية أولًا للصرف من الدرج');
      const e = await tx.expense.create({
        data: {
          workspaceId: ws.workspaceId,
          shiftId: shift?.id ?? null,
          amount: toDecimalString(toPiasters(dto.amount)),
          category: dto.category.trim(),
          note: dto.note?.trim() || null,
          createdById: ws.userId,
        },
      });
      await this.audit.log(tx, { workspaceId: ws.workspaceId, actorUserId: ws.userId, action: 'expense.create', entity: 'expense', entityId: e.id, meta: { amount: dto.amount, category: dto.category }, ip: ws.ip });
      return e;
    });
  }

  expenses(ws: WorkspaceCtx, month: string) {
    const { start, end } = cairoMonthRange(month);
    return this.prisma.scoped(wsScope(ws), (tx) =>
      tx.expense.findMany({ where: { createdAt: { gte: start, lt: end } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    );
  }

  // ───────── المتأخرات والتقارير

  dues(ws: WorkspaceCtx, q: DuesQuery) {
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { status: 'ACTIVE', groupId: q.groupId },
        include: {
          student: { select: { fullName: true, guardian: { select: { name: true, phone: true } } } },
          group: { select: { name: true, monthlyFee: true, teacher: { select: { user: { select: { name: true } } } } } },
        },
      });
      const sums = await paidByEnrollment(tx, enrollments.map((e) => e.id), q.month);
      const items = enrollments
        .map((e) => {
          const s = sums.get(e.id) ?? { paid: 0, discounted: 0 };
          const remaining = remainingDue({ monthlyFee: toPiasters(e.group.monthlyFee), discountPct: e.discountPct, ...s });
          return {
            enrollmentId: e.id,
            code: e.code,
            student: e.student.fullName,
            guardianName: e.student.guardian.name,
            guardianPhone: e.student.guardian.phone,
            group: e.group.name,
            teacher: e.group.teacher.user.name,
            paid: s.paid,
            remaining,
          };
        })
        .filter((x) => x.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining);
      return { month: q.month, count: items.length, totalRemaining: items.reduce((t, x) => t + x.remaining, 0), items };
    });
  }

  /** تقرير شهري: التحصيل الفعلي (بتاريخ الإيصال) ونسبة التحصيل (باستحقاق الشهر) */
  summary(ws: WorkspaceCtx, month: string) {
    const { start, end } = cairoMonthRange(month);
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const receipts = await tx.receipt.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: {
          amount: true, discountAmount: true, method: true, status: true, createdAt: true,
          enrollment: { select: { group: { select: { id: true, name: true, teacher: { select: { id: true, user: { select: { name: true } } } } } } } },
        },
      });
      const live = receipts.filter((r) => r.status !== 'CANCELLED');
      const byMethod: Record<string, number> = {};
      const byDay = new Map<string, number>();
      const byTeacher = new Map<string, { name: string; amount: number }>();
      const byGroup = new Map<string, { name: string; amount: number }>();
      let collected = 0;
      let discounts = 0;
      for (const r of live) {
        const a = toPiasters(r.amount);
        collected += a;
        discounts += toPiasters(r.discountAmount);
        byMethod[r.method] = (byMethod[r.method] ?? 0) + a;
        const day = cairoDateOf(r.createdAt);
        byDay.set(day, (byDay.get(day) ?? 0) + a);
        const g = r.enrollment.group;
        const t = byTeacher.get(g.teacher.id) ?? { name: g.teacher.user.name, amount: 0 };
        t.amount += a;
        byTeacher.set(g.teacher.id, t);
        const gg = byGroup.get(g.id) ?? { name: g.name, amount: 0 };
        gg.amount += a;
        byGroup.set(g.id, gg);
      }
      const cancelled = receipts.filter((r) => r.status === 'CANCELLED');

      const expenses = await tx.expense.groupBy({ by: ['category'], where: { createdAt: { gte: start, lt: end } }, _sum: { amount: true } });
      const expenseTotal = expenses.reduce((t, e) => t + toPiasters(e._sum.amount), 0);

      const active = await tx.enrollment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, discountPct: true, group: { select: { monthlyFee: true } } } });
      const expected = active.reduce((t, e) => t + dueAfterDiscount(toPiasters(e.group.monthlyFee), e.discountPct), 0);
      const forMonth = await tx.receipt.aggregate({ where: { forMonth: month, status: LIVE_RECEIPT }, _sum: { amount: true, discountAmount: true } });
      const paidForMonth = toPiasters(forMonth._sum.amount) + toPiasters(forMonth._sum.discountAmount);

      const days: { date: string; amount: number }[] = [];
      for (let d = `${month}-01`; cairoToUtc(d, '00:00') < end; d = addDays(d, 1)) days.push({ date: d, amount: byDay.get(d) ?? 0 });

      return {
        month,
        collected,
        discounts,
        receiptsCount: live.length,
        cancelled: { count: cancelled.length, amount: cancelled.reduce((t, r) => t + toPiasters(r.amount), 0) },
        byMethod,
        byTeacher: [...byTeacher.values()].sort((a, b) => b.amount - a.amount),
        byGroup: [...byGroup.values()].sort((a, b) => b.amount - a.amount),
        days,
        expenses: { total: expenseTotal, byCategory: expenses.map((e) => ({ category: e.category, amount: toPiasters(e._sum.amount) })) },
        net: collected - expenseTotal,
        collectionRate: { expected, paid: paidForMonth, pct: expected ? Math.round((paidForMonth / expected) * 100) : 0 },
      };
    });
  }

  /** مؤشرات لوحة اليوم حسب صلاحيات الدور */
  today(ws: WorkspaceCtx) {
    const date = cairoDateOf(new Date());
    const start = cairoToUtc(date, '00:00');
    const end = cairoToUtc(addDays(date, 1), '00:00');
    const month = cairoMonthOf(new Date());
    return this.prisma.scoped(wsScope(ws), async (tx) => {
      const mineOnly = !can(ws.role, 'finance.reports');
      const agg = await tx.receipt.aggregate({
        where: { createdAt: { gte: start, lt: end }, status: LIVE_RECEIPT, issuedById: mineOnly ? ws.userId : undefined },
        _sum: { amount: true },
        _count: true,
      });
      const pendingCancels = can(ws.role, 'finance.cancel.approve') ? await tx.receipt.count({ where: { status: 'CANCEL_REQUESTED' } }) : null;
      const closedShifts = can(ws.role, 'finance.shift.approve') ? await tx.cashShift.count({ where: { status: 'CLOSED' } }) : null;
      const openShifts = await tx.cashShift.count({ where: { status: 'OPEN' } });
      return {
        date,
        month,
        collectedToday: toPiasters(agg._sum.amount),
        receiptsToday: agg._count,
        scope: mineOnly ? 'mine' : 'all',
        pendingCancels,
        closedShiftsAwaitingApproval: closedShifts,
        openShifts,
      };
    });
  }

  // ───────── مساعدات

  private async shiftTotals(tx: Tx, shiftId: string, opening: number) {
    const byMethod = await tx.receipt.groupBy({
      by: ['method'],
      where: { shiftId, status: { not: 'CANCELLED' } },
      _sum: { amount: true },
      _count: true,
    });
    const exp = await tx.expense.aggregate({ where: { shiftId }, _sum: { amount: true } });
    const methods: Record<string, { amount: number; count: number }> = {};
    for (const m of byMethod) methods[m.method] = { amount: toPiasters(m._sum.amount), count: m._count };
    const cash = methods.CASH?.amount ?? 0;
    const expenses = toPiasters(exp._sum.amount);
    return { opening, methods, cashIn: cash, expenses, expectedCash: opening + cash - expenses };
  }

  /** مبدأ الشخصين في السنتر؛ مساحة المدرس الفردية مستثناة لأن صاحبها وحده */
  private async assertFourEyes(tx: Tx, ws: WorkspaceCtx, otherUserId: string | null, message: string) {
    if (!otherUserId || otherUserId !== ws.userId) return;
    const w = await tx.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { type: true } });
    if (w.type === 'CENTER') throw new ForbiddenException(message);
  }
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly svc: FinanceService) {}

  @Get('today')
  @RequirePermission('finance.collect')
  today(@Ws() ws: WorkspaceCtx) {
    return this.svc.today(ws);
  }

  @Post('shifts/open')
  @RequirePermission('finance.shift')
  openShift(@Ws() ws: WorkspaceCtx, @Body() dto: OpenShiftDto) {
    return this.svc.openShift(ws, dto);
  }

  @Get('shifts/current')
  @RequirePermission('finance.shift')
  currentShift(@Ws() ws: WorkspaceCtx) {
    return this.svc.currentShift(ws);
  }

  @Get('shifts')
  @RequirePermission('finance.shift.approve')
  shifts(@Ws() ws: WorkspaceCtx, @Query() q: ShiftsQuery) {
    return this.svc.shifts(ws, q);
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  @RequirePermission('finance.shift')
  closeShift(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseShiftDto) {
    return this.svc.closeShift(ws, id, dto);
  }

  @Post('shifts/:id/approve')
  @HttpCode(200)
  @RequirePermission('finance.shift.approve')
  approveShift(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approveShift(ws, id);
  }

  @Post('receipts')
  @RequirePermission('finance.collect')
  collect(@Ws() ws: WorkspaceCtx, @Body() dto: CollectDto) {
    return this.svc.collect(ws, dto);
  }

  @Get('receipts')
  @RequirePermission('finance.collect')
  receipts(@Ws() ws: WorkspaceCtx, @Query() q: ReceiptsQuery) {
    return this.svc.receipts(ws, q);
  }

  @Get('receipts/:id')
  @RequirePermission('finance.collect')
  receipt(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.receipt(ws, id);
  }

  @Post('receipts/:id/cancel-request')
  @HttpCode(200)
  @RequirePermission('finance.cancel.request')
  requestCancel(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRequestDto) {
    return this.svc.requestCancel(ws, id, dto.reason);
  }

  @Post('receipts/:id/cancel-decision')
  @HttpCode(200)
  @RequirePermission('finance.cancel.approve')
  decideCancel(@Ws() ws: WorkspaceCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDecisionDto) {
    return this.svc.decideCancel(ws, id, dto.approve);
  }

  @Post('expenses')
  @RequirePermission('finance.expense')
  expense(@Ws() ws: WorkspaceCtx, @Body() dto: ExpenseDto) {
    return this.svc.expense(ws, dto);
  }

  @Get('expenses')
  @RequirePermission('finance.expense')
  expenses(@Ws() ws: WorkspaceCtx, @Query() q: MonthQuery) {
    return this.svc.expenses(ws, q.month);
  }

  @Get('dues')
  @RequirePermission('finance.dues')
  dues(@Ws() ws: WorkspaceCtx, @Query() q: DuesQuery) {
    return this.svc.dues(ws, q);
  }

  @Get('summary')
  @RequirePermission('finance.reports')
  summary(@Ws() ws: WorkspaceCtx, @Query() q: MonthQuery) {
    return this.svc.summary(ws, q.month);
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService] })
export class FinanceModule {}

import type { WorkspaceCtx } from '../common/context';
import { toPiasters } from '../common/money';
import { can } from '../common/permissions';
import type { Tx } from '../prisma/prisma.service';
import { remainingDue, subscriptionState, type SubscriptionState } from './dues';

/** الإيصالات السارية تشمل ما عليه طلب إلغاء لم يُعتمد بعد */
export const LIVE_RECEIPT = { in: ['VALID', 'CANCEL_REQUESTED'] as ('VALID' | 'CANCEL_REQUESTED')[] };

export interface PaidSums {
  paid: number;
  discounted: number;
}

/** مجموع المدفوع والخصم لكل اشتراك في شهر (بالقرش) */
export async function paidByEnrollment(tx: Tx, enrollmentIds: string[], month: string): Promise<Map<string, PaidSums>> {
  const out = new Map<string, PaidSums>();
  if (!enrollmentIds.length) return out;
  const rows = await tx.receipt.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: enrollmentIds }, forMonth: month, status: LIVE_RECEIPT },
    _sum: { amount: true, discountAmount: true },
  });
  for (const r of rows) {
    out.set(r.enrollmentId, { paid: toPiasters(r._sum.amount), discounted: toPiasters(r._sum.discountAmount) });
  }
  return out;
}

export interface EnrollmentForDue {
  id: string;
  status: string;
  discountPct: number;
  group: { monthlyFee: { toString(): string } };
}

export interface DueView {
  state: SubscriptionState;
  /** يظهر لأدوار المالية فقط */
  remaining?: number;
}

/** حالة الاشتراك لكل طالب، مع إخفاء المبالغ عن المدرسين والمساعدين */
export async function dueViews(tx: Tx, ws: WorkspaceCtx, enrollments: EnrollmentForDue[], month: string) {
  const sums = await paidByEnrollment(tx, enrollments.map((e) => e.id), month);
  const showAmounts = can(ws.role, 'finance.collect') || can(ws.role, 'finance.dues');
  const out = new Map<string, DueView>();
  for (const e of enrollments) {
    const s = sums.get(e.id) ?? { paid: 0, discounted: 0 };
    const remaining = remainingDue({ monthlyFee: toPiasters(e.group.monthlyFee), discountPct: e.discountPct, ...s });
    out.set(e.id, { state: subscriptionState(e.status, remaining), ...(showAmounts ? { remaining } : {}) });
  }
  return out;
}

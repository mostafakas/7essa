import { dueAfterDiscount, type Piasters } from '../common/money';

export type SubscriptionState = 'OK' | 'DUES' | 'SUSPENDED';

export interface DueInput {
  monthlyFee: Piasters;
  discountPct: number;
  /** مجموع الإيصالات السارية للشهر */
  paid: Piasters;
  /** مجموع الخصومات الممنوحة في إيصالات الشهر */
  discounted: Piasters;
}

/** المتبقي على الطالب لشهر معين (لا يقل عن صفر) */
export function remainingDue(i: DueInput): Piasters {
  const due = dueAfterDiscount(i.monthlyFee, i.discountPct);
  return Math.max(0, due - i.paid - i.discounted);
}

/** الحالة التي تظهر بلون واضح عند باب القاعة */
export function subscriptionState(enrollmentStatus: string, remaining: Piasters): SubscriptionState {
  if (enrollmentStatus === 'SUSPENDED' || enrollmentStatus === 'LEFT') return 'SUSPENDED';
  return remaining > 0 ? 'DUES' : 'OK';
}

/** هل الخصم المطلوب ضمن الحد المسموح لغير المديرين؟ */
export function discountWithinLimit(due: Piasters, discount: Piasters, maxPct: number): boolean {
  if (discount <= 0) return true;
  if (due <= 0) return false;
  return discount * 100 <= due * maxPct;
}

/** الحضور متأخر إذا تجاوز المهلة من بداية الحصة */
export function attendanceStatusAt(startsAt: Date, at: Date, lateAfterMinutes: number): 'PRESENT' | 'LATE' {
  return at.getTime() > startsAt.getTime() + lateAfterMinutes * 60_000 ? 'LATE' : 'PRESENT';
}

/** يُسمح بالمسح قبل الحصة بربع ساعة وحتى نهايتها بساعة */
export function scanWindowOpen(startsAt: Date, endsAt: Date, at: Date): boolean {
  return at.getTime() >= startsAt.getTime() - 15 * 60_000 && at.getTime() <= endsAt.getTime() + 60 * 60_000;
}

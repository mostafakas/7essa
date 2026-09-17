import { addDays, cairoToUtc, weekdayOf } from '../common/time';

export interface ScheduleSpec {
  /** أول يوم (YYYY-MM-DD) */
  startDate: string;
  /** عدد الأسابيع (1 – 26) */
  weeks: number;
  /** أيام الأسبوع: 0 = الأحد … 6 = السبت */
  weekdays: number[];
  /** وقت البدء بتوقيت القاهرة HH:mm */
  startTime: string;
  durationMin: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export const MAX_WEEKS = 26;

/** يولّد مواعيد الحصص بتوقيت القاهرة (يحترم التوقيت الصيفي) مرتبة زمنيًا */
export function generateSlots(spec: ScheduleSpec): Slot[] {
  if (!Number.isInteger(spec.weeks) || spec.weeks < 1 || spec.weeks > MAX_WEEKS) {
    throw new Error(`عدد الأسابيع بين 1 و${MAX_WEEKS}`);
  }
  if (!Number.isInteger(spec.durationMin) || spec.durationMin < 15 || spec.durationMin > 360) {
    throw new Error('مدة الحصة بين 15 و360 دقيقة');
  }
  const days = new Set(spec.weekdays);
  if (!days.size || [...days].some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('اختر يومًا واحدًا على الأقل');
  }
  const slots: Slot[] = [];
  for (let i = 0; i < spec.weeks * 7; i++) {
    const date = addDays(spec.startDate, i);
    if (!days.has(weekdayOf(date))) continue;
    const startsAt = cairoToUtc(date, spec.startTime);
    slots.push({ startsAt, endsAt: new Date(startsAt.getTime() + spec.durationMin * 60_000) });
  }
  return slots;
}

/** تداخل فترتين نصف مفتوحتين [start, end) */
export function overlaps(a: Slot, b: Slot): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** يعيد المواعيد الجديدة التي تتعارض مع مواعيد قائمة */
export function findConflicts<T extends Slot>(candidates: Slot[], existing: T[]): { slot: Slot; with: T }[] {
  const sorted = [...existing].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  const out: { slot: Slot; with: T }[] = [];
  for (const slot of candidates) {
    const hit = sorted.find((e) => overlaps(slot, e));
    if (hit) out.push({ slot, with: hit });
  }
  // تعارض المواعيد الجديدة فيما بينها
  const own = [...candidates].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  for (let i = 1; i < own.length; i++) {
    if (overlaps(own[i - 1], own[i])) throw new Error('المواعيد المطلوبة تتداخل مع بعضها');
  }
  return out;
}

/** ساعات الاستخدام الفعلي (للتسويات بالإيجار) مقربة لربع ساعة */
export function billableHours(slots: Slot[]): number {
  const minutes = slots.reduce((s, x) => s + (x.endsAt.getTime() - x.startsAt.getTime()) / 60_000, 0);
  return Math.round((minutes / 60) * 4) / 4;
}

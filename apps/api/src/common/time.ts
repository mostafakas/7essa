export const TZ = 'Africa/Cairo';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isMonth(v: string): boolean {
  return MONTH_RE.test(v);
}

/** فرق توقيت منطقة زمنية عن UTC بالدقائق في لحظة معينة (يشمل التوقيت الصيفي) */
export function tzOffsetMinutes(date: Date, tz = TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** تاريخ ووقت محلي بتوقيت القاهرة → لحظة UTC */
export function cairoToUtc(dateStr: string, timeStr: string): Date {
  const d = DATE_RE.exec(dateStr);
  const t = TIME_RE.exec(timeStr);
  if (!d || !t) throw new Error('صيغة تاريخ أو وقت غير صحيحة');
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const off1 = tzOffsetMinutes(new Date(guess));
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc));
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** الشهر (YYYY-MM) الذي تقع فيه لحظة معينة بتوقيت القاهرة */
export function cairoMonthOf(date: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });
  return f.format(date).slice(0, 7);
}

/** تاريخ اليوم (YYYY-MM-DD) بتوقيت القاهرة */
export function cairoDateOf(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** بداية الشهر ونهايته (نصف مفتوحة) بتوقيت القاهرة */
export function cairoMonthRange(month: string): { start: Date; end: Date } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error('صيغة الشهر يجب أن تكون YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { start: cairoToUtc(`${month}-01`, '00:00'), end: cairoToUtc(`${next}-01`, '00:00') };
}

/** يوم الأسبوع (0 = الأحد) لتاريخ تقويمي */
export function weekdayOf(dateStr: string): number {
  const d = DATE_RE.exec(dateStr);
  if (!d) throw new Error('صيغة تاريخ غير صحيحة');
  return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const d = DATE_RE.exec(dateStr);
  if (!d) throw new Error('صيغة تاريخ غير صحيحة');
  const t = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + days));
  return t.toISOString().slice(0, 10);
}

/** إزاحة شهر (YYYY-MM) بعدد أشهر موجب أو سالب */
export function shiftMonth(month: string, delta: number): string {
  const m = MONTH_RE.exec(month);
  if (!m || !Number.isInteger(delta)) throw new Error('صيغة الشهر يجب أن تكون YYYY-MM');
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** هل الشهر ضمن نافذة معقولة حول الشهر الحالي (للتحصيل المسبق والمتأخر) */
export function monthWithin(month: string, now: Date, back: number, ahead: number): boolean {
  if (!isMonth(month)) return false;
  const current = cairoMonthOf(now);
  return month >= shiftMonth(current, -back) && month <= shiftMonth(current, ahead);
}

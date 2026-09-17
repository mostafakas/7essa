/** تنسيق موحد: أرقام لاتينية جدولية، توقيت القاهرة، والجنيه المصري */

const TZ = 'Africa/Cairo';
const LOCALE = 'ar-EG-u-nu-latn';

const moneyFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat(LOCALE);

/** مبلغ بالقرش (أعداد صحيحة من الخادم) */
export const egpP = (piasters: number | null | undefined) => `${moneyFmt.format((piasters ?? 0) / 100)} ج.م`;

/** مبلغ عشري نصي من حقول Decimal */
export const egp = (decimal: string | number | null | undefined) => `${moneyFmt.format(Number(decimal ?? 0))} ج.م`;

export const num = (n: number | null | undefined) => intFmt.format(n ?? 0);

const dayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dtFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'long', year: 'numeric' });

const d = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);
export const fmtDay = (v: string | Date) => dayFmt.format(d(v));
export const fmtDate = (v: string | Date) => dateFmt.format(d(v));
export const fmtTime = (v: string | Date) => timeFmt.format(d(v));
export const fmtDateTime = (v: string | Date) => dtFmt.format(d(v));
export const fmtMonth = (month: string) => monthFmt.format(new Date(`${month}-01T12:00:00Z`));

/** تاريخ اليوم YYYY-MM-DD بتوقيت القاهرة */
export const cairoToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export const cairoMonth = (now = new Date()) => cairoToday(now).slice(0, 7);

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function addDays(date: string, days: number) {
  const [y, m, dd] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + days)).toISOString().slice(0, 10);
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'المالك',
  MANAGER: 'المدير',
  TEACHER: 'مدرس',
  RECEPTION: 'استقبال',
  ACCOUNTANT: 'محاسب',
  ASSISTANT: 'مساعد مدرس',
  FOLLOWUP: 'متابعة',
};

export const METHOD_LABEL: Record<string, string> = { CASH: 'نقدي', WALLET: 'محفظة', CARD: 'بطاقة', TRANSFER: 'تحويل' };

export const ATTENDANCE_LABEL: Record<string, string> = { PRESENT: 'حاضر', LATE: 'متأخر', ABSENT: 'غائب' };

export const SETTLEMENT_LABEL: Record<string, string> = {
  DRAFT: 'بانتظار المدرس',
  TEACHER_CONFIRMED: 'أكّده المدرس',
  DISPUTED: 'عليه اعتراض',
  APPROVED: 'معتمد للصرف',
  PAID: 'تم الصرف',
};

export const CONTRACT_LABEL: Record<string, string> = {
  PERCENTAGE: 'نسبة من المحصل',
  HALL_RENT_HOURLY: 'إيجار قاعة بالساعة',
  PER_STUDENT: 'مبلغ ثابت عن كل طالب',
  MIXED: 'نسبة بحد أدنى للطالب',
};

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** رقم مصري محلي للعرض من صيغة +20 */
export const localPhone = (p: string) => (p.startsWith('+20') ? `0${p.slice(3)}` : p);

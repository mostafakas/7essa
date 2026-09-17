/** المبالغ تُحسب بالقرش (أعداد صحيحة) لتفادي أخطاء الكسور العشرية */
export type Piasters = number;

export function toPiasters(v: { toString(): string } | number | string | null | undefined): Piasters {
  if (v === null || v === undefined) return 0;
  const n = Number(typeof v === 'number' ? v : v.toString());
  if (!Number.isFinite(n)) throw new Error('قيمة مالية غير صالحة');
  return Math.round(n * 100);
}

/** قرش → نص عشري مناسب لحقول Decimal */
export function toDecimalString(p: Piasters): string {
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(Math.round(p));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** المستحق الشهري بعد خصم نسبة */
export function dueAfterDiscount(monthlyFee: Piasters, discountPct: number): Piasters {
  const pct = Math.min(100, Math.max(0, discountPct));
  return Math.round((monthlyFee * (100 - pct)) / 100);
}

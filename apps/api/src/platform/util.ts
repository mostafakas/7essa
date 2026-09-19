import type { Prisma } from '@prisma/client';

/** إضافة أشهر مع تثبيت اليوم على آخر الشهر عند الحاجة (31 يناير + شهر = 28/29 فبراير) */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export const pageOf = (q: { page?: number; pageSize?: number }, fallback = 25) => {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? fallback;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

/** يحذف المفاتيح غير المعرفة (undefined) ويترك null للمسح الصريح */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const dec = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toString());

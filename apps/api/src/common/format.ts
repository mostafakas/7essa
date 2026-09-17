import { TZ } from './time';

const dateTime = new Intl.DateTimeFormat('ar-EG', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
});

const money = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 });

/** نص عربي لموعد بتوقيت القاهرة (للإشعارات) */
export const formatCairo = (d: Date) => dateTime.format(d);

/** مبلغ بالجنيه من قروش */
export const formatEgp = (piasters: number) => money.format(piasters / 100);

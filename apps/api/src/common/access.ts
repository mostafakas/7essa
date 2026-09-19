/**
 * حالة وصول مساحة العمل حسب الاشتراك (دالة بحتة قابلة للاختبار).
 *  FULL: كل شيء متاح. READ_ONLY: عرض وتصدير فقط. BLOCKED: لا دخول.
 */
export type AccessMode = 'FULL' | 'READ_ONLY' | 'BLOCKED';
export type AccessReason = 'ACTIVE' | 'TRIAL' | 'TRIAL_ENDED' | 'GRACE' | 'EXPIRED' | 'PAUSED' | 'SUSPENDED';

export interface AccessState {
  mode: AccessMode;
  reason: AccessReason;
  /** أيام متبقية في التجربة أو الاشتراك أو فترة السماح (null = بلا نهاية) */
  daysLeft: number | null;
  /** تاريخ نهاية الفترة الحالية */
  until: Date | null;
}

const DAY = 86_400_000;
const daysUntil = (d: Date, now: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY));

export function accessOf(
  ws: { status: string; trialEndsAt: Date | null; paidUntil: Date | null },
  now: Date,
  graceDays: number,
): AccessState {
  switch (ws.status) {
    case 'SUSPENDED':
      return { mode: 'BLOCKED', reason: 'SUSPENDED', daysLeft: null, until: null };
    case 'PAUSED':
      return { mode: 'READ_ONLY', reason: 'PAUSED', daysLeft: null, until: null };
    case 'TRIAL':
      if (!ws.trialEndsAt) return { mode: 'FULL', reason: 'TRIAL', daysLeft: null, until: null };
      return ws.trialEndsAt > now
        ? { mode: 'FULL', reason: 'TRIAL', daysLeft: daysUntil(ws.trialEndsAt, now), until: ws.trialEndsAt }
        : { mode: 'READ_ONLY', reason: 'TRIAL_ENDED', daysLeft: 0, until: ws.trialEndsAt };
    default: {
      // ACTIVE: بلا تاريخ = اشتراك مفتوح يديره الأدمن يدويًا
      if (!ws.paidUntil) return { mode: 'FULL', reason: 'ACTIVE', daysLeft: null, until: null };
      if (ws.paidUntil > now) return { mode: 'FULL', reason: 'ACTIVE', daysLeft: daysUntil(ws.paidUntil, now), until: ws.paidUntil };
      const graceEnd = new Date(ws.paidUntil.getTime() + graceDays * DAY);
      return graceEnd > now
        ? { mode: 'FULL', reason: 'GRACE', daysLeft: daysUntil(graceEnd, now), until: graceEnd }
        : { mode: 'READ_ONLY', reason: 'EXPIRED', daysLeft: 0, until: graceEnd };
    }
  }
}

export const ACCESS_MESSAGE: Record<AccessReason, string> = {
  ACTIVE: '',
  TRIAL: '',
  GRACE: '',
  TRIAL_ENDED: 'انتهت الفترة التجريبية. الحساب متاح للعرض فقط حتى يتم التفعيل من إدارة المنصة.',
  EXPIRED: 'انتهى الاشتراك. الحساب متاح للعرض فقط حتى يتم التجديد من إدارة المنصة.',
  PAUSED: 'الحساب متوقف مؤقتًا ومتاح للعرض فقط. تواصل مع إدارة المنصة.',
  SUSPENDED: 'الحساب موقوف، تواصل مع إدارة المنصة.',
};

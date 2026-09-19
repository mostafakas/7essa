import { env } from './env';

export const APP_DB_ROLE = 'hessa_app';

/** يضبط معاملات الاتصال المناسبة للتشغيل بلا خادم (Vercel) مع pooler */
export function tuneUrl(raw: string, opts: { pooled: boolean }): string {
  const u = new URL(raw);
  // Prisma لا يدعم channel_binding الذي تضيفه Neon لروابطها
  u.searchParams.delete('channel_binding');
  if (!u.searchParams.has('sslmode') && !['localhost', '127.0.0.1'].includes(u.hostname)) u.searchParams.set('sslmode', 'require');
  if (opts.pooled) {
    if (u.hostname.includes('-pooler') && !u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '15');
  }
  return u.toString();
}

/**
 * رابط اتصال التطبيق وقت التشغيل: نفس خادم DATABASE_URL لكن بدور hessa_app
 * (بلا ملكية للجداول وبلا تجاوز لسياسات RLS). الترحيلات وحدها تستخدم حساب المالك.
 */
export function appDatabaseUrl(): string {
  const e = env();
  if (e.APP_DATABASE_URL) return tuneUrl(e.APP_DATABASE_URL, { pooled: true });
  if (!e.APP_DB_PASSWORD) {
    // تطوير فقط (env() يرفض هذا في الإنتاج): العمل بحساب المالك يعطّل RLS
    console.warn('تحذير: APP_DB_PASSWORD غير مضبوط، التطبيق يعمل بحساب المالك وسياسات RLS لا تُطبق.');
    return tuneUrl(e.DATABASE_URL, { pooled: true });
  }
  const u = new URL(e.DATABASE_URL);
  u.username = APP_DB_ROLE;
  u.password = e.APP_DB_PASSWORD;
  return tuneUrl(u.toString(), { pooled: true });
}

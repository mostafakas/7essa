import { z } from 'zod';

const secret = z.string().min(32, 'يجب ألا يقل السر عن 32 حرفًا');
const optional = (s: z.ZodString) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),

  // قاعدة البيانات (Neon عبر Vercel Marketplace أو Postgres محلي)
  DATABASE_URL: z.string().startsWith('postgres'),
  // كلمة مرور دور التطبيق المقيد hessa_app (يُشتق منها اتصال التشغيل)
  APP_DB_PASSWORD: optional(z.string().min(12)),
  // بديل صريح: رابط كامل لدور التطبيق
  APP_DATABASE_URL: optional(z.string().startsWith('postgres')),

  JWT_ACCESS_SECRET: secret,
  QR_SECRET: secret,
  // يرسله Vercel Cron في ترويسة Authorization
  CRON_SECRET: optional(z.string().min(16)),
  // سر مشترك بين الواجهة والخادم لتمرير عنوان العميل الحقيقي
  PROXY_SHARED_SECRET: optional(z.string().min(24)),
  REQUIRE_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // نطاق الواجهة (يقبل أكثر من نطاق مفصولة بفاصلة)
  WEB_ORIGIN: z.string().min(8),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = `إعدادات البيئة غير صحيحة: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`;
      console.error(msg);
      throw new Error(msg);
    }
    if (parsed.data.NODE_ENV === 'production') {
      if (!parsed.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE يجب أن تكون true في الإنتاج');
      if (!parsed.data.APP_DB_PASSWORD && !parsed.data.APP_DATABASE_URL) {
        throw new Error('APP_DB_PASSWORD مطلوب في الإنتاج حتى يعمل التطبيق بدور hessa_app المقيد (RLS)');
      }
    }
    cached = parsed.data;
  }
  return cached;
}

/** قائمة نطاقات الواجهة المسموحة */
export function webOrigins(): string[] {
  return env()
    .WEB_ORIGIN.split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

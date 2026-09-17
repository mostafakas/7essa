import { z } from 'zod';

const secret = z.string().min(32, 'يجب ألا يقل السر عن 32 حرفًا');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().startsWith('postgres'),
  REDIS_URL: z.string().startsWith('redis'),
  JWT_ACCESS_SECRET: secret,
  OTP_PEPPER: secret,
  QR_SECRET: secret,
  WEB_ORIGIN: z.string().url(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      console.error('إعدادات البيئة غير صحيحة:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
      console.error('COOKIE_SECURE يجب أن تكون true في الإنتاج');
      process.exit(1);
    }
    cached = parsed.data;
  }
  return cached;
}

export function redisConnection() {
  const u = new URL(env().REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

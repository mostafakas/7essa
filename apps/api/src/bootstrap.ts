import 'reflect-metadata';
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { csrfMiddleware, safeEqual } from './common/csrf.middleware';
import { PrismaErrorFilter } from './common/prisma-error.filter';
import { env, webOrigins } from './config/env';

const ARABIC = /[\u0600-\u06FF]/;

/**
 * الواجهة (مشروع Vercel آخر) تمرر الطلبات للخادم وتضيف عنوان العميل الحقيقي
 * مع سر مشترك. بدون السر لا يُصدَّق العنوان المرسل.
 */
function trustedProxy(secret: string | undefined, required: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!secret) return next();
    const key = req.headers['x-hessa-proxy-key'];
    if (typeof key === 'string' && safeEqual(key, secret)) {
      const ip = req.headers['x-hessa-client-ip'];
      if (typeof ip === 'string' && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip)) {
        Object.defineProperty(req, 'ip', { value: ip, configurable: true });
      }
      return next();
    }
    // المهمة المجدولة وفحص الصحة يصلان مباشرة من Vercel
    const direct = req.path.startsWith('/api/v1/cron/') || req.path === '/api/v1/health';
    if (required && !direct) return res.status(403).json({ statusCode: 403, message: 'الوصول المباشر للخادم غير مسموح' });
    next();
  };
}

/** ينشئ تطبيق Nest مهيأ بالكامل (يُستخدم للتشغيل المحلي وعلى Vercel) */
export async function createApp(): Promise<NestExpressApplication> {
  const cfg = env();
  const origins = webOrigins();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: cfg.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : undefined,
  });

  app.set('trust proxy', cfg.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(trustedProxy(cfg.PROXY_SHARED_SECRET, cfg.REQUIRE_PROXY));
  app.useBodyParser('json', { limit: '512kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: cfg.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.use(csrfMiddleware(origins, cfg.COOKIE_SECURE));
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-workspace-id'],
    maxAge: 600,
  });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      validationError: { target: false, value: false },
      // رسالة عربية موحدة تحدد الحقل (أو الرسالة العربية المخصصة إن وُجدت)
      exceptionFactory: (errors: ValidationError[]) => {
        const deepest = (e: ValidationError): ValidationError => (e.children?.length ? deepest(e.children[0]) : e);
        const path = (e: ValidationError): string => (e.children?.length ? `${e.property}.${path(e.children[0])}` : e.property);
        const first = errors[0];
        const custom = first ? Object.values(deepest(first).constraints ?? {}).find((m) => ARABIC.test(m)) : undefined;
        return new BadRequestException({
          statusCode: 400,
          message: custom ?? (first ? `قيمة غير صالحة في الحقل «${path(first)}»` : 'بيانات غير صالحة'),
          field: first ? path(first) : undefined,
        });
      },
    }),
  );
  app.useGlobalFilters(new PrismaErrorFilter());
  return app;
}

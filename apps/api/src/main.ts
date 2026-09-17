import './load-env';
import 'reflect-metadata';
import { BadRequestException, Logger, ValidationPipe, type ValidationError } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { csrfMiddleware } from './common/csrf.middleware';
import { PrismaErrorFilter } from './common/prisma-error.filter';
import { env } from './config/env';

async function bootstrap() {
  const cfg = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // عنوان العميل الحقيقي خلف الوكيل العكسي (لحدود المعدل وسجل التدقيق)
  app.set('trust proxy', cfg.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
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
  app.use(csrfMiddleware(cfg.WEB_ORIGIN, cfg.COOKIE_SECURE));
  app.enableCors({
    origin: cfg.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-workspace-id'],
    maxAge: 600,
  });
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
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
      // رسالة عربية موحدة تحدد الحقل بدل رسائل المكتبة الإنجليزية
      exceptionFactory: (errors: ValidationError[]) => {
        const path = (e: ValidationError): string => (e.children?.length ? `${e.property}.${path(e.children[0])}` : e.property);
        const first = errors[0];
        return new BadRequestException({
          statusCode: 400,
          message: first ? `قيمة غير صالحة في الحقل «${path(first)}»` : 'بيانات غير صالحة',
          field: first ? path(first) : undefined,
        });
      },
    }),
  );
  app.useGlobalFilters(new PrismaErrorFilter());
  app.enableShutdownHooks();

  await app.listen(cfg.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`حصّة API تعمل على المنفذ ${cfg.PORT}`);
}

void bootstrap();

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * حماية CSRF بنمط Double-Submit + فحص Origin.
 * الواجهة تقرأ الكوكي hessa_csrf وترسله في الترويسة x-csrf-token مع كل طلب معدِّل.
 */
export function csrfMiddleware(allowedOrigin: string, secure: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookie: string | undefined = req.cookies?.[CSRF_COOKIE];
    if (!cookie) {
      res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), { httpOnly: false, secure, sameSite: 'strict', path: '/' });
    }
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin) {
      return res.status(403).json({ statusCode: 403, message: 'مصدر الطلب غير مسموح' });
    }
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeEqual(header, cookie)) {
      return res.status(403).json({ statusCode: 403, message: 'رمز الحماية غير صالح، أعد تحميل الصفحة' });
    }
    next();
  };
}

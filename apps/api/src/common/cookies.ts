import type { Response } from 'express';
import { env } from '../config/env';

export const ACCESS_COOKIE = 'hessa_at';
export const REFRESH_COOKIE = 'hessa_rt';
export const CSRF_COOKIE = 'hessa_csrf';
/** مؤشر غير حساس تستخدمه الواجهة لتوجيه المستخدم فقط */
export const SESSION_HINT_COOKIE = 'hessa_session';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const base = () => ({ secure: env().COOKIE_SECURE });

export function setAuthCookies(res: Response, tokens: { access: string; refresh: string }) {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...base(), httpOnly: true, sameSite: 'lax', path: '/api', maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refresh, { ...base(), httpOnly: true, sameSite: 'strict', path: '/api/v1/auth', maxAge: REFRESH_TTL_MS });
  res.cookie(SESSION_HINT_COOKIE, '1', { ...base(), httpOnly: false, sameSite: 'lax', path: '/', maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), httpOnly: true, sameSite: 'lax', path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), httpOnly: true, sameSite: 'strict', path: '/api/v1/auth' });
  res.clearCookie(SESSION_HINT_COOKIE, { ...base(), sameSite: 'lax', path: '/' });
}

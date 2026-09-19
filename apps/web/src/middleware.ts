import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/app', '/family', '/platform', '/start', '/notifications', '/print', '/account'];

/**
 * طلبات /api تُمرر لمشروع الخادم على Vercel مع عنوان العميل الحقيقي وسر مشترك
 * (حتى تعمل حدود المعدل وسجل التدقيق بعنوان المستخدم لا بعنوان Vercel).
 */
function proxyApi(req: NextRequest) {
  const target = process.env.API_INTERNAL_URL;
  if (!target) return NextResponse.next(); // التطوير المحلي: إعادة التوجيه في next.config
  const url = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, target);
  const headers = new Headers(req.headers);
  headers.delete('x-hessa-client-ip');
  headers.delete('x-hessa-proxy-key');
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  const key = process.env.PROXY_SHARED_SECRET;
  if (ip) headers.set('x-hessa-client-ip', ip);
  if (key) headers.set('x-hessa-proxy-key', key);
  return NextResponse.rewrite(url, { request: { headers } });
}

/**
 * سياسة أمان المحتوى بـ nonce لكل طلب (بدون unsafe-inline للسكربتات)،
 * وتحويل غير المسجلين لصفحة الدخول. التحقق الفعلي من الجلسة يتم في الخادم.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) return proxyApi(req);

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get('hessa_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};

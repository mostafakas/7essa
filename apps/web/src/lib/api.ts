'use client';

/** عميل الـAPI: كوكيز httpOnly + رمز CSRF + ترويسة مساحة العمل + تجديد الجلسة تلقائيًا */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const WS_KEY = 'hessa.ws';
const BASE = '/api/v1';

export const workspaceStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(WS_KEY)),
  set: (id: string) => window.localStorage.setItem(WS_KEY, id),
  clear: () => window.localStorage.removeItem(WS_KEY),
};

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  let token = readCookie('hessa_csrf');
  if (!token) {
    await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
    token = readCookie('hessa_csrf');
  }
  if (!token) throw new ApiError('تعذر تهيئة الحماية، أعد تحميل الصفحة', 0);
  return token;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** إرسال ترويسة مساحة العمل (افتراضيًا نعم) */
  workspace?: boolean;
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': await ensureCsrf() },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await ensureCsrf();
  const ws = workspaceStore.get();
  if (opts.workspace !== false && ws) headers['x-workspace-id'] = ws;

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, opts, true);
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    throw new ApiError('انتهت الجلسة', 401);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const raw = (data as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? String(raw[0]) : typeof raw === 'string' ? raw : 'حدث خطأ غير متوقع';
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** خطأ شبكة (عدم اتصال) وليس رفضًا من الخادم */
export const isNetworkError = (e: unknown) => e instanceof TypeError;

/** خطأ تحقق من الواجهة برسالة موجهة للمستخدم */
export class UserError extends Error {}

export const errorText = (e: unknown) =>
  e instanceof ApiError || e instanceof UserError
    ? e.message
    : isNetworkError(e)
      ? 'لا يوجد اتصال بالخادم'
      : 'حدث خطأ غير متوقع';

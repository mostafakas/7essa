import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * رموز الكارنيه:
 *  D.<studentId>.<cardVersion>.<step>.<sig>  متغير كل دقيقة (تطبيق الطالب) يمنع تصوير كارنيه زميل
 *  S.<studentId>.<cardVersion>.<sig>         ثابت للكارنيه المطبوع، يُلغى بزيادة cardVersion
 */
export const QR_STEP_SECONDS = 60;

export interface ParsedToken {
  kind: 'dynamic' | 'card';
  studentId: string;
  cardVersion: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 27);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / QR_STEP_SECONDS);
}

export function makeDynamicToken(secret: string, studentId: string, cardVersion: number, now = Date.now()): string {
  const payload = `D.${studentId}.${cardVersion}.${currentStep(now)}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function makeCardToken(secret: string, studentId: string, cardVersion: number): string {
  const payload = `S.${studentId}.${cardVersion}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyToken(secret: string, raw: string, now = Date.now(), skewSteps = 1): ParsedToken | null {
  if (typeof raw !== 'string' || raw.length > 160) return null;
  const parts = raw.trim().split('.');
  const [kind, studentId, versionStr] = parts;
  if (!UUID.test(studentId ?? '')) return null;
  const cardVersion = Number(versionStr);
  if (!Number.isInteger(cardVersion) || cardVersion < 1) return null;

  if (kind === 'D' && parts.length === 5) {
    const payload = parts.slice(0, 4).join('.');
    if (!safeEqual(parts[4], sign(secret, payload))) return null;
    const step = Number(parts[3]);
    if (!Number.isInteger(step) || Math.abs(currentStep(now) - step) > skewSteps) return null;
    return { kind: 'dynamic', studentId: studentId.toLowerCase(), cardVersion };
  }
  if (kind === 'S' && parts.length === 4) {
    const payload = parts.slice(0, 3).join('.');
    if (!safeEqual(parts[3], sign(secret, payload))) return null;
    return { kind: 'card', studentId: studentId.toLowerCase(), cardVersion };
  }
  return null;
}

import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * تجزئة كلمات المرور بـ scrypt المدمجة في Node (بلا مكتبات خارجية).
 * الصيغة: scrypt$N$r$p$salt$hash — المعاملات محفوظة مع كل كلمة لتسهيل رفعها لاحقًا.
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await derive(password, Buffer.from(saltB64, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** تجزئة وهمية ثابتة: تُستخدم عند عدم وجود المستخدم حتى يتساوى زمن الرد */
let dummy: string | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
}

/** سياسة كلمة المرور: 8 أحرف على الأقل وتحتوي حرفًا ورقمًا */
// أشهر الكلمات التي تستوفي الشروط شكليًا وتُخمن في ثوانٍ
const COMMON = new Set([
  'password1', 'password123', 'passw0rd', 'pass1234', 'qwerty123', 'qwerty12', 'abc12345', 'abcd1234', 'a1234567',
  'aa123456', '123456aa', '1234567a', '12345678a', 'admin123', 'admin1234', 'iloveyou1', 'welcome1', 'hessa2026',
  'hessa123', 'egypt123', 'cairo123', 'mohamed123', 'ahmed123', 'center123', 'teacher1', 'student1',
]);

export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'كلمة المرور 8 أحرف على الأقل';
  if (password.length > 128) return 'كلمة المرور طويلة جدًا';
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/\d/.test(password)) return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  if (/^(.)\1+$/.test(password) || COMMON.has(password.toLowerCase())) return 'كلمة المرور شائعة وسهلة التخمين، اختر غيرها';
  return null;
}

// بلا حروف ملتبسة (0/O و1/l/I) لتُملى بالتليفون أو تُكتب من ورقة بسهولة
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** كلمة مرور مؤقتة سهلة القراءة: 4 حروف + 4 أرقام، مثل kmtr-4827 */
export function generateTempPassword(): string {
  let a = '';
  for (let i = 0; i < 4; i++) a += LETTERS[randomInt(LETTERS.length)];
  let b = '';
  for (let i = 0; i < 4; i++) b += DIGITS[randomInt(DIGITS.length)];
  return `${a}-${b}`;
}

/** اسم المستخدم: حروف لاتينية صغيرة وأرقام ونقطة وشرطة، 3–32 حرفًا */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(input: string): string | null {
  const v = input.trim().toLowerCase();
  return USERNAME_RE.test(v) ? v : null;
}

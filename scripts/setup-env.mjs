// ينشئ ملف .env من .env.example مع أسرار عشوائية قوية (لا يستبدل ملفًا موجودًا)
// ويطبع قيمًا جاهزة للصقها في متغيرات مشروعي Vercel.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const rnd = (n) => randomBytes(n).toString('base64url');
const words = 'bdfghjkmnprstvz';
const adminPassword = () =>
  Array.from({ length: 6 }, () => words[randomBytes(1)[0] % words.length]).join('') + '-' + (1000 + (randomBytes(2).readUInt16BE() % 9000));

if (process.argv.includes('--print')) {
  console.log('قيم عشوائية لمتغيرات Vercel (انسخ كل سطر في مكانه):\n');
  console.log(`APP_DB_PASSWORD=${rnd(24)}`);
  console.log(`JWT_ACCESS_SECRET=${rnd(48)}`);
  console.log(`QR_SECRET=${rnd(48)}`);
  console.log(`CRON_SECRET=${rnd(32)}`);
  console.log(`PROXY_SHARED_SECRET=${rnd(32)}   ← نفس القيمة في المشروعين`);
  console.log(`BOOTSTRAP_ADMIN_PASSWORD=${adminPassword()}`);
  process.exit(0);
}

if (existsSync('.env')) {
  console.log('.env موجود بالفعل، لم يتم تعديله. (npm run setup:env -- --print لطباعة أسرار جديدة)');
  process.exit(0);
}
const admin = adminPassword();
const out = readFileSync('.env.example', 'utf8')
  .replaceAll('__ADMIN_PASSWORD__', admin)
  .replace(/__SECRET__/g, () => rnd(40));
writeFileSync('.env', out, { mode: 0o600 });
console.log('تم إنشاء .env بأسرار عشوائية.');
console.log('ضع روابط قاعدة البيانات (DATABASE_URL و DATABASE_URL_UNPOOLED) ثم: npm run db:migrate');
console.log(`دخول مالك المنصة بعد الترحيل: admin / ${admin}`);

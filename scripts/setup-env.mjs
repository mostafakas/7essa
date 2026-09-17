// ينشئ ملف .env من .env.example مع أسرار عشوائية قوية (لا يستبدل ملفًا موجودًا)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env موجود بالفعل، لم يتم تعديله.');
  process.exit(0);
}
const rnd = (n) => randomBytes(n).toString('base64url');
const owner = rnd(18);
const app = rnd(18);
const redis = rnd(18);
const out = readFileSync('.env.example', 'utf8')
  .replaceAll('__OWNER_PASSWORD__', owner)
  .replaceAll('__APP_PASSWORD__', app)
  .replaceAll('__REDIS_PASSWORD__', redis)
  .replace(/__SECRET__/g, () => rnd(48));
writeFileSync('.env', out, { mode: 0o600 });
console.log('تم إنشاء .env بأسرار عشوائية.');

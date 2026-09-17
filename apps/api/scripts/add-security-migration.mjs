// ينسخ prisma/sql/security.sql كترحيل Prisma بعد ترحيل init
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'prisma', 'migrations');
const names = existsSync(dir) ? readdirSync(dir) : [];

if (!names.some((n) => /^\d{14}_init$/.test(n))) {
  console.error('شغّل أولًا: npm run db:init');
  process.exit(1);
}
if (names.some((n) => n.endsWith('_security'))) {
  console.log('ترحيل الأمان موجود بالفعل.');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const target = join(dir, `${stamp}_security`);
mkdirSync(target);
copyFileSync(join(root, 'prisma', 'sql', 'security.sql'), join(target, 'migration.sql'));
console.log(`تم إنشاء ${stamp}_security`);

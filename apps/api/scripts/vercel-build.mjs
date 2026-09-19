// أمر البناء على Vercel لمشروع الخادم:
//   prisma generate ← nest build ← (الإنتاج فقط) prisma migrate deploy ← ضبط hessa_app ومالك المنصة
// معاينات الفروع (Preview) لا تلمس قاعدة البيانات.
import { spawnSync } from 'node:child_process';

function run(cmd, args, extraEnv = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv }, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Prisma لا يقبل channel_binding الذي تضيفه Neon لروابطها
function clean(u) {
  if (!u) return undefined;
  const url = new URL(u);
  url.searchParams.delete('channel_binding');
  return url.toString();
}

const placeholder = 'postgresql://build:build@localhost:5432/build';
const owner = clean(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const pooled = clean(process.env.DATABASE_URL) || owner;
const prismaEnv = { DATABASE_URL: pooled || placeholder, DATABASE_URL_UNPOOLED: owner || placeholder };

run('prisma', ['generate'], prismaEnv);
run('nest', ['build']);

const migrate = process.env.VERCEL_ENV === 'production' || process.env.MIGRATE_ON_BUILD === 'true';
if (!migrate) {
  console.log('\nتخطي الترحيلات: ليست بيئة الإنتاج.');
  process.exit(0);
}
if (!owner) {
  console.error('\nDATABASE_URL_UNPOOLED غير مضبوط. اربط قاعدة Neon بالمشروع من تبويب Storage.');
  process.exit(1);
}
run('prisma', ['migrate', 'deploy'], prismaEnv);
run('node', ['dist/scripts/setup-db.js'], { SETUP_DATABASE_URL: owner });

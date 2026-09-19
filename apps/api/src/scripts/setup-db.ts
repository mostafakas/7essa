/**
 * يُشغَّل بعد الترحيلات بحساب المالك (أثناء بناء الإنتاج على Vercel أو يدويًا محليًا):
 *  1) يضبط دور التطبيق المقيد hessa_app بكلمة المرور APP_DB_PASSWORD (قابل للدخول، بلا تجاوز RLS)
 *  2) ينشئ حساب مالك المنصة الأول من BOOTSTRAP_ADMIN_* إن لم يوجد مالك منصة نشط
 *     (أو يعيد ضبط كلمة مروره إذا كان BOOTSTRAP_ADMIN_RESET=true — طريق الاسترجاع)
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, normalizeUsername, passwordProblem } from '../auth/password';
import { normalizeEgyptPhone } from '../common/phone';

const url = process.env.SETUP_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('لا يوجد رابط قاعدة بيانات (DATABASE_URL_UNPOOLED).');
  process.exit(1);
}
const clean = new URL(url);
clean.searchParams.delete('channel_binding');
const prisma = new PrismaClient({ datasourceUrl: clean.toString() });

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function ensureAppRole() {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    console.warn('APP_DB_PASSWORD غير مضبوط: لم يُضبط دور hessa_app (التطبيق سيرفض العمل في الإنتاج).');
    return;
  }
  if (password.length < 16) throw new Error('APP_DB_PASSWORD يجب ألا يقل عن 16 حرفًا عشوائيًا');
  // الخصائص الافتراضية (بلا SUPERUSER وبلا BYPASSRLS) تكفي، ولا يُسمح لغير المدير الأعلى بذكرها صراحة
  await prisma.$executeRawUnsafe(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hessa_app') THEN
    CREATE ROLE hessa_app LOGIN PASSWORD ${quote(password)};
  ELSE
    ALTER ROLE hessa_app WITH LOGIN PASSWORD ${quote(password)};
  END IF;
END $$;`);
  const [role] = await prisma.$queryRaw<{ bypass: boolean; sup: boolean }[]>`
    SELECT rolbypassrls AS bypass, rolsuper AS sup FROM pg_roles WHERE rolname = 'hessa_app'`;
  if (!role || role.bypass || role.sup) throw new Error('دور hessa_app يتجاوز RLS! أعد إنشاءه بدون BYPASSRLS/SUPERUSER.');
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO hessa_app`);
  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO hessa_app');
  console.log('✓ دور التطبيق hessa_app جاهز (بلا تجاوز RLS).');
}

async function ensureSuperAdmin() {
  const rawUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const reset = process.env.BOOTSTRAP_ADMIN_RESET === 'true';
  const existing = await prisma.user.count({ where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' } });
  if (existing > 0 && !reset) {
    console.log('✓ يوجد مالك منصة نشط.');
    return;
  }
  if (!rawUsername || !password) {
    console.warn('لا يوجد مالك منصة. اضبط BOOTSTRAP_ADMIN_USERNAME و BOOTSTRAP_ADMIN_PASSWORD ثم أعد النشر.');
    return;
  }
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error('BOOTSTRAP_ADMIN_USERNAME غير صالح (حروف إنجليزية صغيرة وأرقام . _ -)');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${problem}`);
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE ? normalizeEgyptPhone(process.env.BOOTSTRAP_ADMIN_PHONE) : null;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'مالك المنصة';
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash, platformRole: 'SUPER_ADMIN', isPlatformAdmin: true, status: 'ACTIVE',
      mustChangePassword: false, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date(),
    },
    create: {
      username, name, phone, passwordHash, platformRole: 'SUPER_ADMIN', isPlatformAdmin: true,
      mustChangePassword: false, passwordChangedAt: new Date(),
    },
  });
  await prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditLog.createMany({
    data: [{ actorUserId: null, action: reset ? 'platform.admin_reset' : 'platform.admin_bootstrap', entity: 'user', entityId: user.id }],
  });
  console.log(`✓ حساب مالك المنصة «${username}» جاهز.${reset ? ' (تذكر حذف BOOTSTRAP_ADMIN_RESET الآن)' : ''}`);
}

async function main() {
  await ensureAppRole();
  await ensureSuperAdmin();
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

-- ════════════════════════════════════════════════════════════════════
-- حصّة: الدخول باسم مستخدم وكلمة مرور، لوحة إدارة المنصة، الخطط والمدفوعات
-- ════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'STAFF', 'OWNERS', 'FAMILIES');

-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- ───── الحسابات: كلمة المرور وحالة الحساب والقفل المؤقت
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "username" TEXT,
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "platformRole" "PlatformRole",
ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

UPDATE "users" SET "platformRole" = 'SUPER_ADMIN' WHERE "isPlatformAdmin" = true;

-- ───── إلغاء الدخول برمز OTP
DROP TABLE IF EXISTS "otp_challenges";

-- ───── الاشتراك وحدود الخطة على مساحة العمل
ALTER TABLE "workspaces" ADD COLUMN "paidUntil" TIMESTAMP(3),
ADD COLUMN "suspendReason" TEXT,
ADD COLUMN "governorate" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "maxStudents" INTEGER,
ADD COLUMN "maxStaff" INTEGER;

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "yearlyPrice" DECIMAL(12,2),
    "maxStudents" INTEGER,
    "maxStaff" INTEGER,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "planCode" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_notes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "level" "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowSelfSignup" BOOLEAN NOT NULL DEFAULT false,
    "defaultTrialDays" INTEGER NOT NULL DEFAULT 30,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "maxOwnedWorkspaces" INTEGER NOT NULL DEFAULT 5,
    "supportPhone" TEXT,
    "maintenanceMessage" TEXT,
    "lastCronAt" TIMESTAMP(3),
    "lastCronResult" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "platform_payments_workspaceId_paidAt_idx" ON "platform_payments"("workspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "platform_payments_paidAt_idx" ON "platform_payments"("paidAt");

-- CreateIndex
CREATE INDEX "workspace_notes_workspaceId_createdAt_idx" ON "workspace_notes"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "announcements_active_startsAt_idx" ON "announcements"("active", "startsAt");

-- AddForeignKey
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── بيانات أولية: الإعدادات والخطط (الأسعار تُضبط من لوحة الإدارة)
INSERT INTO "platform_settings" ("id", "allowSelfSignup", "defaultTrialDays", "graceDays", "maxOwnedWorkspaces", "updatedAt")
VALUES (1, false, 30, 7, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "plans" ("id", "code", "name", "monthlyPrice", "maxStudents", "maxStaff", "description", "sortOrder") VALUES
  (gen_random_uuid(), 'trial',      'تجريبي',          0, NULL, NULL, 'الفترة التجريبية بكل المميزات', 0),
  (gen_random_uuid(), 'teacher',    'مدرس خاص',        0, 150,  3,    'مدرس بمجموعاته ومساعديه',       1),
  (gen_random_uuid(), 'center',     'سنتر',            0, 500,  15,   'سنتر متوسط',                    2),
  (gen_random_uuid(), 'center-pro', 'سنتر برو',        0, NULL, NULL, 'بلا حدود للطلاب أو الفريق',     3)
ON CONFLICT ("code") DO NOTHING;

-- ───── الأمان
-- هل المستخدم الحالي عضو نشط في فريق إدارة المنصة؟
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM users WHERE id = app_uid() AND "platformRole" IS NOT NULL AND status = 'ACTIVE') $$;

-- قراءة إدارية عبر كل المساحات (SELECT مغلفة لتُحسب مرة واحدة لكل استعلام لا لكل صف)
DROP POLICY IF EXISTS membership_platform_read ON memberships;
CREATE POLICY membership_platform_read ON memberships FOR SELECT USING ((SELECT app_is_platform_admin()));
DROP POLICY IF EXISTS student_platform_read ON students;
CREATE POLICY student_platform_read ON students FOR SELECT USING ((SELECT app_is_platform_admin()));
DROP POLICY IF EXISTS audit_platform_read ON audit_logs;
CREATE POLICY audit_platform_read ON audit_logs FOR SELECT USING ((SELECT app_is_platform_admin()));

-- الإضافة للسجل والإشعارات مقصورة على دور التطبيق
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO hessa_app WITH CHECK (true);
DROP POLICY IF EXISTS notif_insert ON notifications;
CREATE POLICY notif_insert ON notifications FOR INSERT TO hessa_app WITH CHECK (true);

-- مؤشرات استخدام مجمعة لكل مساحة (لإدارة المنصة فقط)
DROP FUNCTION IF EXISTS app_platform_workspace_stats();
CREATE OR REPLACE FUNCTION app_platform_workspace_usage(p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (ws_id uuid, members_n bigint, students_n bigint, groups_n bigint, receipts_n bigint,
               attendance_n bigint, attempts_n bigint, last_activity timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id,
         (SELECT count(*) FROM memberships m WHERE m."workspaceId" = w.id AND m.status = 'ACTIVE'),
         (SELECT count(DISTINCT e."studentId") FROM enrollments e WHERE e."workspaceId" = w.id AND e.status = 'ACTIVE'),
         (SELECT count(*) FROM groups g WHERE g."workspaceId" = w.id AND NOT g.archived),
         (SELECT count(*) FROM receipts r WHERE r."workspaceId" = w.id AND r."createdAt" > now() - interval '30 days'),
         (SELECT count(*) FROM attendance a WHERE a."workspaceId" = w.id AND a."recordedAt" > now() - interval '30 days'),
         (SELECT count(*) FROM exam_attempts x WHERE x."workspaceId" = w.id AND x."startedAt" > now() - interval '30 days'),
         GREATEST((SELECT max(r."createdAt") FROM receipts r WHERE r."workspaceId" = w.id),
                  (SELECT max(a."recordedAt") FROM attendance a WHERE a."workspaceId" = w.id))
  FROM workspaces w
  WHERE app_is_platform_admin() AND (p_ids IS NULL OR w.id = ANY(p_ids))
$$;

-- عدد الطلاب النشطين في مساحة (لفرض حد الخطة دون تجاوز العزل)
CREATE OR REPLACE FUNCTION app_ws_active_students() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT count(DISTINCT "studentId") FROM enrollments WHERE "workspaceId" = app_ws() AND status = 'ACTIVE' $$;

REVOKE EXECUTE ON FUNCTION app_is_platform_admin(), app_platform_workspace_usage(uuid[]), app_ws_active_students() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_platform_admin(), app_platform_workspace_usage(uuid[]), app_ws_active_students() TO hessa_app;

-- صلاحيات الجداول الجديدة لدور التطبيق
GRANT SELECT, INSERT, UPDATE ON "plans", "platform_payments", "workspace_notes", "announcements", "platform_settings" TO hessa_app;
GRANT DELETE ON "workspace_notes", "announcements", "platform_payments" TO hessa_app;

-- جدول الترحيلات ليس من شأن دور التطبيق
REVOKE ALL ON "_prisma_migrations" FROM hessa_app;

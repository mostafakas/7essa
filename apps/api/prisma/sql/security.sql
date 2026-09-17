-- ════════════════════════════════════════════════════════════════════
-- حصّة: عزل الصفوف (RLS)، منع تعديل الإيصالات، سجل تدقيق إلحاقي، والصلاحيات
-- يُطبق كترحيل Prisma عبر: npm run db:security
-- الملف idempotent ويمكن إعادة تشغيله.
-- ════════════════════════════════════════════════════════════════════

-- دور التطبيق (يُنشأ بكلمة مرور عبر docker/postgres/init؛ هنا احتياطي بدون دخول)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hessa_app') THEN
    CREATE ROLE hessa_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- ───── 1) سياق الطلب: يضبطه الخادم داخل كل معاملة بـ set_config(..., true)
CREATE OR REPLACE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_ws() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;

-- دوال SECURITY DEFINER تعمل بصلاحية مالك الجداول، فتتجنب تكرار السياسات لا نهائيًا
CREATE OR REPLACE FUNCTION app_guardian_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM students WHERE "guardianUserId" = app_uid() OR "studentUserId" = app_uid() $$;

CREATE OR REPLACE FUNCTION app_guardian_group_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT e."groupId" FROM enrollments e JOIN students s ON s.id = e."studentId"
   WHERE s."guardianUserId" = app_uid() OR s."studentUserId" = app_uid() $$;

CREATE OR REPLACE FUNCTION app_ws_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT "studentId" FROM enrollments WHERE "workspaceId" = app_ws() $$;

-- مطابقة طالب مسجل سابقًا لنفس ولي الأمر دون كشف أي بيانات عنه (تُرجع المعرف فقط)
CREATE OR REPLACE FUNCTION app_match_student(p_guardian uuid, p_name text, p_grade text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM students
   WHERE "guardianUserId" = p_guardian
     AND grade = p_grade
     AND lower(regexp_replace(btrim("fullName"), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
   LIMIT 1 $$;

-- موافقة ولي الأمر على معالجة بيانات ابنه: تعدل حقلًا واحدًا فقط
CREATE OR REPLACE FUNCTION app_guardian_consent(p_enrollment uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE enrollments SET "guardianConsentAt" = now()
   WHERE id = p_enrollment
     AND "guardianConsentAt" IS NULL
     AND "studentId" IN (SELECT id FROM students WHERE "guardianUserId" = app_uid());
  RETURN FOUND;
END $$;

-- إحصاءات مجمعة فقط لمالك المنصة (لا بيانات شخصية)
CREATE OR REPLACE FUNCTION app_platform_workspace_stats()
RETURNS TABLE (workspace_id uuid, members bigint, active_students bigint, receipts_30d bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id,
         (SELECT count(*) FROM memberships m WHERE m."workspaceId" = w.id AND m.status = 'ACTIVE'),
         (SELECT count(DISTINCT e."studentId") FROM enrollments e WHERE e."workspaceId" = w.id AND e.status = 'ACTIVE'),
         (SELECT count(*) FROM receipts r WHERE r."workspaceId" = w.id AND r."createdAt" > now() - interval '30 days')
  FROM workspaces w
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = app_uid() AND u."isPlatformAdmin")
$$;

-- ───── 2) تفعيل RLS
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','halls','groups','class_sessions','students','enrollments','attendance',
    'cash_shifts','receipts','expenses','teacher_contracts','teacher_advances','settlements',
    'questions','exams','exam_questions','exam_attempts','audit_logs','notifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- سياسة العزل العامة: كل صف يخص مساحة العمل الحالية فقط
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'halls','groups','class_sessions','enrollments','attendance','cash_shifts','receipts',
    'expenses','teacher_contracts','teacher_advances','settlements','questions','exams',
    'exam_questions','exam_attempts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING ("workspaceId" = app_ws()) WITH CHECK ("workspaceId" = app_ws())', t);
  END LOOP;
END $$;

-- العضويات: يرى المستخدم عضوياته في كل المساحات، والكتابة داخل المساحة الحالية فقط
DROP POLICY IF EXISTS membership_read ON memberships;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING ("workspaceId" = app_ws() OR "userId" = app_uid());
DROP POLICY IF EXISTS membership_insert ON memberships;
CREATE POLICY membership_insert ON memberships FOR INSERT WITH CHECK ("workspaceId" = app_ws());
DROP POLICY IF EXISTS membership_update ON memberships;
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING ("workspaceId" = app_ws()) WITH CHECK ("workspaceId" = app_ws());

-- الطلاب: هوية عامة يراها ولي الأمر والطالب، والمساحات المسجل بها فقط
DROP POLICY IF EXISTS student_access ON students;
CREATE POLICY student_access ON students FOR ALL
  USING ("guardianUserId" = app_uid() OR "studentUserId" = app_uid()
         OR "createdInWorkspaceId" = app_ws()
         OR id IN (SELECT app_ws_student_ids()))
  WITH CHECK ("createdInWorkspaceId" = app_ws() OR id IN (SELECT app_ws_student_ids()));

-- قراءة الأسرة عبر كل السناتر والمدرسين (قراءة فقط)
DROP POLICY IF EXISTS guardian_read ON enrollments;
CREATE POLICY guardian_read ON enrollments FOR SELECT USING ("studentId" IN (SELECT app_guardian_student_ids()));
DROP POLICY IF EXISTS guardian_read ON attendance;
CREATE POLICY guardian_read ON attendance FOR SELECT USING ("studentId" IN (SELECT app_guardian_student_ids()));
DROP POLICY IF EXISTS guardian_read ON receipts;
CREATE POLICY guardian_read ON receipts FOR SELECT USING ("studentId" IN (SELECT app_guardian_student_ids()));
DROP POLICY IF EXISTS guardian_read ON groups;
CREATE POLICY guardian_read ON groups FOR SELECT USING (id IN (SELECT app_guardian_group_ids()));
DROP POLICY IF EXISTS guardian_read ON class_sessions;
CREATE POLICY guardian_read ON class_sessions FOR SELECT USING ("groupId" IN (SELECT app_guardian_group_ids()));

-- التدقيق: الإضافة مسموحة، والقراءة داخل المساحة فقط
DROP POLICY IF EXISTS audit_read ON audit_logs;
CREATE POLICY audit_read ON audit_logs FOR SELECT USING ("workspaceId" = app_ws());
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (true);

-- الإشعارات: كل مستخدم يرى إشعاراته فقط، والعامل الخلفي يضيف
DROP POLICY IF EXISTS notif_read ON notifications;
CREATE POLICY notif_read ON notifications FOR SELECT USING ("userId" = app_uid());
DROP POLICY IF EXISTS notif_update ON notifications;
CREATE POLICY notif_update ON notifications FOR UPDATE USING ("userId" = app_uid()) WITH CHECK ("userId" = app_uid());
DROP POLICY IF EXISTS notif_insert ON notifications;
CREATE POLICY notif_insert ON notifications FOR INSERT WITH CHECK (true);

-- ───── 3) قيود السلامة المالية
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE OR REPLACE FUNCTION guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipts cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.number, NEW.amount, NEW."discountAmount", NEW."studentId", NEW."enrollmentId", NEW."workspaceId",
      NEW.method, NEW."forMonth", NEW."issuedById", NEW."shiftId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD.number, OLD.amount, OLD."discountAmount", OLD."studentId", OLD."enrollmentId", OLD."workspaceId",
      OLD.method, OLD."forMonth", OLD."issuedById", OLD."shiftId", OLD."createdAt") THEN
    RAISE EXCEPTION 'receipt financial fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled receipts are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS receipts_guard ON receipts;
CREATE TRIGGER receipts_guard BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION guard_receipt();

CREATE OR REPLACE FUNCTION guard_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'PAID' THEN
    RAISE EXCEPTION 'paid settlements are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS settlements_guard ON settlements;
CREATE TRIGGER settlements_guard BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION guard_settlement();

CREATE OR REPLACE FUNCTION guard_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'approved shifts are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shifts_guard ON cash_shifts;
CREATE TRIGGER shifts_guard BEFORE UPDATE OR DELETE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION guard_shift();

-- ───── 4) صلاحيات دور التطبيق (أقل صلاحية ممكنة)
GRANT USAGE ON SCHEMA public TO hessa_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hessa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hessa_app;
GRANT DELETE ON halls, exam_questions, refresh_sessions, otp_challenges TO hessa_app;
-- REVOKE ALL ON _prisma_migrations FROM hessa_app;
REVOKE UPDATE ON audit_logs FROM hessa_app;

REVOKE EXECUTE ON FUNCTION app_guardian_student_ids(), app_guardian_group_ids(), app_ws_student_ids(),
  app_match_student(uuid, text, text), app_guardian_consent(uuid), app_platform_workspace_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_uid(), app_ws(), app_guardian_student_ids(), app_guardian_group_ids(),
  app_ws_student_ids(), app_match_student(uuid, text, text), app_guardian_consent(uuid),
  app_platform_workspace_stats() TO hessa_app;

-- ───── 5) بوابة الأسرة: الامتحانات والجدول دون ضبط مساحة عمل
-- الأسرة لا تضبط app.workspace_id أبدًا؛ كل وصولها يمر بهذه الدوال والسياسات الضيقة.

CREATE OR REPLACE FUNCTION app_guardian_exam_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT x.id FROM exams x
   WHERE x.status <> 'DRAFT' AND x."groupId" IN (SELECT app_guardian_group_ids()) $$;

DROP POLICY IF EXISTS guardian_read ON exams;
CREATE POLICY guardian_read ON exams FOR SELECT USING (id IN (SELECT app_guardian_exam_ids()));

-- محاولات الامتحان: الأسرة تنشئ وتحدّث محاولات أبنائها في امتحانات منشورة لمجموعاتهم فقط
DROP POLICY IF EXISTS family_attempts ON exam_attempts;
CREATE POLICY family_attempts ON exam_attempts FOR ALL
  USING ("studentId" IN (SELECT app_guardian_student_ids()))
  WITH CHECK ("studentId" IN (SELECT app_guardian_student_ids()) AND "examId" IN (SELECT app_guardian_exam_ids()));

-- ورقة الأسئلة بدون الإجابات الصحيحة
CREATE OR REPLACE FUNCTION app_exam_paper(p_exam uuid)
RETURNS TABLE (question_id uuid, body text, choices jsonb, qtype text, points int, pos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.body, q.choices, q.type::text, eq.points, eq.position
  FROM exam_questions eq JOIN questions q ON q.id = eq."questionId"
  WHERE eq."examId" = p_exam AND p_exam IN (SELECT app_guardian_exam_ids())
  ORDER BY eq.position
$$;

-- مفتاح التصحيح لا يُتاح إلا بعد تسجيل التسليم فعليًا
CREATE OR REPLACE FUNCTION app_exam_key(p_attempt uuid)
RETURNS TABLE (question_id uuid, correct_index int, points int, choice_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q."correctIndex", eq.points, jsonb_array_length(q.choices)
  FROM exam_attempts a
  JOIN exam_questions eq ON eq."examId" = a."examId"
  JOIN questions q ON q.id = eq."questionId"
  WHERE a.id = p_attempt
    AND a."submittedAt" IS NOT NULL
    AND a."studentId" IN (SELECT app_guardian_student_ids())
$$;

-- جدول الحصص لكل الأبناء عبر كل السناتر والمدرسين
CREATE OR REPLACE FUNCTION app_guardian_schedule(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (session_id uuid, starts_at timestamptz, ends_at timestamptz, status text, cancel_reason text,
               group_id uuid, group_name text, subject text, teacher_name text, hall_name text, workspace_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cs.id, cs."startsAt", cs."endsAt", cs.status::text, cs."cancelReason",
         g.id, g.name, g.subject, u.name, h.name, w.name
  FROM class_sessions cs
  JOIN groups g ON g.id = cs."groupId"
  JOIN memberships m ON m.id = g."teacherMembershipId"
  JOIN users u ON u.id = m."userId"
  JOIN workspaces w ON w.id = cs."workspaceId"
  LEFT JOIN halls h ON h.id = cs."hallId"
  WHERE cs."groupId" IN (SELECT app_guardian_group_ids())
    AND cs."startsAt" >= p_from AND cs."startsAt" < p_to
    AND p_to - p_from <= interval '62 days'
  ORDER BY cs."startsAt"
$$;

-- أسماء المدرسين لمجموعات الأبناء فقط
CREATE OR REPLACE FUNCTION app_guardian_group_teachers()
RETURNS TABLE (group_id uuid, teacher_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, u.name FROM groups g
  JOIN memberships m ON m.id = g."teacherMembershipId"
  JOIN users u ON u.id = m."userId"
  WHERE g.id IN (SELECT app_guardian_group_ids())
$$;

REVOKE EXECUTE ON FUNCTION app_guardian_exam_ids(), app_exam_paper(uuid), app_exam_key(uuid),
  app_guardian_schedule(timestamptz, timestamptz), app_guardian_group_teachers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_guardian_exam_ids(), app_exam_paper(uuid), app_exam_key(uuid),
  app_guardian_schedule(timestamptz, timestamptz), app_guardian_group_teachers() TO hessa_app;

-- ملاحظة: أي جدول جديد لاحقًا يحتاج GRANT وسياسة عزل في ترحيل مستقل.

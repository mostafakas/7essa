-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('CENTER', 'TEACHER');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'TEACHER', 'RECEPTION', 'ACCOUNTANT', 'ASSISTANT', 'FOLLOWUP');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EducationSystem" AS ENUM ('GENERAL', 'BACCALAUREATE', 'AZHAR', 'LANGUAGES', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITLIST', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR_DYNAMIC', 'QR_CARD', 'CODE', 'MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'WALLET', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('VALID', 'CANCEL_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PERCENTAGE', 'HALL_RENT_HOURLY', 'PER_STUDENT', 'MIXED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'TEACHER_CONFIRMED', 'DISPUTED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "receiptSeq" INTEGER NOT NULL DEFAULT 0,
    "receptionMaxDiscountPct" INTEGER NOT NULL DEFAULT 10,
    "lateAfterMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "supervisorMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "halls" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teacherMembershipId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "system" "EducationSystem" NOT NULL DEFAULT 'GENERAL',
    "capacity" INTEGER NOT NULL,
    "monthlyFee" DECIMAL(12,2) NOT NULL,
    "defaultHallId" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "hallId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "school" TEXT,
    "guardianUserId" UUID NOT NULL,
    "studentUserId" UUID,
    "createdInWorkspaceId" UUID NOT NULL,
    "cardVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "guardianConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientOpId" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "openKey" TEXT,
    "openingBalance" DECIMAL(12,2) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(12,2),
    "countedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "closeNote" TEXT,
    "approvedById" UUID,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "shiftId" UUID,
    "studentId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL,
    "forMonth" TEXT NOT NULL,
    "note" TEXT,
    "issuedById" UUID NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'VALID',
    "cancelReason" TEXT,
    "cancelRequestedById" UUID,
    "cancelApprovedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "shiftId" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_contracts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teacherMembershipId" UUID NOT NULL,
    "type" "ContractType" NOT NULL,
    "teacherPct" DECIMAL(5,2),
    "hourlyRent" DECIMAL(12,2),
    "perStudentAmount" DECIMAL(12,2),
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_advances" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teacherMembershipId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "month" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teacherMembershipId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "grossCollected" DECIMAL(12,2) NOT NULL,
    "payingStudents" INTEGER NOT NULL,
    "hoursUsed" DECIMAL(8,2) NOT NULL,
    "teacherShare" DECIMAL(12,2) NOT NULL,
    "centerShare" DECIMAL(12,2) NOT NULL,
    "advancesDeducted" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "disputeNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidById" UUID,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ownerMembershipId" UUID NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "unit" TEXT,
    "type" "QuestionType" NOT NULL,
    "body" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "bloom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "groupId" UUID,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "showResultImmediately" BOOLEAN NOT NULL DEFAULT true,
    "shuffle" BOOLEAN NOT NULL DEFAULT true,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "examId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("examId","questionId")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "questionOrder" JSONB NOT NULL,
    "answers" JSONB,
    "results" JSONB,
    "score" INTEGER,
    "maxScore" INTEGER,
    "late" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "workspaceId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_createdAt_idx" ON "otp_challenges"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_idx" ON "refresh_sessions"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_workspaceId_userId_key" ON "memberships"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "halls_workspaceId_name_key" ON "halls"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "groups_workspaceId_teacherMembershipId_idx" ON "groups"("workspaceId", "teacherMembershipId");

-- CreateIndex
CREATE INDEX "class_sessions_workspaceId_startsAt_idx" ON "class_sessions"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "class_sessions_groupId_startsAt_idx" ON "class_sessions"("groupId", "startsAt");

-- CreateIndex
CREATE INDEX "students_guardianUserId_idx" ON "students"("guardianUserId");

-- CreateIndex
CREATE INDEX "enrollments_studentId_idx" ON "enrollments"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_groupId_studentId_key" ON "enrollments"("groupId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_workspaceId_code_key" ON "enrollments"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_clientOpId_key" ON "attendance"("clientOpId");

-- CreateIndex
CREATE INDEX "attendance_workspaceId_studentId_idx" ON "attendance"("workspaceId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessionId_studentId_key" ON "attendance"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_openKey_key" ON "cash_shifts"("openKey");

-- CreateIndex
CREATE INDEX "cash_shifts_workspaceId_status_idx" ON "cash_shifts"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "receipts_workspaceId_forMonth_idx" ON "receipts"("workspaceId", "forMonth");

-- CreateIndex
CREATE INDEX "receipts_enrollmentId_forMonth_idx" ON "receipts"("enrollmentId", "forMonth");

-- CreateIndex
CREATE INDEX "receipts_studentId_idx" ON "receipts"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_workspaceId_number_key" ON "receipts"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_createdAt_idx" ON "expenses"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "teacher_contracts_workspaceId_teacherMembershipId_idx" ON "teacher_contracts"("workspaceId", "teacherMembershipId");

-- CreateIndex
CREATE INDEX "teacher_advances_workspaceId_month_idx" ON "teacher_advances"("workspaceId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_workspaceId_teacherMembershipId_month_key" ON "settlements"("workspaceId", "teacherMembershipId", "month");

-- CreateIndex
CREATE INDEX "questions_workspaceId_subject_grade_idx" ON "questions"("workspaceId", "subject", "grade");

-- CreateIndex
CREATE INDEX "exams_workspaceId_groupId_idx" ON "exams"("workspaceId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_examId_studentId_key" ON "exam_attempts"("examId", "studentId");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_createdAt_idx" ON "audit_logs"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_teacherMembershipId_fkey" FOREIGN KEY ("teacherMembershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_teacherMembershipId_fkey" FOREIGN KEY ("teacherMembershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_advances" ADD CONSTRAINT "teacher_advances_teacherMembershipId_fkey" FOREIGN KEY ("teacherMembershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_teacherMembershipId_fkey" FOREIGN KEY ("teacherMembershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

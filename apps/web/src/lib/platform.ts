/** أنواع ردود لوحة إدارة المنصة وتسمياتها */
import type { AccessState, PlatformRole } from './session';

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface Usage {
  members: number;
  activeStudents: number;
  groups: number;
  receipts30d: number;
  attendance30d: number;
  attempts30d: number;
  lastActivity: string | null;
}

export interface WorkspaceBase {
  id: string;
  type: 'CENTER' | 'TEACHER';
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
  plan: string;
  trialEndsAt: string | null;
  paidUntil: string | null;
  suspendReason: string | null;
  governorate: string | null;
  contactPhone: string | null;
  maxStudents: number | null;
  maxStaff: number | null;
  receptionMaxDiscountPct: number;
  lateAfterMinutes: number;
  createdAt: string;
}

export interface WorkspaceRow extends WorkspaceBase {
  owner: { id: string; name: string; phone: string | null; username: string | null; login: string } | null;
  usage: Usage;
  access: AccessState;
}

export interface MemberRow {
  membershipId: string;
  role: string;
  status: 'ACTIVE' | 'DISABLED';
  supervisorMembershipId: string | null;
  createdAt: string;
  user: { id: string; name: string; login: string; status: string; lastLoginAt: string | null; hasPassword: boolean };
}

export interface PaymentRow {
  id: string;
  workspaceId: string;
  amount: string;
  months: number;
  method: string;
  planCode: string | null;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  recordedBy: string;
  workspace?: { id: string; name: string; type: string };
}

export interface NoteRow {
  id: string;
  body: string;
  author: string;
  authorUserId: string;
  createdAt: string;
}

export interface WorkspaceDetail {
  workspace: WorkspaceBase;
  access: AccessState;
  limits: { planCode: string; planName: string; maxStudents: number | null; maxStaff: number | null };
  usage: Usage;
  members: MemberRow[];
  payments: PaymentRow[];
  notes: NoteRow[];
}

export interface UserRow {
  id: string;
  name: string;
  phone: string;
  username: string | null;
  login: string;
  status: 'ACTIVE' | 'DISABLED';
  platformRole: PlatformRole | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  memberships: number;
  children: number;
}

export interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
  workspace?: { id: string; name: string } | null;
}

export interface UserDetail {
  user: {
    id: string;
    name: string;
    phone: string;
    username: string | null;
    login: string;
    status: 'ACTIVE' | 'DISABLED';
    platformRole: PlatformRole | null;
    hasPassword: boolean;
    mustChangePassword: boolean;
    failedLogins: number;
    lockedUntil: string | null;
    lastLoginAt: string | null;
    passwordChangedAt: string | null;
    notes: string | null;
    createdAt: string;
  };
  memberships: { membershipId: string; role: string; status: string; createdAt: string; workspace: { id: string; name: string; type: string; status: string } }[];
  children: { id: string; fullName: string; grade: string; school: string | null; relation: 'SELF' | 'CHILD' }[];
  sessions: { id: string; createdAt: string; expiresAt: string; ip: string | null; userAgent: string | null }[];
  audit: { id: string; action: string; actorUserId: string | null; workspaceId: string | null; meta: Record<string, unknown> | null; ip: string | null; createdAt: string }[];
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  yearlyPrice: string | null;
  maxStudents: number | null;
  maxStaff: number | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  workspaces: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: 'ALL' | 'STAFF' | 'OWNERS' | 'FAMILIES';
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export const AUDIENCE_LABEL: Record<Announcement['audience'], string> = {
  ALL: 'الكل',
  STAFF: 'فرق العمل في السناتر',
  OWNERS: 'ملاك السناتر والمدرسين',
  FAMILIES: 'أولياء الأمور والطلاب',
};

export const LEVEL_LABEL: Record<Announcement['level'], string> = { INFO: 'معلومة', WARNING: 'تنبيه', CRITICAL: 'هام جدًا' };

export const TYPE_LABEL: Record<string, string> = { CENTER: 'سنتر', TEACHER: 'مدرس خاص' };

export const USER_KIND_LABEL: Record<string, string> = {
  '': 'الكل',
  admin: 'فريق المنصة',
  staff: 'أعضاء فرق العمل',
  family: 'أولياء الأمور',
  none: 'غير مرتبطين',
  nopassword: 'بلا كلمة مرور',
  pending: 'لم يسجلوا دخولًا',
  locked: 'مقفولون مؤقتًا',
};

/** تسميات سجل العمليات */
export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'تسجيل دخول',
  'auth.login_failed': 'محاولة دخول فاشلة',
  'auth.locked': 'قفل مؤقت بعد محاولات فاشلة',
  'auth.password_change': 'تغيير كلمة المرور',
  'auth.refresh_reuse': 'تنبيه أمني: إعادة استخدام جلسة',
  'user.rename': 'تعديل الاسم',
  'user.credentials_issue': 'إصدار بيانات دخول',
  'platform.admin_bootstrap': 'إنشاء مالك المنصة',
  'platform.admin_reset': 'استرجاع حساب مالك المنصة',
  'platform.user_create': 'إنشاء حساب',
  'platform.user_update': 'تعديل حساب',
  'platform.password_set': 'ضبط كلمة مرور',
  'platform.password_reset': 'إعادة تعيين كلمة مرور',
  'platform.sessions_revoke': 'إنهاء جلسات',
  'platform.user_unlock': 'فك قفل حساب',
  'platform.workspace_create': 'إنشاء مساحة عمل',
  'platform.workspace_update': 'تعديل مساحة عمل',
  'platform.trial_extend': 'تمديد التجربة',
  'platform.member_add': 'إضافة عضو',
  'platform.member_update': 'تعديل عضو',
  'platform.payment_record': 'تسجيل دفعة',
  'platform.payment_delete': 'حذف دفعة',
  'platform.plan_create': 'إنشاء خطة',
  'platform.plan_update': 'تعديل خطة',
  'platform.announcement_create': 'نشر إعلان',
  'platform.announcement_update': 'تعديل إعلان',
  'platform.announcement_delete': 'حذف إعلان',
  'platform.settings_update': 'تعديل إعدادات المنصة',
  'workspace.create': 'إنشاء مساحة العمل',
  'workspace.update': 'تعديل الإعدادات',
  'member.invite': 'إضافة عضو',
  'member.update': 'تعديل عضو',
  'student.register': 'تسجيل طالب',
  'student.account_create': 'إنشاء حساب طالب',
  'student.card_reissue': 'كارنيه بدل فاقد',
  'enrollment.update': 'تعديل اشتراك',
  'enrollment.transfer': 'نقل طالب',
  'receipt.issue': 'إصدار إيصال',
  'receipt.cancel_request': 'طلب إلغاء إيصال',
  'receipt.cancel_approve': 'اعتماد إلغاء إيصال',
  'shift.open': 'فتح وردية',
  'shift.close': 'إغلاق وردية',
  'settlement.approve': 'اعتماد تسوية',
  'settlement.pay': 'صرف تسوية',
  'exam.publish': 'نشر امتحان',
  'guardian.consent': 'موافقة ولي الأمر',
};

export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;

export const metaText = (meta: Record<string, unknown> | null | undefined) =>
  meta ? Object.entries(meta).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('، ') : '';

/** تاريخ YYYY-MM-DD من قيمة ISO لحقول input[type=date] */
export const dateInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

/** نهاية اليوم بتوقيت القاهرة تقريبًا (21:59 UTC) حتى لا ينتهي الاشتراك صباح اليوم المحدد */
export const endOfDayIso = (d: string) => (d ? new Date(`${d}T21:59:59Z`).toISOString() : null);

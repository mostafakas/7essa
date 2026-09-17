export const ROLES = ['OWNER', 'MANAGER', 'TEACHER', 'RECEPTION', 'ACCOUNTANT', 'ASSISTANT', 'FOLLOWUP'] as const;
export type RoleName = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace.view',
  'workspace.manage',
  'staff.manage',
  'students.read',
  'students.write',
  'academics.read',
  'academics.write',
  'attendance.record',
  'finance.collect',
  'finance.discount',
  'finance.cancel.request',
  'finance.cancel.approve',
  'finance.shift',
  'finance.shift.approve',
  'finance.expense',
  'finance.reports',
  'finance.dues',
  'settlements.read.own',
  'settlements.manage',
  'settlements.approve',
  'settlements.pay',
  'exams.manage',
  'exams.grade',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const set = (...p: Permission[]) => new Set<Permission>(['workspace.view', ...p]);

/** المقاس الافتراضي لمصفوفة الصلاحيات (القسم 7 من الدراسة) — تُفرض على الخادم */
export const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  MANAGER: new Set(PERMISSIONS.filter((p) => p !== 'workspace.manage')),
  TEACHER: set('students.read', 'academics.read', 'attendance.record', 'exams.manage', 'exams.grade', 'settlements.read.own'),
  RECEPTION: set(
    'students.read', 'students.write', 'academics.read', 'attendance.record',
    'finance.collect', 'finance.discount', 'finance.cancel.request', 'finance.shift', 'finance.dues',
  ),
  ACCOUNTANT: set(
    'students.read', 'academics.read', 'finance.collect', 'finance.cancel.request', 'finance.shift',
    'finance.expense', 'finance.reports', 'finance.dues', 'settlements.manage', 'settlements.pay',
  ),
  ASSISTANT: set('students.read', 'academics.read', 'attendance.record', 'exams.grade'),
  FOLLOWUP: set('students.read', 'finance.dues'),
};

export function can(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsOf(role: RoleName): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** المدرس والمساعد يرون بيانات مجموعات مدرس واحد فقط */
export function teacherScopeOf(role: RoleName, membershipId: string, supervisorId: string | null): string | null {
  if (role === 'TEACHER') return membershipId;
  if (role === 'ASSISTANT') return supervisorId ?? '00000000-0000-0000-0000-000000000000';
  return null;
}

/** من يستطيع منح أي دور */
export function canAssignRole(actor: RoleName, target: RoleName): boolean {
  if (actor === 'OWNER') return true;
  if (actor === 'MANAGER') return target !== 'OWNER' && target !== 'MANAGER';
  return false;
}

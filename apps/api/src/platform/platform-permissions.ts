/** أدوار فريق إدارة المنصة وصلاحياتها (تُفرض في الخادم) */
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'VIEWER'] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.read',
  'platform.workspaces.manage',
  'platform.users.manage',
  'platform.billing.manage',
  'platform.content.manage',
  'platform.settings.manage',
  'platform.admins.manage',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const set = (...p: PlatformPermission[]) => new Set<PlatformPermission>(['platform.read', ...p]);

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRoleName, ReadonlySet<PlatformPermission>> = {
  // صاحب المنصة: كل شيء بما فيه فريق الإدارة والإعدادات
  SUPER_ADMIN: new Set(PLATFORM_PERMISSIONS),
  // الدعم: السناتر والحسابات والإعلانات
  SUPPORT: set('platform.workspaces.manage', 'platform.users.manage', 'platform.content.manage'),
  // المالية: الخطط والمدفوعات وتواريخ الاشتراك
  FINANCE: set('platform.billing.manage'),
  // مشاهدة فقط
  VIEWER: set(),
};

export function platformCan(role: PlatformRoleName, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role].has(permission);
}

export function platformPermissionsOf(role: PlatformRoleName): PlatformPermission[] {
  return [...PLATFORM_ROLE_PERMISSIONS[role]];
}

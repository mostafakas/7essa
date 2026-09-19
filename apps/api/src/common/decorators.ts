import { createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { AuthUser, HessaRequest, PlatformCtx, WorkspaceCtx } from './context';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'hessa:public';
export const PERMISSION = 'hessa:permission';
export const ALLOW_PENDING_PASSWORD = 'hessa:allow-pending-password';

/** مسار لا يتطلب تسجيل دخول */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** مسار متاح حتى قبل تغيير كلمة المرور المؤقتة */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** مسار داخل مساحة عمل يتطلب صلاحية محددة (يتطلب ترويسة x-workspace-id) */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<HessaRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

/** يرفض الطلب إن نسي المطور وضع RequirePermission (رفض افتراضي) */
export const Ws = createParamDecorator((_: unknown, ctx: ExecutionContext): WorkspaceCtx => {
  const ws = ctx.switchToHttp().getRequest<HessaRequest>().ws;
  if (!ws) throw new ForbiddenException('سياق مساحة العمل غير متاح');
  return ws;
});

/** سياق مدير المنصة (يضبطه PlatformGuard) */
export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformCtx => {
  const p = ctx.switchToHttp().getRequest<HessaRequest>().platform;
  if (!p) throw new ForbiddenException('هذه الصفحة لإدارة المنصة فقط');
  return p;
});

export const ClientMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<HessaRequest>();
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) };
});

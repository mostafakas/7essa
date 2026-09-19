import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HessaRequest, PlatformCtx } from '../common/context';
import { PrismaService } from '../prisma/prisma.service';
import { platformCan, type PlatformPermission } from './platform-permissions';

export const PLATFORM_PERMISSION = 'hessa:platform-permission';

/** صلاحية مطلوبة داخل لوحة إدارة المنصة (الافتراضي: القراءة) */
export const PlatformPerm = (permission: PlatformPermission) => SetMetadata(PLATFORM_PERMISSION, permission);

/** يتحقق من عضوية فريق المنصة ودوره من قاعدة البيانات مع كل طلب (لا يُكتفى برمز الدخول) */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HessaRequest>();
    if (!req.user) throw new UnauthorizedException();
    const row = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { platformRole: true, status: true } });
    if (!row?.platformRole || row.status !== 'ACTIVE') throw new ForbiddenException('هذه الصفحة لفريق إدارة المنصة فقط');
    const needed =
      this.reflector.getAllAndOverride<PlatformPermission | undefined>(PLATFORM_PERMISSION, [ctx.getHandler(), ctx.getClass()]) ??
      'platform.read';
    if (!platformCan(row.platformRole, needed)) throw new ForbiddenException('دورك في فريق المنصة لا يسمح بهذا الإجراء');
    req.platform = { userId: req.user.id, role: row.platformRole, ip: req.ip } satisfies PlatformCtx;
    return true;
  }
}

/** يتحقق من صلاحية إضافية داخل نفس الطلب */
export function assertPlatform(admin: PlatformCtx, permission: PlatformPermission, message = 'دورك في فريق المنصة لا يسمح بهذا الإجراء') {
  if (!platformCan(admin.role, permission)) throw new ForbiddenException(message);
}

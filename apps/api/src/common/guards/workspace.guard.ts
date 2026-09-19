import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformSettingsService } from '../../platform/settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_MESSAGE, accessOf } from '../access';
import { type HessaRequest, UUID_RE } from '../context';
import { PERMISSION } from '../decorators';
import { can, type Permission, teacherScopeOf } from '../permissions';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<HessaRequest>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const workspaceId = req.header('x-workspace-id');
    if (!workspaceId || !UUID_RE.test(workspaceId)) throw new BadRequestException('الترويسة x-workspace-id مطلوبة');

    const membership = await this.prisma.scoped({ userId: user.id, workspaceId }, (tx) =>
      tx.membership.findFirst({
        where: { workspaceId, userId: user.id, status: 'ACTIVE' },
        include: {
          workspace: { select: { status: true, trialEndsAt: true, paidUntil: true } },
          user: { select: { status: true } },
        },
      }),
    );
    if (!membership) throw new ForbiddenException('لست عضوًا في مساحة العمل هذه');
    if (membership.user.status !== 'ACTIVE') throw new ForbiddenException('هذا الحساب موقوف، تواصل مع إدارة المنصة');

    const { graceDays } = await this.settings.get();
    const access = accessOf(membership.workspace, new Date(), graceDays);
    if (access.mode === 'BLOCKED') {
      throw new ForbiddenException({ statusCode: 403, code: 'WORKSPACE_BLOCKED', message: ACCESS_MESSAGE[access.reason] });
    }
    if (access.mode === 'READ_ONLY' && !READ_METHODS.has(req.method)) {
      throw new ForbiddenException({ statusCode: 403, code: 'READ_ONLY', message: ACCESS_MESSAGE[access.reason] });
    }
    if (!can(membership.role, permission)) throw new ForbiddenException('هذا الإجراء غير مسموح لدورك');

    req.ws = {
      userId: user.id,
      workspaceId,
      membershipId: membership.id,
      role: membership.role,
      teacherScopeId: teacherScopeOf(membership.role, membership.id, membership.supervisorMembershipId),
      access,
      ip: req.ip,
    };
    return true;
  }
}

import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { type HessaRequest, UUID_RE } from '../context';
import { PERMISSION } from '../decorators';
import { can, type Permission, teacherScopeOf } from '../permissions';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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
        include: { workspace: { select: { status: true } } },
      }),
    );
    if (!membership) throw new ForbiddenException('لست عضوًا في مساحة العمل هذه');
    if (membership.workspace.status === 'SUSPENDED') throw new ForbiddenException('الحساب موقوف، تواصل مع الدعم');
    if (!can(membership.role, permission)) throw new ForbiddenException('هذا الإجراء غير مسموح لدورك');

    req.ws = {
      userId: user.id,
      workspaceId,
      membershipId: membership.id,
      role: membership.role,
      teacherScopeId: teacherScopeOf(membership.role, membership.id, membership.supervisorMembershipId),
      ip: req.ip,
    };
    return true;
  }
}

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { localPhone } from '../common/phone';
import { PrismaService } from '../prisma/prisma.service';
import { generateTempPassword, hashPassword, normalizeUsername, passwordProblem } from './password';

export interface IssuedCredentials {
  /** ما يكتبه المستخدم في خانة الدخول */
  login: string;
  password: string;
}

export const loginOf = (u: { username: string | null; phone: string | null }) => u.username ?? localPhone(u.phone);

/** إصدار بيانات الدخول: كلمة مرور مؤقتة تُعرض مرة واحدة ويُلزم صاحبها بتغييرها */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async setPassword(
    userId: string,
    opts: { password?: string; mustChange?: boolean; actorUserId: string; workspaceId?: string | null; ip?: string; action: string },
  ): Promise<IssuedCredentials> {
    if (opts.password) {
      const problem = passwordProblem(opts.password);
      if (problem) throw new BadRequestException(problem);
    }
    const password = opts.password ?? generateTempPassword();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: opts.mustChange ?? true,
        failedLogins: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
      select: { username: true, phone: true },
    });
    // أي جلسة قديمة تنتهي فورًا
    await this.prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(null, {
      workspaceId: opts.workspaceId ?? null,
      actorUserId: opts.actorUserId,
      action: opts.action,
      entity: 'user',
      entityId: userId,
      ip: opts.ip,
    });
    return { login: loginOf(user), password };
  }

  /** يتحقق من اسم مستخدم مطلوب ويرفضه إن كان محجوزًا */
  async assertUsernameFree(raw: string, exceptUserId?: string): Promise<string> {
    const username = normalizeUsername(raw);
    if (!username) throw new BadRequestException('اسم المستخدم: حروف إنجليزية صغيرة وأرقام و . _ - من 3 إلى 32 حرفًا');
    const taken = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (taken && taken.id !== exceptUserId) throw new ConflictException('اسم المستخدم مستخدم بالفعل');
    return username;
  }

  /** اسم مستخدم فريد مولد من بادئة، مثل s-482913 */
  async generateUsername(prefix: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const candidate = `${prefix}-${randomInt(100_000, 1_000_000)}`;
      const taken = await this.prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    throw new ConflictException('تعذر توليد اسم مستخدم، حاول مرة أخرى');
  }
}

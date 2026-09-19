import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_MS } from '../common/cookies';
import { normalizeEgyptPhone } from '../common/phone';
import { env } from '../config/env';
import { PlatformSettingsService } from '../platform/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { burnPasswordCheck, hashPassword, normalizeUsername, passwordProblem, verifyPassword } from './password';

/** بعد 5 محاولات خاطئة متتالية يُقفل الحساب 15 دقيقة */
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

export interface ClientMetaInfo {
  ip?: string;
  userAgent?: string;
}

interface TokenUser {
  id: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** الدخول باسم المستخدم أو رقم الموبايل */
  private findByIdentifier(identifier: string) {
    const phone = normalizeEgyptPhone(identifier);
    if (phone) return this.prisma.user.findUnique({ where: { phone } });
    const username = normalizeUsername(identifier);
    if (!username) return Promise.resolve(null);
    return this.prisma.user.findUnique({ where: { username } });
  }

  async login(identifier: string, password: string, meta: ClientMetaInfo) {
    // رسالة واحدة لكل حالات الفشل حتى لا يُعرف إن كان الحساب موجودًا
    const invalid = new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    const user = await this.findByIdentifier(identifier);
    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      if (user) {
        await this.audit.log(null, { actorUserId: user.id, action: 'auth.login_failed', entity: 'user', entityId: user.id, meta: { reason: 'no_password' }, ip: meta.ip });
      }
      throw invalid;
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new HttpException(`الحساب مقفول مؤقتًا بسبب محاولات خاطئة متكررة. حاول بعد ${minutes} دقيقة أو تواصل مع الإدارة.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedLogins: failed },
      });
      await this.audit.log(null, { actorUserId: user.id, action: lock ? 'auth.locked' : 'auth.login_failed', entity: 'user', entityId: user.id, ip: meta.ip });
      throw invalid;
    }

    if (user.status !== 'ACTIVE') throw new ForbiddenException('هذا الحساب موقوف، تواصل مع إدارة المنصة');

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
    await this.audit.log(null, { actorUserId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user, meta);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: ClientMetaInfo) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    const problem = passwordProblem(newPassword);
    if (problem) throw new BadRequestException(problem);
    if (newPassword === currentPassword) throw new BadRequestException('اختر كلمة مرور مختلفة عن الحالية');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    // تغيير كلمة المرور ينهي كل الجلسات الأخرى
    await this.revokeAll(userId);
    await this.audit.log(null, { actorUserId: userId, action: 'auth.password_change', entity: 'user', entityId: userId, ip: meta.ip });
    return this.issueTokens(updated, meta);
  }

  private async issueTokens(user: TokenUser, meta: ClientMetaInfo) {
    const access = await this.jwt.signAsync(
      { sub: user.id, pa: user.isPlatformAdmin, mcp: user.mustChangePassword, typ: 'access' },
      { secret: env().JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL_SECONDS, issuer: 'hessa', audience: 'hessa-web', algorithm: 'HS256' },
    );
    const refresh = randomBytes(32).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refresh),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { access, refresh, userId: user.id };
  }

  /** تدوير رمز التجديد مع كشف إعادة الاستخدام (إن سُرق الرمز تُلغى كل الجلسات) */
  async rotate(refresh: string, meta: ClientMetaInfo) {
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: sha256(refresh) },
      include: { user: { select: { id: true, isPlatformAdmin: true, mustChangePassword: true, status: true } } },
    });
    if (!session || session.expiresAt < new Date()) throw new UnauthorizedException('انتهت الجلسة');

    const revoked = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      await this.revokeAll(session.userId);
      await this.audit.log(null, { actorUserId: session.userId, action: 'auth.refresh_reuse', entity: 'user', entityId: session.userId, ip: meta.ip });
      throw new UnauthorizedException('تم إنهاء كل الجلسات لأسباب أمنية، سجّل الدخول مرة أخرى');
    }
    if (session.user.status !== 'ACTIVE') {
      await this.revokeAll(session.userId);
      throw new UnauthorizedException('هذا الحساب موقوف');
    }
    return this.issueTokens(session.user, meta);
  }

  async revoke(refresh: string) {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: sha256(refresh), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async rename(userId: string, name: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { name: name.trim() } });
    await this.audit.log(null, { actorUserId: userId, action: 'user.rename', entity: 'user', entityId: userId });
  }

  async me(userId: string) {
    const config = await this.settings.get();
    return this.prisma.scoped({ userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, phone: true, username: true, isPlatformAdmin: true, platformRole: true, mustChangePassword: true },
      });
      const memberships = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { workspace: { select: { id: true, name: true, type: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const children = await tx.student.count({ where: { OR: [{ guardianUserId: userId }, { studentUserId: userId }] } });
      const isStudent = (await tx.student.count({ where: { studentUserId: userId } })) > 0;
      return {
        user,
        children,
        isStudent,
        memberships: memberships.map((m) => ({ membershipId: m.id, role: m.role, workspace: m.workspace })),
        config: {
          allowSelfSignup: config.allowSelfSignup || user.platformRole !== null,
          supportPhone: config.supportPhone,
        },
      };
    });
  }
}

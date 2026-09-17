import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_MS } from '../common/cookies';
import { normalizeEgyptPhone } from '../common/phone';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SmsProvider } from './sms.provider';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;

export interface ClientMetaInfo {
  ip?: string;
  userAgent?: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  private otpHash(phone: string, code: string) {
    return createHmac('sha256', env().OTP_PEPPER).update(`${phone}:${code}`).digest('hex');
  }

  private phoneOrThrow(raw: string) {
    const phone = normalizeEgyptPhone(raw);
    if (!phone) throw new BadRequestException('اكتب رقم موبايل مصري صحيح');
    return phone;
  }

  async requestOtp(raw: string, meta: ClientMetaInfo) {
    const phone = this.phoneOrThrow(raw);
    const recent = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= OTP_MAX_PER_HOUR) {
      throw new HttpException('طلبات كثيرة لهذا الرقم، حاول بعد ساعة', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: this.otpHash(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), ip: meta.ip },
    });
    await this.sms.sendOtp(phone, code);
    // الرد نفسه سواء كان الرقم مسجلًا أم لا (منع تعداد الحسابات)
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(raw: string, code: string, name: string | undefined, meta: ClientMetaInfo) {
    const phone = this.phoneOrThrow(raw);
    const invalid = new UnauthorizedException('الرمز غير صحيح أو انتهت صلاحيته');

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid;

    // احتساب المحاولة ذريًا قبل المقارنة
    const bumped = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count === 0) throw new UnauthorizedException('تجاوزت عدد المحاولات، اطلب رمزًا جديدًا');

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.otpHash(phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    const cleanName = name?.trim();
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({ data: { phone, name: cleanName || 'مستخدم جديد', phoneVerifiedAt: new Date() } });
    } else if (!user.phoneVerifiedAt) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date(), ...(cleanName ? { name: cleanName } : {}) },
      });
    }

    await this.audit.log(null, { actorUserId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user, meta);
  }

  private async issueTokens(user: { id: string; isPlatformAdmin: boolean }, meta: ClientMetaInfo) {
    const access = await this.jwt.signAsync(
      { sub: user.id, pa: user.isPlatformAdmin, typ: 'access' },
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
      include: { user: { select: { id: true, isPlatformAdmin: true } } },
    });
    if (!session || session.expiresAt < new Date()) throw new UnauthorizedException('انتهت الجلسة');

    const revoked = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(null, { actorUserId: session.userId, action: 'auth.refresh_reuse', entity: 'user', entityId: session.userId, ip: meta.ip });
      throw new UnauthorizedException('تم إنهاء كل الجلسات لأسباب أمنية، سجّل الدخول مرة أخرى');
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

  me(userId: string) {
    return this.prisma.scoped({ userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, phone: true, isPlatformAdmin: true },
      });
      const memberships = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { workspace: { select: { id: true, name: true, type: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const children = await tx.student.count({ where: { OR: [{ guardianUserId: userId }, { studentUserId: userId }] } });
      return {
        user,
        children,
        memberships: memberships.map((m) => ({ membershipId: m.id, role: m.role, workspace: m.workspace })),
      };
    });
  }
}

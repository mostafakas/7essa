import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CredentialsService, type IssuedCredentials, loginOf } from '../auth/credentials.service';
import type { PlatformCtx } from '../common/context';
import { localPhone, normalizeEgyptPhone } from '../common/phone';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto, ListUsersQuery, NewUserDto, ResetPasswordDto, UpdateUserDto } from './dto';
import { assertPlatform } from './platform.guard';
import { defined, pageOf } from './util';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credentials: CredentialsService,
  ) {}

  /** مستخدم موجود بالمعرف، أو بالرقم، أو ينشأ جديدًا (مع كلمة مرور مؤقتة إن لم يكن له كلمة مرور) */
  async resolve(admin: PlatformCtx, input: { userId?: string; newUser?: NewUserDto }, workspaceId?: string | null) {
    let user: User | null = null;
    if (input.userId) {
      user = await this.prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new NotFoundException('المستخدم غير موجود');
    } else if (input.newUser) {
      const nu = input.newUser;
      const phone = nu.phone?.trim() ? normalizeEgyptPhone(nu.phone) : null;
      if (nu.phone?.trim() && !phone) throw new BadRequestException('رقم الموبايل غير صحيح');
      if (phone) user = await this.prisma.user.findUnique({ where: { phone } });
      if (!user) {
        const username = nu.username?.trim() ? await this.credentials.assertUsernameFree(nu.username) : null;
        if (!phone && !username) throw new BadRequestException('أدخل رقم الموبايل أو اسم المستخدم للحساب الجديد');
        user = await this.prisma.user.create({ data: { name: nu.name.trim(), phone, username } });
        await this.audit.log(null, { workspaceId, actorUserId: admin.userId, action: 'platform.user_create', entity: 'user', entityId: user.id, ip: admin.ip });
      }
    } else {
      throw new BadRequestException('اختر مستخدمًا موجودًا أو أدخل بيانات حساب جديد');
    }
    if (user.status !== 'ACTIVE') throw new BadRequestException('هذا الحساب موقوف');
    let credentials: IssuedCredentials | null = null;
    if (!user.passwordHash) {
      credentials = await this.credentials.setPassword(user.id, { actorUserId: admin.userId, workspaceId, ip: admin.ip, action: 'user.credentials_issue' });
    }
    return { user, credentials };
  }

  list(admin: PlatformCtx, q: ListUsersQuery) {
    const { page, pageSize, skip, take } = pageOf(q);
    const term = q.q?.trim();
    const where: Prisma.UserWhereInput = { status: q.status };
    if (term) {
      const phoneDigits = /^\+?\d[\d\s-]{2,}$/.test(term) ? term.replace(/[\s-]/g, '').replace(/^\+?20/, '').replace(/^0/, '') : null;
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { username: { contains: term.toLowerCase() } },
        ...(phoneDigits ? [{ phone: { contains: phoneDigits } }] : []),
        ...(/^[0-9a-f-]{36}$/i.test(term) ? [{ id: term }] : []),
      ];
    }
    switch (q.kind) {
      case 'admin': where.platformRole = { not: null }; break;
      case 'staff': where.memberships = { some: {} }; break;
      case 'family': where.guardianOf = { some: {} }; break;
      case 'none': where.memberships = { none: {} }; where.guardianOf = { none: {} }; where.platformRole = null; break;
      case 'nopassword': where.passwordHash = null; break;
      case 'locked': where.lockedUntil = { gt: new Date() }; break;
      case 'pending': where.passwordHash = { not: null }; where.lastLoginAt = null; break;
    }
    // داخل سياق الأدمن حتى تسمح سياسات RLS بعد العضويات والأبناء
    return this.prisma.scoped({ userId: admin.userId }, async (tx) => {
      const total = await tx.user.count({ where });
      const rows = await tx.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true, name: true, phone: true, username: true, status: true, platformRole: true, passwordHash: true,
          mustChangePassword: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
          _count: { select: { memberships: true, guardianOf: true } },
        },
      });
      return {
        total,
        page,
        pageSize,
        items: rows.map(({ passwordHash, _count, ...u }) => ({
          ...u,
          login: loginOf(u),
          phone: localPhone(u.phone),
          hasPassword: Boolean(passwordHash),
          memberships: _count.memberships,
          children: _count.guardianOf,
        })),
      };
    });
  }

  async get(admin: PlatformCtx, id: string) {
    return this.prisma.scoped({ userId: admin.userId }, async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundException('المستخدم غير موجود');
      const memberships = await tx.membership.findMany({
        where: { userId: id },
        include: { workspace: { select: { id: true, name: true, type: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const children = await tx.student.findMany({
        where: { OR: [{ guardianUserId: id }, { studentUserId: id }] },
        select: { id: true, fullName: true, grade: true, school: true, studentUserId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const sessions = await tx.refreshSession.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const audit = await tx.auditLog.findMany({
        where: { OR: [{ actorUserId: id }, { entityId: id }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const { passwordHash, ...rest } = u;
      return {
        user: { ...rest, phone: localPhone(u.phone), login: loginOf(u), hasPassword: Boolean(passwordHash) },
        memberships: memberships.map((m) => ({ membershipId: m.id, role: m.role, status: m.status, createdAt: m.createdAt, workspace: m.workspace })),
        children: children.map((c) => ({ ...c, relation: c.studentUserId === id ? 'SELF' : 'CHILD' })),
        sessions,
        audit: audit.map((a) => ({ ...a, id: a.id.toString() })),
      };
    });
  }

  async create(admin: PlatformCtx, dto: CreateUserDto) {
    if (dto.platformRole) assertPlatform(admin, 'platform.admins.manage', 'منح أدوار فريق المنصة لمالك المنصة فقط');
    const phone = dto.phone?.trim() ? normalizeEgyptPhone(dto.phone) : null;
    if (dto.phone?.trim() && !phone) throw new BadRequestException('رقم الموبايل غير صحيح');
    const username = dto.username?.trim() ? await this.credentials.assertUsernameFree(dto.username) : null;
    if (!phone && !username) throw new BadRequestException('أدخل رقم الموبايل أو اسم المستخدم');
    if (phone && (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }))) {
      throw new ConflictException('يوجد حساب بهذا الرقم بالفعل');
    }
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(), phone, username,
        platformRole: dto.platformRole ?? null,
        isPlatformAdmin: Boolean(dto.platformRole),
      },
    });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.user_create', entity: 'user', entityId: user.id, meta: { platformRole: dto.platformRole ?? null }, ip: admin.ip });
    const credentials = await this.credentials.setPassword(user.id, {
      password: dto.password,
      mustChange: dto.mustChangePassword ?? true,
      actorUserId: admin.userId,
      ip: admin.ip,
      action: 'platform.password_set',
    });
    return { id: user.id, credentials };
  }

  async update(admin: PlatformCtx, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    this.assertCanManage(admin, target);
    if (dto.platformRole !== undefined) {
      assertPlatform(admin, 'platform.admins.manage', 'تعديل أدوار فريق المنصة لمالك المنصة فقط');
      if (id === admin.userId) throw new ForbiddenException('لا يمكنك تغيير دورك بنفسك');
    }
    if (dto.status === 'DISABLED' && id === admin.userId) throw new ForbiddenException('لا يمكنك إيقاف حسابك بنفسك');

    // يبقى مالك منصة واحد نشط على الأقل
    const losesSuper =
      target.platformRole === 'SUPER_ADMIN' &&
      ((dto.platformRole !== undefined && dto.platformRole !== 'SUPER_ADMIN') || dto.status === 'DISABLED');
    if (losesSuper) {
      const supers = await this.prisma.user.count({ where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' } });
      if (supers <= 1) throw new BadRequestException('يجب أن يبقى مالك منصة واحد نشط على الأقل');
    }

    let phone: string | null | undefined;
    if (dto.phone !== undefined) {
      phone = dto.phone?.trim() ? normalizeEgyptPhone(dto.phone) : null;
      if (dto.phone?.trim() && !phone) throw new BadRequestException('رقم الموبايل غير صحيح');
      if (phone) {
        const other = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
        if (other && other.id !== id) throw new ConflictException('الرقم مستخدم في حساب آخر');
      }
    }
    let username: string | null | undefined;
    if (dto.username !== undefined) {
      username = dto.username?.trim() ? await this.credentials.assertUsernameFree(dto.username, id) : null;
    }
    const nextPhone = phone === undefined ? target.phone : phone;
    const nextUsername = username === undefined ? target.username : username;
    if (!nextPhone && !nextUsername) throw new BadRequestException('يجب أن يبقى للحساب رقم موبايل أو اسم مستخدم');

    const data = defined({
      name: dto.name?.trim(),
      phone,
      username,
      status: dto.status,
      notes: dto.notes,
      platformRole: dto.platformRole,
      isPlatformAdmin: dto.platformRole === undefined ? undefined : Boolean(dto.platformRole),
    });
    const updated = await this.prisma.user.update({ where: { id }, data });
    if (dto.status === 'DISABLED') {
      await this.prisma.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log(null, {
      actorUserId: admin.userId, action: 'platform.user_update', entity: 'user', entityId: id,
      meta: JSON.parse(JSON.stringify({ ...dto, notes: dto.notes === undefined ? undefined : '…' })), ip: admin.ip,
    });
    return { id: updated.id };
  }

  async resetPassword(admin: PlatformCtx, id: string, dto: ResetPasswordDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    this.assertCanManage(admin, target);
    return this.credentials.setPassword(id, {
      password: dto.password,
      mustChange: dto.mustChangePassword ?? true,
      actorUserId: admin.userId,
      ip: admin.ip,
      action: 'platform.password_reset',
    });
  }

  async revokeSessions(admin: PlatformCtx, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    this.assertCanManage(admin, target);
    const r = await this.prisma.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.sessions_revoke', entity: 'user', entityId: id, meta: { count: r.count }, ip: admin.ip });
    return { revoked: r.count };
  }

  async unlock(admin: PlatformCtx, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    this.assertCanManage(admin, target);
    await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.user_unlock', entity: 'user', entityId: id, ip: admin.ip });
    return { ok: true };
  }

  /** حسابات فريق المنصة لا يديرها إلا مالك المنصة (لا يعيد الدعم تعيين كلمة مرور المالك مثلًا) */
  private assertCanManage(admin: PlatformCtx, target: { id: string; platformRole: string | null }) {
    assertPlatform(admin, 'platform.users.manage');
    if (target.platformRole && target.id !== admin.userId) {
      assertPlatform(admin, 'platform.admins.manage', 'حسابات فريق المنصة يديرها مالك المنصة فقط');
    }
  }
}

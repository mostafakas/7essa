import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AnnouncementAudience } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PlatformCtx } from '../common/context';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import type { AnnouncementDto } from './dto';
import { PlatformSettingsService } from './settings.service';
import { defined } from './util';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  list() {
    return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async create(admin: PlatformCtx, dto: AnnouncementDto) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException('العنوان والنص مطلوبان');
    const a = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        audience: dto.audience ?? 'ALL',
        level: dto.level ?? 'INFO',
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        active: dto.active ?? true,
        createdById: admin.userId,
      },
    });
    let notified = 0;
    if (dto.notify) {
      const ids = await this.audienceUserIds(admin, a.audience);
      await this.notify.notify({ kind: 'announcement', userIds: ids, title: a.title, body: a.body });
      notified = ids.length;
    }
    await this.audit.log(null, {
      actorUserId: admin.userId, action: 'platform.announcement_create', entity: 'announcement', entityId: a.id,
      meta: { audience: a.audience, notified }, ip: admin.ip,
    });
    return { ...a, notified };
  }

  async update(admin: PlatformCtx, id: string, dto: AnnouncementDto) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('الإعلان غير موجود');
    const a = await this.prisma.announcement.update({
      where: { id },
      data: defined({
        title: dto.title?.trim(),
        body: dto.body?.trim(),
        audience: dto.audience,
        level: dto.level,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null,
        active: dto.active,
      }),
    });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.announcement_update', entity: 'announcement', entityId: id, ip: admin.ip });
    return a;
  }

  async remove(admin: PlatformCtx, id: string) {
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.announcement_delete', entity: 'announcement', entityId: id, ip: admin.ip });
    return { ok: true };
  }

  /** الإعلانات السارية للمستخدم الحالي حسب شريحته + رسالة الصيانة إن وُجدت */
  async activeFor(userId: string) {
    const now = new Date();
    const { maintenanceMessage } = await this.settings.get();
    const audiences = await this.prisma.scoped({ userId }, async (tx) => {
      const roles = await tx.membership.findMany({ where: { userId, status: 'ACTIVE' }, select: { role: true } });
      const children = await tx.student.count({ where: { OR: [{ guardianUserId: userId }, { studentUserId: userId }] } });
      const list: AnnouncementAudience[] = ['ALL'];
      if (roles.length) list.push('STAFF');
      if (roles.some((r) => r.role === 'OWNER')) list.push('OWNERS');
      if (children) list.push('FAMILIES');
      return list;
    });
    const items = await this.prisma.announcement.findMany({
      where: { active: true, audience: { in: audiences }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ level: 'desc' }, { startsAt: 'desc' }],
      take: 5,
      select: { id: true, title: true, body: true, level: true, startsAt: true },
    });
    return { maintenance: maintenanceMessage, items };
  }

  private async audienceUserIds(admin: PlatformCtx, audience: AnnouncementAudience): Promise<string[]> {
    if (audience === 'ALL') {
      const rows = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      return rows.map((r) => r.id);
    }
    return this.prisma.scoped({ userId: admin.userId }, async (tx) => {
      if (audience === 'FAMILIES') {
        const rows = await tx.student.findMany({ select: { guardianUserId: true, studentUserId: true } });
        return [...new Set(rows.flatMap((r) => (r.studentUserId ? [r.guardianUserId, r.studentUserId] : [r.guardianUserId])))];
      }
      const rows = await tx.membership.findMany({
        where: { status: 'ACTIVE', ...(audience === 'OWNERS' ? { role: 'OWNER' as const } : {}) },
        select: { userId: true },
        distinct: ['userId'],
      });
      return rows.map((r) => r.userId);
    });
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Workspace } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { loginOf } from '../auth/credentials.service';
import { accessOf } from '../common/access';
import type { PlatformCtx } from '../common/context';
import { normalizeEgyptPhone } from '../common/phone';
import { managerIds } from '../common/recipients';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';
import type {
  AddMemberDto, CreateWorkspaceDto, ListWorkspacesQuery, NoteDto, RecordPaymentDto, UpdateMemberDto, UpdateWorkspaceDto,
} from './dto';
import { LimitsService } from './limits.service';
import { assertPlatform } from './platform.guard';
import { PlatformSettingsService } from './settings.service';
import { addDays, addMonths, dec, defined, pageOf } from './util';

export interface Usage {
  members: number;
  activeStudents: number;
  groups: number;
  receipts30d: number;
  attendance30d: number;
  attempts30d: number;
  lastActivity: Date | null;
}

interface UsageRow {
  ws_id: string;
  members_n: bigint;
  students_n: bigint;
  groups_n: bigint;
  receipts_n: bigint;
  attendance_n: bigint;
  attempts_n: bigint;
  last_activity: Date | null;
}

const EMPTY_USAGE: Usage = { members: 0, activeStudents: 0, groups: 0, receipts30d: 0, attendance30d: 0, attempts30d: 0, lastActivity: null };

@Injectable()
export class AdminWorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingsService,
    private readonly limits: LimitsService,
    private readonly users: AdminUsersService,
    private readonly notify: NotificationsService,
  ) {}

  /** مؤشرات مجمعة (أعداد فقط) عبر دالة آمنة في قاعدة البيانات */
  async usage(admin: PlatformCtx, ids: string[] | null): Promise<Map<string, Usage>> {
    const rows = await this.prisma.scoped({ userId: admin.userId }, (tx) =>
      ids
        ? tx.$queryRaw<UsageRow[]>`SELECT ws_id::text AS ws_id, members_n, students_n, groups_n, receipts_n, attendance_n, attempts_n, last_activity
                                   FROM app_platform_workspace_usage(${ids}::uuid[])`
        : tx.$queryRaw<UsageRow[]>`SELECT ws_id::text AS ws_id, members_n, students_n, groups_n, receipts_n, attendance_n, attempts_n, last_activity
                                   FROM app_platform_workspace_usage(NULL)`,
    );
    return new Map(
      rows.map((r) => [
        r.ws_id,
        {
          members: Number(r.members_n),
          activeStudents: Number(r.students_n),
          groups: Number(r.groups_n),
          receipts30d: Number(r.receipts_n),
          attendance30d: Number(r.attendance_n),
          attempts30d: Number(r.attempts_n),
          lastActivity: r.last_activity,
        },
      ]),
    );
  }

  async list(admin: PlatformCtx, q: ListWorkspacesQuery) {
    const { page, pageSize, skip, take } = pageOf(q);
    const now = new Date();
    const week = addDays(now, 7);
    const where: Prisma.WorkspaceWhereInput = { status: q.status, type: q.type, plan: q.plan || undefined };
    const term = q.q?.trim();
    if (term) {
      const phone = normalizeEgyptPhone(term);
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { governorate: { contains: term, mode: 'insensitive' } },
        ...(/^[0-9a-f-]{36}$/i.test(term) ? [{ id: term }] : []),
        {
          memberships: {
            some: {
              role: 'OWNER',
              user: phone ? { phone } : { OR: [{ name: { contains: term, mode: 'insensitive' } }, { username: { contains: term.toLowerCase() } }] },
            },
          },
        },
      ];
    }
    if (q.due === 'trial_ending') Object.assign(where, { status: 'TRIAL', trialEndsAt: { gte: now, lte: week } });
    if (q.due === 'trial_ended') Object.assign(where, { status: 'TRIAL', trialEndsAt: { lt: now } });
    if (q.due === 'expiring') Object.assign(where, { status: 'ACTIVE', paidUntil: { gte: now, lte: addDays(now, 14) } });
    if (q.due === 'expired') Object.assign(where, { status: 'ACTIVE', paidUntil: { lt: now } });

    const { graceDays } = await this.settings.get();
    const { total, rows } = await this.prisma.scoped({ userId: admin.userId }, async (tx) => {
      const total = await tx.workspace.count({ where });
      const rows = await tx.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          memberships: {
            where: { role: 'OWNER', status: 'ACTIVE' },
            take: 1,
            orderBy: { createdAt: 'asc' },
            include: { user: { select: { id: true, name: true, phone: true, username: true } } },
          },
        },
      });
      return { total, rows };
    });
    const usage = rows.length ? await this.usage(admin, rows.map((r) => r.id)) : new Map<string, Usage>();
    return {
      total,
      page,
      pageSize,
      items: rows.map(({ memberships, ...w }) => ({
        ...this.view(w),
        owner: memberships[0] ? { ...memberships[0].user, login: loginOf(memberships[0].user) } : null,
        usage: usage.get(w.id) ?? EMPTY_USAGE,
        access: accessOf(w, now, graceDays),
      })),
    };
  }

  async get(admin: PlatformCtx, id: string) {
    const w = await this.prisma.workspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('مساحة العمل غير موجودة');
    const { graceDays } = await this.settings.get();
    const [limits, usage] = await Promise.all([this.limits.of(id), this.usage(admin, [id])]);
    const members = await this.prisma.scoped({ userId: admin.userId, workspaceId: id }, (tx) =>
      tx.membership.findMany({
        where: { workspaceId: id },
        include: { user: { select: { id: true, name: true, phone: true, username: true, lastLoginAt: true, status: true, passwordHash: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    const payments = await this.prisma.platformPayment.findMany({ where: { workspaceId: id }, orderBy: { paidAt: 'desc' }, take: 60 });
    const notes = await this.prisma.workspaceNote.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const authorIds = [...new Set([...payments.map((p) => p.recordedById), ...notes.map((n) => n.authorUserId)])];
    const authors = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    return {
      workspace: this.view(w),
      access: accessOf(w, new Date(), graceDays),
      limits,
      usage: usage.get(id) ?? EMPTY_USAGE,
      members: members.map((m) => ({
        membershipId: m.id,
        role: m.role,
        status: m.status,
        supervisorMembershipId: m.supervisorMembershipId,
        createdAt: m.createdAt,
        user: {
          id: m.user.id,
          name: m.user.name,
          login: loginOf(m.user),
          status: m.user.status,
          lastLoginAt: m.user.lastLoginAt,
          hasPassword: Boolean(m.user.passwordHash),
        },
      })),
      payments: payments.map((p) => ({ ...p, amount: dec(p.amount), recordedBy: authors.get(p.recordedById) ?? '—' })),
      notes: notes.map((n) => ({ ...n, author: authors.get(n.authorUserId) ?? '—' })),
    };
  }

  async create(admin: PlatformCtx, dto: CreateWorkspaceDto) {
    assertPlatform(admin, 'platform.workspaces.manage');
    const config = await this.settings.get();
    const status = dto.status ?? 'TRIAL';
    if (status === 'ACTIVE') assertPlatform(admin, 'platform.billing.manage', 'التفعيل المدفوع يحتاج صلاحية المالية');
    const plan = dto.plan?.trim() || (status === 'TRIAL' ? 'trial' : dto.type === 'TEACHER' ? 'teacher' : 'center');
    await this.assertPlan(plan);
    const now = new Date();
    const owner = await this.users.resolve(admin, { userId: dto.ownerUserId, newUser: dto.owner });

    const workspace = await this.prisma.workspace.create({
      data: {
        type: dto.type,
        name: dto.name.trim(),
        status,
        plan,
        trialEndsAt: status === 'TRIAL' ? addDays(now, dto.trialDays ?? config.defaultTrialDays) : null,
        paidUntil: status === 'ACTIVE' && dto.paidMonths ? addMonths(now, dto.paidMonths) : null,
        governorate: dto.governorate?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
      },
    });
    await this.prisma.scoped({ userId: admin.userId, workspaceId: workspace.id }, async (tx) => {
      await tx.membership.create({ data: { workspaceId: workspace.id, userId: owner.user.id, role: 'OWNER' } });
      await this.audit.log(tx, {
        workspaceId: workspace.id, actorUserId: admin.userId, action: 'platform.workspace_create', entity: 'workspace', entityId: workspace.id,
        meta: { type: dto.type, status, plan, ownerUserId: owner.user.id }, ip: admin.ip,
      });
    });
    await this.notify.notify({
      kind: 'welcome',
      userIds: [owner.user.id],
      workspaceId: workspace.id,
      title: `تم تجهيز ${workspace.name} على حصّة`,
      body: 'ابدأ من صفحة الإعدادات: أضف القاعات والفريق والمجموعات ثم سجّل الطلاب.',
    });
    return { id: workspace.id, owner: { userId: owner.user.id, login: loginOf(owner.user), credentials: owner.credentials } };
  }

  async update(admin: PlatformCtx, id: string, dto: UpdateWorkspaceDto) {
    const w = await this.prisma.workspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('مساحة العمل غير موجودة');

    const billing = ['plan', 'paidUntil', 'maxStudents', 'maxStaff'] as const;
    const general = ['name', 'type', 'status', 'suspendReason', 'trialEndsAt', 'governorate', 'contactPhone', 'receptionMaxDiscountPct', 'lateAfterMinutes'] as const;
    if (billing.some((k) => dto[k] !== undefined)) assertPlatform(admin, 'platform.billing.manage', 'الخطة وتاريخ الاشتراك والحدود تحتاج صلاحية المالية');
    if (general.some((k) => dto[k] !== undefined)) assertPlatform(admin, 'platform.workspaces.manage');
    if (dto.plan) await this.assertPlan(dto.plan);
    if (dto.status === 'SUSPENDED' && !dto.suspendReason?.trim() && !w.suspendReason) {
      throw new BadRequestException('اكتب سبب الإيقاف (يظهر في السجل)');
    }

    const data = defined({
      name: dto.name?.trim(),
      type: dto.type,
      status: dto.status,
      suspendReason: dto.status && dto.status !== 'SUSPENDED' ? null : dto.suspendReason === undefined ? undefined : dto.suspendReason?.trim() || null,
      plan: dto.plan,
      trialEndsAt: dto.trialEndsAt === undefined ? undefined : dto.trialEndsAt ? new Date(dto.trialEndsAt) : null,
      paidUntil: dto.paidUntil === undefined ? undefined : dto.paidUntil ? new Date(dto.paidUntil) : null,
      maxStudents: dto.maxStudents,
      maxStaff: dto.maxStaff,
      governorate: dto.governorate === undefined ? undefined : dto.governorate?.trim() || null,
      contactPhone: dto.contactPhone === undefined ? undefined : dto.contactPhone?.trim() || null,
      receptionMaxDiscountPct: dto.receptionMaxDiscountPct,
      lateAfterMinutes: dto.lateAfterMinutes,
    });
    const updated = await this.prisma.workspace.update({ where: { id }, data });
    await this.audit.log(null, {
      workspaceId: id, actorUserId: admin.userId, action: 'platform.workspace_update', entity: 'workspace', entityId: id,
      meta: JSON.parse(JSON.stringify({ from: this.diffFrom(w, data), to: data })), ip: admin.ip,
    });
    if (dto.status && dto.status !== w.status) {
      const text: Record<string, string> = {
        ACTIVE: 'تم تفعيل اشتراككم. شكرًا لثقتكم في حصّة.',
        TRIAL: 'حسابكم في الفترة التجريبية.',
        PAUSED: 'تم إيقاف الحساب مؤقتًا وأصبح للعرض فقط. تواصلوا مع إدارة المنصة.',
        SUSPENDED: 'تم إيقاف الحساب. تواصلوا مع إدارة المنصة.',
      };
      await this.notifyManagers(id, { title: `تحديث حالة ${updated.name}`, body: text[dto.status] });
    }
    return this.view(updated);
  }

  async extendTrial(admin: PlatformCtx, id: string, days: number) {
    assertPlatform(admin, 'platform.workspaces.manage');
    const w = await this.prisma.workspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('مساحة العمل غير موجودة');
    if (w.status === 'ACTIVE' || w.status === 'SUSPENDED') throw new BadRequestException('التمديد للمساحات التجريبية أو المتوقفة فقط');
    const now = new Date();
    // يُمد من تاريخ الانتهاء إن كان مستقبليًا، وإلا من اليوم
    const base = w.trialEndsAt && w.trialEndsAt > now ? w.trialEndsAt : now;
    const trialEndsAt = addDays(base, days);
    const updated = await this.prisma.workspace.update({ where: { id }, data: { status: 'TRIAL', trialEndsAt } });
    await this.audit.log(null, {
      workspaceId: id, actorUserId: admin.userId, action: 'platform.trial_extend', entity: 'workspace', entityId: id,
      meta: { days, from: w.trialEndsAt, to: trialEndsAt }, ip: admin.ip,
    });
    await this.notifyManagers(id, { title: 'تم تمديد الفترة التجريبية', body: `أصبحت الفترة التجريبية حتى ${trialEndsAt.toISOString().slice(0, 10)}.` });
    return this.view(updated);
  }

  async addMember(admin: PlatformCtx, id: string, dto: AddMemberDto) {
    assertPlatform(admin, 'platform.workspaces.manage');
    const w = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!w) throw new NotFoundException('مساحة العمل غير موجودة');
    if (dto.role === 'ASSISTANT' && !dto.supervisorMembershipId) throw new BadRequestException('حدد المدرس الذي يتبعه المساعد');
    const { user, credentials } = await this.users.resolve(admin, { userId: dto.userId, newUser: dto.newUser }, id);
    const membership = await this.prisma.scoped({ userId: admin.userId, workspaceId: id }, async (tx) => {
      const existing = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: user.id } } });
      if (existing) throw new BadRequestException('هذا المستخدم عضو بالفعل في مساحة العمل');
      if (dto.supervisorMembershipId) {
        const t = await tx.membership.findFirst({ where: { id: dto.supervisorMembershipId, workspaceId: id, role: { in: ['TEACHER', 'OWNER'] } } });
        if (!t) throw new BadRequestException('المدرس المحدد غير موجود');
      }
      const m = await tx.membership.create({
        data: { workspaceId: id, userId: user.id, role: dto.role, supervisorMembershipId: dto.role === 'ASSISTANT' ? dto.supervisorMembershipId : null },
      });
      await this.audit.log(tx, {
        workspaceId: id, actorUserId: admin.userId, action: 'platform.member_add', entity: 'membership', entityId: m.id,
        meta: { role: dto.role, userId: user.id }, ip: admin.ip,
      });
      return m;
    });
    await this.notify.notify({ kind: 'welcome', userIds: [user.id], workspaceId: id, title: `تمت إضافتك إلى ${w.name}`, body: 'ادخل باسم المستخدم أو رقم موبايلك وكلمة المرور.' });
    return { membershipId: membership.id, login: loginOf(user), credentials };
  }

  async updateMember(admin: PlatformCtx, id: string, membershipId: string, dto: UpdateMemberDto) {
    assertPlatform(admin, 'platform.workspaces.manage');
    return this.prisma.scoped({ userId: admin.userId, workspaceId: id }, async (tx) => {
      const target = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: id } });
      if (!target) throw new NotFoundException('العضو غير موجود');
      const nextRole = dto.role ?? target.role;
      const nextStatus = dto.status ?? target.status;
      if (target.role === 'OWNER' && target.status === 'ACTIVE' && (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE')) {
        const owners = await tx.membership.count({ where: { workspaceId: id, role: 'OWNER', status: 'ACTIVE' } });
        if (owners <= 1) throw new BadRequestException('يجب أن يبقى مالك واحد نشط على الأقل. أضف مالكًا آخر أولًا.');
      }
      const supervisor = nextRole === 'ASSISTANT' ? (dto.supervisorMembershipId ?? target.supervisorMembershipId) : null;
      if (nextRole === 'ASSISTANT' && !supervisor) throw new BadRequestException('حدد المدرس الذي يتبعه المساعد');
      const m = await tx.membership.update({
        where: { id: membershipId },
        data: { role: dto.role, status: dto.status, supervisorMembershipId: supervisor },
      });
      await this.audit.log(tx, {
        workspaceId: id, actorUserId: admin.userId, action: 'platform.member_update', entity: 'membership', entityId: membershipId,
        meta: { from: { role: target.role, status: target.status }, to: { role: m.role, status: m.status } }, ip: admin.ip,
      });
      return { membershipId: m.id, role: m.role, status: m.status };
    });
  }

  async addNote(admin: PlatformCtx, id: string, dto: NoteDto) {
    assertPlatform(admin, 'platform.workspaces.manage');
    await this.prisma.workspace.findUniqueOrThrow({ where: { id }, select: { id: true } });
    return this.prisma.workspaceNote.create({ data: { workspaceId: id, authorUserId: admin.userId, body: dto.body.trim() } });
  }

  async deleteNote(admin: PlatformCtx, id: string, noteId: string) {
    const note = await this.prisma.workspaceNote.findFirst({ where: { id: noteId, workspaceId: id } });
    if (!note) throw new NotFoundException('الملاحظة غير موجودة');
    if (note.authorUserId !== admin.userId) assertPlatform(admin, 'platform.admins.manage', 'تحذف ملاحظاتك فقط');
    await this.prisma.workspaceNote.delete({ where: { id: noteId } });
    return { ok: true };
  }

  /** تسجيل دفعة اشتراك: يمد الاشتراك من نهايته الحالية (أو من اليوم إن كان منتهيًا) */
  async recordPayment(admin: PlatformCtx, id: string, dto: RecordPaymentDto) {
    assertPlatform(admin, 'platform.billing.manage');
    const w = await this.prisma.workspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('مساحة العمل غير موجودة');
    if (dto.planCode) await this.assertPlan(dto.planCode);
    const now = new Date();
    const periodStart = w.paidUntil && w.paidUntil > now ? w.paidUntil : now;
    const periodEnd = addMonths(periodStart, dto.months);
    const planCode = dto.planCode || (w.plan === 'trial' ? (w.type === 'TEACHER' ? 'teacher' : 'center') : w.plan);

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.platformPayment.create({
        data: {
          workspaceId: id,
          amount: dto.amount,
          months: dto.months,
          method: dto.method,
          planCode,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
          periodStart,
          periodEnd,
          note: dto.note?.trim() || null,
          recordedById: admin.userId,
        },
      });
      await tx.workspace.update({
        where: { id },
        data: {
          paidUntil: periodEnd,
          plan: planCode,
          // الإيقاف الإداري لا يُرفع تلقائيًا بالدفع
          status: w.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        },
      });
      return p;
    });
    await this.audit.log(null, {
      workspaceId: id, actorUserId: admin.userId, action: 'platform.payment_record', entity: 'platform_payment', entityId: payment.id,
      meta: { amount: dto.amount, months: dto.months, method: dto.method, planCode, until: periodEnd }, ip: admin.ip,
    });
    await this.notifyManagers(id, {
      title: 'تم تجديد الاشتراك',
      body: `تم استلام ${dto.amount} ج.م واشتراككم ساري حتى ${periodEnd.toISOString().slice(0, 10)}. شكرًا لكم.`,
    });
    return { ...payment, amount: dec(payment.amount) };
  }

  async auditOf(admin: PlatformCtx, id: string, page = 1) {
    const take = 50;
    return this.prisma.scoped({ userId: admin.userId }, async (tx) => {
      const rows = await tx.auditLog.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take: take + 1 });
      const actors = await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))] } },
        select: { id: true, name: true },
      });
      const names = new Map(actors.map((a) => [a.id, a.name]));
      return {
        page,
        hasMore: rows.length > take,
        items: rows.slice(0, take).map((r) => ({
          ...r,
          id: r.id.toString(),
          actor: r.actorUserId ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? '—' } : null,
        })),
      };
    });
  }

  private async notifyManagers(workspaceId: string, msg: { title: string; body: string }) {
    const ids = await this.prisma.scoped({ userId: '00000000-0000-0000-0000-000000000000', workspaceId }, (tx) => managerIds(tx, workspaceId));
    await this.notify.notify({ kind: 'subscription', userIds: ids, workspaceId, ...msg });
  }

  private async assertPlan(code: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code }, select: { id: true } });
    if (!plan) throw new BadRequestException(`الخطة ${code} غير موجودة`);
  }

  private diffFrom(w: Workspace, data: Record<string, unknown>) {
    return Object.fromEntries(Object.keys(data).map((k) => [k, (w as unknown as Record<string, unknown>)[k]]));
  }

  private view(w: Workspace) {
    return {
      id: w.id,
      type: w.type,
      name: w.name,
      status: w.status,
      plan: w.plan,
      trialEndsAt: w.trialEndsAt,
      paidUntil: w.paidUntil,
      suspendReason: w.suspendReason,
      governorate: w.governorate,
      contactPhone: w.contactPhone,
      maxStudents: w.maxStudents,
      maxStaff: w.maxStaff,
      receptionMaxDiscountPct: w.receptionMaxDiscountPct,
      lateAfterMinutes: w.lateAfterMinutes,
      createdAt: w.createdAt,
    };
  }

  /** للاستخدام في مسار الحذف المحمي بعد التأكد من الصلاحية */
  assertSuper(admin: PlatformCtx) {
    if (admin.role !== 'SUPER_ADMIN') throw new ForbiddenException('لمالك المنصة فقط');
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PlatformCtx } from '../common/context';
import { PrismaService } from '../prisma/prisma.service';
import type { ListPaymentsQuery, PlanDto } from './dto';
import { dec, defined, pageOf } from './util';

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async plans() {
    const plans = await this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const counts = await this.prisma.workspace.groupBy({ by: ['plan'], _count: { _all: true } });
    const byPlan = new Map(counts.map((c) => [c.plan, c._count._all]));
    return plans.map((p) => ({ ...p, monthlyPrice: dec(p.monthlyPrice), yearlyPrice: dec(p.yearlyPrice), workspaces: byPlan.get(p.code) ?? 0 }));
  }

  async createPlan(admin: PlatformCtx, dto: PlanDto) {
    if (!dto.code || !dto.name) throw new BadRequestException('الكود والاسم مطلوبان');
    if (await this.prisma.plan.findUnique({ where: { code: dto.code } })) throw new ConflictException('يوجد خطة بنفس الكود');
    const plan = await this.prisma.plan.create({
      data: {
        code: dto.code,
        name: dto.name.trim(),
        monthlyPrice: dto.monthlyPrice ?? '0',
        yearlyPrice: dto.yearlyPrice ?? null,
        maxStudents: dto.maxStudents ?? null,
        maxStaff: dto.maxStaff ?? null,
        description: dto.description?.trim() || null,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.plan_create', entity: 'plan', entityId: plan.id, meta: { code: plan.code }, ip: admin.ip });
    return { ...plan, monthlyPrice: dec(plan.monthlyPrice), yearlyPrice: dec(plan.yearlyPrice) };
  }

  async updatePlan(admin: PlatformCtx, id: string, dto: PlanDto) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('الخطة غير موجودة');
    if (dto.code && dto.code !== before.code) throw new BadRequestException('كود الخطة لا يتغير لأنه مرتبط بالمساحات');
    const data = defined({
      name: dto.name?.trim(),
      monthlyPrice: dto.monthlyPrice,
      yearlyPrice: dto.yearlyPrice,
      maxStudents: dto.maxStudents,
      maxStaff: dto.maxStaff,
      description: dto.description === undefined ? undefined : dto.description?.trim() || null,
      active: dto.active,
      sortOrder: dto.sortOrder,
    });
    const plan = await this.prisma.plan.update({ where: { id }, data });
    await this.audit.log(null, { actorUserId: admin.userId, action: 'platform.plan_update', entity: 'plan', entityId: id, meta: JSON.parse(JSON.stringify(data)), ip: admin.ip });
    return { ...plan, monthlyPrice: dec(plan.monthlyPrice), yearlyPrice: dec(plan.yearlyPrice) };
  }

  async payments(q: ListPaymentsQuery) {
    const { page, pageSize, skip, take } = pageOf(q, 50);
    const where: Prisma.PlatformPaymentWhereInput = {
      workspaceId: q.workspaceId,
      paidAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [total, sum, rows] = await Promise.all([
      this.prisma.platformPayment.count({ where }),
      this.prisma.platformPayment.aggregate({ where, _sum: { amount: true } }),
      this.prisma.platformPayment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip,
        take,
        include: { workspace: { select: { id: true, name: true, type: true } } },
      }),
    ]);
    const recorders = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    return {
      total,
      page,
      pageSize,
      sum: dec(sum._sum.amount) ?? '0',
      items: rows.map((r) => ({ ...r, amount: dec(r.amount), recordedBy: recorders.get(r.recordedById) ?? '—' })),
    };
  }

  /** حذف دفعة مسجلة بالخطأ (مالك المنصة فقط). لا يغير تاريخ نهاية الاشتراك تلقائيًا. */
  async deletePayment(admin: PlatformCtx, id: string) {
    const p = await this.prisma.platformPayment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('الدفعة غير موجودة');
    await this.prisma.platformPayment.delete({ where: { id } });
    await this.audit.log(null, {
      workspaceId: p.workspaceId, actorUserId: admin.userId, action: 'platform.payment_delete', entity: 'platform_payment', entityId: id,
      meta: { amount: dec(p.amount), months: p.months, paidAt: p.paidAt }, ip: admin.ip,
    });
    return { ok: true };
  }
}

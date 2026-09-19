import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';

export interface Limits {
  planCode: string;
  planName: string;
  maxStudents: number | null;
  maxStaff: number | null;
}

/** حدود الخطة: تجاوز المساحة إن وُجد، وإلا حدود الخطة، وإلا بلا حد */
@Injectable()
export class LimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async of(workspaceId: string): Promise<Limits> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true, maxStudents: true, maxStaff: true },
    });
    const plan = await this.prisma.plan.findUnique({ where: { code: ws.plan } });
    return {
      planCode: ws.plan,
      planName: plan?.name ?? ws.plan,
      maxStudents: ws.maxStudents ?? plan?.maxStudents ?? null,
      maxStaff: ws.maxStaff ?? plan?.maxStaff ?? null,
    };
  }

  /** داخل معاملة بسياق المساحة: عدد الطلاب النشطين (مميزين) */
  async activeStudents(tx: Tx): Promise<number> {
    const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT app_ws_active_students()::int AS n`;
    return row?.n ?? 0;
  }

  /** يرفض تسجيل طالب جديد إن وصلت المساحة لحد الخطة */
  async assertCanAddStudent(tx: Tx, workspaceId: string, studentAlreadyActive: boolean): Promise<void> {
    if (studentAlreadyActive) return;
    const { maxStudents, planName } = await this.of(workspaceId);
    if (maxStudents === null) return;
    const n = await this.activeStudents(tx);
    if (n >= maxStudents) {
      throw new ForbiddenException(`وصلت لحد خطة «${planName}» (${maxStudents} طالب نشط). تواصل مع إدارة المنصة لترقية الخطة.`);
    }
  }

  /** يرفض إضافة عضو جديد للفريق إن وصلت المساحة لحد الخطة */
  async assertCanAddStaff(tx: Tx, workspaceId: string): Promise<void> {
    const { maxStaff, planName } = await this.of(workspaceId);
    if (maxStaff === null) return;
    const n = await tx.membership.count({ where: { workspaceId, status: 'ACTIVE' } });
    if (n >= maxStaff) {
      throw new ForbiddenException(`وصلت لحد خطة «${planName}» (${maxStaff} عضو). تواصل مع إدارة المنصة لترقية الخطة.`);
    }
  }
}

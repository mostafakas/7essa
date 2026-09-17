import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** إضافة فقط (createMany لا يستخدم RETURNING فيعمل مع سياسة القراءة المقيدة) */
  async log(tx: Tx | null, e: AuditEntry): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.createMany({
      data: [{
        workspaceId: e.workspaceId ?? null,
        actorUserId: e.actorUserId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        meta: e.meta,
        ip: e.ip,
      }],
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

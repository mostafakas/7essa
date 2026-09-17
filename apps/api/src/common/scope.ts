import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import type { WorkspaceCtx } from './context';
import { can, type Permission } from './permissions';

/** سياق RLS لطلب داخل مساحة عمل */
export const wsScope = (ws: WorkspaceCtx) => ({ userId: ws.userId, workspaceId: ws.workspaceId });

/** فلتر المجموعات حسب نطاق المدرس/المساعد (فارغ للإدارة) */
export const groupScope = (ws: WorkspaceCtx) => (ws.teacherScopeId ? { teacherMembershipId: ws.teacherScopeId } : {});

/** يتحقق من صلاحية إضافية داخل نفس الطلب */
export function assertCan(ws: WorkspaceCtx, permission: Permission, message = 'هذا الإجراء غير مسموح لدورك') {
  if (!can(ws.role, permission)) throw new ForbiddenException(message);
}

/** يرفض الوصول لمجموعة خارج نطاق المدرس */
export function assertGroupInScope(ws: WorkspaceCtx, group: { teacherMembershipId: string } | null | undefined) {
  if (!group) throw new NotFoundException('المجموعة غير موجودة');
  if (ws.teacherScopeId && group.teacherMembershipId !== ws.teacherScopeId) {
    throw new ForbiddenException('هذه المجموعة ليست ضمن مجموعاتك');
  }
}

export function notFound(what: string): never {
  throw new NotFoundException(`${what} غير موجود`);
}


/**
 * أقفال استشارية داخل المعاملة لمنع السباقات (حجز نفس القاعة، الترقيم، السعة).
 * تُرتب المفاتيح لتفادي الاختناق المتبادل، وتتحرر تلقائيًا بانتهاء المعاملة.
 */
export async function lockKeys(tx: Tx, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

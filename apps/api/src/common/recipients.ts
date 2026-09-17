import type { Tx } from '../prisma/prisma.service';

/** حسابات الأسرة (ولي الأمر + حساب الطالب إن وجد) */
export function familyIds(student: { guardianUserId: string; studentUserId: string | null }): string[] {
  return student.studentUserId ? [student.guardianUserId, student.studentUserId] : [student.guardianUserId];
}

/** أولياء أمور الطلاب النشطين في مجموعة */
export async function groupFamilyIds(tx: Tx, groupId: string): Promise<string[]> {
  const rows = await tx.enrollment.findMany({
    where: { groupId, status: 'ACTIVE' },
    select: { student: { select: { guardianUserId: true, studentUserId: true } } },
  });
  return [...new Set<string>(rows.flatMap((r) => familyIds(r.student)))];
}

/** المديرون والملاك النشطون (لتنبيهات الإلغاء والعجز والخصومات) */
export async function managerIds(tx: Tx, workspaceId: string): Promise<string[]> {
  const rows = await tx.membership.findMany({
    where: { workspaceId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

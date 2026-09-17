import type { Request } from 'express';
import type { RoleName } from './permissions';

export interface AuthUser {
  id: string;
  isPlatformAdmin: boolean;
}

/** سياق الطلب داخل مساحة عمل، يضبطه WorkspaceGuard بعد التحقق من العضوية */
export interface WorkspaceCtx {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: RoleName;
  /** عند وجوده تُقيد البيانات بمجموعات هذا المدرس */
  teacherScopeId: string | null;
  ip?: string;
}

export interface HessaRequest extends Request {
  user?: AuthUser;
  ws?: WorkspaceCtx;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

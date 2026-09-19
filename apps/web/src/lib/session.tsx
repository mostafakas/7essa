'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText, workspaceStore } from './api';

export interface Membership {
  membershipId: string;
  role: string;
  workspace: { id: string; name: string; type: 'CENTER' | 'TEACHER'; status: string };
}

export type PlatformRole = 'SUPER_ADMIN' | 'SUPPORT' | 'FINANCE' | 'VIEWER';

export interface Me {
  user: {
    id: string;
    name: string;
    phone: string | null;
    username: string | null;
    isPlatformAdmin: boolean;
    platformRole: PlatformRole | null;
    mustChangePassword: boolean;
  };
  children: number;
  isStudent: boolean;
  memberships: Membership[];
  config: { allowSelfSignup: boolean; supportPhone: string | null };
}

export type AccessReason = 'ACTIVE' | 'TRIAL' | 'TRIAL_ENDED' | 'GRACE' | 'EXPIRED' | 'PAUSED' | 'SUSPENDED';
export interface AccessState {
  mode: 'FULL' | 'READ_ONLY' | 'BLOCKED';
  reason: AccessReason;
  daysLeft: number | null;
  until: string | null;
}

export interface CurrentWorkspace {
  workspace: {
    id: string;
    name: string;
    type: 'CENTER' | 'TEACHER';
    status: string;
    plan: string;
    trialEndsAt: string | null;
    paidUntil: string | null;
    receptionMaxDiscountPct: number;
    lateAfterMinutes: number;
  };
  access: AccessState;
  me: { membershipId: string; role: string; teacherScopeId: string | null; permissions: string[] };
}

interface SessionValue {
  me: Me | null;
  current: CurrentWorkspace | null;
  /** سبب تعذر فتح مساحة العمل الحالية (موقوفة مثلًا) */
  workspaceError: string | null;
  loading: boolean;
  can: (permission: string) => boolean;
  /** مساحة للعرض فقط (انتهت التجربة أو الاشتراك) */
  readOnly: boolean;
  switchWorkspace: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children, needWorkspace = true }: { children: ReactNode; needWorkspace?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState<CurrentWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const m = await api<Me>('/auth/me', { workspace: false });
      if (m.user.mustChangePassword) {
        window.location.assign('/account?required=1');
        return;
      }
      setMe(m);
      setWorkspaceError(null);
      if (needWorkspace && m.memberships.length) {
        const saved = workspaceStore.get();
        const chosen = m.memberships.find((x) => x.workspace.id === saved) ?? m.memberships[0];
        workspaceStore.set(chosen.workspace.id);
        try {
          setCurrent(await api<CurrentWorkspace>('/workspaces/current'));
        } catch (e) {
          setCurrent(null);
          setWorkspaceError(errorText(e));
        }
      } else {
        setCurrent(null);
      }
    } finally {
      setLoading(false);
    }
  }, [needWorkspace]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SessionValue>(
    () => ({
      me,
      current,
      workspaceError,
      loading,
      can: (p) => Boolean(current?.me.permissions.includes(p)),
      readOnly: current?.access.mode === 'READ_ONLY',
      switchWorkspace: (id) => {
        workspaceStore.set(id);
        window.location.assign('/app');
      },
      reload,
    }),
    [me, current, workspaceError, loading, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession خارج SessionProvider');
  return v;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', workspace: false });
  } finally {
    workspaceStore.clear();
    window.location.assign('/login');
  }
}

/** الصفحة المناسبة لكل مستخدم بعد الدخول */
export function homeFor(me: Me): string {
  if (me.user.mustChangePassword) return '/account?required=1';
  if (me.memberships.length) return '/app';
  if (me.children) return '/family';
  if (me.user.platformRole) return '/platform';
  return '/start';
}

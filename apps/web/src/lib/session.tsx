'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, workspaceStore } from './api';

export interface Membership {
  membershipId: string;
  role: string;
  workspace: { id: string; name: string; type: 'CENTER' | 'TEACHER'; status: string };
}

export interface Me {
  user: { id: string; name: string; phone: string; isPlatformAdmin: boolean };
  children: number;
  memberships: Membership[];
}

export interface CurrentWorkspace {
  workspace: {
    id: string;
    name: string;
    type: 'CENTER' | 'TEACHER';
    status: string;
    plan: string;
    trialEndsAt: string | null;
    receptionMaxDiscountPct: number;
    lateAfterMinutes: number;
  };
  me: { membershipId: string; role: string; teacherScopeId: string | null; permissions: string[] };
}

interface SessionValue {
  me: Me | null;
  current: CurrentWorkspace | null;
  loading: boolean;
  can: (permission: string) => boolean;
  switchWorkspace: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children, needWorkspace = true }: { children: ReactNode; needWorkspace?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState<CurrentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const m = await api<Me>('/auth/me', { workspace: false });
      setMe(m);
      if (needWorkspace && m.memberships.length) {
        const saved = workspaceStore.get();
        const chosen = m.memberships.find((x) => x.workspace.id === saved) ?? m.memberships[0];
        workspaceStore.set(chosen.workspace.id);
        setCurrent(await api<CurrentWorkspace>('/workspaces/current'));
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
      loading,
      can: (p) => Boolean(current?.me.permissions.includes(p)),
      switchWorkspace: (id) => {
        workspaceStore.set(id);
        window.location.assign('/app');
      },
      reload,
    }),
    [me, current, loading, reload],
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

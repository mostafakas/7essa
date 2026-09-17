import type { ReactNode } from 'react';
import { FamilyShell } from '@/components/family-shell';
import { SessionProvider } from '@/lib/session';

export default function FamilyLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider needWorkspace={false}>
      <FamilyShell>{children}</FamilyShell>
    </SessionProvider>
  );
}

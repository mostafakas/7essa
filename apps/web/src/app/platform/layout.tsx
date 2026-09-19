import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform-shell';
import { SessionProvider } from '@/lib/session';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider needWorkspace={false}>
      <PlatformShell>{children}</PlatformShell>
    </SessionProvider>
  );
}

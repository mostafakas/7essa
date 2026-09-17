import type { Metadata, Viewport } from 'next';
import { Alexandria, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

const display = Alexandria({ subsets: ['arabic', 'latin'], variable: '--font-alexandria', display: 'swap' });
const body = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'حصّة — إدارة السناتر والدروس الخصوصية', template: '%s | حصّة' },
  description: 'الحضور بالـQR، الخزنة والإيصالات، تسويات المدرسين، الامتحانات، وبوابة أولياء الأمور.',
  icons: { icon: '/favicon.svg' },
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: '#1e3b33', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // قراءة الترويسات تجعل العرض ديناميكيًا حتى يطبق Next قيمة nonce الخاصة بكل طلب
  await headers();
  return (
    <html lang="ar" dir="rtl" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}

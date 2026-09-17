'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** صورة QR تُولَّد محليًا في المتصفح (لا تُرسل الرموز لأي خدمة خارجية) */
export function QrImage({ value, size = 260, alt }: { value: string; size?: number; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1e3b33', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt={alt} />;
}

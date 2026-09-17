'use client';

import { useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

export const cameraScanSupported = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * مسح الـQR بكاميرا الجهاز عبر BarcodeDetector المدمج في المتصفح (بدون مكتبات).
 * القارئ اليدوي (USB/Bluetooth) يعمل ككيبورد ولا يحتاج هذا المكون.
 */
export function CameraScanner({ onCode, onClose }: { onCode: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef({ value: '', at: 0 });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          try {
            const [hit] = await detector.detect(video.current);
            const now = Date.now();
            // تجاهل تكرار نفس الرمز خلال 3 ثوانٍ
            if (hit && (hit.rawValue !== last.current.value || now - last.current.at > 3000)) {
              last.current = { value: hit.rawValue, at: now };
              onCode(hit.rawValue);
            }
          } catch {
            /* إطار غير قابل للقراءة */
          }
        }, 350);
      } catch {
        setError('تعذر تشغيل الكاميرا. اسمح بالوصول للكاميرا أو استخدم القارئ.');
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="stack-sm">
      {error ? <div className="note error">{error}</div> : null}
      <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 280, objectFit: 'cover' }} />
      <button className="btn quiet" onClick={onClose} type="button">إيقاف الكاميرا</button>
    </div>
  );
}

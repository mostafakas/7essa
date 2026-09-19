import './load-env';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { env } from './config/env';

/** التشغيل المحلي كخادم دائم (على Vercel يُستخدم serverless.ts) */
async function main() {
  const app = await createApp();
  app.enableShutdownHooks();
  const { PORT } = env();
  await app.listen(PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`حصّة API تعمل على المنفذ ${PORT}`);
}

void main();

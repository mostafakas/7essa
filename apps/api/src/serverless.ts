import './load-env';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './bootstrap';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// يُهيأ التطبيق مرة واحدة لكل نسخة دافئة من الدالة ويُعاد استخدامه
let ready: Promise<Handler> | null = null;

async function init(): Promise<Handler> {
  const app = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

/** نقطة الدخول لدالة Vercel (api/index.js) */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= init().catch((e: unknown) => {
    ready = null;
    throw e;
  });
  const app = await ready;
  await new Promise<void>((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    app(req, res);
  });
}

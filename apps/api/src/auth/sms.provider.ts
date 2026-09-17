import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

/**
 * مزود الرسائل. في التطوير يطبع الرمز في سجل الخادم فقط.
 * في الإنتاج: اربطه بمزود SMS مصري أو WhatsApp Cloud API (قالب مصادقة).
 */
@Injectable()
export class SmsProvider {
  private readonly log = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    if (env().NODE_ENV === 'production') {
      throw new Error('اربط مزود رسائل حقيقي قبل التشغيل في الإنتاج (auth/sms.provider.ts)');
    }
    this.log.warn(`[تطوير فقط] رمز الدخول للرقم ${phone}: ${code}`);
  }
}

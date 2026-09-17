import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const KNOWN: Record<string, [number, string]> = {
  P2002: [409, 'السجل موجود بالفعل'],
  P2003: [400, 'مرجع غير صالح'],
  P2025: [404, 'السجل غير موجود'],
  P2034: [409, 'تعارض مع عملية أخرى، حاول مرة ثانية'],
};

@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Database');

  catch(error: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = 'code' in error ? error.code : '';
    let [status, message] = KNOWN[code] ?? [500, 'خطأ داخلي في قاعدة البيانات'];
    // أخطاء الـ Triggers وسياسات RLS
    if (/insufficient_privilege|row-level security|42501/i.test(error.message)) {
      [status, message] = [403, 'العملية مرفوضة بواسطة قواعد حماية البيانات'];
    }
    if (status >= 500) this.log.error(error.message);
    res.status(status).json({ statusCode: status, message });
  }
}

import { Controller, Get, Headers, Logger, Module, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { accessOf } from '../common/access';
import { Public } from '../common/decorators';
import { managerIds } from '../common/recipients';
import { safeEqual } from '../common/csrf.middleware';
import { env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.module';
import { PlatformSettingsService } from '../platform/settings.service';
import { PrismaService } from '../prisma/prisma.service';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const DAY = 86_400_000;

/**
 * مهمة يومية يشغلها Vercel Cron (vercel.json) بترويسة Authorization: Bearer CRON_SECRET.
 * - تنبيه الملاك قبل انتهاء التجربة أو الاشتراك بـ 7 و 3 و 1 يوم
 * - تنظيف جلسات الدخول المنتهية
 * تُسجل نتيجتها في إعدادات المنصة لتظهر في صفحة «صحة النظام».
 */
@Controller('cron')
export class CronController {
  private readonly log = new Logger('Cron');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly notify: NotificationsService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('daily')
  async daily(@Headers('authorization') auth?: string) {
    const secret = env().CRON_SECRET;
    if (!secret) throw new ServiceUnavailableException('CRON_SECRET غير مضبوط');
    if (!auth || !safeEqual(auth, `Bearer ${secret}`)) throw new UnauthorizedException();

    const now = new Date();
    const config = await this.settings.get(true);
    // تشغيل واحد لكل يوم حتى لا تتكرر التنبيهات عند إعادة المحاولة
    const today = now.toISOString().slice(0, 10);
    const alreadyRan = config.lastCronAt?.toISOString().slice(0, 10) === today;

    let reminders = 0;
    if (!alreadyRan) {
      const candidates = await this.prisma.workspace.findMany({
        where: { status: { in: ['TRIAL', 'ACTIVE'] } },
        select: { id: true, name: true, status: true, trialEndsAt: true, paidUntil: true },
      });
      for (const w of candidates) {
        const a = accessOf(w, now, config.graceDays);
        const end = a.reason === 'TRIAL' ? w.trialEndsAt : a.reason === 'ACTIVE' ? w.paidUntil : null;
        if (!end) continue;
        const days = Math.ceil((end.getTime() - now.getTime()) / DAY);
        if (![7, 3, 1].includes(days)) continue;
        const ids = await this.prisma.scoped({ userId: SYSTEM_USER, workspaceId: w.id }, (tx) => managerIds(tx, w.id));
        const what = a.reason === 'TRIAL' ? 'الفترة التجريبية' : 'الاشتراك';
        await this.notify.notify({
          kind: 'subscription',
          userIds: ids,
          workspaceId: w.id,
          title: `${what} في ${w.name} تنتهي خلال ${days} ${days === 1 ? 'يوم' : 'أيام'}`,
          body: `بعد الانتهاء يصبح الحساب للعرض فقط.${config.supportPhone ? ` للتجديد تواصل معنا: ${config.supportPhone}` : ' تواصل مع إدارة المنصة للتجديد.'}`,
        });
        reminders += ids.length;
      }
    }

    const cleaned = await this.prisma.refreshSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * DAY) } }] },
    });
    const result = { at: now.toISOString(), reminders, sessionsCleaned: cleaned.count, skippedReminders: alreadyRan };
    await this.settings.update({ lastCronAt: now, lastCronResult: result });
    this.log.log(JSON.stringify(result));
    return result;
  }
}

@Module({ controllers: [CronController] })
export class CronModule {}

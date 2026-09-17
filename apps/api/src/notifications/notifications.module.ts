import { InjectQueue, BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { AuthUser } from '../common/context';
import { CurrentUser } from '../common/decorators';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const NOTIFY_QUEUE = 'notifications';

export type NotificationKind =
  | 'welcome' | 'arrival' | 'absence' | 'receipt' | 'session_cancelled' | 'session_changed'
  | 'consent_request' | 'discount_alert' | 'settlement_disputed'
  | 'exam_published' | 'shift_variance' | 'cancel_request' | 'settlement_ready';

export interface NotificationJob {
  kind: NotificationKind;
  userIds: string[];
  title: string;
  body: string;
  workspaceId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(@InjectQueue(NOTIFY_QUEUE) private readonly queue: Queue<NotificationJob>) {}

  /** لا يعطل العملية الأساسية إن تعذر الوصول لـ Redis */
  async notify(job: NotificationJob): Promise<void> {
    const userIds = [...new Set(job.userIds)].filter(Boolean);
    if (!userIds.length) return;
    try {
      await this.queue.add(job.kind, { ...job, userIds }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    } catch (e) {
      this.log.error(`تعذر جدولة الإشعار: ${(e as Error).message}`);
    }
  }
}

/**
 * العامل الخلفي: يحفظ الإشعار داخل التطبيق (القناة الأساسية المجانية).
 * نقطة الإضافة لاحقًا: FCM/APNs ثم واتساب أو SMS كقناة احتياطية مدفوعة.
 */
@Processor(NOTIFY_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly log = new Logger('NotifyWorker');

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const { userIds, kind, title, body, workspaceId } = job.data;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, kind, title, body, workspaceId })),
    });
    this.log.debug(`${kind} → ${userIds.length}`);
  }
}

class MarkReadDto {
  /** بدون معرفات = تعليم الكل كمقروء */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  ids?: string[];
}

/** إشعارات المستخدم الحالي (سياسة RLS تقصرها على صاحبها) */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.scoped({ userId: user.id }, async (tx) => {
      // استعلامات المعاملة الواحدة تُنفذ بالتتابع على نفس الاتصال
      const items = await tx.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      const unread = await tx.notification.count({ where: { userId: user.id, readAt: null } });
      return { unread, items };
    });
  }

  @Post('read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.prisma.scoped({ userId: user.id }, async (tx) => {
      const r = await tx.notification.updateMany({
        where: { userId: user.id, readAt: null, ...(dto.ids?.length ? { id: { in: dto.ids } } : {}) },
        data: { readAt: new Date() },
      });
      return { updated: r.count };
    });
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  imports: [BullModule.registerQueue({ name: NOTIFY_QUEUE })],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}

import { Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { AuthUser } from '../common/context';
import { CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationKind =
  | 'welcome' | 'arrival' | 'absence' | 'receipt' | 'session_cancelled' | 'session_changed'
  | 'consent_request' | 'discount_alert' | 'settlement_disputed'
  | 'exam_published' | 'shift_variance' | 'cancel_request' | 'settlement_ready'
  | 'announcement' | 'subscription';

export interface NotificationJob {
  kind: NotificationKind;
  userIds: string[];
  title: string;
  body: string;
  workspaceId?: string;
}

/**
 * الإشعارات داخل التطبيق تُكتب مباشرة في قاعدة البيانات (بلا طابور خارجي)،
 * لأن التشغيل على Vercel بلا خوادم دائمة. الإرسال سريع (إدراج واحد مجمع)
 * وفشله لا يعطل العملية الأساسية.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async notify(job: NotificationJob): Promise<void> {
    const userIds = [...new Set(job.userIds)].filter(Boolean);
    if (!userIds.length) return;
    try {
      for (let i = 0; i < userIds.length; i += 1000) {
        await this.prisma.notification.createMany({
          data: userIds.slice(i, i + 1000).map((userId) => ({
            userId,
            kind: job.kind,
            title: job.title.slice(0, 200),
            body: job.body.slice(0, 2000),
            workspaceId: job.workspaceId,
          })),
        });
      }
    } catch (e) {
      this.log.error(`تعذر حفظ الإشعار: ${(e as Error).message}`);
    }
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
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

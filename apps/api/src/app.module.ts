import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AcademicsModule } from './academics/academics.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { WorkspaceGuard } from './common/guards/workspace.guard';
import { redisConnection } from './config/env';
import { ExamsModule } from './exams/exams.module';
import { FamilyModule } from './family/family.module';
import { FinanceModule } from './finance/finance.module';
import { HealthModule } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.service';
import { SettlementsModule } from './settlements/settlements.module';
import { StudentsModule } from './students/students.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    HealthModule,
    WorkspacesModule,
    AcademicsModule,
    StudentsModule,
    AttendanceModule,
    FinanceModule,
    SettlementsModule,
    ExamsModule,
    FamilyModule,
    PlatformModule,
  ],
  providers: [
    // الترتيب مهم: الحد من المعدل ← التحقق من الدخول ← العضوية والصلاحية
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: WorkspaceGuard },
  ],
})
export class AppModule {}

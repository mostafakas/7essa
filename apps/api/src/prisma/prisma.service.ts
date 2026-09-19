import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { appDatabaseUrl } from '../config/database-url';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  userId: string;
  workspaceId?: string | null;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // الاتصال يُفتح عند أول استعلام (أسرع في بدء التشغيل على Vercel)
    super({ datasourceUrl: appDatabaseUrl() });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * ينفذ العمليات داخل معاملة بعد ضبط سياق RLS.
   * set_config(..., true) محلي للمعاملة، فلا يتسرب بين الاتصالات في الـ pool.
   * أي استعلام على جدول معزول خارج هذه الدالة لن يرى أي صفوف (فشل آمن).
   */
  scoped<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>, isolationLevel?: Prisma.TransactionIsolationLevel): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${scope.userId}, true), set_config('app.workspace_id', ${scope.workspaceId ?? ''}, true)`;
        return fn(tx);
      },
      { maxWait: 10_000, timeout: 20_000, isolationLevel },
    );
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

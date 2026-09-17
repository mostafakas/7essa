import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  userId: string;
  workspaceId?: string | null;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
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
      { maxWait: 5_000, timeout: 20_000, isolationLevel },
    );
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

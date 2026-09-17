import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'down' });
    }
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformConfig {
  allowSelfSignup: boolean;
  defaultTrialDays: number;
  graceDays: number;
  maxOwnedWorkspaces: number;
  supportPhone: string | null;
  maintenanceMessage: string | null;
  lastCronAt: Date | null;
  lastCronResult: Prisma.JsonValue | null;
}

const DEFAULTS: PlatformConfig = {
  allowSelfSignup: false,
  defaultTrialDays: 30,
  graceDays: 7,
  maxOwnedWorkspaces: 5,
  supportPhone: null,
  maintenanceMessage: null,
  lastCronAt: null,
  lastCronResult: null,
};

const TTL_MS = 60_000;

export interface SettingsPatch {
  allowSelfSignup?: boolean;
  defaultTrialDays?: number;
  graceDays?: number;
  maxOwnedWorkspaces?: number;
  supportPhone?: string | null;
  maintenanceMessage?: string | null;
  lastCronAt?: Date;
  lastCronResult?: Prisma.InputJsonValue;
}

/** إعدادات المنصة (صف واحد) مع ذاكرة مؤقتة قصيرة لأنها تُقرأ مع كل طلب */
@Injectable()
export class PlatformSettingsService {
  private cache: { at: number; value: PlatformConfig } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(fresh = false): Promise<PlatformConfig> {
    if (!fresh && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.value;
    const row = await this.prisma.platformSettings.findUnique({ where: { id: 1 } });
    const value: PlatformConfig = row
      ? {
          allowSelfSignup: row.allowSelfSignup,
          defaultTrialDays: row.defaultTrialDays,
          graceDays: row.graceDays,
          maxOwnedWorkspaces: row.maxOwnedWorkspaces,
          supportPhone: row.supportPhone,
          maintenanceMessage: row.maintenanceMessage,
          lastCronAt: row.lastCronAt,
          lastCronResult: row.lastCronResult,
        }
      : DEFAULTS;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(data: SettingsPatch): Promise<PlatformConfig> {
    await this.prisma.platformSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    this.cache = null;
    return this.get(true);
  }
}

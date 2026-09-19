import { Global, Module } from '@nestjs/common';
import { CredentialsService } from '../auth/credentials.service';
import { LimitsService } from './limits.service';
import { PlatformSettingsService } from './settings.service';

/** خدمات مشتركة تحتاجها وحدات المنصة كلها */
@Global()
@Module({
  providers: [PlatformSettingsService, LimitsService, CredentialsService],
  exports: [PlatformSettingsService, LimitsService, CredentialsService],
})
export class PlatformCoreModule {}

import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsProvider } from './sms.provider';

@Global()
@Module({
  // السر يُمرر عند التوقيع والتحقق حتى لا يُقرأ قبل تحميل البيئة
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SmsProvider],
  exports: [JwtModule],
})
export class AuthModule {}

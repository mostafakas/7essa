import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser, HessaRequest } from '../common/context';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../common/cookies';
import { AllowPendingPassword, ClientMeta, CurrentUser, Public } from '../common/decorators';
import { AuthService, type ClientMetaInfo } from './auth.service';
import { ChangePasswordDto, LoginDto, UpdateMeDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** يضمن وجود كوكي CSRF قبل أول طلب معدِّل */
  @Public()
  @Get('csrf')
  csrf() {
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @ClientMeta() meta: ClientMetaInfo, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto.identifier, dto.password, meta);
    setAuthCookies(res, tokens);
    return this.auth.me(tokens.userId);
  }

  @AllowPendingPassword()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @ClientMeta() meta: ClientMetaInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, meta);
    setAuthCookies(res, tokens);
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: HessaRequest, @ClientMeta() meta: ClientMetaInfo, @Res({ passthrough: true }) res: Response) {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('انتهت الجلسة');
    try {
      setAuthCookies(res, await this.auth.rotate(token, meta));
      return { ok: true };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: HessaRequest, @Res({ passthrough: true }) res: Response) {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.auth.revoke(token);
    clearAuthCookies(res);
    return { ok: true };
  }

  @AllowPendingPassword()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAll(user.id);
    clearAuthCookies(res);
    return { ok: true };
  }

  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    await this.auth.rename(user.id, dto.name);
    return this.auth.me(user.id);
  }
}

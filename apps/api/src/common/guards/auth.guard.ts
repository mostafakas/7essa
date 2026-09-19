import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { env } from '../../config/env';
import type { HessaRequest } from '../context';
import { ACCESS_COOKIE } from '../cookies';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC } from '../decorators';

interface AccessPayload {
  sub: string;
  pa?: boolean;
  mcp?: boolean;
  typ: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<HessaRequest>();
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('سجّل الدخول أولًا');
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: env().JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: 'hessa',
        audience: 'hessa-web',
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
    } catch {
      throw new UnauthorizedException('انتهت الجلسة');
    }
    req.user = { id: payload.sub, isPlatformAdmin: payload.pa === true, mustChangePassword: payload.mcp === true };

    if (req.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'غيّر كلمة المرور المؤقتة أولًا' });
    }
    return true;
  }
}

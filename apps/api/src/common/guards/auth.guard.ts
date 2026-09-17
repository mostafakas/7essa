import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { env } from '../../config/env';
import type { HessaRequest } from '../context';
import { ACCESS_COOKIE } from '../cookies';
import { IS_PUBLIC } from '../decorators';

interface AccessPayload {
  sub: string;
  pa?: boolean;
  typ: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<HessaRequest>();
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('سجّل الدخول أولًا');
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: env().JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: 'hessa',
        audience: 'hessa-web',
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      req.user = { id: payload.sub, isPlatformAdmin: payload.pa === true };
      return true;
    } catch {
      throw new UnauthorizedException('انتهت الجلسة');
    }
  }
}

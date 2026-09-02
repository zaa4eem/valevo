import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects the request — it just leaves
 * `req.user` undefined when no/invalid token is present. Used on public
 * endpoints whose response shape varies for a logged-in viewer (e.g.
 * `viewerHasVoted` on an idea) without requiring login to view them.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: unknown): TUser {
    return (user ?? undefined) as TUser;
  }

  getRequest(context: ExecutionContext) {
    return context.switchToHttp().getRequest();
  }
}

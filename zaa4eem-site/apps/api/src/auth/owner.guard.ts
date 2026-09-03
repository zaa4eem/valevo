import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestUser } from './current-user.decorator';

/** Use alongside JwtAuthGuard: @UseGuards(JwtAuthGuard, OwnerGuard) */
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user || user.role !== 'OWNER') {
      throw new ForbiddenException('Доступно только владельцу');
    }
    return true;
  }
}

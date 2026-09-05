import { Global, Module } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';
import { WebAuthnService } from './webauthn.service';
import { BreachCheckService } from './breach-check.service';

/**
 * Global because AuthService needs SecurityService (to check a second
 * factor) and WebAuthnService (to log someone in with a passkey), while
 * SecurityService needs nothing from auth — keeping the dependency in one
 * direction is what stops a circular module import.
 */
@Global()
@Module({
  providers: [SecurityService, WebAuthnService, BreachCheckService],
  controllers: [SecurityController],
  exports: [SecurityService, WebAuthnService, BreachCheckService],
})
export class SecurityModule {}

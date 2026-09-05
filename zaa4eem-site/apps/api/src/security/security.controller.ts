import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  passwordCheckSchema,
  renamePasskeySchema,
  totpVerifySchema,
} from '@zaa4eem/shared';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { SecurityService } from './security.service';
import { WebAuthnService } from './webauthn.service';

const disableTotpSchema = z.object({ password: z.string().max(200).optional() });

@Controller('security')
export class SecurityController {
  constructor(
    private readonly security: SecurityService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.security.overview(user.id, user.sessionId);
  }

  // ---- Sessions ----

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@CurrentUser() user: RequestUser) {
    return this.security.listSessions(user.id, user.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.security.revokeSession(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@CurrentUser() user: RequestUser) {
    return { revoked: await this.security.revokeOtherSessions(user.id, user.sessionId) };
  }

  // ---- Password checking ----

  /**
   * Deliberately the one route here with no guard: its whole job is to rate
   * a password *while someone is choosing one*, which on the registration
   * screen is before any account exists. Rate-limited hard instead, because
   * it takes a plaintext password and talks to an outside service, so it
   * must never become a convenient oracle.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('password/check')
  @HttpCode(HttpStatus.OK)
  checkPassword(@Body() body: unknown) {
    const { password } = passwordCheckSchema.parse(body);
    return this.security.checkPassword(password);
  }

  // ---- TOTP ----

  @UseGuards(JwtAuthGuard)
  @Post('totp/begin')
  @HttpCode(HttpStatus.OK)
  beginTotp(@CurrentUser() user: RequestUser) {
    return this.security.beginTotp(user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmTotp(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const { code } = totpVerifySchema.parse(body);
    return { codes: await this.security.confirmTotp(user.id, code) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTotp(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const { password } = disableTotpSchema.parse(body ?? {});
    await this.security.disableTotp(user.id, password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateBackupCodes(@CurrentUser() user: RequestUser) {
    return { codes: await this.security.regenerateBackupCodes(user.id) };
  }

  // ---- Passkeys ----

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/begin')
  @HttpCode(HttpStatus.OK)
  beginPasskey(@CurrentUser() user: RequestUser) {
    return this.webauthn.beginRegistration(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/finish')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finishPasskey(@CurrentUser() user: RequestUser, @Body() body: unknown, @Req() req: Request) {
    await this.webauthn.finishRegistration(user.id, body, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('passkeys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async renamePasskey(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { label } = renamePasskeySchema.parse(body);
    await this.security.renamePasskey(user.id, id, label);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('passkeys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePasskey(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.security.deletePasskey(user.id, id);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * SMTP is optional infrastructure — a fresh deploy or a dev sandbox won't
 * have real credentials configured yet. Rather than making every auth flow
 * that touches email hard-fail without SMTP_HOST, this logs the message
 * (including the actual reset link) to the console instead, so password
 * reset stays testable/usable before SMTP is wired up for real.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('SMTP_FROM', 'ZAA4EEM <no-reply@zaa4eem.ru>');

    this.transporter = host
      ? createTransport({
          host,
          port: this.config.get<number>('SMTP_PORT', 587),
          secure: this.config.get<string>('SMTP_SECURE') === 'true',
          auth: this.config.get<string>('SMTP_USER')
            ? {
                user: this.config.getOrThrow<string>('SMTP_USER'),
                pass: this.config.getOrThrow<string>('SMTP_PASS'),
              }
            : undefined,
        })
      : null;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const subject = 'Восстановление пароля ZAA4EEM';
    const text = `Чтобы сбросить пароль, перейдите по ссылке: ${resetUrl}\n\nСсылка действительна 1 час. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.`;
    const html = `
      <p>Чтобы сбросить пароль, перейдите по ссылке ниже:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
    `;

    if (!this.transporter) {
      this.logger.warn(
        `SMTP не настроен — письмо для ${to} не отправлено. Ссылка для сброса: ${resetUrl}`,
      );
      return;
    }

    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }
}

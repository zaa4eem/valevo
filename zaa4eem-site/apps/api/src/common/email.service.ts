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

  /** Lets callers hide email-based controls entirely rather than offering a button that silently logs to a console. */
  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.send(
      to,
      'Восстановление пароля ZAA4EEM',
      `Чтобы сбросить пароль, перейдите по ссылке: ${resetUrl}\n\nСсылка действительна 1 час. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.`,
      `
      <p>Чтобы сбросить пароль, перейдите по ссылке ниже:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
    `,
    );
  }

  async sendEmailVerification(to: string, verifyUrl: string): Promise<void> {
    await this.send(
      to,
      'Подтвердите почту в ZAA4EEM',
      `Подтвердите, что это ваша почта: ${verifyUrl}\n\nСсылка действительна 24 часа. Если вы не регистрировались в ZAA4EEM, просто проигнорируйте это письмо — без перехода по ссылке ничего не произойдёт.`,
      `
      <p>Подтвердите, что это ваша почта:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Ссылка действительна 24 часа. Если вы не регистрировались в ZAA4EEM, просто проигнорируйте это письмо — без перехода по ссылке ничего не произойдёт.</p>
    `,
    );
  }

  async sendMagicLink(to: string, loginUrl: string): Promise<void> {
    await this.send(
      to,
      'Вход в ZAA4EEM',
      `Ссылка для входа: ${loginUrl}\n\nДействительна 15 минут и только один раз. Если вход запрашивали не вы — никому не пересылайте это письмо и просто удалите его.`,
      `
      <p>Ссылка для входа в ZAA4EEM:</p>
      <p><a href="${loginUrl}">${loginUrl}</a></p>
      <p>Действительна 15 минут и только один раз. Если вход запрашивали не вы — никому не пересылайте это письмо и просто удалите его.</p>
    `,
    );
  }

  /**
   * Sent when a session starts on a device this account has not been seen on
   * before. This is the one email that matters most: it is how someone finds
   * out about a stolen password from their inbox instead of from the damage.
   */
  async sendNewDeviceAlert(
    to: string,
    device: string,
    network: string | null,
    at: Date,
  ): Promise<void> {
    const when = at.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const where = network ? ` (сеть ${network})` : '';
    await this.send(
      to,
      'Новый вход в ZAA4EEM',
      `В ваш аккаунт вошли с нового устройства: ${device}${where}, ${when} МСК.\n\nЕсли это были вы — ничего делать не нужно. Если нет — смените пароль и завершите чужие сеансы в Настройках → Безопасность.`,
      `
      <p>В ваш аккаунт вошли с нового устройства:</p>
      <p><b>${device}</b>${where}<br/>${when} МСК</p>
      <p>Если это были вы — ничего делать не нужно. Если нет — смените пароль и завершите чужие сеансы в разделе Настройки → Безопасность.</p>
    `,
    );
  }

  /** One place that decides between real SMTP and the console fallback. */
  private async send(to: string, subject: string, text: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP не настроен — письмо «${subject}» для ${to} не отправлено:\n${text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }
}

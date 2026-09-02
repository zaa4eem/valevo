import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifyText, ModerationState } from '@zaa4eem/shared';

@Injectable()
export class ModerationService {
  private readonly extraBannedWords: string[];

  constructor(config: ConfigService) {
    const raw = config.get<string>('ADMIN_EXTRA_BANNED_WORDS', '');
    this.extraBannedWords = raw
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
  }

  /** Server-side authoritative classification — always the final word. */
  classify(text: string): typeof ModerationState.CLEAN | typeof ModerationState.PENDING_REVIEW {
    return classifyText(text, this.extraBannedWords).state;
  }
}

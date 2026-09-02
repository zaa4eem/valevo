import { ConfigService } from '@nestjs/config';
import { ModerationService } from './moderation.service';

function makeService(extra = ''): ModerationService {
  const config = { get: () => extra } as unknown as ConfigService;
  return new ModerationService(config);
}

describe('ModerationService', () => {
  it('classifies clean text as CLEAN', () => {
    expect(makeService().classify('Добавьте лидерборд по дням')).toBe('CLEAN');
  });

  it('classifies banned content as PENDING_REVIEW, never rejects outright', () => {
    expect(makeService().classify('ты мудак')).toBe('PENDING_REVIEW');
  });

  it('honors ADMIN_EXTRA_BANNED_WORDS from config', () => {
    expect(makeService('badword1,badword2').classify('this has badword2 in it')).toBe(
      'PENDING_REVIEW',
    );
  });
});

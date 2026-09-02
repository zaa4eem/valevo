import { describe, expect, it } from 'vitest';
import { ModerationState } from '../enums';
import { classifyText } from './classify';

describe('classifyText', () => {
  it('marks clean text as CLEAN', () => {
    expect(classifyText('Добавьте тёмную тему для профиля').state).toBe(ModerationState.CLEAN);
  });

  it('flags banned substrings for review instead of rejecting', () => {
    const result = classifyText('ты полный мудак за такое предложение');
    expect(result.state).toBe(ModerationState.PENDING_REVIEW);
    expect(result.matchedTerm).toBeDefined();
  });

  it('is case-insensitive', () => {
    expect(classifyText('FUCK this idea').state).toBe(ModerationState.PENDING_REVIEW);
  });

  it('respects extra owner-configured banned words', () => {
    expect(classifyText('spamword here').state).toBe(ModerationState.CLEAN);
    expect(classifyText('spamword here', ['spamword']).state).toBe(
      ModerationState.PENDING_REVIEW,
    );
  });
});

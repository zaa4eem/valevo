/**
 * Russian's three plural forms.
 *
 * `n % 10` alone gets 11-14 wrong ("11 подписчик"), which is why the
 * hundreds remainder is checked first.
 *
 *     plural(1, 'подписчик', 'подписчика', 'подписчиков')  // подписчик
 *     plural(3, …)                                          // подписчика
 *     plural(12, …)                                         // подписчиков
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** `plural`, with the number in front of it — the form it's wanted in nine times out of ten. */
export function pluralWithCount(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}

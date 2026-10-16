import { describe, expect, it } from 'vitest';
import { isOutdated } from './version';

describe('isOutdated', () => {
  it('compara versões semânticas', () => {
    expect(isOutdated('1.0.0', '1.0.1')).toBe(true);
    expect(isOutdated('1.2.0', '1.10.0')).toBe(true);
    expect(isOutdated('2.0.0', '1.9.9')).toBe(false);
    expect(isOutdated('1.0.0', '1.0.0')).toBe(false);
  });
});

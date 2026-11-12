import { describe, expect, it } from 'vitest';
import { sanitizeTheme } from './theme';

describe('theme', () => {
  it('accepts only light, dark or automatic', () => {
    expect(sanitizeTheme('light')).toBe('light');
    expect(sanitizeTheme('dark')).toBe('dark');
    expect(sanitizeTheme('auto')).toBe('auto');
    for (const bad of ['blue', '', null, undefined, 3, {}]) expect(sanitizeTheme(bad)).toBe('auto');
  });
});

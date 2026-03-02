import { normalizeSlashCommandInput } from './input-normalize.js';
import { stripMouseEscapeSequences } from './input-mouse-sanitize.js';

describe('normalizeSlashCommandInput', () => {
  it('keeps slash at the front when command input drifts before slash', () => {
    expect(normalizeSlashCommandInput('/', 'h/')).toBe('/h');
  });

  it('normalizes continued command typing when slash drifts behind text', () => {
    expect(normalizeSlashCommandInput('/he', 'hel/')).toBe('/hel');
  });

  it('does not change already-correct slash command input', () => {
    expect(normalizeSlashCommandInput('/', '/help')).toBe('/help');
  });

  it('does not change non-command input', () => {
    expect(normalizeSlashCommandInput('hello', 'hello world')).toBe('hello world');
  });
});

describe('input cursor prefix stability helpers', () => {
  it('sanitizes mouse sequences while preserving plain prompt-prefix text', () => {
    expect(stripMouseEscapeSequences('a[<0;155;50M')).toBe('a');
  });
});

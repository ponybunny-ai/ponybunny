import { sanitizeModelSelectorQuery } from '../../../../src/cli/tui/components/modals/model-selector-input-sanitize.js';

describe('model selector input sanitize', () => {
  it('removes terminal mouse escape sequences from selector query', () => {
    const raw = 'abc\u001b[<0;120;38Mdef\u001b[<0;120;38m';
    expect(sanitizeModelSelectorQuery(raw)).toBe('abcdef');
  });

  it('removes stripped mouse fragments without ESC prefix', () => {
    const raw = 'foo[<0;155;50Mbar[<0;155;50m';
    expect(sanitizeModelSelectorQuery(raw)).toBe('foobar');
  });
});

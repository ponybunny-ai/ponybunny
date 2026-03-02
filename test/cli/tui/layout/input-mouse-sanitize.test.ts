import { normalizeSlashCommandInput } from '../../../../src/cli/tui/components/layout/input-normalize.js';
import { stripMouseEscapeSequences } from '../../../../src/cli/tui/components/layout/input-mouse-sanitize.js';

describe('input mouse sanitize', () => {
  it('removes terminal mouse escape sequences from input text', () => {
    const raw = 'hello\u001b[<0;120;38Mworld\u001b[<0;120;38m';
    expect(stripMouseEscapeSequences(raw)).toBe('helloworld');
  });

  it('removes malformed/stripped mouse fragments without ESC prefix', () => {
    const raw = 'foo[<0;155;50Mbar[<0;155;50m';
    expect(stripMouseEscapeSequences(raw)).toBe('foobar');
  });

  it('keeps slash command normalization after mouse sequence removal', () => {
    const prev = '/hel';
    const rawNext = 'abc/hel\u001b[<0;120;38M';
    const normalized = normalizeSlashCommandInput(prev, stripMouseEscapeSequences(rawNext));
    expect(normalized).toBe('/abchel');
  });
});

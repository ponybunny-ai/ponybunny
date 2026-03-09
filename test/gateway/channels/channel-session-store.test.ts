import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ChannelSessionStore } from '../../../src/gateway/channels/channel-session-store.js';

describe('ChannelSessionStore', () => {
  it('persists and loads session-channel map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-channel-store-'));
    const file = join(dir, 'channel-sessions.json');
    const store = new ChannelSessionStore(file);

    store.save({
      'sess-1': 'discord',
      'sess-2': 'tui',
    });

    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
    expect(raw['sess-1']).toBe('discord');
    expect(raw['sess-2']).toBe('tui');

    const loaded = store.load();
    expect(loaded).toEqual({
      'sess-1': 'discord',
      'sess-2': 'tui',
    });
  });

  it('filters invalid channel entries while loading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-channel-store-'));
    const file = join(dir, 'channel-sessions.json');
    const store = new ChannelSessionStore(file);

    store.save({
      'sess-1': 'discord',
    });

    const loaded = store.load();
    expect(loaded).toEqual({
      'sess-1': 'discord',
    });
  });
});

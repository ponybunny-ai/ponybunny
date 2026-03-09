import { ChannelRouter } from '../../../src/gateway/channels/channel-router.js';
import { Session } from '../../../src/gateway/connection/session.js';

function createSession(id: string, channelType?: string): Session {
  return new Session({
    id,
    publicKey: `pk-${id}`,
    permissions: ['read'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    metadata: channelType ? { channelType } : undefined,
  });
}

describe('ChannelRouter', () => {
  it('filters by enabled channels and source channel when mirror is disabled', () => {
    const router = new ChannelRouter();
    router.setEnabledChannels(['tui', 'discord']);
    router.setMirrorToAllEnabledChannels(false);

    const filter = router.buildSessionFilter({ channelType: 'discord' });
    expect(filter(createSession('tui-1', 'tui'))).toBe(false);
    expect(filter(createSession('discord-1', 'discord'))).toBe(true);
    expect(filter(createSession('web-1', 'webui'))).toBe(false);
  });

  it('mirrors to all enabled channels when mirror is enabled', () => {
    const router = new ChannelRouter();
    router.setEnabledChannels(['tui', 'discord']);
    router.setMirrorToAllEnabledChannels(true);

    const filter = router.buildSessionFilter({ channelType: 'discord' });
    expect(filter(createSession('tui-1', 'tui'))).toBe(true);
    expect(filter(createSession('discord-1', 'discord'))).toBe(true);
    expect(filter(createSession('web-1', 'webui'))).toBe(false);
  });

  it('respects explicit enabledChannels payload override', () => {
    const router = new ChannelRouter();
    router.setEnabledChannels(['tui', 'discord']);
    router.setMirrorToAllEnabledChannels(true);

    const filter = router.buildSessionFilter({
      channelType: 'discord',
      enabledChannels: ['discord'],
      mirrorToAllEnabledChannels: true,
    });

    expect(filter(createSession('tui-1', 'tui'))).toBe(false);
    expect(filter(createSession('discord-1', 'discord'))).toBe(true);
  });

  it('supports per-session channel override', () => {
    const router = new ChannelRouter();
    router.setEnabledChannels(['discord']);
    router.setSessionChannel('sess-a', 'discord');

    const filter = router.buildSessionFilter({
      channelType: 'discord',
      mirrorToAllEnabledChannels: true,
    });

    const fallbackTuiSession = createSession('sess-a', 'tui');
    expect(filter(fallbackTuiSession)).toBe(true);

    router.clearSessionChannel('sess-a');
    expect(filter(fallbackTuiSession)).toBe(false);
  });

  it('adds override channel into enabled set automatically', () => {
    const router = new ChannelRouter();
    router.setEnabledChannels(['tui']);

    router.setSessionChannel('sess-x', 'telegram');
    expect(router.getEnabledChannels()).toContain('telegram');
  });
});

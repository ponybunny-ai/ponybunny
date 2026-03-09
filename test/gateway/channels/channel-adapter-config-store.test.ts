import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ChannelAdapterConfigStore } from '../../../src/gateway/channels/channel-adapter-config-store.js';

describe('ChannelAdapterConfigStore', () => {
  it('saves and loads adapter configs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-adapter-config-store-'));
    try {
      const filePath = path.join(root, 'gateway', 'adapter-configs.json');
      const store = new ChannelAdapterConfigStore(filePath);

      store.save({
        discord: { botTokenPresent: true },
        telegram: { pollingEnabled: true },
      });

      const rawSaved = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { version?: number; configs?: unknown };
      expect(rawSaved.version).toBe(1);
      expect(rawSaved.configs).toBeDefined();

      const loaded = store.load();
      expect(loaded).toEqual({
        discord: {
          botToken: '',
          webhookUrl: '',
          guildId: '',
          applicationId: '',
          commandsEnabled: true,
          retryAttempts: 2,
          retryBackoffMs: 50,
          botTokenPresent: true,
        },
        telegram: {
          botToken: '',
          webhookUrl: '',
          pollingEnabled: true,
          retryAttempts: 2,
          retryBackoffMs: 50,
        },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores invalid channel keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-adapter-config-store-'));
    try {
      const filePath = path.join(root, 'gateway', 'adapter-configs.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          discord: { botTokenPresent: true },
          unknown: { x: 1 },
        }),
        'utf-8'
      );

      const store = new ChannelAdapterConfigStore(filePath);
      const loaded = store.load();
      expect(loaded).toEqual({
        discord: {
          botToken: '',
          webhookUrl: '',
          guildId: '',
          applicationId: '',
          commandsEnabled: true,
          retryAttempts: 2,
          retryBackoffMs: 50,
          botTokenPresent: true,
        },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('migrates legacy flat-map format on load', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-adapter-config-store-'));
    try {
      const filePath = path.join(root, 'gateway', 'adapter-configs.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          email: { inboundAddress: 'alerts@example.com' },
        }),
        'utf-8'
      );

      const store = new ChannelAdapterConfigStore(filePath);
      const loaded = store.load();
      expect(loaded.email).toEqual({
        inboundAddress: 'alerts@example.com',
        smtpHost: '',
        smtpPort: 587,
        useTls: true,
        retryAttempts: 2,
        retryBackoffMs: 50,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import {
  diffAdapterConfigMaps,
  normalizeAdapterConfig,
  sanitizeAdapterConfig,
  summarizeAdapterConfigImpact,
} from '../../../src/gateway/channels/channel-adapter-config.js';

describe('channel-adapter-config utilities', () => {
  it('applies channel defaults when normalizing', () => {
    expect(normalizeAdapterConfig('webui', {})).toEqual({
      origin: '*',
      corsEnabled: true,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });

    expect(normalizeAdapterConfig('email', { smtpHost: 'smtp.example.com' })).toEqual({
      inboundAddress: '',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      useTls: true,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });
  });

  it('masks sensitive fields in sanitized config', () => {
    expect(sanitizeAdapterConfig('discord', { botToken: 'abc', commandsEnabled: false })).toEqual({
      botToken: '***',
      webhookUrl: '',
      guildId: '',
      applicationId: '',
      commandsEnabled: false,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });
  });

  it('builds field-level diffs using sanitized snapshots', () => {
    const before = {
      discord: {
        botToken: 'old',
        commandsEnabled: true,
      },
    };
    const after = {
      discord: {
        botToken: 'new',
        commandsEnabled: false,
      },
      telegram: {
        pollingEnabled: true,
      },
    };

    expect(diffAdapterConfigMaps(before, after)).toEqual([
      {
        channel: 'discord',
        changedKeys: ['commandsEnabled'],
        changedCategories: {
          credentials: [],
          policy: ['commandsEnabled'],
          routing: [],
          other: [],
        },
      },
      {
        channel: 'telegram',
        changedKeys: ['pollingEnabled'],
        changedCategories: {
          credentials: [],
          policy: ['pollingEnabled'],
          routing: [],
          other: [],
        },
      },
    ]);
  });

  it('classifies diff keys into credentials/policy/routing buckets', () => {
    const before = {
      discord: {
        botToken: 'a',
        retryAttempts: 2,
        guildId: '1',
      },
    };
    const after = {
      discord: {
        botToken: 'b',
        retryAttempts: 3,
        guildId: '2',
      },
    };

    expect(diffAdapterConfigMaps(before, after)).toEqual([
      {
        channel: 'discord',
        changedKeys: ['guildId', 'retryAttempts'],
        changedCategories: {
          credentials: [],
          policy: ['retryAttempts'],
          routing: ['guildId'],
          other: [],
        },
      },
    ]);
  });

  it('summarizes config impact flags from diff categories', () => {
    const diff = diffAdapterConfigMaps(
      {
        discord: {
          commandsEnabled: true,
          guildId: '1',
        },
      },
      {
        discord: {
          commandsEnabled: false,
          guildId: '2',
          customTag: 'prod',
        },
      }
    );

    expect(summarizeAdapterConfigImpact(diff)).toEqual({
      credentialsChanged: false,
      policyChanged: true,
      routingChanged: true,
      otherChanged: true,
    });
  });
});

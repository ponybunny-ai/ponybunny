import { resolveRuntimeConfigFromEnvironment } from '../../../src/infra/config/runtime-config.js';

describe('runtime-config memory user profile id', () => {
  it('uses PONY_MEMORY_USER_PROFILE_ID when provided', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_DB_PATH: '/tmp/pony.db',
      PONY_MEMORY_USER_PROFILE_ID: 'alice',
    });

    expect(config.memory.userProfileId).toBe('alice');
    expect(config.memory.database).toBe('/tmp/memory.db');
  });

  it('falls back to detected/default user profile id when env is missing', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_DB_PATH: '/tmp/pony.db',
    });

    expect(typeof config.memory.userProfileId).toBe('string');
    expect(config.memory.userProfileId.length).toBeGreaterThan(0);
  });

  it('loads persona config from environment', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_PERSONA_DIR: '/tmp/personas',
      PONY_DEFAULT_PERSONA_ID: 'pony-pro',
      PONY_PERSONA_OVERRIDE_PERSONALITY: 'Custom personality block',
    });

    expect(config.persona.directory).toBe('/tmp/personas');
    expect(config.persona.defaultPersonaId).toBe('pony-pro');
    expect(config.persona.promptOverrides.personalityDescription).toBe('Custom personality block');
  });
});

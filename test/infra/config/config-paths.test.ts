import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pony-config-paths-'));
}

describe('config-paths migration', () => {
  const originalEnv = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    PONYBUNNY_CONFIG_DIR: process.env.PONYBUNNY_CONFIG_DIR,
  };

  afterEach(() => {
    process.env.HOME = originalEnv.HOME;
    process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
    process.env.PONYBUNNY_CONFIG_DIR = originalEnv.PONYBUNNY_CONFIG_DIR;
    jest.resetModules();
  });

  test('migrates legacy config files from ~/.ponybunny to ~/.config/ponybunny', async () => {
    const tempHome = makeTempHome();
    process.env.HOME = tempHome;
    delete process.env.PONYBUNNY_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;

    const legacyDir = path.join(tempHome, '.ponybunny');
    fs.mkdirSync(path.join(legacyDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'credentials.json'), '{"endpoints":{}}');
    fs.writeFileSync(path.join(legacyDir, 'prompts', 'manifest.json'), '{"manifestVersion":"1"}');

    const { getConfigDir } = await import('../../../src/infra/config/config-paths.js');
    const configDir = getConfigDir();

    const targetCredentials = path.join(configDir, 'credentials.json');
    const targetManifest = path.join(configDir, 'prompts', 'manifest.json');

    expect(configDir).toBe(path.join(tempHome, '.config', 'ponybunny'));
    expect(fs.existsSync(targetCredentials)).toBe(true);
    expect(fs.existsSync(targetManifest)).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'credentials.json'))).toBe(false);
  });

  test('respects explicit config dir override', async () => {
    const tempHome = makeTempHome();
    const overrideDir = path.join(tempHome, 'custom-config');
    process.env.HOME = tempHome;
    process.env.PONYBUNNY_CONFIG_DIR = overrideDir;

    const { getConfigDir } = await import('../../../src/infra/config/config-paths.js');
    const configDir = getConfigDir();

    expect(configDir).toBe(overrideDir);
    expect(fs.existsSync(overrideDir)).toBe(true);
  });
});

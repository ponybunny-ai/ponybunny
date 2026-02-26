import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createConfigBackup,
  listConfigBackups,
  restoreConfigBackup,
} from '../../src/cli/lib/config-backup.js';

describe('config backup', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `pb-config-backup-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    process.env.PONYBUNNY_CONFIG_DIR = configDir;
    mkdirSync(configDir, { recursive: true, mode: 0o700 });

    writeFileSync(join(configDir, 'llm-config.json'), JSON.stringify({ providers: {} }, null, 2), { mode: 0o600 });
    writeFileSync(join(configDir, 'mcp-config.json'), JSON.stringify({ mcpServers: {} }, null, 2), { mode: 0o600 });
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({ providers: { openai: { apiKey: 'secret' } } }, null, 2), { mode: 0o600 });

    mkdirSync(join(configDir, 'vault'), { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir, 'vault', '20260101-000000.pbvault'), Buffer.from('vault-data'), { mode: 0o600 });
  });

  afterEach(() => {
    delete process.env.PONYBUNNY_CONFIG_DIR;
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  test('creates backup without credentials and vault content', () => {
    const backupPath = createConfigBackup();
    expect(existsSync(backupPath)).toBe(true);

    const backups = listConfigBackups();
    expect(backups.length).toBe(1);
    expect(backups[0]?.encrypted).toBe(false);
  });

  test('creates encrypted backup and restores with passcode', () => {
    const backupPath = createConfigBackup(Buffer.from('pass-123', 'utf-8'));

    writeFileSync(join(configDir, 'llm-config.json'), JSON.stringify({ providers: { modified: true } }, null, 2), { mode: 0o600 });

    restoreConfigBackup(backupPath, Buffer.from('pass-123', 'utf-8'));

    const restored = readFileSync(join(configDir, 'llm-config.json'), 'utf-8');
    expect(restored).toContain('"providers": {}');

    const credentials = readFileSync(join(configDir, 'credentials.json'), 'utf-8');
    expect(credentials).toContain('secret');
  });

  test('fails to restore encrypted backup with wrong passcode', () => {
    const backupPath = createConfigBackup(Buffer.from('pass-abc', 'utf-8'));
    expect(() => restoreConfigBackup(backupPath, Buffer.from('wrong-pass', 'utf-8'))).toThrow(
      'Wrong passcode or backup file is corrupted.',
    );
  });
});

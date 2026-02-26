import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createVaultBackup,
  getVaultDirPath,
  listVaultFiles,
  restoreCredentialsFromVault,
} from '../../src/cli/lib/auth-vault.js';

describe('auth vault', () => {
  let configDir: string;
  let credentialsPath: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `pb-vault-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    process.env.PONYBUNNY_CONFIG_DIR = configDir;
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    credentialsPath = join(configDir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({ providers: { 'openai-direct': { apiKey: 'sk-test-value' } } }, null, 2), {
      mode: 0o600,
    });
    chmodSync(credentialsPath, 0o600);
  });

  afterEach(() => {
    delete process.env.PONYBUNNY_CONFIG_DIR;
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  test('creates encrypted vault file and enforces permissions', () => {
    const passkey = Buffer.from('my-passkey', 'utf-8');
    try {
      const vaultPath = createVaultBackup(passkey);
      expect(vaultPath.endsWith('.pbvault')).toBe(true);
      expect(existsSync(vaultPath)).toBe(true);

      const raw = readFileSync(vaultPath);
      expect(raw.toString('utf-8')).not.toContain('sk-test-value');

      const vaultStats = statSync(vaultPath);
      expect(vaultStats.mode & 0o777).toBe(0o600);

      const vaultDirStats = statSync(getVaultDirPath());
      expect(vaultDirStats.mode & 0o777).toBe(0o700);

      const listed = listVaultFiles();
      expect(listed.length).toBe(1);
      expect(listed[0]?.path).toBe(vaultPath);
    } finally {
      passkey.fill(0);
    }
  });

  test('fails safely with wrong passkey without modifying credentials', () => {
    const passkey = Buffer.from('correct-passkey', 'utf-8');
    const vaultPath = createVaultBackup(passkey);
    passkey.fill(0);

    const before = readFileSync(credentialsPath, 'utf-8');
    expect(() => restoreCredentialsFromVault(vaultPath, Buffer.from('wrong-passkey', 'utf-8'))).toThrow(
      'Wrong passkey or vault file is corrupted.',
    );
    const after = readFileSync(credentialsPath, 'utf-8');
    expect(after).toBe(before);
  });

  test('restores credentials when passkey is correct', () => {
    const sourceCredentials = JSON.stringify(
      { providers: { 'openai-compatible': { apiKey: 'sk-restore-source' } } },
      null,
      2,
    );
    writeFileSync(credentialsPath, sourceCredentials, { mode: 0o600 });

    const passkey = Buffer.from('restore-passkey', 'utf-8');
    const vaultPath = createVaultBackup(passkey);

    const differentCredentials = JSON.stringify(
      { providers: { 'anthropic-direct': { apiKey: 'sk-different' } } },
      null,
      2,
    );
    writeFileSync(credentialsPath, differentCredentials, { mode: 0o600 });

    try {
      restoreCredentialsFromVault(vaultPath, passkey);
    } finally {
      passkey.fill(0);
    }

    expect(readFileSync(credentialsPath, 'utf-8')).toBe(sourceCredentials);
    expect(existsSync(`${credentialsPath}.bak`)).toBe(false);

    const credentialsStats = statSync(credentialsPath);
    expect(credentialsStats.mode & 0o777).toBe(0o600);
  });
});

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { getConfigDir } from '../../infra/config/config-paths.js';
import { getCredentialsPath, validateCredentials } from '../../infra/config/credentials-loader.js';

const MAGIC = Buffer.from('PBVAULT1', 'ascii');
const VERSION = 1;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const EXTENSION = '.pbvault';
const VAULT_NAME_RE = /^\d{8}-\d{6}\.pbvault$/;

export interface VaultFileEntry {
  name: string;
  path: string;
  mtimeMs: number;
  timestampMs: number;
}

function toUtcTimestampFromFilename(name: string): number {
  if (!VAULT_NAME_RE.test(name)) {
    return Number.NaN;
  }

  const [datePart, timeWithExt] = name.split('-');
  const timePart = timeWithExt.slice(0, 6);

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));

  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function formatVaultFilename(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}${EXTENSION}`;
}

function deriveKey(passkeyBuffer: Buffer, salt: Buffer): Buffer {
  return scryptSync(passkeyBuffer, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function buildVaultBinary(plaintext: Buffer, passkeyBuffer: Buffer): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passkeyBuffer, salt);

  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ciphertext, tag]);

    const saltLength = Buffer.from([salt.length]);
    const nonceLength = Buffer.from([nonce.length]);
    const payloadLength = Buffer.alloc(4);
    payloadLength.writeUInt32BE(payload.length, 0);

    return Buffer.concat([
      MAGIC,
      Buffer.from([VERSION]),
      saltLength,
      salt,
      nonceLength,
      nonce,
      payloadLength,
      payload,
    ]);
  } finally {
    key.fill(0);
  }
}

function parseVaultBinary(vault: Buffer): { salt: Buffer; nonce: Buffer; payload: Buffer } {
  let offset = 0;

  if (vault.length < MAGIC.length + 1 + 1 + 1 + 4) {
    throw new Error('Vault file is too short.');
  }

  const magic = vault.subarray(offset, offset + MAGIC.length);
  offset += MAGIC.length;
  if (!magic.equals(MAGIC)) {
    throw new Error('Vault header mismatch.');
  }

  const version = vault.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported vault version: ${version}`);
  }

  const saltLength = vault.readUInt8(offset);
  offset += 1;
  if (saltLength <= 0 || offset + saltLength > vault.length) {
    throw new Error('Invalid salt field.');
  }
  const salt = vault.subarray(offset, offset + saltLength);
  offset += saltLength;

  const nonceLength = vault.readUInt8(offset);
  offset += 1;
  if (nonceLength <= 0 || offset + nonceLength > vault.length) {
    throw new Error('Invalid nonce field.');
  }
  const nonce = vault.subarray(offset, offset + nonceLength);
  offset += nonceLength;

  if (offset + 4 > vault.length) {
    throw new Error('Invalid payload length field.');
  }
  const payloadLength = vault.readUInt32BE(offset);
  offset += 4;

  if (payloadLength <= TAG_BYTES) {
    throw new Error('Invalid payload data.');
  }
  if (offset + payloadLength !== vault.length) {
    throw new Error('Vault payload is truncated or malformed.');
  }

  const payload = vault.subarray(offset, offset + payloadLength);
  return { salt, nonce, payload };
}

function decryptVaultBinary(vault: Buffer, passkeyBuffer: Buffer): Buffer {
  const { salt, nonce, payload } = parseVaultBinary(vault);
  const key = deriveKey(passkeyBuffer, salt);

  try {
    const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Wrong passkey or vault file is corrupted.');
  } finally {
    key.fill(0);
  }
}

export function getVaultDirPath(): string {
  return join(getConfigDir(), 'vault');
}

export function ensureVaultDir(): string {
  const vaultDir = getVaultDirPath();
  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(vaultDir, 0o700);
  return vaultDir;
}

export function listVaultFiles(): VaultFileEntry[] {
  const vaultDir = getVaultDirPath();
  if (!existsSync(vaultDir)) {
    return [];
  }

  const dirEntries = readdirSync(vaultDir, { withFileTypes: true });
  const files: VaultFileEntry[] = [];

  for (const entry of dirEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (!VAULT_NAME_RE.test(entry.name)) {
      continue;
    }

    const filePath = join(vaultDir, entry.name);
    const stats = statSync(filePath);
    const timestampMs = toUtcTimestampFromFilename(entry.name);

    files.push({
      name: entry.name,
      path: filePath,
      mtimeMs: stats.mtimeMs,
      timestampMs,
    });
  }

  files.sort((a, b) => {
    const at = Number.isFinite(a.timestampMs) ? a.timestampMs : a.mtimeMs;
    const bt = Number.isFinite(b.timestampMs) ? b.timestampMs : b.mtimeMs;
    return bt - at;
  });

  return files;
}

export function resolveVaultFilePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('Vault file path cannot be empty.');
  }

  const absoluteCandidate = resolve(trimmed);
  if (existsSync(absoluteCandidate)) {
    return absoluteCandidate;
  }

  const fromVaultDir = join(getVaultDirPath(), trimmed);
  if (existsSync(fromVaultDir)) {
    return fromVaultDir;
  }

  throw new Error('Vault file not found.');
}

export function createVaultBackup(passkeyBuffer: Buffer): string {
  const credentialsPath = getCredentialsPath();
  if (!existsSync(credentialsPath)) {
    throw new Error('credentials.json missing');
  }

  const plaintext = readFileSync(credentialsPath);
  const binary = buildVaultBinary(plaintext, passkeyBuffer);
  const vaultDir = ensureVaultDir();
  const filename = formatVaultFilename(new Date());
  const outputPath = join(vaultDir, filename);

  writeFileSync(outputPath, binary, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  return outputPath;
}

export function restoreCredentialsFromVault(vaultPath: string, passkeyBuffer: Buffer): void {
  if (!existsSync(vaultPath)) {
    throw new Error('Vault file missing.');
  }

  const encrypted = readFileSync(vaultPath);
  const plaintext = decryptVaultBinary(encrypted, passkeyBuffer);

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf-8'));
  } catch {
    throw new Error('Decrypted credentials are invalid JSON.');
  }
  validateCredentials(parsed);

  const credentialsPath = getCredentialsPath();
  const credentialsDir = getConfigDir();
  if (!existsSync(credentialsDir)) {
    mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(credentialsDir, 0o700);

  const backupPath = `${credentialsPath}.bak`;
  const tempPath = `${credentialsPath}.tmp-${process.pid}-${Date.now()}`;
  const hadExisting = existsSync(credentialsPath);

  if (hadExisting) {
    copyFileSync(credentialsPath, backupPath);
    chmodSync(backupPath, 0o600);
  }

  try {
    writeFileSync(tempPath, plaintext, { mode: 0o600 });
    renameSync(tempPath, credentialsPath);
    chmodSync(credentialsPath, 0o600);

    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }

    if (existsSync(backupPath)) {
      copyFileSync(backupPath, credentialsPath);
      chmodSync(credentialsPath, 0o600);
      unlinkSync(backupPath);
    }

    throw error;
  }
}

export function getRelativeAgeLabel(referenceMs: number): string {
  const now = Date.now();
  const diffDays = Math.floor((now - referenceMs) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return '1 day ago';
  }
  return `${diffDays} days ago`;
}

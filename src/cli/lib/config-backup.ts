import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { dirname, join, normalize, relative, sep } from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { getConfigDir } from '../../infra/config/config-paths.js';

const MAGIC = Buffer.from('PBCFGBAK', 'ascii');
const VERSION = 1;
const FLAG_ENCRYPTED = 1;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const EXTENSION = '.pbbackup';
const BACKUP_NAME_RE = /^\d{8}-\d{6}\.pbbackup$/;

const EXCLUDED_TOP_LEVEL_NAMES = new Set<string>(['credentials.json', 'vault', 'backup']);

interface BackupManifestEntry {
  path: string;
  mode: number;
  contentBase64: string;
}

interface BackupManifest {
  version: number;
  createdAt: string;
  entries: BackupManifestEntry[];
}

export interface BackupFileEntry {
  name: string;
  path: string;
  mtimeMs: number;
  timestampMs: number;
  encrypted: boolean;
}

function formatBackupFilename(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}${EXTENSION}`;
}

function toUtcTimestampFromFilename(name: string): number {
  if (!BACKUP_NAME_RE.test(name)) {
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

function deriveKey(passcodeBuffer: Buffer, salt: Buffer): Buffer {
  return scryptSync(passcodeBuffer, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function buildPayload(plaintext: Buffer, passcodeBuffer?: Buffer): { payload: Buffer; encrypted: boolean } {
  if (!passcodeBuffer || passcodeBuffer.length === 0) {
    return { payload: plaintext, encrypted: false };
  }

  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passcodeBuffer, salt);

  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      payload: Buffer.concat([salt, nonce, ciphertext, tag]),
      encrypted: true,
    };
  } finally {
    key.fill(0);
  }
}

function parsePayload(payload: Buffer, encrypted: boolean, passcodeBuffer?: Buffer): Buffer {
  if (!encrypted) {
    return payload;
  }

  if (!passcodeBuffer || passcodeBuffer.length === 0) {
    throw new Error('This backup is encrypted. Passcode is required.');
  }

  if (payload.length <= SALT_BYTES + NONCE_BYTES + TAG_BYTES) {
    throw new Error('Encrypted backup payload is malformed.');
  }

  const salt = payload.subarray(0, SALT_BYTES);
  const nonce = payload.subarray(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const encryptedContent = payload.subarray(SALT_BYTES + NONCE_BYTES, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const key = deriveKey(passcodeBuffer, salt);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedContent), decipher.final()]);
  } catch {
    throw new Error('Wrong passcode or backup file is corrupted.');
  } finally {
    key.fill(0);
  }
}

function buildBackupBinary(payload: Buffer, encrypted: boolean): Buffer {
  const payloadLength = Buffer.alloc(4);
  payloadLength.writeUInt32BE(payload.length, 0);

  return Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    Buffer.from([encrypted ? FLAG_ENCRYPTED : 0]),
    payloadLength,
    payload,
  ]);
}

function parseBackupBinary(binary: Buffer): { payload: Buffer; encrypted: boolean } {
  if (binary.length < MAGIC.length + 1 + 1 + 4) {
    throw new Error('Backup file is too short.');
  }

  let offset = 0;
  const magic = binary.subarray(offset, offset + MAGIC.length);
  offset += MAGIC.length;
  if (!magic.equals(MAGIC)) {
    throw new Error('Backup header mismatch.');
  }

  const version = binary.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported backup version: ${version}`);
  }

  const flags = binary.readUInt8(offset);
  offset += 1;
  const encrypted = (flags & FLAG_ENCRYPTED) === FLAG_ENCRYPTED;

  const payloadLength = binary.readUInt32BE(offset);
  offset += 4;

  if (payloadLength <= 0 || offset + payloadLength !== binary.length) {
    throw new Error('Backup payload is truncated or malformed.');
  }

  return {
    payload: binary.subarray(offset, offset + payloadLength),
    encrypted,
  };
}

function collectManifestEntries(configDir: string): BackupManifestEntry[] {
  const entries: BackupManifestEntry[] = [];

  const walk = (currentDir: string): void => {
    const dirEntries = readdirSync(currentDir, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      const absolutePath = join(currentDir, dirEntry.name);
      const relPath = relative(configDir, absolutePath);

      if (!relPath || relPath.startsWith('..')) {
        continue;
      }

      const topLevel = relPath.split(sep)[0];
      if (EXCLUDED_TOP_LEVEL_NAMES.has(topLevel)) {
        continue;
      }

      if (dirEntry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!dirEntry.isFile()) {
        continue;
      }

      const stats = statSync(absolutePath);
      const content = readFileSync(absolutePath);
      entries.push({
        path: relPath.split(sep).join('/'),
        mode: stats.mode & 0o777,
        contentBase64: content.toString('base64'),
      });
    }
  };

  walk(configDir);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function sanitizeManifestEntryPath(entryPath: string): string {
  if (!entryPath || entryPath.trim().length === 0) {
    throw new Error('Backup contains an empty path entry.');
  }

  const normalized = normalize(entryPath).replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new Error('Backup contains unsafe path entries.');
  }

  const topLevel = normalized.split('/')[0];
  if (EXCLUDED_TOP_LEVEL_NAMES.has(topLevel)) {
    throw new Error(`Backup contains forbidden path entry: ${entryPath}`);
  }

  return normalized;
}

function getBackupDirPath(): string {
  return join(getConfigDir(), 'backup');
}

function ensureBackupDir(): string {
  const backupDir = getBackupDirPath();
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(backupDir, 0o700);
  return backupDir;
}

export function createConfigBackup(passcodeBuffer?: Buffer): string {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(configDir, 0o700);

  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries: collectManifestEntries(configDir),
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf-8');
  const compressed = gzipSync(manifestBuffer);
  const { payload, encrypted } = buildPayload(compressed, passcodeBuffer);
  const binary = buildBackupBinary(payload, encrypted);

  const backupDir = ensureBackupDir();
  const backupPath = join(backupDir, formatBackupFilename(new Date()));
  writeFileSync(backupPath, binary, { mode: 0o600 });
  chmodSync(backupPath, 0o600);
  return backupPath;
}

export function listConfigBackups(): BackupFileEntry[] {
  const backupDir = getBackupDirPath();
  if (!existsSync(backupDir)) {
    return [];
  }

  const dirEntries = readdirSync(backupDir, { withFileTypes: true });
  const backups: BackupFileEntry[] = [];

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isFile()) {
      continue;
    }
    if (!BACKUP_NAME_RE.test(dirEntry.name)) {
      continue;
    }

    const backupPath = join(backupDir, dirEntry.name);
    const stats = statSync(backupPath);
    let encrypted = false;
    try {
      const header = readFileSync(backupPath).subarray(0, MAGIC.length + 2);
      if (header.length === MAGIC.length + 2) {
        const magic = header.subarray(0, MAGIC.length);
        const flags = header.readUInt8(MAGIC.length + 1);
        encrypted = magic.equals(MAGIC) && (flags & FLAG_ENCRYPTED) === FLAG_ENCRYPTED;
      }
    } catch {
      encrypted = false;
    }

    backups.push({
      name: dirEntry.name,
      path: backupPath,
      mtimeMs: stats.mtimeMs,
      timestampMs: toUtcTimestampFromFilename(dirEntry.name),
      encrypted,
    });
  }

  backups.sort((a, b) => {
    const at = Number.isFinite(a.timestampMs) ? a.timestampMs : a.mtimeMs;
    const bt = Number.isFinite(b.timestampMs) ? b.timestampMs : b.mtimeMs;
    return bt - at;
  });

  return backups;
}

export function restoreConfigBackup(backupPath: string, passcodeBuffer?: Buffer): void {
  if (!existsSync(backupPath)) {
    throw new Error('Backup file not found.');
  }

  const binary = readFileSync(backupPath);
  const { payload, encrypted } = parseBackupBinary(binary);
  const compressed = parsePayload(payload, encrypted, passcodeBuffer);

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(gunzipSync(compressed).toString('utf-8')) as BackupManifest;
  } catch {
    throw new Error('Backup content is corrupted or invalid.');
  }

  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new Error('Backup manifest is invalid.');
  }

  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(configDir, 0o700);

  for (const entry of manifest.entries) {
    const safePath = sanitizeManifestEntryPath(entry.path);
    const absolutePath = join(configDir, safePath);
    const parent = dirname(absolutePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true, mode: 0o700 });
    }

    const content = Buffer.from(entry.contentBase64, 'base64');
    writeFileSync(absolutePath, content, {
      mode: typeof entry.mode === 'number' ? entry.mode : 0o600,
    });
    chmodSync(absolutePath, typeof entry.mode === 'number' ? entry.mode : 0o600);
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

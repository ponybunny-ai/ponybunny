import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_FILES_TO_MIGRATE = [
  'credentials.json',
  'credentials.schema.json',
  'llm-config.json',
  'llm-config.schema.json',
  'mcp-config.json',
  'mcp-config.schema.json',
  'accounts.json',
  'auth.json',
  'models.json',
  'debug-config.json',
  'prompts',
] as const;

let migrationDone = false;

function resolveHomeDir(): string {
  const homeFromEnv = process.env.HOME;
  if (typeof homeFromEnv === 'string' && homeFromEnv.trim()) {
    return homeFromEnv;
  }
  return os.homedir();
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

function movePath(sourcePath: string, targetPath: string): void {
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch {
    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      fs.rmSync(sourcePath, { recursive: true, force: true });
      return;
    }

    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
  }
}

export function getLegacyConfigDir(): string {
  return path.join(resolveHomeDir(), '.ponybunny');
}

export function getInstallDir(): string {
  return getLegacyConfigDir();
}

export function getConfigDir(): string {
  const override = process.env.PONYBUNNY_CONFIG_DIR;
  if (typeof override === 'string' && override.trim()) {
    if (!fs.existsSync(override)) {
      fs.mkdirSync(override, { recursive: true, mode: 0o700 });
    }
    return override;
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const baseDir =
    typeof xdgConfigHome === 'string' && xdgConfigHome.trim()
      ? xdgConfigHome
      : path.join(resolveHomeDir(), '.config');
  const configDir = path.join(baseDir, 'ponybunny');

  ensureConfigDirMigration(configDir);
  return configDir;
}

export function ensureConfigDirMigration(targetConfigDir?: string): void {
  if (migrationDone) {
    return;
  }

  const destinationDir = targetConfigDir ?? path.join(resolveHomeDir(), '.config', 'ponybunny');
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  }

  const legacyDir = getLegacyConfigDir();
  if (!fs.existsSync(legacyDir)) {
    migrationDone = true;
    return;
  }

  for (const relativeName of CONFIG_FILES_TO_MIGRATE) {
    const sourcePath = path.join(legacyDir, relativeName);
    const targetPath = path.join(destinationDir, relativeName);

    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
      continue;
    }

    const targetParentDir = path.dirname(targetPath);
    if (!fs.existsSync(targetParentDir)) {
      fs.mkdirSync(targetParentDir, { recursive: true, mode: 0o700 });
    }

    movePath(sourcePath, targetPath);
  }

  migrationDone = true;
}

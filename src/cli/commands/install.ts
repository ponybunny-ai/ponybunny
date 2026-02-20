import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

function findPackageRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const pkgPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to locate package.json from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function writeLauncher(installRoot: string): string {
  const binDir = path.join(installRoot, 'bin');
  ensureDirectory(binDir);

  const launcherPath = path.join(binDir, 'pb');
  const script = '#!/usr/bin/env bash\nexec node "$HOME/.ponybunny/app/dist/cli/index.js" "$@"\n';
  fs.writeFileSync(launcherPath, script, { mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);
  return launcherPath;
}

export const installCommand = new Command('install')
  .description('Install pb runtime bundle into ~/.ponybunny')
  .option('-f, --force', 'Overwrite existing ~/.ponybunny/app bundle')
  .option('--dry-run', 'Show what would be installed')
  .action(async (options) => {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const packageRoot = findPackageRoot(moduleDir);

    const sourceDistDir = path.join(packageRoot, 'dist');
    const sourceNodeModules = path.join(packageRoot, 'node_modules');
    const sourcePackageJson = path.join(packageRoot, 'package.json');
    const sourcePromptDefaultsCandidates = [
      path.join(packageRoot, 'dist', 'infra', 'prompts', 'defaults'),
      path.join(packageRoot, 'src', 'infra', 'prompts', 'defaults'),
    ];
    const sourcePromptDefaults = sourcePromptDefaultsCandidates.find(candidate => fs.existsSync(candidate));

    if (!fs.existsSync(sourceDistDir)) {
      throw new Error(`Build output missing: ${sourceDistDir}. Run npm run build:cli first.`);
    }

    const installRoot = path.join(os.homedir(), '.ponybunny');
    const appDir = path.join(installRoot, 'app');
    const targetDistDir = path.join(appDir, 'dist');
    const targetNodeModules = path.join(appDir, 'node_modules');
    const targetPackageJson = path.join(appDir, 'package.json');
    const targetPromptDefaults = path.join(appDir, 'dist', 'infra', 'prompts', 'defaults');

    console.log(chalk.bold('\nInstalling PonyBunny runtime bundle...'));
    console.log(chalk.gray(`Source: ${packageRoot}`));
    console.log(chalk.gray(`Target: ${appDir}\n`));

    if (options.dryRun) {
      console.log(chalk.yellow('Dry run mode - no files will be written\n'));
      console.log(`- dist -> ${targetDistDir}`);
      console.log(`- package.json -> ${targetPackageJson}`);
      console.log(`- node_modules -> ${targetNodeModules}`);
      console.log(`- prompt defaults -> ${targetPromptDefaults}`);
      console.log(`- launcher -> ${path.join(installRoot, 'bin', 'pb')}`);
      return;
    }

    ensureDirectory(installRoot);

    if (fs.existsSync(appDir)) {
      if (!options.force) {
        throw new Error(`Install target already exists: ${appDir} (use --force to overwrite)`);
      }
      fs.rmSync(appDir, { recursive: true, force: true });
    }

    ensureDirectory(appDir);
    copyDirectoryRecursive(sourceDistDir, targetDistDir);
    fs.copyFileSync(sourcePackageJson, targetPackageJson);

    if (fs.existsSync(sourceNodeModules)) {
      copyDirectoryRecursive(sourceNodeModules, targetNodeModules);
    }

    if (sourcePromptDefaults) {
      copyDirectoryRecursive(sourcePromptDefaults, targetPromptDefaults);
    }

    const launcherPath = writeLauncher(installRoot);

    console.log(chalk.green('✓ Installed runtime bundle'));
    console.log(chalk.gray(`  Launcher: ${launcherPath}`));
    console.log(chalk.gray(`  Runtime: ${path.join(installRoot, 'app')}`));
    console.log(chalk.yellow('\nOptional: add ~/.ponybunny/bin to your PATH'));
  });

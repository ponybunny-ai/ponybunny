import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { accountManagerV2, authManagerV2 } from '../lib/auth-manager-v2.js';
import {
  createConfigBackup,
  getRelativeAgeLabel,
  listConfigBackups,
  restoreConfigBackup,
} from '../lib/config-backup.js';

async function showConfig(): Promise<void> {
  const config = authManagerV2.getConfig();
  const isAuth = accountManagerV2.isAuthenticated('codex');
  
  console.log(chalk.cyan('\nCurrent Configuration:\n'));
  console.log(chalk.white('  Authenticated:'), isAuth ? chalk.green('Yes') : chalk.red('No'));
  
  if (config.email) {
    console.log(chalk.white('  Email:'), config.email);
  }
  
  if (config.userId) {
    console.log(chalk.white('  User ID:'), config.userId);
  }
  
  console.log();
}

async function backupConfig(): Promise<void> {
  const { usePasscode } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'usePasscode',
      message: 'Encrypt backup with a passcode?',
      default: false,
    },
  ]);

  let passcodeBuffer: Buffer | undefined;

  try {
    if (usePasscode) {
      const { passcode, confirmPasscode } = await inquirer.prompt([
        {
          type: 'password',
          name: 'passcode',
          message: 'Enter backup passcode:',
          mask: '*',
          validate: (input: string) => input.trim().length > 0 || 'Passcode cannot be empty',
        },
        {
          type: 'password',
          name: 'confirmPasscode',
          message: 'Confirm backup passcode:',
          mask: '*',
          validate: (input: string) => input.trim().length > 0 || 'Passcode cannot be empty',
        },
      ]);

      if (passcode !== confirmPasscode) {
        throw new Error('Passcode confirmation does not match.');
      }

      passcodeBuffer = Buffer.from(passcode, 'utf-8');
    }

    const backupPath = createConfigBackup(passcodeBuffer);
    console.log(chalk.green('\n✓ Config backup created successfully.'));
    console.log(chalk.gray(`  File: ${backupPath}`));
    console.log();
  } finally {
    if (passcodeBuffer) {
      passcodeBuffer.fill(0);
    }
  }
}

async function restoreConfig(): Promise<void> {
  const backups = listConfigBackups();
  if (backups.length === 0) {
    console.log(chalk.yellow('\nNo backup files found in ~/.config/ponybunny/backup\n'));
    return;
  }

  const { selectedBackupPath } = await inquirer.prompt([
    {
      type: 'select',
      name: 'selectedBackupPath',
      message: 'Select a backup to restore (newest first):',
      choices: backups.map((backup) => ({
        name: `${backup.name} (${getRelativeAgeLabel(Number.isFinite(backup.timestampMs) ? backup.timestampMs : backup.mtimeMs)})${backup.encrypted ? ' [encrypted]' : ''}`,
        value: backup.path,
      })),
      loop: false,
      pageSize: 12,
    },
  ]);

  const selected = backups.find((entry) => entry.path === selectedBackupPath);
  if (!selected) {
    throw new Error('Selected backup not found.');
  }

  let passcodeBuffer: Buffer | undefined;

  try {
    if (selected.encrypted) {
      const { passcode } = await inquirer.prompt([
        {
          type: 'password',
          name: 'passcode',
          message: 'Enter backup passcode:',
          mask: '*',
          validate: (input: string) => input.trim().length > 0 || 'Passcode cannot be empty',
        },
      ]);
      passcodeBuffer = Buffer.from(passcode, 'utf-8');
    }

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'This will overwrite current config files (excluding credentials and vault). Continue?',
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.yellow('\nRestore cancelled.\n'));
      return;
    }

    restoreConfigBackup(selected.path, passcodeBuffer);
    console.log(chalk.green(`\n✓ Config restore completed from ${selected.name}`));
    console.log();
  } finally {
    if (passcodeBuffer) {
      passcodeBuffer.fill(0);
    }
  }
}

export const configCommand = new Command('config')
  .description('Manage CLI configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .action(showConfig);

configCommand
  .command('backup')
  .description('Backup config files except credentials and vault')
  .action(backupConfig);

configCommand
  .command('restore')
  .description('Restore config files from a backup')
  .action(restoreConfig);

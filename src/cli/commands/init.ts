import { Command } from 'commander';
import chalk from 'chalk';
import {
  initAllConfigFiles,
  checkMissingConfigFiles,
  getOnboardingFiles,
  getConfigDir,
} from '../../infra/config/onboarding.js';

/**
 * Init command - Initialize PonyBunny configuration files
 */
export const initCommand = new Command('init')
  .description('Initialize PonyBunny configuration files')
  .option('-f, --force', 'Overwrite existing files')
  .option('--dry-run', 'Show what would be created without creating')
  .option('-l, --list', 'List all config files and their status')
  .action(async (options) => {
    const configDir = getConfigDir();

    // List mode
    if (options.list) {
      console.log(chalk.bold('\nPonyBunny Configuration Files'));
      console.log(chalk.gray(`Directory: ${configDir}\n`));

      const files = getOnboardingFiles();
      const missing = checkMissingConfigFiles();
      const missingNames = new Set(missing.map((f) => f.name));

      for (const file of files) {
        const status = missingNames.has(file.name)
          ? chalk.yellow('missing')
          : chalk.green('exists');
        console.log(`  ${status}  ${file.name}`);
        console.log(chalk.gray(`          ${file.description}`));
      }

      if (missing.length > 0) {
        console.log(chalk.yellow(`\nRun ${chalk.bold('pb init')} to create missing files.`));
      } else {
        console.log(chalk.green('\nAll configuration files are present.'));
      }
      return;
    }

    // Init mode
    console.log(chalk.bold('\nInitializing PonyBunny configuration...'));
    console.log(chalk.gray(`Directory: ${configDir}\n`));

    if (options.dryRun) {
      console.log(chalk.yellow('Dry run mode - no files will be created\n'));
    }

    const results = initAllConfigFiles({
      force: options.force,
      dryRun: options.dryRun,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const result of results) {
      let icon: string;
      let color: typeof chalk;

      switch (result.status) {
        case 'created':
          icon = options.dryRun ? '○' : '✓';
          color = chalk.green;
          created++;
          break;
        case 'updated':
          icon = options.dryRun ? '○' : '↺';
          color = chalk.cyan;
          updated++;
          break;
        case 'exists':
          icon = '•';
          color = chalk.gray;
          skipped++;
          break;
        case 'error':
          icon = '✗';
          color = chalk.red;
          errors++;
          break;
      }

      console.log(`  ${color(icon)} ${result.file}`);
      console.log(chalk.gray(`    ${result.message}`));
    }

    console.log('');

    if (errors > 0) {
      console.log(chalk.red(`${errors} file(s) failed to create.`));
    }

    if (created > 0 && !options.dryRun) {
      console.log(chalk.green(`${created} file(s) created.`));
    }

    if (updated > 0) {
      console.log(
        options.dryRun
          ? chalk.cyan(`${updated} file(s) would be updated.`)
          : chalk.cyan(`${updated} file(s) updated.`)
      );
    }

    if (skipped > 0 && !options.force) {
      console.log(
        chalk.gray(`${skipped} file(s) already exist. Use ${chalk.bold('--force')} to overwrite.`)
      );
    }

    // Show next steps
    if (created > 0 || options.dryRun) {
      console.log(chalk.bold('\nNext steps:'));
      console.log(`  1. Edit ${chalk.cyan('~/.ponybunny/credentials.json')} to add your API keys`);
      console.log(`  2. Edit ${chalk.cyan('~/.ponybunny/llm-config.json')} to customize endpoints`);
      console.log(`  3. Run ${chalk.cyan('pb status')} to verify configuration`);
    }
  });

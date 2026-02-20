import { Command } from 'commander';
import chalk from 'chalk';
import { getPromptDoctorReport } from '../../infra/prompts/template-loader.js';

export function createPromptsCommand(): Command {
  const prompts = new Command('prompts').description('Manage prompt templates and diagnostics');

  prompts
    .command('doctor')
    .description('Check prompt template manifest and files')
    .action(async () => {
      const report = getPromptDoctorReport();
      const errorCount = report.issues.filter(issue => issue.severity === 'error').length;
      const warningCount = report.issues.filter(issue => issue.severity === 'warning').length;

      console.log(chalk.bold('\nPrompt Doctor\n'));
      console.log(chalk.gray(`Prompt dir: ${report.promptDir}`));
      console.log(chalk.gray(`Default manifest: ${report.defaultManifestPath}`));
      console.log(chalk.gray(`User manifest: ${report.userManifestPath}`));
      console.log(chalk.gray(`Checked templates: ${report.checkedTemplates}\n`));

      if (report.issues.length === 0) {
        console.log(chalk.green('✓ Prompt templates are healthy.'));
        return;
      }

      for (const issue of report.issues) {
        const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
        const icon = issue.severity === 'error' ? '✗' : '⚠';
        console.log(color(`${icon} [${issue.code}] ${issue.message}`));
      }

      console.log('');
      if (errorCount > 0) {
        console.log(chalk.red(`Errors: ${errorCount}`));
      }
      if (warningCount > 0) {
        console.log(chalk.yellow(`Warnings: ${warningCount}`));
      }

      if (errorCount > 0) {
        process.exitCode = 1;
      }
    });

  return prompts;
}

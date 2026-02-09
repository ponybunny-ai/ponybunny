/**
 * Skills Management CLI Commands
 * pb skills search/install/list/info
 */

import { Command } from 'commander';
import chalk from 'chalk';
import os from 'node:os';
import path from 'node:path';
import { getSkillsShClient } from '../../infra/skills/skills-sh-client.js';
import { getSkillInstaller } from '../../infra/skills/skill-installer.js';
import { getGlobalSkillRegistry } from '../../infra/skills/skill-registry.js';

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description('Manage skills from skills.sh marketplace');

  // pb skills search <query>
  skills
    .command('search')
    .description('Search for skills on skills.sh')
    .argument('<query>', 'Search query')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('-a, --author <author>', 'Filter by author')
    .action(async (query: string, options) => {
      try {
        console.log(chalk.blue(`🔍 Searching skills.sh for: "${query}"`));

        const client = getSkillsShClient();
        const result = await client.searchSkills({
          query,
          limit: parseInt(options.limit),
          tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined,
          author: options.author,
        });

        if (result.skills.length === 0) {
          console.log(chalk.yellow('No skills found.'));
          return;
        }

        console.log(chalk.green(`\n✨ Found ${result.total} skill(s):\n`));

        for (const [index, skill] of result.skills.entries()) {
          console.log(chalk.bold(`${index + 1}. ${skill.name}`));
          console.log(`   ${chalk.gray(skill.description)}`);
          if (skill.author) {
            console.log(`   ${chalk.cyan(`Author: ${skill.author}`)}`);
          }
          if (skill.tags && skill.tags.length > 0) {
            console.log(`   ${chalk.magenta(`Tags: ${skill.tags.join(', ')}`)}`);
          }
          console.log(`   ${chalk.blue(skill.url)}`);
          console.log();
        }

        console.log(chalk.gray(`\nTo install a skill, use: ${chalk.white('pb skills install <skill-path>')}`));
      } catch (error) {
        console.error(chalk.red('❌ Search failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // pb skills install <path>
  skills
    .command('install')
    .description('Install a skill from skills.sh')
    .argument('<path>', 'Skill path (e.g., vercel-labs/skills/find-skills)')
    .option('-f, --force', 'Overwrite if already installed')
    .action(async (skillPath: string, options) => {
      try {
        console.log(chalk.blue(`📥 Installing skill: ${skillPath}`));

        const installer = getSkillInstaller();
        const managedSkillsDir = path.join(os.homedir(), '.ponybunny', 'skills');

        const result = await installer.installSkillByPath(skillPath, {
          managedSkillsDir,
          overwrite: options.force,
        });

        if (!result.success) {
          console.error(chalk.red(`❌ Installation failed: ${result.error}`));
          process.exit(1);
        }

        if (result.skipped) {
          console.log(chalk.yellow(`⚠️  Skill already installed: ${result.skillName}`));
          console.log(chalk.gray(`   Use --force to overwrite`));
          console.log(chalk.gray(`   Path: ${result.path}`));
        } else {
          console.log(chalk.green(`✅ Successfully installed: ${result.skillName}`));
          console.log(chalk.gray(`   Path: ${result.path}`));
        }
      } catch (error) {
        console.error(chalk.red('❌ Installation failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // pb skills list
  skills
    .command('list')
    .description('List installed skills')
    .option('-s, --source <source>', 'Filter by source (workspace|managed|bundled|extra)')
    .option('-p, --phase <phase>', 'Filter by phase')
    .option('--stats', 'Show statistics')
    .action(async (options) => {
      try {
        const registry = getGlobalSkillRegistry();

        // Load skills
        const workspaceDir = process.cwd();
        const managedSkillsDir = path.join(os.homedir(), '.ponybunny', 'skills');
        const bundledSkillsDir = path.join(process.cwd(), 'skills');

        await registry.loadSkills({
          workspaceDir,
          managedSkillsDir,
          bundledSkillsDir,
        });

        let skills = registry.getSkills();

        // Apply filters
        if (options.source) {
          skills = skills.filter(s => s.source === options.source);
        }
        if (options.phase) {
          skills = skills.filter(s =>
            !s.metadata.phases || s.metadata.phases.includes(options.phase)
          );
        }

        if (skills.length === 0) {
          console.log(chalk.yellow('No skills found.'));
          return;
        }

        console.log(chalk.green(`\n📦 Installed Skills (${skills.length}):\n`));

        for (const skill of skills) {
          console.log(chalk.bold(skill.name));
          console.log(`   ${chalk.gray(skill.description)}`);
          console.log(`   ${chalk.cyan(`Source: ${skill.source}`)}`);
          if (skill.metadata.phases && skill.metadata.phases.length > 0) {
            console.log(`   ${chalk.magenta(`Phases: ${skill.metadata.phases.join(', ')}`)}`);
          }
          if (skill.metadata.tags && skill.metadata.tags.length > 0) {
            console.log(`   ${chalk.blue(`Tags: ${skill.metadata.tags.join(', ')}`)}`);
          }
          console.log(`   ${chalk.gray(`Path: ${skill.baseDir}`)}`);
          console.log();
        }

        // Show stats if requested
        if (options.stats) {
          const stats = registry.getStats();
          console.log(chalk.green('📊 Statistics:'));
          console.log(`   Total: ${stats.total}`);
          console.log(`   By Source:`);
          for (const [source, count] of Object.entries(stats.bySource)) {
            if (count > 0) {
              console.log(`     ${source}: ${count}`);
            }
          }
          console.log(`   User-invocable: ${stats.userInvocable}`);
          console.log(`   Model-invocable: ${stats.modelInvocable}`);
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to list skills:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // pb skills info <name>
  skills
    .command('info')
    .description('Show detailed information about a skill')
    .argument('<name>', 'Skill name')
    .action(async (name: string) => {
      try {
        const registry = getGlobalSkillRegistry();

        // Load skills
        const workspaceDir = process.cwd();
        const managedSkillsDir = path.join(os.homedir(), '.ponybunny', 'skills');
        const bundledSkillsDir = path.join(process.cwd(), 'skills');

        await registry.loadSkills({
          workspaceDir,
          managedSkillsDir,
          bundledSkillsDir,
        });

        const skill = registry.getSkill(name);
        if (!skill) {
          console.log(chalk.yellow(`Skill not found: ${name}`));
          process.exit(1);
        }

        console.log(chalk.green(`\n📄 Skill: ${skill.name}\n`));
        console.log(chalk.bold('Description:'));
        console.log(`  ${skill.description}\n`);

        console.log(chalk.bold('Metadata:'));
        console.log(`  Source: ${chalk.cyan(skill.source)}`);
        if (skill.metadata.version) {
          console.log(`  Version: ${skill.metadata.version}`);
        }
        if (skill.metadata.author) {
          console.log(`  Author: ${skill.metadata.author}`);
        }
        if (skill.metadata.tags && skill.metadata.tags.length > 0) {
          console.log(`  Tags: ${chalk.blue(skill.metadata.tags.join(', '))}`);
        }
        if (skill.metadata.phases && skill.metadata.phases.length > 0) {
          console.log(`  Phases: ${chalk.magenta(skill.metadata.phases.join(', '))}`);
        }
        console.log(`  User-invocable: ${skill.metadata.userInvocable !== false ? 'Yes' : 'No'}`);
        console.log(`  Model-invocable: ${!skill.metadata.disableModelInvocation ? 'Yes' : 'No'}`);
        if (skill.metadata.requiresApproval) {
          console.log(`  ${chalk.yellow('⚠️  Requires Approval')}`);
        }

        console.log(chalk.bold('\nLocation:'));
        console.log(`  ${chalk.gray(skill.filePath)}`);

        // Load and display content preview
        const content = await registry.loadSkillContent(name);
        const lines = content.split('\n');
        const previewLines = lines.slice(0, 20);

        console.log(chalk.bold('\nContent Preview:'));
        console.log(chalk.gray('  ' + previewLines.join('\n  ')));
        if (lines.length > 20) {
          console.log(chalk.gray(`  ... (${lines.length - 20} more lines)`));
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to get skill info:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

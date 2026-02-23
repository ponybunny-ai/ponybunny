import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AgentRegistry } from '../../infra/agents/agent-registry.js';
import { getConfigDir } from '../../infra/config/config-paths.js';
import { loadRuntimeConfig, saveRuntimeConfig } from '../../infra/config/runtime-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PONY_PID_DIR = join(homedir(), '.ponybunny');
const SCHEDULER_PID_FILE = join(PONY_PID_DIR, 'scheduler.pid');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listAgentIds(baseDir: string): string[] {
  if (!existsSync(baseDir)) {
    return [];
  }

  const entries = readdirSync(baseDir)
    .filter((entry) => {
      const agentDir = join(baseDir, entry);
      if (!statSync(agentDir).isDirectory()) {
        return false;
      }

      return existsSync(join(agentDir, 'agent.json')) && existsSync(join(agentDir, 'AGENT.md'));
    })
    .sort((a, b) => a.localeCompare(b));

  return entries;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectDiffPaths(
  left: unknown,
  right: unknown,
  prefix: string,
  output: string[]
): void {
  if (left === right) {
    return;
  }

  if (typeof left !== typeof right) {
    output.push(prefix);
    return;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      output.push(prefix);
    }
    return;
  }

  if (
    typeof left !== 'object'
    || left === null
    || typeof right !== 'object'
    || right === null
  ) {
    output.push(prefix);
    return;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keySet = new Set<string>([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);

  for (const key of Array.from(keySet).sort((a, b) => a.localeCompare(b))) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (!(key in leftRecord) || !(key in rightRecord)) {
      output.push(nextPrefix);
      continue;
    }

    collectDiffPaths(leftRecord[key], rightRecord[key], nextPrefix, output);
  }
}

function restartSchedulerIfRunning(config: ReturnType<typeof loadRuntimeConfig>): void {
  if (!existsSync(SCHEDULER_PID_FILE)) {
    return;
  }

  let pid = 0;
  try {
    const pidInfo = JSON.parse(readFileSync(SCHEDULER_PID_FILE, 'utf-8')) as { pid?: number };
    pid = pidInfo.pid ?? 0;
  } catch {
    return;
  }

  if (!pid || !isProcessRunning(pid)) {
    return;
  }

  const cliPath = join(__dirname, '../index.js');
  spawnSync(process.execPath, [cliPath, 'scheduler', 'stop'], { stdio: 'inherit' });

  const startArgs = [
    cliPath,
    'scheduler',
    'start',
    '--db',
    config.paths.database,
    '--socket',
    config.paths.schedulerSocket,
    '--main-agent',
    config.agent.mainAgentId,
  ];

  if (config.scheduler.agentsEnabled) {
    startArgs.push('--agents');
  }

  if (config.agent.personaEnabled) {
    startArgs.push('--persona');
  }

  spawnSync(process.execPath, startArgs, { stdio: 'inherit' });
}

export const agentCommand = new Command('agent')
  .description('Manage PonyBunny main agent and user agent overrides')
  .addCommand(
    new Command('list')
      .description('List built-in and user agent configurations')
      .action(async () => {
        const registry = new AgentRegistry();
        await registry.loadAgents({ workspaceDir: process.cwd() });

        const config = loadRuntimeConfig();
        const systemIds = listAgentIds(join(process.cwd(), 'agents'));
        const userIds = listAgentIds(join(getConfigDir(), 'agents'));
        const unionIds = Array.from(new Set([...systemIds, ...userIds])).sort((a, b) => a.localeCompare(b));

        console.log(chalk.bold('\nAgent Configurations\n'));
        for (const id of unionIds) {
          const definition = registry.getAgent(id);
          const isMain = id === config.agent.mainAgentId;
          const hasSystem = systemIds.includes(id);
          const hasUser = userIds.includes(id);
          const source = hasUser ? 'user' : hasSystem ? 'system' : 'unknown';

          console.log(`${isMain ? chalk.green('●') : chalk.gray('○')} ${chalk.cyan(id)} (${source})`);
          if (definition) {
            console.log(chalk.gray(`   enabled=${definition.config.enabled} type=${definition.config.type}`));
          }
        }

        console.log(chalk.gray(`\nMain agent: ${config.agent.mainAgentId}`));
        console.log(chalk.gray(`Persona: ${config.agent.personaEnabled ? 'enabled' : 'disabled'}`));
      })
  )
  .addCommand(
    new Command('use')
      .description('Select which agent runs as main agent')
      .argument('<id>', 'Agent ID')
      .action(async (id: string) => {
        const registry = new AgentRegistry();
        await registry.loadAgents({ workspaceDir: process.cwd() });
        if (!registry.hasAgent(id)) {
          console.error(chalk.red(`Agent not found: ${id}`));
          process.exit(1);
        }

        const config = loadRuntimeConfig();
        config.agent.mainAgentId = id;
        config.scheduler.agentsEnabled = true;
        saveRuntimeConfig(config);

        console.log(chalk.green(`✓ Main agent set to '${id}' in ~/.config/ponybunny/ponybunny.json`));
        restartSchedulerIfRunning(config);
      })
  )
  .addCommand(
    new Command('customize')
      .description('Copy built-in agent config to user config for customization')
      .argument('<id>', 'Agent ID')
      .option('-f, --force', 'Overwrite existing user override')
      .action((id: string, options: { force?: boolean }) => {
        const sourceDir = join(process.cwd(), 'agents', id);
        const sourceJson = join(sourceDir, 'agent.json');
        const sourceMarkdown = join(sourceDir, 'AGENT.md');
        if (!existsSync(sourceJson) || !existsSync(sourceMarkdown)) {
          console.error(chalk.red(`Built-in agent not found: ${id}`));
          process.exit(1);
        }

        const userDir = join(getConfigDir(), 'agents', id);
        const targetJson = join(userDir, 'agent.json');
        const targetMarkdown = join(userDir, 'AGENT.md');

        if ((existsSync(targetJson) || existsSync(targetMarkdown)) && !options.force) {
          console.error(chalk.yellow(`User override already exists for '${id}'. Use --force to overwrite.`));
          process.exit(1);
        }

        mkdirSync(userDir, { recursive: true, mode: 0o700 });
        copyFileSync(sourceJson, targetJson);
        copyFileSync(sourceMarkdown, targetMarkdown);

        console.log(chalk.green(`✓ Copied agent '${id}' to ${userDir}`));
      })
  )
  .addCommand(
    new Command('status')
      .description('Show current main agent and user/system diff status')
      .action(() => {
        const config = loadRuntimeConfig();
        const id = config.agent.mainAgentId;

        const systemPath = join(process.cwd(), 'agents', id, 'agent.json');
        const userPath = join(getConfigDir(), 'agents', id, 'agent.json');
        const systemConfig = readJsonFile(systemPath);
        const userConfig = readJsonFile(userPath);

        console.log(chalk.bold('\nAgent Runtime Status\n'));
        console.log(chalk.white(`Main agent: ${chalk.cyan(id)}`));
        console.log(chalk.white(`Scheduler agents: ${config.scheduler.agentsEnabled ? 'enabled' : 'disabled'}`));
        console.log(chalk.white(`Persona: ${config.agent.personaEnabled ? 'enabled' : 'disabled'}`));
        console.log(chalk.white(`System config: ${existsSync(systemPath) ? systemPath : 'missing'}`));
        console.log(chalk.white(`User override: ${existsSync(userPath) ? userPath : 'not present'}`));

        if (systemConfig && userConfig) {
          const diffPaths: string[] = [];
          collectDiffPaths(systemConfig, userConfig, '', diffPaths);

          if (diffPaths.length === 0) {
            console.log(chalk.green('\nNo user/system differences for current main agent.'));
            return;
          }

          console.log(chalk.yellow(`\nUser override differs in ${diffPaths.length} path(s):`));
          for (const pathEntry of diffPaths.slice(0, 20)) {
            console.log(chalk.gray(` - ${pathEntry}`));
          }
          if (diffPaths.length > 20) {
            console.log(chalk.gray(` - ... and ${diffPaths.length - 20} more`));
          }
        }
      })
  );

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { probeAndPersistAvailability } from '../../infra/llm/provider-manager/availability-prober.js';
import { loadLLMConfig } from '../../infra/llm/provider-manager/config-loader.js';
import { getAllEndpointConfigs, hasRequiredCredentials } from '../../infra/llm/endpoints/index.js';
import type { EndpointConfig } from '../../infra/llm/endpoints/index.js';

export function isEndpointEffectivelyEnabled(
  endpointId: string,
  llmConfigEnabled: boolean,
  endpointConfigMap: Map<string, EndpointConfig>
): boolean {
  if (!llmConfigEnabled) {
    return false;
  }

  const endpoint = endpointConfigMap.get(endpointId);
  if (!endpoint) {
    return llmConfigEnabled;
  }

  return hasRequiredCredentials(endpoint);
}

export const modelsCommand = new Command('models');

modelsCommand
  .description('Manage model lists')
  .addHelpText('after', `
Examples:
  $ pb models list         List models from llm-config
  $ pb models probe        Probe enabled endpoints/models and persist health
`);

modelsCommand
  .command('list')
  .description('List models from ~/.config/ponybunny/llm-config.json')
  .action(async () => {
    try {
      const config = loadLLMConfig();
      const endpointConfigMap = new Map(getAllEndpointConfigs().map((endpoint) => [endpoint.id, endpoint]));
      const endpointIds = Object.keys(config.providers).sort((a, b) => a.localeCompare(b));
      const modelIds = Object.keys(config.models).sort((a, b) => a.localeCompare(b));

      console.log(chalk.cyan('\n📋 Endpoints'));
      for (const endpointId of endpointIds) {
        const endpoint = config.providers[endpointId];
        const healthMark = endpoint.health?.available === true
          ? chalk.green('available')
          : endpoint.health
            ? chalk.red('unavailable')
            : chalk.gray('unknown');
        const enabledMark = isEndpointEffectivelyEnabled(endpointId, endpoint.enabled, endpointConfigMap)
          ? chalk.green('enabled')
          : chalk.gray('disabled');
        console.log(`  - ${chalk.white(endpointId)} (${enabledMark}, ${healthMark})`);
      }

      console.log(chalk.cyan('\n📋 Models'));
      for (const modelId of modelIds) {
        const model = config.models[modelId];
        const availableEndpoints = Object.entries(model.health?.providers ?? {})
          .filter(([, value]) => value.available)
          .map(([id]) => id);
        const availability = availableEndpoints.length > 0
          ? chalk.green(`available on ${availableEndpoints.join(', ')}`)
          : model.health
            ? chalk.red('unavailable on probed endpoints')
            : chalk.gray('not probed');

        console.log(`  - ${chalk.white(modelId)} (${chalk.gray(model.displayName)})`);
        console.log(chalk.gray(`    providers: ${model.providers.join(', ')}`));
        console.log(chalk.gray(`    status: ${availability}`));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red(`Failed to list models: ${(error as Error).message}`));
      process.exit(1);
    }
  });

modelsCommand
  .command('probe')
  .description('Probe enabled provider endpoints/models and write availability back to llm-config.json')
  .option('--timeout <ms>', 'Probe timeout per request in milliseconds', '10000')
  .option('--max-models <n>', 'Maximum models to probe per endpoint', '20')
  .action(async (options) => {
    const timeoutMs = Number.parseInt(options.timeout, 10);
    const maxModelsPerEndpoint = Number.parseInt(options.maxModels, 10);

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      console.error(chalk.red('Invalid --timeout value; must be a positive integer.'));
      process.exit(1);
    }

    if (!Number.isFinite(maxModelsPerEndpoint) || maxModelsPerEndpoint <= 0) {
      console.error(chalk.red('Invalid --max-models value; must be a positive integer.'));
      process.exit(1);
    }

    const spinner = ora('Probing enabled endpoints/models...').start();
    try {
      const summary = await probeAndPersistAvailability({ timeoutMs, maxModelsPerEndpoint });
      spinner.succeed('LLM availability probe completed');

      console.log(chalk.cyan('\nProbe Summary:'));
      console.log(chalk.white(`  Checked at: ${summary.checkedAt}`));
      console.log(chalk.white(`  Enabled endpoints: ${summary.endpointCount}`));
      console.log(chalk.white(`  Endpoint checks passed: ${summary.endpointAvailable}`));
      console.log(chalk.white(`  Model-endpoint checks: ${summary.modelEndpointChecks}`));
      console.log(chalk.white(`  Model-endpoint available: ${summary.modelEndpointAvailable}`));

      if (summary.failures.length > 0) {
        console.log(chalk.yellow('\nRecent failures (first 10):'));
        for (const failure of summary.failures.slice(0, 10)) {
          console.log(chalk.gray(`  - ${failure.endpointId} / ${failure.modelId}: ${failure.error}`));
        }
      }

      console.log(chalk.green('\n✓ Probe results written to ~/.config/ponybunny/llm-config.json\n'));
    } catch (error) {
      spinner.fail('LLM availability probe failed');
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

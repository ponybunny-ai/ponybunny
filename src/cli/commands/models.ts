import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { probeAndPersistAvailability } from '../../infra/llm/provider-manager/availability-prober.js';
import { loadLLMConfig } from '../../infra/llm/provider-manager/config-loader.js';
import { getLLMProviderManager } from '../../infra/llm/provider-manager/index.js';
import type { LLMMessage } from '../../infra/llm/llm-provider.js';

interface ProviderTreeNode {
  providerId: string;
  enabled: boolean;
  protocol: string;
  type?: string;
  priority?: number;
  models: string[];
}

interface ModelTestMetadata {
  requestedAt: string;
  firstTokenLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface ModelTestTurnResult {
  ok: boolean;
  metadata?: ModelTestMetadata;
  errorMessage?: string;
}

interface ModelTestTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ModelTestManager {
  completeWithModel: ReturnType<typeof getLLMProviderManager>['completeWithModel'];
  estimateCost: ReturnType<typeof getLLMProviderManager>['estimateCost'];
}

function resolveModelProviders(modelId: string, modelConfig: Record<string, unknown>): string[] {
  const providers = Array.isArray(modelConfig.providers)
    ? modelConfig.providers.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (providers.length > 0) {
    return providers;
  }

  const dotIndex = modelId.indexOf('.');
  if (dotIndex > 0) {
    return [modelId.slice(0, dotIndex)];
  }

  return [];
}

export function buildProviderTree(
  config: ReturnType<typeof loadLLMConfig>,
  all: boolean
): ProviderTreeNode[] {
  const providerIds = Object.keys(config.providers)
    .filter((providerId) => all || config.providers[providerId]?.enabled === true)
    .sort((a, b) => a.localeCompare(b));

  const modelMap = new Map<string, string[]>();
  for (const modelId of Object.keys(config.models)) {
    const modelConfig = config.models[modelId] as unknown as Record<string, unknown>;
    const providers = resolveModelProviders(modelId, modelConfig);
    for (const providerId of providers) {
      if (!modelMap.has(providerId)) {
        modelMap.set(providerId, []);
      }
      modelMap.get(providerId)?.push(modelId);
    }
  }

  return providerIds.map((providerId) => {
    const endpoint = config.providers[providerId];
    const models = (modelMap.get(providerId) || []).sort((a, b) => a.localeCompare(b));
    return {
      providerId,
      enabled: endpoint.enabled === true,
      protocol: endpoint.protocol,
      type: endpoint.type,
      priority: endpoint.priority,
      models,
    };
  });
}

export function renderProviderTree(nodes: ProviderTreeNode[]): string[] {
  const lines: string[] = [];
  lines.push(chalk.cyan('\n📋 Providers & Models'));

  if (nodes.length === 0) {
    lines.push(chalk.gray('  (no providers)'));
    return lines;
  }

  lines.push('providers');
  nodes.forEach((node, providerIndex) => {
    const isLastProvider = providerIndex === nodes.length - 1;
    const providerBranch = isLastProvider ? '└─' : '├─';
    const enabledLabel = node.enabled ? chalk.green('enabled') : chalk.gray('disabled');
    const protocolLabel = node.protocol ? chalk.white(node.protocol) : chalk.gray('unknown');
    const typeLabel = node.type ? chalk.white(node.type) : chalk.gray('unknown');
    const priorityLabel = Number.isFinite(node.priority) ? chalk.white(String(node.priority)) : chalk.gray('unknown');

    lines.push(
      `${providerBranch} ${chalk.white(node.providerId)} (${enabledLabel}, ${protocolLabel}, ${typeLabel}, ${priorityLabel})`
    );

    node.models.forEach((modelId, modelIndex) => {
      const isLastModel = modelIndex === node.models.length - 1;
      const modelPrefix = isLastProvider ? '   ' : '│  ';
      const modelBranch = isLastModel ? '└─' : '├─';
      lines.push(`${modelPrefix}${modelBranch} ${chalk.gray(modelId)}`);
    });
  });

  return lines;
}

export function buildModelTestMetadata(
  requestedAtMs: number,
  firstTokenAtMs: number | null,
  tokenUsage: ModelTestTokenUsage,
  estimatedCostUsd: number | null
): ModelTestMetadata {
  const inputTokens = Math.max(0, tokenUsage.inputTokens || 0);
  const outputTokens = Math.max(0, tokenUsage.outputTokens || 0);
  const totalTokens = Math.max(0, tokenUsage.totalTokens || (inputTokens + outputTokens));
  return {
    requestedAt: new Date(requestedAtMs).toISOString(),
    firstTokenLatencyMs: firstTokenAtMs === null ? null : Math.max(0, firstTokenAtMs - requestedAtMs),
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
  };
}

export async function runModelTestTurn(
  manager: ModelTestManager,
  modelId: string,
  messages: LLMMessage[],
  userInput: string,
  writeChunk: (text: string) => void
): Promise<ModelTestTurnResult> {
  messages.push({ role: 'user', content: userInput });

  const requestedAt = Date.now();
  let firstTokenAt: number | null = null;
  let emittedChunkCount = 0;

  async function completeStreaming(): Promise<import('../../infra/llm/llm-provider.js').LLMResponse> {
    return manager.completeWithModel(modelId, messages, {
      stream: true,
      onChunk: (chunk) => {
        if (firstTokenAt === null) {
          firstTokenAt = Date.now();
        }
        emittedChunkCount += 1;
        writeChunk(chunk);
      },
    });
  }

  async function completeNonStreaming(): Promise<import('../../infra/llm/llm-provider.js').LLMResponse> {
    const response = await manager.completeWithModel(modelId, messages, {
      stream: false,
    });
    if (firstTokenAt === null) {
      firstTokenAt = Date.now();
    }
    if (response.content) {
      writeChunk(response.content);
    }
    return response;
  }

  try {
    let response: import('../../infra/llm/llm-provider.js').LLMResponse;
    try {
      response = await completeStreaming();
    } catch (streamError) {
      if (emittedChunkCount > 0) {
        throw streamError;
      }
      response = await completeNonStreaming();
    }

    const assistantContent = response.content || '';
    messages.push({ role: 'assistant', content: assistantContent });

    const normalizedTokenUsage: ModelTestTokenUsage = response.tokenUsage
      ? {
        inputTokens: Math.max(0, response.tokenUsage.inputTokens || 0),
        outputTokens: Math.max(0, response.tokenUsage.outputTokens || 0),
        totalTokens: Math.max(
          0,
          response.tokenUsage.totalTokens || (response.tokenUsage.inputTokens || 0) + (response.tokenUsage.outputTokens || 0)
        ),
      }
      : {
        inputTokens: 0,
        outputTokens: Math.max(0, response.tokensUsed || 0),
        totalTokens: Math.max(0, response.tokensUsed || 0),
      };
    let estimatedCostUsd: number | null = null;
    try {
      estimatedCostUsd = manager.estimateCost(
        modelId,
        normalizedTokenUsage.inputTokens,
        normalizedTokenUsage.outputTokens
      );
    } catch {
      estimatedCostUsd = null;
    }

    const metadata = buildModelTestMetadata(
      requestedAt,
      firstTokenAt,
      normalizedTokenUsage,
      estimatedCostUsd
    );
    return { ok: true, metadata };
  } catch (error) {
    messages.pop();
    return {
      ok: false,
      errorMessage: (error as Error).message,
    };
  }
}

export const modelsCommand = new Command('models');

modelsCommand
  .description('Manage model lists')
  .addHelpText('after', `
Examples:
  $ pb models list         List models from llm-config
  $ pb models probe        Probe enabled endpoints/models and persist health
  $ pb models test openai.gpt-5.2
`);

modelsCommand
  .command('list')
  .description('List models from ~/.config/ponybunny/llm-config.json')
  .option('--all', 'Show all providers, including disabled ones', false)
  .action(async (options) => {
    try {
      const config = loadLLMConfig();
      const nodes = buildProviderTree(config, Boolean(options.all));
      const lines = renderProviderTree(nodes);
      for (const line of lines) {
        console.log(line);
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
          const modelLabel = failure.sourceModelId && failure.sourceModelId !== failure.modelId
            ? `${failure.modelId} (from ${failure.sourceModelId})`
            : failure.modelId;
          console.log(chalk.gray(`  - ${failure.endpointId} / ${modelLabel}: ${failure.error}`));
        }
      }

      console.log(chalk.green('\n✓ Probe results written to ~/.config/ponybunny/llm-config.json\n'));
    } catch (error) {
      spinner.fail('LLM availability probe failed');
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

modelsCommand
  .command('test <modelId>')
  .description('Interactive streaming chat test for a specific provider.model')
  .action(async (modelId: string) => {
    const manager = getLLMProviderManager();
    const modelConfig = manager.getModelConfig(modelId);
    if (!modelConfig) {
      console.error(chalk.red(`Unknown model: ${modelId}`));
      process.exit(1);
    }

    const messages: LLMMessage[] = [];
    const rl = createInterface({ input, output });
    let exiting = false;

    const onSigint = () => {
      if (exiting) {
        return;
      }
      exiting = true;
      console.log(chalk.gray('\nExiting model test...'));
      rl.close();
    };

    process.on('SIGINT', onSigint);

    try {
      console.log(chalk.cyan(`\nInteractive model test started: ${modelId}`));
      console.log(chalk.gray('Type your message and press Enter. Use /exit or Ctrl-C to quit.\n'));

      while (!exiting) {
        const userInput = (await rl.question(chalk.white('you> '))).trim();
        if (!userInput) {
          continue;
        }

        if (userInput === '/exit') {
          exiting = true;
          break;
        }

        try {
          process.stdout.write(chalk.green('ai> '));

          const turn = await runModelTestTurn(
            manager,
            modelId,
            messages,
            userInput,
            (chunk) => process.stdout.write(chunk)
          );

          process.stdout.write('\n');

          if (!turn.ok) {
            console.error(chalk.red(`request failed: ${turn.errorMessage || 'unknown error'}`));
            console.log(chalk.gray('you can continue or type /exit\n'));
            continue;
          }

          const metadata = turn.metadata;
          if (!metadata) {
            console.error(chalk.red('request failed: missing metadata'));
            console.log(chalk.gray('you can continue or type /exit\n'));
            continue;
          }

          const costLabel = metadata.estimatedCostUsd === null
            ? 'N/A'
            : `$${metadata.estimatedCostUsd.toFixed(6)}`;
          const ttfbLabel = metadata.firstTokenLatencyMs === null
            ? 'N/A'
            : `${metadata.firstTokenLatencyMs}ms`;

          console.log(chalk.gray('\nmetadata:'));
          console.log(chalk.gray(`  requestedAt: ${metadata.requestedAt}`));
          console.log(chalk.gray(`  firstTokenLatencyMs: ${ttfbLabel}`));
          console.log(chalk.gray(`  inputTokens: ${metadata.inputTokens}`));
          console.log(chalk.gray(`  outputTokens: ${metadata.outputTokens}`));
          console.log(chalk.gray(`  totalTokens: ${metadata.totalTokens}`));
          console.log(chalk.gray(`  estimatedCostUsd: ${costLabel}\n`));
        } catch (error) {
          process.stdout.write('\n');
          console.error(chalk.red(`request failed: ${(error as Error).message}`));
          console.log(chalk.gray('you can continue or type /exit\n'));
          continue;
        }
      }

      console.log(chalk.gray('Model test ended.\n'));
    } catch (error) {
      console.error(chalk.red(`Model test failed: ${(error as Error).message}`));
      process.exitCode = 1;
    } finally {
      process.off('SIGINT', onSigint);
      rl.close();
    }
  });

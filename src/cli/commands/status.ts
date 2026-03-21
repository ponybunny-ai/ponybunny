import chalk from 'chalk';
import type { AccountProvider } from '../lib/account-types.js';
import { accountManagerV2, authManagerV2 } from '../lib/auth-manager-v2.js';
import { getCachedCredentials, getCachedEndpointCredential } from '../../infra/config/credentials-loader.js';
import { getAllEndpointConfigs, hasRequiredCredentials } from '../../infra/llm/endpoints/index.js';
import type { EndpointConfig, EndpointId } from '../../infra/llm/endpoints/index.js';
import { loadLLMConfig } from '../../infra/llm/provider-manager/config-loader.js';
import { testOpenAIProtocolConnection } from '../../infra/llm/provider-manager/openai-model-catalog.js';
import { getLLMService } from '../../infra/llm/llm-service.js';

function providerDisplayName(provider: AccountProvider): string {
  switch (provider) {
    case 'codex':
      return 'OpenAI';
    case 'openai-compatible':
      return 'OpenAI-Compatible';
    case 'antigravity':
      return 'Google';
  }
}

function hasCredentialFields(endpointId: EndpointId): boolean {
  const credential = getCachedEndpointCredential(endpointId);
  if (!credential) {
    return false;
  }

  return Object.values(credential).some((value) => !!value);
}

function isEndpointEnabled(endpointId: EndpointId): boolean {
  const llmConfig = loadLLMConfig();
  if (llmConfig.providers[endpointId]?.enabled !== true) {
    return false;
  }

  const endpoint = getAllEndpointConfigs().find((item) => item.id === endpointId);
  if (!endpoint) {
    return false;
  }

  return hasCredentialFields(endpointId) || hasRequiredCredentials(endpoint);
}

function listOtherEnabledProviders(): string[] {
  return getAllEndpointConfigs()
    .filter((endpoint) => endpoint.id !== 'codex' && endpoint.id !== 'openai-compatible')
    .filter((endpoint) => isEndpointEnabled(endpoint.id))
    .map((endpoint) => endpoint.displayName);
}

function listOtherEnabledEndpointConfigs(): EndpointConfig[] {
  return getAllEndpointConfigs()
    .filter((endpoint) => endpoint.id !== 'codex' && endpoint.id !== 'openai-compatible')
    .filter((endpoint) => isEndpointEnabled(endpoint.id));
}

function resolveOpenAICompatibleConfig(): { apiKey: string; baseUrl: string } | null {
  const credential = getCachedEndpointCredential('openai-compatible');
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || credential?.apiKey;
  const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL || credential?.baseUrl || OPENAI_DEFAULT_BASE_URL;

  if (!apiKey) {
    return null;
  }

  return { apiKey, baseUrl: baseUrl.replace(/\/$/, '') };
}

async function testOpenAICompatibleConnection(): Promise<void> {
  const config = resolveOpenAICompatibleConfig();
  if (!config) {
    throw new Error('OPENAI_COMPATIBLE_API_KEY is missing');
  }

  await testOpenAIProtocolConnection(config.baseUrl, config.apiKey);
}

async function testProvider(endpoint: EndpointConfig): Promise<void> {
  if (endpoint.id === 'openai-compatible') {
    await testOpenAICompatibleConnection();
    return;
  }

  if (!hasRequiredCredentials(endpoint)) {
    throw new Error('Required credentials missing');
  }
}

export async function statusCommand(): Promise<void> {
  console.log(chalk.cyan('\n🔍 PonyBunny Status\n'));

  const isAuth = authManagerV2.isAuthenticated();
  const hasOpenAICompatible = isEndpointEnabled('openai-compatible');
  const enabledOtherProviders = listOtherEnabledProviders();
  const enabledOtherEndpoints = listOtherEnabledEndpointConfigs();
  const hasEnabledProviders = isAuth || hasOpenAICompatible || enabledOtherProviders.length > 0;

  console.log(chalk.white('Enabled providers:'), hasEnabledProviders ? chalk.green('✓ Found') : chalk.red('✗ None'));

  if (isAuth) {
    const config = authManagerV2.getConfig();
    const account = accountManagerV2.getCurrentAccount('codex');
    const providerName = providerDisplayName(account?.provider ?? 'codex');
    console.log(chalk.white('\n- OpenAI OAuth'));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
    console.log(chalk.white('  Provider:'), providerName);
    console.log(chalk.white('  User:'), config.email || config.userId || 'Unknown');
  }

  if (hasOpenAICompatible) {
    console.log(chalk.white('\n- OpenAI-Compatible'));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
  }

  for (const providerName of enabledOtherProviders) {
    console.log(chalk.white(`\n- ${providerName}`));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
  }

  if (hasEnabledProviders) {
    console.log(chalk.white('\nTesting enabled providers...'));

    if (isAuth) {
      try {
        const llmService = getLLMService();
        await llmService.complete(
          [{ role: 'user', content: 'Say "OK"' }],
          {
            model: 'openai-codex.gpt-5.2-codex',
            maxTokens: 16,
            timeout: 30000,
          }
        );
        console.log(chalk.green('✓ OpenAI OAuth test successful'));
      } catch (error) {
        console.log(chalk.red(`✗ OpenAI OAuth test failed: ${(error as Error).message}`));
      }
    }

    if (hasOpenAICompatible) {
      const openaiCompatibleEndpoint = getAllEndpointConfigs().find((endpoint) => endpoint.id === 'openai-compatible');
      if (openaiCompatibleEndpoint) {
        try {
          await testProvider(openaiCompatibleEndpoint);
          console.log(chalk.green('✓ OpenAI-Compatible test successful'));
        } catch (error) {
          console.log(chalk.red(`✗ OpenAI-Compatible test failed: ${(error as Error).message}`));
        }
      }
    }

    for (const endpoint of enabledOtherEndpoints) {
      try {
        await testProvider(endpoint);
        console.log(chalk.green(`✓ ${endpoint.displayName} test successful`));
      } catch (error) {
        console.log(chalk.red(`✗ ${endpoint.displayName} test failed: ${(error as Error).message}`));
      }
    }
  }

  if (!hasEnabledProviders) {
    console.log(chalk.yellow('\nRun `pb auth login` or configure provider credentials to enable providers'));
  }

  const credentials = getCachedCredentials();
  if (!credentials?.providers || Object.keys(credentials.providers).length === 0) {
    console.log(chalk.yellow('\nTip: configure providers in ~/.config/ponybunny/credentials.json'));
  }
  
  console.log();
}

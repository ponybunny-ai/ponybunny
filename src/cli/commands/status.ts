import chalk from 'chalk';
import type { AccountProvider } from '../lib/account-types.js';
import { accountManagerV2, authManagerV2 } from '../lib/auth-manager-v2.js';
import { openaiClient } from '../lib/openai-client.js';
import { getCachedCredentials, getCachedEndpointCredential } from '../../infra/config/credentials-loader.js';
import { getAllEndpointConfigs, hasRequiredCredentials } from '../../infra/llm/endpoints/index.js';
import type { EndpointConfig, EndpointId } from '../../infra/llm/endpoints/index.js';

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

  return Object.entries(credential).some(([key, value]) => key !== 'enabled' && !!value);
}

function isEndpointEnabled(endpointId: EndpointId): boolean {
  const credential = getCachedEndpointCredential(endpointId);
  if (credential?.enabled === false) {
    return false;
  }

  if (credential?.enabled === true) {
    return true;
  }

  if (hasCredentialFields(endpointId)) {
    return true;
  }

  const endpoint = getAllEndpointConfigs().find((item) => item.id === endpointId);
  if (!endpoint) {
    return false;
  }

  return hasRequiredCredentials(endpoint);
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
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL || credential?.baseUrl || 'https://api.openai.com/v1';

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

  const response = await fetch(`${config.baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
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
        let response = '';
        await openaiClient.streamChatCompletion({
          model: 'gpt-5.2',
          messages: [{ role: 'user', content: 'Say "OK"' }],
        }, (chunk) => {
          response += chunk;
        });
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
  if (!credentials?.endpoints || Object.keys(credentials.endpoints).length === 0) {
    console.log(chalk.yellow('\nTip: configure endpoints in ~/.config/ponybunny/credentials.json (set `enabled: true`)'));
  }
  
  console.log();
}

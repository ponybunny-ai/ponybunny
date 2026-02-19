import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { AgentDiscoveryOptions, AgentConfigSource } from './agent-discovery.js';
import { discoverAgentCandidates } from './agent-discovery.js';
import type { CompiledAgentConfig } from './config/index.js';
import { AgentConfigValidationError, validateAndCompileAgentConfig } from './config/index.js';

export type AgentDefinitionStatus = 'valid' | 'using_last_good';
export type AgentConfigStatus = 'valid' | 'invalid' | 'using_last_good';

export interface AgentDefinition {
  id: string;
  source: AgentConfigSource;
  config: CompiledAgentConfig;
  markdown: string;
  definitionHash: string;
  status: AgentDefinitionStatus;
  configPath: string;
  markdownPath: string;
}

export interface AgentRegistryLoadOptions extends AgentDiscoveryOptions {}

const CACHE_TTL_MS = 5000;

function sortForCanonicalization(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCanonicalization);
  }

  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortForCanonicalization((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

function canonicalizeConfig(config: unknown): string {
  return JSON.stringify(sortForCanonicalization(config));
}

function computeDefinitionHash(config: unknown): string {
  const canonical = canonicalizeConfig(config);
  return createHash('sha256').update(canonical).digest('hex');
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private lastGood = new Map<string, AgentDefinition>();
  private lastLoadedAt = 0;
  private loading: Promise<void> | null = null;
  private loadOptions: AgentRegistryLoadOptions | null = null;
  private logger: Pick<Console, 'info' | 'warn'> = console;

  async loadAgents(options: AgentRegistryLoadOptions): Promise<void> {
    this.loadOptions = options;
    return this.loadWithCache(false);
  }

  async reload(): Promise<void> {
    if (!this.loadOptions) {
      throw new Error('AgentRegistry.reload called before initial load');
    }

    return this.loadWithCache(true);
  }

  getAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  private async loadWithCache(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && this.agents.size > 0 && now - this.lastLoadedAt < CACHE_TTL_MS) {
      return;
    }

    if (this.loading) {
      return this.loading;
    }

    this.loading = this.performLoad().finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  private async performLoad(): Promise<void> {
    if (!this.loadOptions) {
      throw new Error('AgentRegistry.loadAgents must be called with options before loading');
    }

    const candidates = await discoverAgentCandidates(this.loadOptions);
    const nextAgents = new Map<string, AgentDefinition>();

    for (const candidate of candidates) {
      const definition = await this.loadCandidate(candidate);
      if (definition) {
        nextAgents.set(definition.id, definition);
      }
    }

    this.agents = nextAgents;
    this.lastLoadedAt = Date.now();
  }

  private async loadCandidate(candidate: {
    id: string;
    source: AgentConfigSource;
    agentConfigPath: string;
    agentMarkdownPath: string;
    configId: string | null;
    idMatches: boolean;
  }): Promise<AgentDefinition | undefined> {
    if (!candidate.idMatches) {
      return this.handleInvalid(
        candidate.id,
        `agent.json id (${candidate.configId ?? 'missing'}) does not match directory id`,
        {
          source: candidate.source,
          configPath: candidate.agentConfigPath,
        }
      );
    }

    let rawConfig: unknown;
    try {
      const configContent = await fs.readFile(candidate.agentConfigPath, 'utf-8');
      rawConfig = JSON.parse(configContent);
    } catch (error) {
      return this.handleInvalid(candidate.id, `Failed to parse agent.json: ${(error as Error).message}`, {
        source: candidate.source,
        configPath: candidate.agentConfigPath,
      });
    }

    let compiled: CompiledAgentConfig;
    try {
      compiled = validateAndCompileAgentConfig(rawConfig);
    } catch (error) {
      if (error instanceof AgentConfigValidationError) {
        this.logger.warn('[AgentRegistry] Agent config validation failed', {
          agentId: candidate.id,
          source: candidate.source,
          configPath: candidate.agentConfigPath,
          configStatus: 'invalid' as AgentConfigStatus,
          errors: error.errors.map((validationError) => ({
            path: validationError.path,
            message: validationError.message,
          })),
        });

        return this.handleInvalid(candidate.id, error.message, {
          source: candidate.source,
          configPath: candidate.agentConfigPath,
        });
      }

      return this.handleInvalid(candidate.id, (error as Error).message, {
        source: candidate.source,
        configPath: candidate.agentConfigPath,
      });
    }

    let markdown: string;
    try {
      markdown = await fs.readFile(candidate.agentMarkdownPath, 'utf-8');
    } catch (error) {
      return this.handleInvalid(candidate.id, `Failed to read AGENT.md: ${(error as Error).message}`, {
        source: candidate.source,
        configPath: candidate.agentConfigPath,
      });
    }

    const definition: AgentDefinition = {
      id: candidate.id,
      source: candidate.source,
      config: compiled,
      markdown,
      definitionHash: computeDefinitionHash(rawConfig),
      status: 'valid',
      configPath: candidate.agentConfigPath,
      markdownPath: candidate.agentMarkdownPath,
    };

    this.lastGood.set(candidate.id, definition);
    this.logger.info('[AgentRegistry] Agent config loaded', {
      agentId: candidate.id,
      source: candidate.source,
      configPath: candidate.agentConfigPath,
      configStatus: 'valid' as AgentConfigStatus,
    });
    return definition;
  }

  private handleInvalid(
    id: string,
    reason: string,
    context?: { source: AgentConfigSource; configPath: string }
  ): AgentDefinition | undefined {
    const lastGood = this.lastGood.get(id);
    if (lastGood) {
      this.logger.warn('[AgentRegistry] Agent config fallback to last-good', {
        agentId: id,
        source: context?.source ?? lastGood.source,
        configPath: context?.configPath ?? lastGood.configPath,
        configStatus: 'using_last_good' as AgentConfigStatus,
        reason,
      });
      return {
        ...lastGood,
        status: 'using_last_good',
      };
    }

    this.logger.warn('[AgentRegistry] Agent config invalid and skipped', {
      agentId: id,
      source: context?.source,
      configPath: context?.configPath,
      configStatus: 'invalid' as AgentConfigStatus,
      reason,
    });
    return undefined;
  }
}

let globalRegistry: AgentRegistry | null = null;

export function getGlobalAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}

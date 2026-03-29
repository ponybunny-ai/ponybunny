/**
 * Scheduler Capabilities Information
 * Collects information about loaded models, providers, tools, MCPs, and skills
 */

import { loadLLMConfig } from '../llm/provider-manager/config-loader.js';
import { getGlobalSkillRegistry } from '../skills/skill-registry.js';
import { loadMCPConfig } from '../mcp/config/mcp-config-loader.js';
import { getGlobalSubagentExecutionBoundary } from '../agents/subagent-execution-boundary.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { getManagedSkillsDir } from '../config/config-paths.js';
import type { ILogger } from '../observability/logger.js';
import { NoopLogger } from '../observability/logger.js';

export interface ModelInfo {
  name: string;
  displayName: string;
  providers: string[];
  capabilities: string[];
  reasoningEfforts?: string[];
  costPer1kTokens: {
    input: number;
    output: number;
  };
  maxContextTokens: number;
}

export interface ProviderInfo {
  name: string;
  protocol: string;
  enabled: boolean;
  healthAvailable: boolean;
  priority: number;
  baseUrl?: string;
}

export interface ToolInfo {
  name: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  description: string;
}

export interface MCPServerInfo {
  name: string;
  enabled: boolean;
  transport: string;
  command?: string;
  url?: string;
  allowedTools: string[];
  autoReconnect: boolean;
}

export interface SkillInfo {
  name: string;
  source: string;
  version?: string;
  description: string;
  enabled: boolean;
  phases?: string[];
  tags?: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  source: string;
  status: string;
  scheduleKind: 'cron' | 'interval';
}

export interface SchedulerCapabilities {
  models: ModelInfo[];
  providers: ProviderInfo[];
  tools: ToolInfo[];
  mcpServers: MCPServerInfo[];
  skills: SkillInfo[];
  agents: AgentInfo[];
  summary: {
    totalModels: number;
    totalProviders: number;
    totalTools: number;
    totalMCPServers: number;
    totalSkills: number;
    totalAgents: number;
  };
}

/**
 * Get all models information
 */
export function getModelsInfo(logger?: ILogger): ModelInfo[] {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    const config = loadLLMConfig();
    const models: ModelInfo[] = [];

    for (const [modelId, modelConfig] of Object.entries(config.models)) {
      const providers = Array.isArray(modelConfig.providers) && modelConfig.providers.length > 0
        ? modelConfig.providers
        : (() => {
          const dotIndex = modelId.indexOf('.');
          if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
            return [];
          }
          return [modelId.slice(0, dotIndex)];
        })();

      models.push({
        name: modelId,
        displayName: modelConfig.displayName,
        providers,
        capabilities: modelConfig.capabilities || [],
        reasoningEfforts: modelConfig.reasoningEfforts,
        costPer1kTokens: modelConfig.costPer1kTokens,
        maxContextTokens: modelConfig.maxContextTokens || 0,
      });
    }

    return models;
  } catch (error) {
    log.error({}, 'Failed to load models info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Get all providers information
 */
export function getProvidersInfo(logger?: ILogger): ProviderInfo[] {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    const config = loadLLMConfig();
    const providers: ProviderInfo[] = [];

    for (const [endpointId, endpointConfig] of Object.entries(config.providers)) {
      providers.push({
        name: endpointId,
        protocol: endpointConfig.protocol,
        enabled: endpointConfig.enabled,
        healthAvailable: endpointConfig.health?.available === true,
        priority: endpointConfig.priority,
        baseUrl: endpointConfig.baseUrl,
      });
    }

    return providers;
  } catch (error) {
    log.error({}, 'Failed to load providers info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Get all tools information
 */
export function getToolsInfo(toolRegistry?: ToolRegistry, logger?: ILogger): ToolInfo[] {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    if (!toolRegistry) {
      return [];
    }

    const tools = toolRegistry.getAllTools();
    return tools.map(tool => ({
      name: tool.name,
      category: tool.category,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      description: tool.description,
    }));
  } catch (error) {
    log.error({}, 'Failed to load tools info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Get all MCP servers information
 */
export function getMCPServersInfo(logger?: ILogger): MCPServerInfo[] {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    const config = loadMCPConfig();
    if (!config) {
      return [];
    }
    
    const servers: MCPServerInfo[] = [];

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      servers.push({
        name: serverName,
        enabled: serverConfig.enabled ?? true,
        transport: serverConfig.transport,
        command: serverConfig.command,
        url: serverConfig.url,
        allowedTools: serverConfig.allowedTools ?? ['*'],
        autoReconnect: serverConfig.autoReconnect ?? true,
      });
    }

    return servers;
  } catch (error) {
    log.error({}, 'Failed to load MCP servers info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Get all skills information
 */
export async function getSkillsInfo(logger?: ILogger): Promise<SkillInfo[]> {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    const registry = getGlobalSkillRegistry();
    if (registry.getSkills().length === 0) {
      await registry.loadSkills({
        workspaceDir: process.cwd(),
        managedSkillsDir: getManagedSkillsDir(),
      });
    }
    const skills = registry.getSkills();

    return skills.map(skill => ({
      name: skill.name,
      source: skill.source,
      version: skill.metadata.version,
      description: skill.metadata.description,
      enabled: skill.metadata.disableModelInvocation !== true,
      phases: skill.metadata.phases,
      tags: skill.metadata.tags,
    }));
  } catch (error) {
    log.error({}, 'Failed to load skills info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

export async function getAgentsInfo(logger?: ILogger): Promise<AgentInfo[]> {
  const log = (logger ?? new NoopLogger()).child({ component: 'SchedulerCapabilities' });
  try {
    const subagentExecutionBoundary = getGlobalSubagentExecutionBoundary();
    const agents = await subagentExecutionBoundary.listAgentCapabilities({ ensureLoaded: true });

    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      enabled: agent.enabled,
      source: agent.source,
      status: agent.status,
      scheduleKind: agent.scheduleKind,
    }));
  } catch (error) {
    log.error({}, 'Failed to load agents info', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Get complete scheduler capabilities
 */
export async function getSchedulerCapabilities(toolRegistry?: ToolRegistry, logger?: ILogger): Promise<SchedulerCapabilities> {
  const allModels = getModelsInfo(logger);
  const providers = getProvidersInfo(logger);
  const tools = getToolsInfo(toolRegistry, logger);
  const mcpServers = getMCPServersInfo(logger);
  const skills = await getSkillsInfo(logger);
  const agents = await getAgentsInfo(logger);

  const enabledHealthyProviderNames = new Set(
    providers
      .filter(provider => provider.enabled && provider.healthAvailable)
      .map(provider => provider.name)
  );
  const models = allModels.filter(model =>
    model.providers.some(providerName => enabledHealthyProviderNames.has(providerName))
  );
  const enabledProvidersCount = providers.filter(provider => provider.enabled).length;
  const enabledMCPServersCount = mcpServers.filter(server => server.enabled).length;
  const enabledSkillsCount = skills.filter(skill => skill.enabled).length;
  const enabledAgentsCount = agents.filter(agent => agent.enabled).length;

  return {
    models,
    providers,
    tools,
    mcpServers,
    skills,
    agents,
    summary: {
      totalModels: models.length,
      totalProviders: enabledProvidersCount,
      totalTools: tools.length,
      totalMCPServers: enabledMCPServersCount,
      totalSkills: enabledSkillsCount,
      totalAgents: enabledAgentsCount,
    },
  };
}

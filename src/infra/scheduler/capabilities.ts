/**
 * Scheduler Capabilities Information
 * Collects information about loaded models, providers, tools, MCPs, and skills
 */

import { loadLLMConfig } from '../llm/provider-manager/config-loader.js';
import { getGlobalSkillRegistry } from '../skills/skill-registry.js';
import { loadMCPConfig } from '../mcp/config/mcp-config-loader.js';
import { getGlobalAgentRegistry } from '../agents/agent-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { getManagedSkillsDir } from '../config/config-paths.js';

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
export function getModelsInfo(): ModelInfo[] {
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
    console.error('[SchedulerCapabilities] Failed to load models info:', error);
    return [];
  }
}

/**
 * Get all providers information
 */
export function getProvidersInfo(): ProviderInfo[] {
  try {
    const config = loadLLMConfig();
    const providers: ProviderInfo[] = [];

    for (const [endpointId, endpointConfig] of Object.entries(config.providers)) {
      providers.push({
        name: endpointId,
        protocol: endpointConfig.protocol,
        enabled: endpointConfig.enabled,
        priority: endpointConfig.priority,
        baseUrl: endpointConfig.baseUrl,
      });
    }

    return providers;
  } catch (error) {
    console.error('[SchedulerCapabilities] Failed to load providers info:', error);
    return [];
  }
}

/**
 * Get all tools information
 */
export function getToolsInfo(toolRegistry?: ToolRegistry): ToolInfo[] {
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
    console.error('[SchedulerCapabilities] Failed to load tools info:', error);
    return [];
  }
}

/**
 * Get all MCP servers information
 */
export function getMCPServersInfo(): MCPServerInfo[] {
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
    console.error('[SchedulerCapabilities] Failed to load MCP servers info:', error);
    return [];
  }
}

/**
 * Get all skills information
 */
export async function getSkillsInfo(): Promise<SkillInfo[]> {
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
    console.error('[SchedulerCapabilities] Failed to load skills info:', error);
    return [];
  }
}

export async function getAgentsInfo(): Promise<AgentInfo[]> {
  try {
    const registry = getGlobalAgentRegistry();
    if (registry.getAgents().length === 0) {
      await registry.loadAgents({ workspaceDir: process.cwd() });
    }
    const agents = registry.getAgents();

    return agents.map(agent => ({
      id: agent.id,
      name: agent.config.name,
      type: agent.config.type,
      enabled: agent.config.enabled,
      source: agent.source,
      status: agent.status,
      scheduleKind: agent.config.schedule.kind,
    }));
  } catch (error) {
    console.error('[SchedulerCapabilities] Failed to load agents info:', error);
    return [];
  }
}

/**
 * Get complete scheduler capabilities
 */
export async function getSchedulerCapabilities(toolRegistry?: ToolRegistry): Promise<SchedulerCapabilities> {
  const models = getModelsInfo();
  const providers = getProvidersInfo();
  const tools = getToolsInfo(toolRegistry);
  const mcpServers = getMCPServersInfo();
  const skills = await getSkillsInfo();
  const agents = await getAgentsInfo();

  const enabledProviderNames = new Set(
    providers.filter(provider => provider.enabled).map(provider => provider.name)
  );
  const enabledModelsCount = models.filter(model =>
    model.providers.some(providerName => enabledProviderNames.has(providerName))
  ).length;
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
      totalModels: enabledModelsCount,
      totalProviders: enabledProvidersCount,
      totalTools: tools.length,
      totalMCPServers: enabledMCPServersCount,
      totalSkills: enabledSkillsCount,
      totalAgents: enabledAgentsCount,
    },
  };
}

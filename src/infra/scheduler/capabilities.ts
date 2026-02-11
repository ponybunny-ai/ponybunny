/**
 * Scheduler Capabilities Information
 * Collects information about loaded models, providers, tools, MCPs, and skills
 */

import { getLLMProviderManager } from '../llm/provider-manager/index.js';
import { loadLLMConfig } from '../llm/provider-manager/config-loader.js';
import { getGlobalSkillRegistry } from '../skills/skill-registry.js';
import { loadMCPConfig } from '../mcp/config/mcp-config-loader.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

export interface ModelInfo {
  name: string;
  displayName: string;
  endpoints: string[];
  capabilities: string[];
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
  phases?: string[];
  tags?: string[];
}

export interface SchedulerCapabilities {
  models: ModelInfo[];
  providers: ProviderInfo[];
  tools: ToolInfo[];
  mcpServers: MCPServerInfo[];
  skills: SkillInfo[];
  summary: {
    totalModels: number;
    totalProviders: number;
    totalTools: number;
    totalMCPServers: number;
    totalSkills: number;
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
      models.push({
        name: modelId,
        displayName: modelConfig.displayName,
        endpoints: modelConfig.endpoints,
        capabilities: modelConfig.capabilities || [],
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

    for (const [endpointId, endpointConfig] of Object.entries(config.endpoints)) {
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
export function getSkillsInfo(): SkillInfo[] {
  try {
    const registry = getGlobalSkillRegistry();
    const skills = registry.getSkills();

    return skills.map(skill => ({
      name: skill.name,
      source: skill.source,
      version: skill.metadata.version,
      description: skill.metadata.description,
      phases: skill.metadata.phases,
      tags: skill.metadata.tags,
    }));
  } catch (error) {
    console.error('[SchedulerCapabilities] Failed to load skills info:', error);
    return [];
  }
}

/**
 * Get complete scheduler capabilities
 */
export function getSchedulerCapabilities(toolRegistry?: ToolRegistry): SchedulerCapabilities {
  const models = getModelsInfo();
  const providers = getProvidersInfo();
  const tools = getToolsInfo(toolRegistry);
  const mcpServers = getMCPServersInfo();
  const skills = getSkillsInfo();

  return {
    models,
    providers,
    tools,
    mcpServers,
    skills,
    summary: {
      totalModels: models.length,
      totalProviders: providers.length,
      totalTools: tools.length,
      totalMCPServers: mcpServers.length,
      totalSkills: skills.length,
    },
  };
}

import { configureLLMProviderManagerStreamEventSink } from '../../infra/llm/provider-manager/index.js';
import { ToolProvider, setGlobalToolProvider } from '../../infra/tools/tool-provider.js';
import {
  ToolAllowlist,
  ToolEnforcer,
  ToolRegistry,
} from '../../infra/tools/tool-registry.js';
import { ExecuteCommandTool } from '../../infra/tools/implementations/execute-command-tool.js';
import { ReadFileTool } from '../../infra/tools/implementations/read-file-tool.js';
import { SearchCodeTool } from '../../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../../infra/tools/implementations/web-search-tool.js';
import { WriteFileTool } from '../../infra/tools/implementations/write-file-tool.js';
import { findSkillsTool } from '../../infra/tools/implementations/find-skills-tool.js';
import type { LLMStreamEventSink } from '../../infra/llm/provider-manager/stream-event-sink.js';

const DEFAULT_ALLOWED_TOOL_NAMES = [
  'read_file',
  'write_file',
  'execute_command',
  'search_code',
  'web_search',
  'find_skills',
] as const;

export interface GatewayToolProviderRuntimeDependencies {
  streamEventSink: LLMStreamEventSink;
}

export class GatewayToolProviderRuntime {
  readonly toolRegistry: ToolRegistry;
  readonly toolAllowlist: ToolAllowlist;
  readonly toolEnforcer: ToolEnforcer;
  readonly toolProvider: ToolProvider;

  constructor(dependencies: GatewayToolProviderRuntimeDependencies) {
    this.toolRegistry = new ToolRegistry();
    this.toolAllowlist = new ToolAllowlist();

    this.registerBuiltInTools();

    this.toolEnforcer = new ToolEnforcer(this.toolRegistry, this.toolAllowlist);
    this.toolProvider = new ToolProvider(this.toolEnforcer);

    setGlobalToolProvider(this.toolProvider);
    configureLLMProviderManagerStreamEventSink(dependencies.streamEventSink);
  }

  private registerBuiltInTools(): void {
    this.toolRegistry.register(new ReadFileTool());
    this.toolRegistry.register(new WriteFileTool());
    this.toolRegistry.register(new ExecuteCommandTool());
    this.toolRegistry.register(new SearchCodeTool());
    this.toolRegistry.register(new WebSearchTool());
    this.toolRegistry.register(findSkillsTool);

    for (const toolName of DEFAULT_ALLOWED_TOOL_NAMES) {
      this.toolAllowlist.addTool(toolName);
    }
  }
}

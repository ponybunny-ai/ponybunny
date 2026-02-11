export interface SystemStatusResponse {
  timestamp: number;
  system: SystemInfo;
  processes: ProcessesInfo;
  gateway: GatewayInfo;
  scheduler: SchedulerInfo;
}

export interface SystemInfo {
  os: OSInfo;
  hardware: HardwareInfo;
  network: NetworkInfo;
  process: ProcessInfo;
}

export interface OSInfo {
  platform: string;
  type: string;
  release: string;
  version: string;
  arch: string;
  hostname: string;
  uptime: number;
}

export interface HardwareInfo {
  cpu: CPUInfo;
  memory: MemoryInfo;
}

export interface CPUInfo {
  model: string;
  cores: number;
  speed: number;
  usage?: number;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

export interface NetworkInfo {
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
  mac?: string;
}

export interface ProcessInfo {
  pid: number;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    user: number;
    system: number;
  };
}

export interface ProcessesInfo {
  current: ProcessInfo;
  gateway: GatewayProcessInfo;
  scheduler: SchedulerProcessInfo;
}

export interface GatewayProcessInfo extends ProcessInfo {
  type: 'gateway';
  status: 'running' | 'stopped';
  startedAt?: number;
  socketPath?: string;
}

export interface SchedulerProcessInfo extends ProcessInfo {
  type: 'scheduler';
  status: 'running' | 'stopped';
  startedAt?: number;
  dbPath?: string;
  socketPath?: string;
  mode?: 'foreground' | 'background';
}

export interface GatewayInfo {
  isRunning: boolean;
  connections: {
    total: number;
    authenticated: number;
    pending: number;
    byIp: Record<string, number>;
  };
  daemonConnected: boolean;
  schedulerConnected: boolean;
}

export interface SchedulerInfo {
  isConnected: boolean;
  state?: {
    status: string;
    activeGoals: string[];
    lastTickAt?: number;
    errorCount: number;
  };
  metrics?: {
    goalsProcessed: number;
    workItemsCompleted: number;
    totalTokensUsed: number;
    averageCompletionTime: number;
  };
  capabilities?: SchedulerCapabilities;
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

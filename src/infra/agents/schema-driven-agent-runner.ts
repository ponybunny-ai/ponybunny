import Database from 'better-sqlite3';
import type {
  AgentApprovalPolicy,
  AgentForbiddenPatternConfig,
  AgentPrivacyPolicy,
} from './config/index.js';
import type { IPersona } from '../../domain/conversation/persona.js';
import type { OSService } from '../../domain/permission/os-service.js';
import { PersonaEngine } from '../../app/conversation/persona-engine.js';
import { InMemoryPersonaRepository } from '../conversation/persona-repository.js';
import type { AgentRunner, AgentRunnerInput } from './runner-types.js';
import type { LLMMessage } from '../llm/llm-provider.js';
import { getLLMProviderManager } from '../llm/provider-manager/provider-manager.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { OSPermissionRepository, OSServiceChecker } from '../permission/os-service-checker.js';
import {
  getGlobalSubagentExecutionBoundary,
  type SubagentExecutionBoundary,
  type SubagentExecutionScope,
} from './subagent-execution-boundary.js';

export interface AgentExecutionStage {
  key: string;
  systemPrompt: string;
}

export interface AgentExecutionPlan {
  agentId: string;
  runKey: string;
  now: Date;
  engine: string;
  entrypoint?: string;
  type: string;
  goalId?: string;
  workDir?: string;
  parentAgentId?: string;
  isSubagent: boolean;
  subAgents: string[];
  stages: AgentExecutionStage[];
  osPermissions: AgentOSPermissionRequirement[];
  limits: Record<string, number | boolean | string>;
  approval?: AgentApprovalPolicy;
  privacy?: AgentPrivacyPolicy;
  effectiveTools: string[];
}

export interface AgentDefinitionInterpreter {
  interpret(input: AgentRunnerInput): AgentExecutionPlan;
}

export interface AgentExecutionEngine {
  execute(plan: AgentExecutionPlan): Promise<void>;
}

export interface AgentOSPermissionRequirement {
  service: OSService;
  scope: string;
  reason: string;
  optional: boolean;
}

const toStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      result[key] = candidate;
    }
  }
  return result;
};

const toLimitRecord = (value: unknown): Record<string, number | boolean | string> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, number | boolean | string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate === 'number'
      || typeof candidate === 'boolean'
      || typeof candidate === 'string'
    ) {
      result[key] = candidate;
    }
  }
  return result;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const OS_SERVICES: readonly OSService[] = [
  'keychain',
  'browser',
  'docker',
  'network',
  'filesystem',
  'clipboard',
  'notifications',
  'process',
  'environment',
];

const isOSService = (value: unknown): value is OSService =>
  typeof value === 'string' && OS_SERVICES.includes(value as OSService);

const toOSPermissions = (value: unknown): AgentOSPermissionRequirement[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): AgentOSPermissionRequirement[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;
    const service = record.service;
    const scope = record.scope;
    const reason = record.reason;

    if (!isOSService(service) || typeof scope !== 'string' || scope.trim().length === 0) {
      return [];
    }

    return [
      {
        service,
        scope,
        reason: typeof reason === 'string' && reason.trim().length > 0
          ? reason
          : `Agent requires ${service}:${scope}`,
        optional: record.optional === true,
      },
    ];
  });
};

const unique = (items: string[]): string[] => Array.from(new Set(items));

const DEFAULT_PERSONA: IPersona = {
  id: 'pony-default',
  name: 'Pony',
  nickname: '小马',
  personality: {
    warmth: 0.8,
    formality: 0.4,
    humor: 0.5,
    empathy: 0.7,
  },
  communicationStyle: {
    verbosity: 'balanced',
    technicalDepth: 'adaptive',
    expressiveness: 'moderate',
  },
  expertise: {
    primaryDomains: ['software-engineering', 'devops', 'automation'],
    skillConfidence: {
      coding: 0.95,
      debugging: 0.9,
      architecture: 0.85,
    },
  },
  backstory: '我是 Pony，你的自主 AI 助手。',
  locale: 'zh-CN',
};

const buildPersonaPrefix = (): string | null => {
  const runtime = loadRuntimeConfig();
  if (!runtime.agent.personaEnabled) {
    return null;
  }

  const repository = new InMemoryPersonaRepository();
  repository.addPersona(DEFAULT_PERSONA);
  const engine = new PersonaEngine(repository, DEFAULT_PERSONA.id);
  return engine.generateSystemPrompt(DEFAULT_PERSONA);
};

let globalOSServiceChecker: OSServiceChecker | null = null;

const getOSServiceChecker = (): OSServiceChecker => {
  if (!globalOSServiceChecker) {
    const runtime = loadRuntimeConfig();
    const db = new Database(runtime.paths.database);
    const repository = new OSPermissionRepository(db);
    repository.initialize();
    globalOSServiceChecker = new OSServiceChecker(repository);
  }

  return globalOSServiceChecker;
};

const buildForbiddenMatchers = (patterns: AgentForbiddenPatternConfig[]): RegExp[] =>
  patterns
    .map((pattern) => pattern.pattern)
    .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0)
    .map((pattern) => new RegExp(pattern, 'i'));

const computeEffectiveTools = (
  allowlist: string[],
  denylist: string[],
  forbiddenPatterns: AgentForbiddenPatternConfig[]
): string[] => {
  const deny = new Set(denylist);
  const forbiddenMatchers = buildForbiddenMatchers(forbiddenPatterns);

  return allowlist.filter((tool) => {
    if (deny.has(tool)) {
      return false;
    }
    return !forbiddenMatchers.some((matcher) => matcher.test(tool));
  });
};

export class SchemaDrivenAgentInterpreter implements AgentDefinitionInterpreter {
  interpret(input: AgentRunnerInput): AgentExecutionPlan {
    const config = input.config;
    const personaPrefix = buildPersonaPrefix();
    const prompts = toStringRecord(config.policy?.prompts);
    const stages: AgentExecutionStage[] = Object.keys(prompts)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => ({
        key,
        systemPrompt:
          personaPrefix && personaPrefix.length > 0
            ? `${personaPrefix}\n\n${prompts[key]}`
            : prompts[key],
      }));

    if (stages.length === 0) {
      throw new Error(`Agent '${config.id}' has no executable prompt stages.`);
    }

    const allowlist = unique(toStringArray(config.policy?.toolAllowlist));
    const denylist = unique(toStringArray(config.policy?.toolDenylist));
    const forbiddenPatterns = Array.isArray(config.policy?.forbiddenPatterns)
      ? config.policy.forbiddenPatterns
      : [];
    const effectiveTools = computeEffectiveTools(allowlist, denylist, forbiddenPatterns);
    const runnerConfig = config.runner?.config ?? {};
    const runnerConfigRecord =
      runnerConfig && typeof runnerConfig === 'object'
        ? (runnerConfig as Record<string, unknown>)
        : {};
    const osPermissions = toOSPermissions(
      runnerConfigRecord.os_permissions ?? runnerConfigRecord.osPermissions
    );

    const subAgents = unique(toStringArray(config.subAgents)).filter((id) => id !== config.id);
    const parentAgentId =
      input.tick.routeContext?.isSubagent
      && input.tick.routeContext.agentId
      && input.tick.routeContext.agentId !== input.agentId
        ? input.tick.routeContext.agentId
        : undefined;

    return {
      agentId: input.agentId,
      runKey: input.tick.runKey,
      now: input.tick.now,
      engine: config.runner?.engine ?? 'default',
      entrypoint: config.runner?.entrypoint,
      type: config.type,
      goalId: input.tick.goalId,
      workDir: input.tick.workDir,
      parentAgentId,
      isSubagent: input.tick.routeContext?.isSubagent === true,
      subAgents,
      stages,
      osPermissions,
      limits: toLimitRecord(config.policy?.limits),
      approval: config.policy?.approval,
      privacy: config.policy?.privacy,
      effectiveTools,
    };
  }
}

export class DefaultAgentExecutionEngine implements AgentExecutionEngine {
  constructor(
    private readonly subagentExecutionBoundary: SubagentExecutionBoundary =
      getGlobalSubagentExecutionBoundary()
  ) {}

  async execute(plan: AgentExecutionPlan): Promise<void> {
    if (plan.approval?.required && (!plan.approval.actions || plan.approval.actions.length === 0)) {
      throw new Error(`Agent '${plan.agentId}' requires approval but has no approval actions configured.`);
    }

    if (plan.privacy?.redactPiiByDefault && !plan.privacy.allowedDataClasses?.length) {
      throw new Error(
        `Agent '${plan.agentId}' enables PII redaction but has no allowedDataClasses configured.`
      );
    }

    const llm = getLLMProviderManager();
    const osChecker = plan.osPermissions.length > 0 ? getOSServiceChecker() : null;

    if (plan.osPermissions.length > 0 && !plan.goalId) {
      throw new Error(
        `Agent '${plan.agentId}' requires OS permissions but goalId is missing from tick context.`
      );
    }

    const activePermissions: Array<{ service: OSService; scope: string; expiresAt?: number }> = [];

    if (osChecker && plan.goalId) {
      const pendingRequests: Array<{ service: OSService; scope: string; requestId: string; optional: boolean }> = [];

      for (const requirement of plan.osPermissions) {
        const availability = await osChecker.isServiceAvailable(requirement.service);
        if (!availability) {
          if (requirement.optional) {
            continue;
          }
          throw new Error(
            `Required OS service unavailable for agent '${plan.agentId}': ${requirement.service}`
          );
        }

        const permission = await osChecker.checkPermission(
          requirement.service,
          requirement.scope,
          plan.goalId
        );

        if (!permission.granted) {
          const requestId = await osChecker.requestPermission({
            service: requirement.service,
            scope: requirement.scope,
            goalId: plan.goalId,
            runId: plan.runKey,
            reason: requirement.reason,
          });

          pendingRequests.push({
            service: requirement.service,
            scope: requirement.scope,
            requestId,
            optional: requirement.optional,
          });
          continue;
        }

        activePermissions.push({
          service: requirement.service,
          scope: requirement.scope,
          expiresAt: permission.expiresAt,
        });
      }

      const requiredPending = pendingRequests.filter((request) => !request.optional);
      if (requiredPending.length > 0) {
        throw new Error(
          `OS permission approval required for agent '${plan.agentId}': `
          + `${requiredPending.map((request) => `${request.service}:${request.scope}#${request.requestId}`).join(', ')}`
        );
      }
    }

    let subagentExecution: SubagentExecutionScope | null = null;

    try {
      subagentExecution = await this.subagentExecutionBoundary.startExecution({
        agentId: plan.agentId,
        runKey: plan.runKey,
        goalId: plan.goalId,
        isSubagent: plan.isSubagent,
        subAgents: plan.subAgents,
      });

      for (const _stage of plan.stages) {
        const subagentRuntime = subagentExecution.getRuntimeContext();

        const stagePayload = {
          stage: _stage.key,
          runKey: plan.runKey,
          now: plan.now.toISOString(),
          type: plan.type,
          entrypoint: plan.entrypoint,
          workDir: plan.workDir,
          isSubagent: plan.isSubagent,
          parentAgentId: plan.parentAgentId,
          subAgents: plan.subAgents,
          subagentProcesses: subagentRuntime.subagentProcesses,
          subagentHeartbeats: subagentRuntime.subagentHeartbeats,
          osPermissions: activePermissions,
          limits: plan.limits,
          effectiveTools: plan.effectiveTools,
          approval: plan.approval,
          privacy: plan.privacy,
        };

        const messages: LLMMessage[] = [
          { role: 'system', content: _stage.systemPrompt },
          {
            role: 'user',
            content:
              'Execute this stage according to the provided JSON policy. '
              + 'Return ONLY valid JSON.\n'
              + JSON.stringify(stagePayload),
          },
        ];

        await llm.complete(plan.agentId, messages, {
          maxTokens: 800,
          temperature: 0.1,
        });
      }
    } finally {
      if (subagentExecution) {
        await subagentExecution.stop();
      }

      if (osChecker && plan.goalId) {
        await osChecker.revokeAllForGoal(plan.goalId);
      }
    }
  }
}

export class SchemaDrivenAgentRunner implements AgentRunner {
  constructor(
    private readonly interpreter: AgentDefinitionInterpreter = new SchemaDrivenAgentInterpreter(),
    private readonly engine: AgentExecutionEngine = new DefaultAgentExecutionEngine()
  ) {}

  async runTick(input: AgentRunnerInput): Promise<void> {
    const plan = this.interpreter.interpret(input);
    await this.engine.execute(plan);
  }
}

export const createSchemaDrivenAgentRunner = (): AgentRunner =>
  new SchemaDrivenAgentRunner();

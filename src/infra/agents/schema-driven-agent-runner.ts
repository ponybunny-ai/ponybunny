import type {
  AgentApprovalPolicy,
  AgentForbiddenPatternConfig,
  AgentPrivacyPolicy,
} from './config/index.js';
import type { AgentRunner, AgentRunnerInput } from './runner-types.js';
import type { LLMMessage } from '../llm/llm-provider.js';
import { getLLMProviderManager } from '../llm/provider-manager/provider-manager.js';

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
  subAgents: string[];
  stages: AgentExecutionStage[];
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

const unique = (items: string[]): string[] => Array.from(new Set(items));

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
    const prompts = toStringRecord(config.policy?.prompts);
    const stages: AgentExecutionStage[] = Object.keys(prompts)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => ({ key, systemPrompt: prompts[key] }));

    if (stages.length === 0) {
      throw new Error(`Agent '${config.id}' has no executable prompt stages.`);
    }

    const allowlist = unique(toStringArray(config.policy?.toolAllowlist));
    const denylist = unique(toStringArray(config.policy?.toolDenylist));
    const forbiddenPatterns = Array.isArray(config.policy?.forbiddenPatterns)
      ? config.policy.forbiddenPatterns
      : [];
    const effectiveTools = computeEffectiveTools(allowlist, denylist, forbiddenPatterns);

    const subAgents = unique(toStringArray(config.subAgents)).filter((id) => id !== config.id);

    return {
      agentId: input.agentId,
      runKey: input.tick.runKey,
      now: input.tick.now,
      engine: config.runner?.engine ?? 'default',
      entrypoint: config.runner?.entrypoint,
      type: config.type,
      subAgents,
      stages,
      limits: toLimitRecord(config.policy?.limits),
      approval: config.policy?.approval,
      privacy: config.policy?.privacy,
      effectiveTools,
    };
  }
}

export class DefaultAgentExecutionEngine implements AgentExecutionEngine {
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

    for (const _stage of plan.stages) {
      const stagePayload = {
        stage: _stage.key,
        runKey: plan.runKey,
        now: plan.now.toISOString(),
        type: plan.type,
        entrypoint: plan.entrypoint,
        subAgents: plan.subAgents,
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

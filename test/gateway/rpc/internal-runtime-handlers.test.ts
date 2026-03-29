import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '../../../src/gateway/connection/session.js';
import { ErrorCodes } from '../../../src/gateway/errors.js';
import { registerInternalRuntimeHandlers } from '../../../src/gateway/rpc/handlers/internal-runtime-handlers.js';
import { GatewayDaemonAttachment } from '../../../src/gateway/integration/gateway-daemon-attachment.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import { ToolRegistry } from '../../../src/infra/tools/tool-registry.js';
import { ReadFileTool } from '../../../src/infra/tools/implementations/read-file-tool.js';
import type { Goal, Run, WorkItem } from '../../../src/work-order/types/index.js';
import { DeterministicRuntimeErrorCodes } from '../../../src/deterministic-runtime/error-codes.js';
import type { PlanV1 } from '../../../src/deterministic-runtime/plan-compiler.js';
import { DaemonEventEmitterMixin } from '../../../src/runtime/events/daemon-event-emitter.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import {
  type DeterministicRunEvent,
} from '../../../src/deterministic-runtime/run-events.js';

function createSession(permissions: Array<'read' | 'write' | 'admin'>): Session {
  return new Session({
    id: 'sess-internal-1',
    publicKey: 'pk-internal-test',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

class TestDaemonEmitter extends DaemonEventEmitterMixin {
  emitGoalCreated(goal: Goal): void {
    super.emitGoalCreated(goal);
  }
}

describe('internal runtime handlers', () => {
  const now = Date.now();

  const goal: Goal = {
    id: 'goal-internal-1',
    created_at: now,
    updated_at: now,
    title: 'Internal Goal',
    description: 'Internal plan target',
    success_criteria: [
      {
        description: 'lint passes',
        type: 'deterministic',
        verification_method: 'npm run lint',
        required: true,
      },
      {
        description: 'review completed',
        type: 'heuristic',
        verification_method: 'human review',
        required: false,
      },
    ],
    status: 'queued',
    priority: 50,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    tags: ['scheduler', 'runtime', 'deterministic'],
  };

  const workItem: WorkItem = {
    id: 'wi-internal-1',
    created_at: now,
    updated_at: now,
    goal_id: goal.id,
    title: 'Prepare',
    description: 'Prepare deterministic runtime',
    item_type: 'analysis',
    status: 'ready',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    context: {
      planStep: {
        type: 'tool_call',
        tool_ref: 'local://read_file',
        args: { path: '/tmp/project.txt' },
      },
    },
  };

  const dependentWorkItem: WorkItem = {
    id: 'wi-internal-2',
    created_at: now + 1,
    updated_at: now + 1,
    goal_id: goal.id,
    title: 'Analyze output',
    description: 'Analyze read result',
    item_type: 'analysis',
    status: 'ready',
    priority: 40,
    dependencies: ['wi-internal-1'],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 2,
    verification_status: 'not_started',
  };

  const run: Run = {
    id: 'run-internal-1',
    created_at: now,
    work_item_id: workItem.id,
    goal_id: goal.id,
    agent_type: 'default',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
  };

  let rpc: RpcHandler;
  let repository: IWorkOrderRepository;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    rpc = new RpcHandler();
    toolRegistry = new ToolRegistry();
    toolRegistry.register(new ReadFileTool());

    repository = {
      initialize: jest.fn(),
      close: jest.fn(),
      createGoal: jest.fn(),
      getGoal: jest.fn(() => goal),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => [goal]),
      createWorkItem: jest.fn(),
      getWorkItem: jest.fn(() => workItem),
      updateWorkItemStatus: jest.fn(),
      getReadyWorkItems: jest.fn(() => [workItem, dependentWorkItem]),
      getWorkItemsByGoal: jest.fn(() => [workItem, dependentWorkItem]),
      createRun: jest.fn(),
      getRun: jest.fn(() => run),
      completeRun: jest.fn(),
      getRunsByWorkItem: jest.fn(() => [run]),
      updateGoalSpending: jest.fn(),
      incrementWorkItemRetry: jest.fn(),
      updateWorkItemStatusIfDependenciesMet: jest.fn(),
      getBlockedWorkItems: jest.fn(() => []),
      getRepeatedErrorSignatures: jest.fn(() => []),
      createArtifact: jest.fn(),
      createDecision: jest.fn(),
      createEscalation: jest.fn(),
      createContextPack: jest.fn(),
      appendRunEvent: jest.fn(),
      listRunEvents: jest.fn(),
      pruneRunEvents: jest.fn(),
      upsertCronJob: jest.fn(),
      getCronJob: jest.fn(),
      listCronJobs: jest.fn(() => []),
      claimDueCronJobs: jest.fn(() => []),
      markCronJobInFlight: jest.fn(),
      updateCronJobAfterOutcome: jest.fn(),
      getOrCreateCronJobRun: jest.fn(),
      linkCronJobRunToGoal: jest.fn(),
      updateCronJobRunStatus: jest.fn(),
    } as unknown as IWorkOrderRepository;

    registerInternalRuntimeHandlers(
      rpc,
      repository,
      () => ({
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 0,
            replay: 0,
          },
        },
        agent: {
          mainAgentId: 'lead',
        },
        tui: {
          inputBackgroundColor: 'gray',
          sessionFirstEnabled: true,
          goalSubmitFastPathEnabled: false,
        },
      }),
      () => toolRegistry
    );

    const inMemoryEvents: DeterministicRunEvent[] = [];
    (repository.appendRunEvent as jest.Mock).mockImplementation((event: {
      run_id: string;
      plan_id?: string;
      event_type: string;
      payload: Record<string, unknown>;
    }) => {
      const materialized: DeterministicRunEvent = {
        event_id: `evt-${inMemoryEvents.length + 1}`,
        sequence: inMemoryEvents.length + 1,
        run_id: event.run_id,
        plan_id: event.plan_id,
        event_type: event.event_type as DeterministicRunEvent['event_type'],
        ts_ms: Date.now(),
        payload: event.payload,
      };
      inMemoryEvents.push(materialized);
      return materialized;
    });
    (repository.listRunEvents as jest.Mock).mockImplementation((params: {
      run_id?: string;
      run_ids?: string[];
      event_types?: DeterministicRunEvent['event_type'][];
      limit?: number;
      offset?: number;
    }) => {
      let events = [...inMemoryEvents];
      if (params.run_id) {
        events = events.filter((event) => event.run_id === params.run_id);
      }
      if (params.run_ids && params.run_ids.length > 0) {
        const set = new Set(params.run_ids);
        events = events.filter((event) => set.has(event.run_id));
      }
      if (params.event_types && params.event_types.length > 0) {
        const set = new Set(params.event_types);
        events = events.filter((event) => set.has(event.event_type));
      }
      events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      if (params.offset && params.offset > 0) {
        events = events.slice(params.offset);
      }
      if (params.limit && params.limit > 0) {
        events = events.slice(0, params.limit);
      }
      return events;
    });
    (repository.pruneRunEvents as jest.Mock).mockImplementation((params: {
      before_ts_ms: number;
      run_id?: string;
      run_ids?: string[];
      event_types?: DeterministicRunEvent['event_type'][];
      keep_latest_per_run?: number;
    }) => {
      const runIdSet = params.run_ids ? new Set(params.run_ids) : undefined;
      const eventTypeSet = params.event_types ? new Set(params.event_types) : undefined;

      const candidates = inMemoryEvents.filter((event) => {
        if (event.ts_ms >= params.before_ts_ms) {
          return false;
        }
        if (params.run_id && event.run_id !== params.run_id) {
          return false;
        }
        if (runIdSet && !runIdSet.has(event.run_id)) {
          return false;
        }
        if (eventTypeSet && !eventTypeSet.has(event.event_type)) {
          return false;
        }
        return true;
      });

      const keepLatestPerRun = params.keep_latest_per_run ?? 0;
      const retainedIds = new Set<string>();
      if (keepLatestPerRun > 0) {
        const byRun = new Map<string, DeterministicRunEvent[]>();
        for (const event of candidates) {
          const existing = byRun.get(event.run_id);
          if (existing) {
            existing.push(event);
          } else {
            byRun.set(event.run_id, [event]);
          }
        }

        for (const events of byRun.values()) {
          events.sort((a, b) => {
            if (a.ts_ms !== b.ts_ms) {
              return b.ts_ms - a.ts_ms;
            }
            return (b.sequence ?? 0) - (a.sequence ?? 0);
          });
          for (let index = 0; index < Math.min(keepLatestPerRun, events.length); index += 1) {
            retainedIds.add(events[index].event_id);
          }
        }
      }

      const deleteIds = new Set(
        candidates
          .filter((event) => !retainedIds.has(event.event_id))
          .map((event) => event.event_id)
      );

      if (deleteIds.size === 0) {
        return { deleted: 0 };
      }

      let deleted = 0;
      const keptEvents: DeterministicRunEvent[] = [];
      for (const event of inMemoryEvents) {
        if (deleteIds.has(event.event_id)) {
          deleted += 1;
        } else {
          keptEvents.push(event);
        }
      }

      inMemoryEvents.length = 0;
      inMemoryEvents.push(...keptEvents);
      return { deleted };
    });
  });

  it('returns internal runtime config for admin sessions', async () => {
    const result = await rpc.handle('internal.runtime.config', {}, createSession(['admin']));
    expect(result).toEqual({
      deterministicRuntimeEnabled: true,
      planCompilerEnabled: true,
      toolRoutingMode: 'system_only',
      runtimeRollout: {
        shadowModeEnabled: false,
        canaryPercent: 0,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 0,
          compile: 0,
          replay: 0,
        },
      },
      agent: {
        mainAgentId: 'lead',
      },
      tui: {
        sessionFirstEnabled: true,
        goalSubmitFastPathEnabled: false,
        inputBackgroundColor: 'gray',
      },
    });
  });

  it('wires internal.runtime.daemon.detach to the existing attachment-owned detach seam', async () => {
    const rpcWithDetach = new RpcHandler();
    const mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;
    const attachment = new GatewayDaemonAttachment(mockEventBus);
    const daemon = new TestDaemonEmitter();

    attachment.connect(daemon);

    registerInternalRuntimeHandlers(
      rpcWithDetach,
      repository,
      () => ({
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 0,
            replay: 0,
          },
        },
        agent: {
          mainAgentId: 'lead',
        },
        tui: {
          inputBackgroundColor: 'gray',
          sessionFirstEnabled: true,
          goalSubmitFastPathEnabled: false,
        },
      }),
      () => toolRegistry,
      undefined,
      {
        detachDaemon: () => {
          attachment.detach();
          return attachment.getOperationState();
        },
      }
    );

    const detachResult = await rpcWithDetach.handle(
      'internal.runtime.daemon.detach',
      {},
      createSession(['admin'])
    );

    daemon.emitGoalCreated(goal);

    expect(detachResult).toEqual({
      attachment: {
        daemon: null,
        status: {
          phase: 'detached',
          connected: false,
          connectedAt: null,
        },
      },
      detach: {
        phase: 'idle',
        attached: false,
        detachSupported: true,
        unsubscribeSupported: false,
      },
    });
    expect(mockEventBus.emit).not.toHaveBeenCalled();
    expect(attachment.getStatus()).toEqual({
      phase: 'detached',
      connected: false,
      connectedAt: null,
    });

    const secondDetachResult = await rpcWithDetach.handle(
      'internal.runtime.daemon.detach',
      {},
      createSession(['admin'])
    );

    expect(secondDetachResult).toEqual(detachResult);

    const reattachedDaemon = new TestDaemonEmitter();
    attachment.connect(reattachedDaemon);
    reattachedDaemon.emitGoalCreated(goal);

    expect(attachment.getStatus()).toEqual({
      phase: 'attached',
      connected: true,
      connectedAt: expect.any(Number),
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'attached-awaiting-daemon-unsubscribe',
      attached: true,
      detachSupported: true,
      unsubscribeSupported: false,
    });
    expect(mockEventBus.emit).toHaveBeenCalledWith('goal.created', {
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      priority: goal.priority,
    });
  });

  it('returns plan.v1 projection from goal and work items', async () => {
    const result = await rpc.handle('internal.plan.get', { goalId: goal.id }, createSession(['admin'])) as PlanV1;

    expect(result.schema_version).toBe('plan.v1');
    expect(result.plan_id).toMatch(new RegExp(`^plan-${goal.id}-[a-f0-9]{16}$`));
    const parsedGoal = JSON.parse(result.goal) as {
      title: string;
      description: string;
      priority: number;
      success_criteria: Array<{ description: string; verification_method: string }>;
      tags: string[];
    };

    expect(parsedGoal.title).toBe(goal.title);
    expect(parsedGoal.description).toBe(goal.description);
    expect(parsedGoal.priority).toBe(goal.priority);
    expect(parsedGoal.success_criteria).toHaveLength(2);
    expect(parsedGoal.success_criteria[0].description).toBe('lint passes');
    expect(parsedGoal.success_criteria[1].description).toBe('review completed');
    expect(parsedGoal.tags).toEqual(['deterministic', 'runtime', 'scheduler']);
    expect(result.steps).toHaveLength(2);

    const firstStep = result.steps.find((step) => step.id === workItem.id);
    const secondStep = result.steps.find((step) => step.id === dependentWorkItem.id);

    expect(firstStep).toMatchObject({
      id: workItem.id,
      type: 'tool_call',
      tool_ref: 'local://read_file',
    });
    expect(firstStep?.args).toEqual({ path: '/tmp/project.txt' });
    expect(secondStep).toMatchObject({
      id: dependentWorkItem.id,
      type: 'transform',
      depends_on: [workItem.id],
    });
  });

  it('produces deterministic goal serialization across repeated plan.get calls', async () => {
    const first = await rpc.handle('internal.plan.get', { goalId: goal.id }, createSession(['admin'])) as PlanV1;
    const second = await rpc.handle('internal.plan.get', { goalId: goal.id }, createSession(['admin'])) as PlanV1;

    expect(first.goal).toBe(second.goal);
    expect(first.plan_id).toBe(second.plan_id);
  });

  it('changes plan_id when projected steps change', async () => {
    const first = await rpc.handle('internal.plan.get', { goalId: goal.id }, createSession(['admin'])) as PlanV1;

    const mutatedItems = [
      workItem,
      {
        ...dependentWorkItem,
        dependencies: [],
      },
    ];
    (repository.getWorkItemsByGoal as jest.Mock).mockReturnValue(mutatedItems);

    const second = await rpc.handle('internal.plan.get', { goalId: goal.id }, createSession(['admin'])) as PlanV1;

    expect(first.plan_id).not.toBe(second.plan_id);
  });

  it('supports plan.get -> plan.compile roundtrip', async () => {
    const plan = await rpc.handle(
      'internal.plan.get',
      { goalId: goal.id },
      createSession(['admin'])
    ) as PlanV1;

    const compileResult = await rpc.handle(
      'internal.plan.compile',
      { plan },
      createSession(['admin'])
    ) as { ok: boolean; acceptedPlan?: { planId: string }; errors: Array<{ code: string }> };

    expect(compileResult.ok).toBe(true);
    expect(compileResult.acceptedPlan?.planId).toBe(plan.plan_id);
    expect(compileResult.errors).toEqual([]);
  });

  it('returns run by id and runs by work item', async () => {
    const runResult = await rpc.handle('internal.run.get', { runId: run.id }, createSession(['admin'])) as Run;
    expect(runResult.id).toBe(run.id);

    const workItemRuns = await rpc.handle(
      'internal.runs.byWorkItem',
      { workItemId: workItem.id },
      createSession(['admin'])
    ) as { runs: Run[] };

    expect(workItemRuns.runs).toHaveLength(1);
    expect(workItemRuns.runs[0].id).toBe(run.id);
  });

  it('returns run not found error when run does not exist', async () => {
    (repository.getRun as jest.Mock).mockReturnValue(undefined);

    await expect(
      rpc.handle('internal.run.get', { runId: 'missing-run' }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.RUN_NOT_FOUND });
  });

  it('requires admin permissions', async () => {
    await expect(
      rpc.handle('internal.runtime.config', {}, createSession(['read']))
    ).rejects.toMatchObject({ code: ErrorCodes.PERMISSION_DENIED });
  });

  it('validates tool manifests from registry', async () => {
    const result = await rpc.handle(
      'internal.toolManifest.validate',
      { requireManifest: true },
      createSession(['admin'])
    ) as { valid: boolean; manifestsValidated: number; issues: Array<{ code: string }> };

    expect(result.valid).toBe(true);
    expect(result.manifestsValidated).toBeGreaterThanOrEqual(1);
    expect(result.issues).toEqual([]);
  });

  it('returns internal error when manifest validation runs without tool registry', async () => {
    const rpcWithoutRegistry = new RpcHandler();
    registerInternalRuntimeHandlers(
      rpcWithoutRegistry,
      repository,
      () => ({
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 0,
            replay: 0,
          },
        },
        agent: {
          mainAgentId: 'lead',
        },
        tui: {
          inputBackgroundColor: 'gray',
          sessionFirstEnabled: true,
          goalSubmitFastPathEnabled: false,
        },
      })
    );

    await expect(
      rpcWithoutRegistry.handle('internal.toolManifest.validate', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INTERNAL_ERROR });
  });

  it('compiles a valid plan via internal.plan.compile', async () => {
    const result = await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-0001',
          goal: 'Compile through internal RPC',
          steps: [
            {
              id: 'read_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/ok.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    ) as { ok: boolean; compile_run_id: string; acceptedPlan?: { planId: string }; errors: Array<{ code: string }> };

    expect(result.ok).toBe(true);
    expect(result.acceptedPlan?.planId).toBe('plan-rpc-0001');
    expect(result.compile_run_id).toBe('compile-plan-rpc-0001');
    expect(result.errors).toEqual([]);

    const events = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-0001' },
      createSession(['admin'])
    ) as { runId: string; events: Array<{ event_type: string; payload: { ok?: boolean } }> };

    expect(events.runId).toBe('compile-plan-rpc-0001');
    expect(events.events).toHaveLength(2);
    expect(events.events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
    expect(events.events[1].event_type).toBe('PLAN_COMPILE_COMPLETED');
    expect(events.events[1].payload.ok).toBe(true);
  });

  it('returns compile errors for invalid plans via internal.plan.compile', async () => {
    const result = await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-invalid-1001',
          goal: 'Invalid compile request',
          steps: [
            {
              id: 'broken',
              type: 'tool_call',
              tool_ref: 'local://unknown_tool',
              args: {},
            },
          ],
        },
      },
      createSession(['admin'])
    ) as { ok: boolean; compile_run_id: string; errors: Array<{ code: string }> };

    expect(result.ok).toBe(false);
    expect(result.compile_run_id).toBe('compile-plan-rpc-invalid-1001');
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_TOOL_NOT_FOUND)).toBe(true);

    const events = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-invalid-1001' },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string; payload: { ok?: boolean; error_count?: number } }> };

    expect(events.events).toHaveLength(2);
    expect(events.events[1].event_type).toBe('PLAN_COMPILE_FAILED');
    expect(events.events[1].payload.ok).toBe(false);
    expect(typeof events.events[1].payload.error_count).toBe('number');
  });

  it('applies runtimeProfile policy checks in internal.plan.compile', async () => {
    const result = await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-policy-1001',
          goal: 'Policy enforced compile',
          steps: [
            {
              id: 'script_step',
              type: 'script_execute',
              script_ref: 'script-policy-1',
              language: 'bash',
              timeout_ms: 30000,
              args: {
                max_output_bytes: 1024,
                requires_network: true,
                app: 'Terminal',
              },
            },
          ],
        },
        runtimeProfile: {
          profile_id: 'rpc-policy-profile',
          tool_routing: {
            mode: 'system_only',
            allow_model_native_tools: false,
            resolution_order: ['skills', 'local_tools'],
          },
          policy: {
            default_network: 'deny',
            default_filesystem_scope: {
              read: ['/tmp'],
              write: ['/tmp'],
            },
            require_human_approval_for: ['script_execute'],
            script_sandbox: {
              allowed_languages: ['applescript'],
              no_network: true,
              allowed_apps: ['Finder'],
              max_runtime_ms: 5000,
            },
          },
        },
      },
      createSession(['admin'])
    ) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_REQUIRE_HUMAN_APPROVAL)).toBe(true);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED)).toBe(true);
  });

  it('returns policy denied errors when runtimeProfile schema is invalid', async () => {
    const result = await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-runtime-profile-invalid-1001',
          goal: 'Invalid runtime profile should fail compile',
          steps: [
            {
              id: 'read_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/a.txt' },
            },
          ],
        },
        runtimeProfile: {
          profile_id: 'invalid-profile',
          tool_routing: {
            mode: 'system_only',
            allow_model_native_tools: false,
            resolution_order: ['skills'],
          },
          policy: {
            default_filesystem_scope: {
              read: ['/tmp'],
            },
          },
        },
      },
      createSession(['admin'])
    ) as { ok: boolean; errors: Array<{ code: string; path: string }> };

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED)).toBe(true);
    expect(result.errors.some((error) => error.path.includes('/policy/default_network'))).toBe(true);
  });

  it('returns invalid params when runId is missing for internal.runs.events', async () => {
    await expect(
      rpc.handle('internal.runs.events', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('supports limit for internal.runs.events and returns latest events', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-limit-1001',
          goal: 'Compile to test event limits',
          steps: [
            {
              id: 'limit_step',
              type: 'tool_call',
              tool_ref: 'local://unknown_tool',
              args: {},
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const result = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-limit-1001', limit: 1 },
      createSession(['admin'])
    ) as { offset: number; returned: number; nextOffset?: number; events: Array<{ event_type: string }> };

    expect(result.offset).toBe(0);
    expect(result.returned).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
  });

  it('supports offset pagination for internal.runs.events', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-page-1001',
          goal: 'Pagination test',
          steps: [
            {
              id: 'page_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/page.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const page1 = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-page-1001', limit: 1, offset: 0 },
      createSession(['admin'])
    ) as { offset: number; returned: number; nextOffset?: number; events: Array<{ event_type: string }> };

    expect(page1.offset).toBe(0);
    expect(page1.returned).toBe(1);
    expect(page1.nextOffset).toBe(1);
    expect(page1.events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');

    const page2 = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-page-1001', limit: 1, offset: page1.nextOffset },
      createSession(['admin'])
    ) as { offset: number; returned: number; nextOffset?: number; events: Array<{ event_type: string }> };

    expect(page2.offset).toBe(1);
    expect(page2.returned).toBe(1);
    expect(page2.nextOffset).toBeUndefined();
    expect(page2.events[0].event_type).toBe('PLAN_COMPILE_COMPLETED');
  });

  it('supports cursor pagination for internal.runs.events', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-cursor-1001',
          goal: 'Cursor pagination test',
          steps: [
            {
              id: 'cursor_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/cursor.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const page1 = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-cursor-1001', limit: 1, cursor: '0' },
      createSession(['admin'])
    ) as { offset: number; returned: number; nextOffset?: number; nextCursor?: string; events: Array<{ event_type: string }> };

    expect(page1.offset).toBe(0);
    expect(page1.returned).toBe(1);
    expect(page1.nextOffset).toBe(1);
    expect(page1.nextCursor).toBe('1');

    const page2 = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-cursor-1001', limit: 1, cursor: page1.nextCursor },
      createSession(['admin'])
    ) as { offset: number; returned: number; nextOffset?: number; nextCursor?: string; events: Array<{ event_type: string }> };

    expect(page2.offset).toBe(1);
    expect(page2.returned).toBe(1);
    expect(page2.nextOffset).toBeUndefined();
    expect(page2.nextCursor).toBeUndefined();
    expect(page2.events[0].event_type).toBe('PLAN_COMPILE_COMPLETED');
  });

  it('returns invalid params when internal.runs.events limit is invalid', async () => {
    await expect(
      rpc.handle('internal.runs.events', { runId: 'compile-plan-rpc-0001', limit: 0 }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params when internal.runs.events offset is invalid', async () => {
    await expect(
      rpc.handle('internal.runs.events', { runId: 'compile-plan-rpc-0001', offset: -1 }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle('internal.runs.events', { runId: 'compile-plan-rpc-0001', offset: 1.5 }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params when internal.runs.events cursor is invalid', async () => {
    await expect(
      rpc.handle('internal.runs.events', { runId: 'compile-plan-rpc-0001', cursor: '' }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle('internal.runs.events', { runId: 'compile-plan-rpc-0001', cursor: '-1' }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params when internal.runs.events provides both offset and cursor', async () => {
    await expect(
      rpc.handle(
        'internal.runs.events',
        { runId: 'compile-plan-rpc-0001', offset: 0, cursor: '0' },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('filters run events by eventTypes', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-filter-1001',
          goal: 'Filter event types',
          steps: [
            {
              id: 'filter_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/filter.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const filtered = await rpc.handle(
      'internal.runs.events',
      {
        runId: 'compile-plan-rpc-filter-1001',
        eventTypes: ['PLAN_COMPILE_COMPLETED'],
      },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string }> };

    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0].event_type).toBe('PLAN_COMPILE_COMPLETED');
  });

  it('aggregates events across runId and relatedRunId', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-related-1001',
          goal: 'Related run aggregation',
          steps: [
            {
              id: 'related_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/related.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-rpc-related-1001',
        compileRunId: 'compile-plan-rpc-related-1001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-rpc-related-1001',
          goal: 'Related run aggregation',
          steps: [],
        },
      },
      createSession(['admin'])
    );

    const result = await rpc.handle(
      'internal.runs.events',
      {
        runId: 'compile-plan-rpc-related-1001',
        relatedRunId: 'run-plan-rpc-related-1001',
      },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string }> };

    const eventTypes = result.events.map((event) => event.event_type);
    expect(eventTypes).toContain('PLAN_COMPILE_REQUESTED');
    expect(eventTypes).toContain('PLAN_COMPILE_COMPLETED');
    expect(eventTypes).toContain('RUN_CREATED');
    expect(eventTypes).toContain('RUN_LINKED');
    expect((repository.listRunEvents as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('returns invalid params when eventTypes is invalid', async () => {
    await expect(
      rpc.handle(
        'internal.runs.events',
        {
          runId: 'compile-plan-rpc-0001',
          eventTypes: [],
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.events',
        {
          runId: 'compile-plan-rpc-0001',
          eventTypes: ['INVALID_EVENT'] as unknown as string[],
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('prunes run events via internal.runs.events.prune', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-rpc-prune-1001',
          goal: 'Prune events',
          steps: [
            {
              id: 'prune_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/prune.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const runBefore = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-prune-1001' },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string }> };
    expect(runBefore.events).toHaveLength(2);

    const pruneResult = await rpc.handle(
      'internal.runs.events.prune',
      {
        beforeTsMs: Date.now() + 60_000,
        runId: 'compile-plan-rpc-prune-1001',
        eventTypes: ['PLAN_COMPILE_REQUESTED'],
      },
      createSession(['admin'])
    ) as { deleted: number };

    expect(pruneResult.deleted).toBe(1);

    const runAfter = await rpc.handle(
      'internal.runs.events',
      { runId: 'compile-plan-rpc-prune-1001' },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string }> };
    expect(runAfter.events).toHaveLength(1);
    expect(runAfter.events[0].event_type).toBe('PLAN_COMPILE_COMPLETED');
  });

  it('returns invalid params when internal.runs.events.prune params are invalid', async () => {
    await expect(
      rpc.handle('internal.runs.events.prune', { beforeTsMs: -1 }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.events.prune',
        { beforeTsMs: Date.now(), keepLatestPerRun: -1 },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.events.prune',
        { beforeTsMs: Date.now(), runIds: [] },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.events.prune',
        { beforeTsMs: Date.now(), eventTypes: ['INVALID_EVENT'] as unknown as string[] },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('creates runtime run marker via internal.run.create and records RUN_CREATED event', async () => {
    const result = await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-runtime-2001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-runtime-2001',
          goal: 'runtime create',
          steps: [],
        },
      },
      createSession(['admin'])
    ) as { run_id: string; plan_id: string; status: string };

    expect(result).toEqual({
      run_id: 'run-plan-runtime-2001',
      plan_id: 'plan-runtime-2001',
      status: 'created',
    });

    const events = await rpc.handle(
      'internal.runs.events',
      { runId: 'run-plan-runtime-2001' },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string; payload: { source?: string } }> };

    expect(events.events).toHaveLength(1);
    expect(events.events[0].event_type).toBe('RUN_CREATED');
    expect(events.events[0].payload.source).toBe('internal.run.create');
  });

  it('records RUN_LINKED event when compileRunId is provided', async () => {
    await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-runtime-3001',
        compileRunId: 'compile-plan-runtime-3001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-runtime-3001',
          goal: 'runtime linked create',
          steps: [],
        },
      },
      createSession(['admin'])
    );

    const events = await rpc.handle(
      'internal.runs.events',
      { runId: 'run-plan-runtime-3001' },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string; payload: { compile_run_id?: string; runtime_run_id?: string } }> };

    expect(events.events).toHaveLength(2);
    expect(events.events[0].event_type).toBe('RUN_CREATED');
    expect(events.events[1].event_type).toBe('RUN_LINKED');
    expect(events.events[1].payload.compile_run_id).toBe('compile-plan-runtime-3001');
    expect(events.events[1].payload.runtime_run_id).toBe('run-plan-runtime-3001');
  });

  it('builds timeline for compile + runtime linked runs', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-timeline-1001',
          goal: 'Timeline test',
          steps: [
            {
              id: 'timeline_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/timeline.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-timeline-1001',
        compileRunId: 'compile-plan-timeline-1001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-timeline-1001',
          goal: 'Timeline test',
          steps: [],
        },
      },
      createSession(['admin'])
    );

    const timeline = await rpc.handle(
      'internal.runs.timeline',
      {
        runId: 'compile-plan-timeline-1001',
        relatedRunId: 'run-plan-timeline-1001',
      },
      createSession(['admin'])
    ) as {
      status: string;
      phases: Array<{ phase: string; event_type: string }>;
    };

    expect(timeline.status).toBe('completed');
    expect(timeline.phases.map((phase) => phase.event_type)).toEqual([
      'PLAN_COMPILE_REQUESTED',
      'PLAN_COMPILE_COMPLETED',
      'RUN_CREATED',
      'RUN_LINKED',
    ]);
    expect(timeline.phases.map((phase) => phase.phase)).toEqual([
      'compile_requested',
      'compile_completed',
      'run_created',
      'run_linked',
    ]);
  });

  it('returns failed timeline status when compile failed', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-timeline-fail-1001',
          goal: 'Timeline fail test',
          steps: [
            {
              id: 'timeline_fail_step',
              type: 'tool_call',
              tool_ref: 'local://unknown_tool',
              args: {},
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const timeline = await rpc.handle(
      'internal.runs.timeline',
      { runId: 'compile-plan-timeline-fail-1001' },
      createSession(['admin'])
    ) as { status: string; phases: Array<{ event_type: string }> };

    expect(timeline.status).toBe('failed');
    expect(timeline.phases[timeline.phases.length - 1].event_type).toBe('PLAN_COMPILE_FAILED');
  });

  it('returns invalid params when internal.runs.timeline runId is missing', async () => {
    await expect(
      rpc.handle('internal.runs.timeline', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('replays facts_only summary for compile + runtime linked runs', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-replay-1001',
          goal: 'Replay test',
          steps: [
            {
              id: 'replay_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/replay.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-replay-1001',
        compileRunId: 'compile-plan-replay-1001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-replay-1001',
          goal: 'Replay test',
          steps: [],
        },
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.run.create',
      {
        planId: 'plan-replay-1001',
        acceptedPlan: {
          schemaVersion: 'plan.v1',
          planId: 'plan-replay-1001',
          goal: 'Replay test artifacts',
          steps: [],
        },
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.runs.events',
      {
        runId: 'run-plan-replay-1001',
      },
      createSession(['admin'])
    );

    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-replay-1001-artifact',
          goal: 'Replay artifact event',
          steps: [
            {
              id: 'replay_artifact_step',
              type: 'tool_call',
              tool_ref: 'local://unknown_tool',
              args: {},
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const replay = await rpc.handle(
      'internal.runs.replay',
      {
        runId: 'compile-plan-replay-1001',
        relatedRunId: 'run-plan-replay-1001',
        mode: 'facts_only',
      },
      createSession(['admin'])
    ) as {
      mode: string;
      status: string;
      summary: {
        total_events: number;
        compile_run_id?: string;
        runtime_run_id?: string;
        event_counts: Record<string, number>;
        facts_count: number;
        artifacts_count: number;
      };
      indexes: {
        facts: Array<{ key: string }>;
        artifacts: Array<{ id: string }>;
      };
      phases: Array<{ event_type: string }>;
    };

    expect(replay.mode).toBe('facts_only');
    expect(replay.status).toBe('completed');
    expect(replay.summary.total_events).toBeGreaterThanOrEqual(4);
    expect(replay.summary.compile_run_id).toBe('compile-plan-replay-1001');
    expect(replay.summary.runtime_run_id).toBe('run-plan-replay-1001');
    expect(replay.summary.event_counts.PLAN_COMPILE_REQUESTED).toBe(1);
    expect(replay.summary.event_counts.PLAN_COMPILE_COMPLETED).toBe(1);
    expect((replay.summary.event_counts.RUN_CREATED ?? 0)).toBeGreaterThanOrEqual(1);
    expect((replay.summary.event_counts.RUN_LINKED ?? 0)).toBeGreaterThanOrEqual(1);
    expect(replay.summary.facts_count).toBeGreaterThanOrEqual(0);
    expect(replay.summary.artifacts_count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(replay.indexes.facts)).toBe(true);
    expect(Array.isArray(replay.indexes.artifacts)).toBe(true);
    expect(replay.phases.length).toBeGreaterThanOrEqual(4);
  });

  it('replay indexes are empty when no facts/artifacts in payload', async () => {
    await rpc.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-replay-empty-1001',
          goal: 'Replay empty indexes',
          steps: [
            {
              id: 'replay_empty_step',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/replay-empty.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    );

    const replay = await rpc.handle(
      'internal.runs.replay',
      { runId: 'compile-plan-replay-empty-1001', mode: 'facts_only' },
      createSession(['admin'])
    ) as {
      summary: { facts_count: number; artifacts_count: number };
      indexes: { facts: unknown[]; artifacts: unknown[] };
    };

    expect(replay.summary.facts_count).toBe(0);
    expect(replay.summary.artifacts_count).toBe(0);
    expect(replay.indexes.facts).toEqual([]);
    expect(replay.indexes.artifacts).toEqual([]);
  });

  it('returns invalid params when internal.runs.replay runId is missing', async () => {
    await expect(
      rpc.handle('internal.runs.replay', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns structured skeleton for reexecute_tools replay mode', async () => {
    const replay = await rpc.handle(
      'internal.runs.replay',
      { runId: 'compile-plan-replay-empty-1001', mode: 'reexecute_tools' },
      createSession(['admin'])
    ) as {
      mode: string;
      reexecution?: {
        status: string;
        attempted_steps: number;
        eligible_steps: number;
        executed_steps: number;
        skipped: Array<{ tool: string; reason: string }>;
      };
    };

    expect(replay.mode).toBe('reexecute_tools');
    expect(replay.reexecution).toEqual({
      status: 'dry_run_only',
      attempted_steps: 0,
      eligible_steps: 0,
      executed_steps: 0,
      skipped: [],
      message: 'reexecute_tools dry-run skeleton: candidates analyzed, execution is intentionally disabled',
    });
  });

  it('reports allowlist and registry filtering in reexecute_tools dry-run skeleton', async () => {
    repository.appendRunEvent?.({
      run_id: 'compile-plan-replay-empty-1001',
      plan_id: 'plan-replay-empty-1001',
      event_type: 'PLAN_COMPILE_COMPLETED',
      payload: {
        tool_ref: 'local://read_file',
        nested: {
          tool_name: 'local://missing_tool',
        },
      },
    });

    const replay = await rpc.handle(
      'internal.runs.replay',
      {
        runId: 'compile-plan-replay-empty-1001',
        mode: 'reexecute_tools',
        allowTools: ['local://read_file'],
        maxAttempts: 10,
      },
      createSession(['admin'])
    ) as {
      reexecution?: {
        attempted_steps: number;
        eligible_steps: number;
        executed_steps: number;
        skipped: Array<{ tool: string; reason: string }>;
      };
    };

    expect(replay.reexecution?.attempted_steps).toBeGreaterThanOrEqual(2);
    expect(replay.reexecution?.eligible_steps).toBe(1);
    expect(replay.reexecution?.executed_steps).toBe(0);
    expect(replay.reexecution?.skipped).toContainEqual({
      tool: 'local://missing_tool',
      reason: 'not_allowlisted',
    });
  });

  it('returns invalid params for unknown replay mode', async () => {
    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', mode: 'unknown_mode' as 'facts_only' },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params for malformed reexecute_tools options', async () => {
    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', mode: 'reexecute_tools', allowTools: ['local://read_file', ''] },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', mode: 'reexecute_tools', maxAttempts: 0 },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', mode: 'reexecute_tools', enableExecution: 'yes' as unknown as boolean },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', mode: 'reexecute_tools', enableExecution: true },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('executes safe idempotent replay tools when enableExecution is true', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ponybunny-replay-'));
    const filePath = join(tempDir, 'replay.txt');
    writeFileSync(filePath, 'replay-ok', 'utf-8');

    try {
      repository.appendRunEvent?.({
        run_id: 'compile-plan-replay-empty-1001',
        plan_id: 'plan-replay-empty-1001',
        event_type: 'PLAN_COMPILE_COMPLETED',
        payload: {
          tool_ref: 'local://read_file',
          args: {
            path: filePath,
          },
        },
      });

      const replay = await rpc.handle(
        'internal.runs.replay',
        {
          runId: 'compile-plan-replay-empty-1001',
          mode: 'reexecute_tools',
          allowTools: ['local://read_file'],
          maxAttempts: 10,
          enableExecution: true,
          reexecutionIdempotencyKey: 'idem-replay-1',
        },
        createSession(['admin'])
      ) as {
        reexecution?: {
          attempted_steps: number;
          eligible_steps: number;
          executed_steps: number;
          skipped: Array<{ tool: string; reason: string }>;
          message: string;
        };
      };

      expect(replay.reexecution?.attempted_steps).toBeGreaterThanOrEqual(1);
      expect(replay.reexecution?.eligible_steps).toBeGreaterThanOrEqual(1);
      expect(replay.reexecution?.executed_steps).toBeGreaterThanOrEqual(1);
      expect(replay.reexecution?.message).toContain('attempted safe/idempotent execution');
      expect(replay.reexecution?.skipped.some((entry) => entry.reason === 'execution_disabled')).toBe(false);

      const replayEvents = await rpc.handle(
        'internal.runs.events',
        {
          runId: 'compile-plan-replay-empty-1001',
          eventTypes: [
            'REPLAY_REEXECUTION_REQUESTED',
            'REPLAY_REEXECUTION_STEP_EXECUTED',
            'REPLAY_REEXECUTION_COMPLETED',
          ],
        },
        createSession(['admin'])
      ) as { events: Array<{ event_type: string }> };

      const replayEventTypes = replayEvents.events.map((event) => event.event_type);
      expect(replayEventTypes).toContain('REPLAY_REEXECUTION_REQUESTED');
      expect(replayEventTypes).toContain('REPLAY_REEXECUTION_STEP_EXECUTED');
      expect(replayEventTypes).toContain('REPLAY_REEXECUTION_COMPLETED');

      const replaySecond = await rpc.handle(
        'internal.runs.replay',
        {
          runId: 'compile-plan-replay-empty-1001',
          mode: 'reexecute_tools',
          allowTools: ['local://read_file'],
          maxAttempts: 10,
          enableExecution: true,
          reexecutionIdempotencyKey: 'idem-replay-1',
        },
        createSession(['admin'])
      ) as {
        reexecution?: {
          executed_steps: number;
          message: string;
        };
      };

      expect(replaySecond.reexecution?.executed_steps).toBeGreaterThanOrEqual(1);
      expect(replaySecond.reexecution?.message).toContain('reused existing idempotent execution result');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('executes dryRun pipeline successfully for valid goal', async () => {
    const result = await rpc.handle(
      'internal.runtime.executeDryRun',
      { goalId: goal.id },
      createSession(['admin'])
    ) as {
      ok: boolean;
      goalId: string;
      basePlan: PlanV1;
      plan: PlanV1;
      diff: {
        hasOverrides: boolean;
        goalChanged: boolean;
        planIdChanged: boolean;
        changedStepIds: string[];
        changedStepCount: number;
        goalFieldChanges: string[];
        stepStructureChanges: { added: number; removed: number; modified: number };
        toolRefChanges: number;
        argsChanges: number;
      };
      report: {
        summary: string;
        status: string;
        kpi: {
          compileOk: boolean;
          planStepCount: number;
          changedStepCount: number;
          goalFieldChangeCount: number;
          replayEventCount: number;
          replayFactsCount: number;
          replayArtifactsCount: number;
        };
      };
      compile: { ok: boolean; compile_run_id: string; acceptedPlan?: { planId: string } };
      run?: { run_id: string; plan_id: string; status: string };
      replay: { mode: string; status: string; summary: { total_events: number } };
    };

    expect(result.ok).toBe(true);
    expect(result.goalId).toBe(goal.id);
    expect(result.basePlan.plan_id).toBe(result.plan.plan_id);
    expect(result.plan.schema_version).toBe('plan.v1');
    expect(result.diff).toEqual({
      hasOverrides: false,
      goalChanged: false,
      planIdChanged: false,
      changedStepIds: [],
      changedStepCount: 0,
      goalFieldChanges: [],
      stepStructureChanges: { added: 0, removed: 0, modified: 0 },
      toolRefChanges: 0,
      argsChanges: 0,
    });
    expect(result.compile.ok).toBe(true);
    expect(result.report.status).toBe('pass');
    expect(result.report.kpi.compileOk).toBe(true);
    expect(result.report.kpi.planStepCount).toBe(result.plan.steps.length);
    expect(result.report.kpi.changedStepCount).toBe(0);
    expect(result.report.kpi.goalFieldChangeCount).toBe(0);
    expect(result.report.kpi.replayEventCount).toBeGreaterThanOrEqual(4);
    expect(result.compile.compile_run_id).toBe(`compile-${result.plan.plan_id}`);
    expect(result.run).toBeDefined();
    expect(result.run?.status).toBe('created');
    expect(result.replay.mode).toBe('facts_only');
    expect(result.replay.status).toBe('completed');
    expect(result.replay.summary.total_events).toBeGreaterThanOrEqual(4);
  });

  it('returns dryRun compile failure without runtime run creation', async () => {
    const invalidGoal: Goal = {
      ...goal,
      id: 'goal-invalid-dryrun-1',
      title: 'Invalid dry run goal',
    };
    const invalidWorkItem: WorkItem = {
      ...workItem,
      id: 'wi-invalid-dryrun-1',
      goal_id: invalidGoal.id,
      context: {
        planStep: {
          type: 'tool_call',
          tool_ref: 'local://unknown_tool',
          args: {},
        },
      },
    };

    (repository.getGoal as jest.Mock).mockImplementation((goalId: string) => {
      if (goalId === invalidGoal.id) {
        return invalidGoal;
      }
      return goal;
    });
    (repository.getWorkItemsByGoal as jest.Mock).mockImplementation((goalId: string) => {
      if (goalId === invalidGoal.id) {
        return [invalidWorkItem];
      }
      return [workItem, dependentWorkItem];
    });

    const result = await rpc.handle(
      'internal.runtime.executeDryRun',
      { goalId: invalidGoal.id },
      createSession(['admin'])
    ) as {
      ok: boolean;
      basePlan: PlanV1;
      plan: PlanV1;
      diff: {
        hasOverrides: boolean;
        goalChanged: boolean;
        planIdChanged: boolean;
        changedStepIds: string[];
        changedStepCount: number;
        goalFieldChanges: string[];
        stepStructureChanges: { added: number; removed: number; modified: number };
        toolRefChanges: number;
        argsChanges: number;
      };
      report: {
        status: string;
        summary: string;
        kpi: {
          compileOk: boolean;
          changedStepCount: number;
          goalFieldChangeCount: number;
        };
      };
      compile: { ok: boolean; errors: Array<{ code: string }> };
      run?: unknown;
      replay: { status: string };
    };

    expect(result.ok).toBe(false);
    expect(result.diff.hasOverrides).toBe(false);
    expect(result.diff.goalFieldChanges).toEqual([]);
    expect(result.diff.stepStructureChanges).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.diff.toolRefChanges).toBe(0);
    expect(result.diff.argsChanges).toBe(0);
    expect(result.report.status).toBe('fail');
    expect(result.report.kpi.compileOk).toBe(false);
    expect(result.report.summary).toContain('dryRun failed');
    expect(result.basePlan.plan_id).toBe(result.plan.plan_id);
    expect(result.compile.ok).toBe(false);
    expect(result.compile.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_TOOL_NOT_FOUND)).toBe(true);
    expect(result.run).toBeUndefined();
    expect(result.replay.status).toBe('failed');
  });

  it('returns invalid params when dryRun goalId is missing', async () => {
    await expect(
      rpc.handle('internal.runtime.executeDryRun', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('applies dryRun goalOverride and workItemOverrides in-memory', async () => {
    const result = await rpc.handle(
      'internal.runtime.executeDryRun',
      {
        goalId: goal.id,
        goalOverride: {
          title: 'Overridden Goal Title',
          description: 'Overridden Goal Description',
          priority: 91,
          tags: ['override', 'shadow'],
        },
        workItemOverrides: [
          {
            id: workItem.id,
            priority: 99,
            context: {
              planStep: {
                type: 'tool_call',
                tool_ref: 'local://read_file',
                args: { path: '/tmp/override.txt' },
              },
            },
          },
        ],
      },
      createSession(['admin'])
    ) as {
      ok: boolean;
      basePlan: PlanV1;
      plan: PlanV1;
      diff: {
        hasOverrides: boolean;
        goalChanged: boolean;
        planIdChanged: boolean;
        changedStepIds: string[];
        changedStepCount: number;
        goalFieldChanges: string[];
        stepStructureChanges: { added: number; removed: number; modified: number };
        toolRefChanges: number;
        argsChanges: number;
      };
      report: {
        status: string;
        summary: string;
        kpi: {
          compileOk: boolean;
          changedStepCount: number;
          goalFieldChangeCount: number;
        };
      };
    };

    expect(result.ok).toBe(true);
    expect(result.basePlan.plan_id).not.toBe(result.plan.plan_id);
    expect(result.diff.hasOverrides).toBe(true);
    expect(result.diff.goalChanged).toBe(true);
    expect(result.diff.planIdChanged).toBe(true);
    expect(result.diff.goalFieldChanges).toEqual(['title', 'description', 'priority', 'tags']);
    expect(result.diff.stepStructureChanges).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(result.diff.toolRefChanges).toBe(0);
    expect(result.diff.argsChanges).toBe(1);
    expect(result.report.status).toBe('pass');
    expect(result.report.kpi.compileOk).toBe(true);
    expect(result.report.kpi.changedStepCount).toBeGreaterThanOrEqual(1);
    expect(result.report.kpi.goalFieldChangeCount).toBe(4);
    expect(result.report.summary).toContain('dryRun passed');
    expect(result.diff.changedStepIds).toContain(workItem.id);
    expect(result.diff.changedStepCount).toBeGreaterThanOrEqual(1);
    const serializedGoal = JSON.parse(result.plan.goal) as {
      title: string;
      description: string;
      priority: number;
      tags: string[];
    };

    expect(serializedGoal.title).toBe('Overridden Goal Title');
    expect(serializedGoal.description).toBe('Overridden Goal Description');
    expect(serializedGoal.priority).toBe(91);
    expect(serializedGoal.tags).toEqual(['override', 'shadow']);

    const overriddenStep = result.plan.steps.find((step) => step.id === workItem.id);
    expect(overriddenStep?.type).toBe('tool_call');
    expect(overriddenStep?.tool_ref).toBe('local://read_file');
    expect(overriddenStep?.args).toEqual({ path: '/tmp/override.txt' });

    expect(repository.getGoal).toHaveBeenCalledWith(goal.id);
    expect(repository.updateGoalStatus).not.toHaveBeenCalled();
    expect(repository.updateWorkItemStatus).not.toHaveBeenCalled();
  });

  it('returns invalid params for malformed dryRun overrides', async () => {
    await expect(
      rpc.handle(
        'internal.runtime.executeDryRun',
        {
          goalId: goal.id,
          goalOverride: { priority: -1 },
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle(
        'internal.runtime.executeDryRun',
        {
          goalId: goal.id,
          workItemOverrides: [{ id: workItem.id, dependencies: [123] as unknown as string[] }],
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params when relatedRunId is empty in replay', async () => {
    await expect(
      rpc.handle(
        'internal.runs.replay',
        { runId: 'compile-plan-rpc-0001', relatedRunId: '   ' },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns invalid params when internal.run.create params are incomplete', async () => {
    await expect(
      rpc.handle('internal.run.create', { acceptedPlan: {} }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });

    await expect(
      rpc.handle('internal.run.create', { planId: 'plan-runtime-2002' }, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('uses repository-backed run event store by default when repository supports run event APIs', async () => {
    const persistedEvents: DeterministicRunEvent[] = [];

    const repoWithEvents: IWorkOrderRepository = {
      ...repository,
      appendRunEvent: jest.fn((event) => {
        const materialized = {
          event_id: `evt-${persistedEvents.length + 1}`,
          sequence: persistedEvents.length + 1,
          run_id: event.run_id,
          plan_id: event.plan_id,
          event_type: event.event_type,
          ts_ms: event.ts_ms ?? Date.now(),
          payload: event.payload,
        };
        persistedEvents.push(materialized);
        return materialized;
      }),
      listRunEvents: jest.fn(({
        run_id,
        run_ids,
        offset,
        limit,
      }: {
        run_id?: string;
        run_ids?: string[];
        offset?: number;
        limit?: number;
      }) => {
        let events = persistedEvents;
        if (run_id) {
          events = persistedEvents.filter((event) => event.run_id === run_id);
        }
        if (run_ids) {
          const set = new Set(run_ids);
          events = persistedEvents.filter((event) => set.has(event.run_id));
        }
        events = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        if (offset && offset > 0) {
          events = events.slice(offset);
        }
        if (limit && limit > 0) {
          events = events.slice(0, limit);
        }
        return events;
      }),
    };

    const rpcWithPersistedEvents = new RpcHandler();
    registerInternalRuntimeHandlers(
      rpcWithPersistedEvents,
      repoWithEvents,
      () => ({
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 0,
            replay: 0,
          },
        },
        agent: {
          mainAgentId: 'lead',
        },
        tui: {
          inputBackgroundColor: 'gray',
          sessionFirstEnabled: true,
          goalSubmitFastPathEnabled: false,
        },
      }),
      () => toolRegistry
    );

    const compile = await rpcWithPersistedEvents.handle(
      'internal.plan.compile',
      {
        plan: {
          schema_version: 'plan.v1',
          plan_id: 'plan-persisted-1',
          goal: 'Persisted event path',
          steps: [
            {
              id: 's1',
              type: 'tool_call',
              tool_ref: 'local://read_file',
              args: { path: '/tmp/persisted.txt' },
            },
          ],
        },
      },
      createSession(['admin'])
    ) as { compile_run_id: string; ok: boolean };

    expect(compile.ok).toBe(true);

    const events = await rpcWithPersistedEvents.handle(
      'internal.runs.events',
      { runId: compile.compile_run_id },
      createSession(['admin'])
    ) as { events: Array<{ event_type: string }> };

    expect((repoWithEvents.appendRunEvent as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(events.events).toHaveLength(2);
    expect(events.events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
    expect(events.events[1].event_type).toBe('PLAN_COMPILE_COMPLETED');
  });

  it('returns invalid params when plan is missing for internal.plan.compile', async () => {
    await expect(
      rpc.handle('internal.plan.compile', {}, createSession(['admin']))
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PARAMS });
  });

  it('returns internal error when plan.compile runs without tool registry', async () => {
    const rpcWithoutRegistry = new RpcHandler();
    registerInternalRuntimeHandlers(
      rpcWithoutRegistry,
      repository,
      () => ({
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 0,
            replay: 0,
          },
        },
        agent: {
          mainAgentId: 'lead',
        },
        tui: {
          inputBackgroundColor: 'gray',
          sessionFirstEnabled: true,
          goalSubmitFastPathEnabled: false,
        },
      })
    );

    await expect(
      rpcWithoutRegistry.handle(
        'internal.plan.compile',
        {
          plan: {
            schema_version: 'plan.v1',
            plan_id: 'plan-no-registry-1',
            goal: 'No registry',
            steps: [
              {
                id: 's1',
                type: 'tool_call',
                tool_ref: 'local://read_file',
                args: { path: '/tmp/x' },
              },
            ],
          },
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INTERNAL_ERROR });
  });
});

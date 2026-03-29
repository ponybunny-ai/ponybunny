/**
 * PonyBunny Main Entry Point — ADR-001 Phase 3
 *
 * Uses HarnessDaemon + GoalHarness + SchedulerCore instead of AutonomyDaemon.
 * GoalHarness owns elaborate → plan → delegate.
 * SchedulerCore owns execution and all production infrastructure.
 * HarnessDaemon provides the polling loop.
 */

import { WorkOrderDatabase } from './work-order/database/manager.js';
import { ExecutionService } from './app/lifecycle/execution/execution-service.js';
import { PlanningService } from './app/lifecycle/planning/planning-service.js';
import { ElaborationService } from './app/lifecycle/elaboration/elaboration-service.js';
import { GlobalKnowledgeService } from './domain/knowledge/index.js';
import { GoalHarness } from './harness/goal-harness.js';
import { HarnessDaemon } from './harness/harness-daemon.js';
import { PostGoalEvaluator } from './harness/post-goal-evaluator.js';
import { EvaluationService } from './app/lifecycle/evaluation/evaluation-service.js';
import { getLLMService } from './infra/llm/index.js';
import { JsonLogger } from './infra/observability/logger.js';
import type { ILLMProvider } from './infra/llm/llm-provider.js';
import { MockLLMProvider, LLMRouter } from './infra/llm/llm-provider.js';
import { getGlobalSkillRegistry } from './infra/skills/skill-registry.js';
import { getConfigDir, getManagedSkillsDir } from './infra/config/config-paths.js';
import { loadRuntimeConfig } from './infra/config/runtime-config.js';
import { createDefaultScheduler } from './scheduler/composition/index.js';

const DB_PATH = loadRuntimeConfig().paths.database;

async function initializeEnhancedSystem() {
  console.log('[PonyBunny] 🚀 Initializing Enhanced System...\n');

  // 1. Initialize Skill Registry
  console.log('[PonyBunny] 📚 Loading skills...');
  const skillRegistry = getGlobalSkillRegistry();

  const managedSkillsDir = getManagedSkillsDir();

  await skillRegistry.loadSkills({
    workspaceDir: process.cwd(),
    managedSkillsDir,
  });

  const skills = skillRegistry.getSkills();
  console.log(`[PonyBunny] ✅ Loaded ${skills.length} skills`);

  if (skills.length > 0) {
    console.log('[PonyBunny] Available skills:');
    skills.forEach(skill => {
      console.log(`  - ${skill.name}: ${skill.description} [${skill.source}]`);
    });
  } else {
    console.log('[PonyBunny] ℹ️  No skills loaded. Create skills in ./skills/ directory.');
  }

  const stats = skillRegistry.getStats();
  console.log(`[PonyBunny] 📊 Skill Stats:`, stats);
  console.log('');

  return { skillRegistry };
}

async function main() {
  // Initialize enhanced system
  const { skillRegistry } = await initializeEnhancedSystem();

  // Initialize database
  const repository = new WorkOrderDatabase(DB_PATH);
  await repository.initialize();

  // Initialize LLM Service
  const llmService = getLLMService();
  const availableProviders = llmService.getAvailableProviders();

  let llmProvider: ILLMProvider;

  if (availableProviders.length === 0) {
    console.warn('[PonyBunny] ⚠️  No API keys found. Using Mock LLM Provider.');
    console.warn(`[PonyBunny] To use real LLMs, configure ${getConfigDir()}/credentials.json`);
    llmProvider = new LLMRouter([new MockLLMProvider('mock-provider')]);
  } else {
    console.log(`[PonyBunny] ✅ Active LLM Providers: ${availableProviders.join(', ')}`);
    llmProvider = llmService;
  }

  // Use Enhanced Services (Phase-aware prompts + Skills integration)
  console.log('[PonyBunny] 🧠 Initializing Enhanced Lifecycle Services...');

  // Initialize cross-goal knowledge service (graceful if table missing)
  let globalKnowledge: GlobalKnowledgeService | undefined;
  try {
    globalKnowledge = new GlobalKnowledgeService(repository.getDatabase());
    console.log('[PonyBunny] ✅ Global Knowledge Service initialized');
  } catch {
    console.warn('[PonyBunny] ⚠️  Global Knowledge Service unavailable (table may not exist yet)');
  }

  const executionService = new ExecutionService(
    repository,
    { maxConsecutiveErrors: 3 },
    llmProvider
  );

  const planningService = new PlanningService(
    repository,
    llmProvider,
    undefined,
    executionService.getRuntimeToolingContext(),
    globalKnowledge
  );
  console.log('[PonyBunny] ✅ Planning Service (Enhanced) initialized');

  // Initialize skills for execution service
  await executionService.initializeSkills(process.cwd());

  // Initialize MCP integration (connect to external tool servers)
  await executionService.initializeMCP();

  console.log('[PonyBunny] ✅ Execution Service (Enhanced) initialized');

  const elaborationService = new ElaborationService(repository, globalKnowledge);
  console.log('[PonyBunny] ✅ Elaboration Service initialized');

  // ADR-001: Create SchedulerCore for production execution infrastructure
  const scheduler = createDefaultScheduler(
    {
      repository,
      executionService,
      llmProvider,
    },
    {
      tickIntervalMs: 1000,
      maxConcurrentGoals: 5,
      autoStart: false,
    }
  );
  await scheduler.start();
  console.log('[PonyBunny] ✅ SchedulerCore initialized');

  // Structured logger for harness components (ADR-002 C1)
  const logger = new JsonLogger({ level: 'info' });

  // ADR-001: Create GoalHarness (elaborate → plan → delegate to SchedulerCore)
  const goalHarness = new GoalHarness({
    repository,
    elaborationService,
    planningService,
    schedulerCore: scheduler,
    logger: logger.child({ component: 'GoalHarness' }),
  });
  console.log('[PonyBunny] ✅ GoalHarness initialized');

  // ADR-001 Phase 5: Post-goal evaluation hook
  const evaluationService = new EvaluationService(repository);
  const postGoalEvaluator = new PostGoalEvaluator({
    schedulerCore: scheduler,
    evaluationService,
    repository,
    globalKnowledgeService: globalKnowledge,
    db: repository.getDatabase(),
    logger: logger.child({ component: 'PostGoalEvaluator' }),
  });
  console.log('[PonyBunny] ✅ PostGoalEvaluator initialized');

  // ADR-001: Create HarnessDaemon (polling loop feeding GoalHarness)
  const daemon = new HarnessDaemon(
    repository,
    goalHarness,
    {
      maxConcurrentGoals: 2,
      pollingIntervalMs: 5000,
    },
    postGoalEvaluator,
    logger.child({ component: 'HarnessDaemon' }),
  );
  console.log('[PonyBunny] ✅ HarnessDaemon initialized\n');

  process.on('SIGINT', async () => {
    console.log('\n[PonyBunny] 👋 Shutting down gracefully...');
    daemon.stop();
    await scheduler.stop();
    process.exit(0);
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log('🎉 PonyBunny Enhanced System Ready!');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📁 Database: ${DB_PATH}`);
  console.log(`🤖 LLM Providers: ${availableProviders.length > 0 ? availableProviders.join(', ') : 'mock-provider'}`);
  console.log(`🎯 Model Tiers: ${JSON.stringify(llmService.getTierModels())}`);
  console.log(`📚 Skills Loaded: ${skillRegistry.getSkills().length}`);
  console.log('');
  console.log('✨ Enhanced Features:');
  console.log('  ✅ GoalHarness (ADR-001) — unified goal lifecycle');
  console.log('  ✅ Phase-aware System Prompts');
  console.log('  ✅ Skill-driven Execution');
  console.log('  ✅ Budget-conscious Planning');
  console.log('  ✅ SchedulerCore Production Infrastructure');
  console.log('═══════════════════════════════════════════════════════\n');

  await daemon.start();
}

main().catch(error => {
  console.error('[PonyBunny] ❌ Fatal error:', error);
  process.exit(1);
});

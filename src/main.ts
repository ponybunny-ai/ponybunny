import { AutonomyDaemon } from './autonomy/daemon.js';
import { WorkOrderDatabase } from './work-order/database/manager.js';
import { ExecutionService } from './app/lifecycle/execution/execution-service.js';
import { VerificationService } from './app/lifecycle/verification/verification-service.js';
import { EvaluationService } from './app/lifecycle/evaluation/evaluation-service.js';
import { PlanningService } from './app/lifecycle/planning/planning-service.js';
import { GlobalKnowledgeService } from './domain/knowledge/index.js';
import { getLLMService } from './infra/llm/index.js';
import type { ILLMProvider } from './infra/llm/llm-provider.js';
import { MockLLMProvider, LLMRouter } from './infra/llm/llm-provider.js';
import { getGlobalSkillRegistry } from './infra/skills/skill-registry.js';
import { getConfigDir, getManagedSkillsDir } from './infra/config/config-paths.js';
import { loadRuntimeConfig } from './infra/config/runtime-config.js';

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

  const verificationService = new VerificationService();
  console.log('[PonyBunny] ✅ Verification Service initialized');

  const evaluationService = new EvaluationService(repository);
  console.log('[PonyBunny] ✅ Evaluation Service initialized\n');

  const daemon = new AutonomyDaemon(
    repository,
    planningService,
    executionService,
    verificationService,
    evaluationService,
    {
      maxConcurrentRuns: 2,
      pollingIntervalMs: 5000,
    }
  );

  process.on('SIGINT', () => {
    console.log('\n[PonyBunny] 👋 Shutting down gracefully...');
    daemon.stop();
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
  console.log('  ✅ Phase-aware System Prompts');
  console.log('  ✅ Skill-driven Execution');
  console.log('  ✅ Budget-conscious Planning');
  console.log('  ✅ Default Concise Mode');
  console.log('  ✅ Clear Escalation Paths');
  console.log('═══════════════════════════════════════════════════════\n');

  await daemon.start();
}

main().catch(error => {
  console.error('[PonyBunny] ❌ Fatal error:', error);
  process.exit(1);
});

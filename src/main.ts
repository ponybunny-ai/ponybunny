import { AutonomyDaemon } from './autonomy/daemon.js';
import { WorkOrderDatabase } from './work-order/database/manager.js';
import { ExecutionService } from './app/lifecycle/execution/execution-service.js';
import { VerificationService } from './app/lifecycle/verification/verification-service.js';
import { EvaluationService } from './app/lifecycle/evaluation/evaluation-service.js';
import { PlanningService } from './app/lifecycle/planning/planning-service.js';
import { getLLMService } from './infra/llm/index.js';
import { MockLLMProvider, LLMRouter } from './infra/llm/llm-provider.js';

const DB_PATH = process.env.PONY_DB_PATH || './pony-work-orders.db';

async function main() {
  const repository = new WorkOrderDatabase(DB_PATH);
  await repository.initialize();

  // Use the unified LLM service
  const llmService = getLLMService();
  const availableProviders = llmService.getAvailableProviders();

  let llmRouter: LLMRouter;

  if (availableProviders.length === 0) {
    console.warn('[PonyBunny] No API keys found. Using Mock LLM Provider.');
    llmRouter = new LLMRouter([new MockLLMProvider('mock-provider')]);
  } else {
    llmRouter = llmService.createRouter();
  }

  const planningService = new PlanningService(repository, llmRouter);

  const executionService = new ExecutionService(repository, {
    maxConsecutiveErrors: 3,
  }, llmRouter);

  const verificationService = new VerificationService();

  const evaluationService = new EvaluationService(repository);

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
    console.log('\n[PonyBunny] Shutting down gracefully...');
    daemon.stop();
    process.exit(0);
  });

  console.log('[PonyBunny] Autonomy Daemon starting...');
  console.log(`[PonyBunny] Database: ${DB_PATH}`);
  console.log(`[PonyBunny] Active LLM Providers: ${availableProviders.length > 0 ? availableProviders.join(', ') : 'mock-provider'}`);
  console.log(`[PonyBunny] Model Tiers: ${JSON.stringify(llmService.getTierModels())}`);

  await daemon.start();
}

main().catch(error => {
  console.error('[PonyBunny] Fatal error:', error);
  process.exit(1);
});

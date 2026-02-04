import { AutonomyDaemon } from './autonomy/daemon.js';
import { WorkOrderDatabase } from './work-order/database/manager.js';
import { ExecutionService } from './app/lifecycle/execution/execution-service.js';
import { VerificationService } from './app/lifecycle/verification/verification-service.js';
import { EvaluationService } from './app/lifecycle/evaluation/evaluation-service.js';
import { PlanningService } from './app/lifecycle/planning/planning-service.js';
import { OpenAIProvider, AnthropicProvider } from './infra/llm/providers.js';
import { LLMRouter, MockLLMProvider } from './infra/llm/llm-provider.js';

const DB_PATH = process.env.PONY_DB_PATH || './pony-work-orders.db';

async function main() {
  const repository = new WorkOrderDatabase(DB_PATH);
  await repository.initialize();

  const providers = [];
  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      maxTokens: 4000,
    }));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 4000,
    }));
  }
  
  if (providers.length === 0) {
    console.warn('[PonyBunny] No API keys found. Using Mock LLM Provider.');
    providers.push(new MockLLMProvider('mock-provider'));
  }

  const llmRouter = new LLMRouter(providers);

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
  console.log(`[PonyBunny] Active LLM Providers: ${providers.map(p => p.getName()).join(', ')}`);
  
  await daemon.start();
}

main().catch(error => {
  console.error('[PonyBunny] Fatal error:', error);
  process.exit(1);
});

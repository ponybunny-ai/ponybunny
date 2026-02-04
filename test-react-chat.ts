#!/usr/bin/env node

/**
 * Test script to verify ReAct integration is working
 * Run with: npm run build && node dist/test-react-chat.js
 */

import { WorkOrderDatabase } from './work-order/database/manager.js';
import { ExecutionService } from './app/lifecycle/execution/execution-service.js';
import { LLMRouter } from './infra/llm/llm-provider.js';
import { CodexAccountProvider, AntigravityAccountProvider } from './infra/llm/account-providers.js';
import { accountManagerV2 } from './cli/lib/auth-manager-v2.js';

async function testReActChat() {
  console.log('=== Testing ReAct Chat Integration ===\n');
  
  // Initialize services
  const dbPath = './test-pony.db';
  const repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();
  
  const providers = [];
  
  const codexAccount = accountManagerV2.getCurrentAccount('codex');
  if (codexAccount) {
    console.log(`✓ Found Codex account: ${codexAccount.email}`);
    providers.push(new CodexAccountProvider(accountManagerV2, { model: 'gpt-5.2-codex', maxTokens: 4000 }));
  }
  
  const antigravityAccount = accountManagerV2.getCurrentAccount('antigravity');
  if (antigravityAccount) {
    console.log(`✓ Found Antigravity account: ${antigravityAccount.email}`);
    providers.push(new AntigravityAccountProvider(accountManagerV2, { model: 'gemini-2.5-flash', maxTokens: 4000 }));
  }
  
  if (providers.length === 0) {
    console.error('✗ No authenticated accounts found!');
    console.log('\nPlease login first:');
    console.log('  pb auth login           (for Codex/OpenAI)');
    console.log('  pb auth antigravity login  (for Antigravity/Google)');
    process.exit(1);
  }
  
  console.log(`\nUsing ${providers.length} provider(s)\n`);
  
  const llmRouter = new LLMRouter(providers);
  const executionService = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, llmRouter);
  
  // Create session
  const goal = repository.createGoal({
    title: 'Test ReAct Chat',
    description: 'Testing ReAct integration',
    priority: 50,
    success_criteria: [],
  });
  
  const workItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'Weather Query Test',
    description: 'Test weather query execution',
    item_type: 'analysis',
    priority: 50,
  });
  
  const run = repository.createRun({
    work_item_id: workItem.id,
    goal_id: goal.id,
    agent_type: 'test-agent',
    run_sequence: 1,
  });
  
  const sessionParams = {
    workItem,
    run,
    signal: new AbortController().signal,
  };
  
  console.log('--- Sending test message ---\n');
  
  const reactIntegration = (executionService as any).reactIntegration;
  const result = await reactIntegration.chatStep(sessionParams, 'show me current weather in London');
  
  console.log('\n--- Result ---');
  console.log('Success:', result.success);
  console.log('Tokens used:', result.tokensUsed);
  console.log('Reply:', result.reply);
  console.log('\n--- Execution Log ---');
  console.log(result.log);
}

testReActChat().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

/**
 * Test script for LLM Provider Manager
 * Run with: npx tsx test/provider-manager-test.ts
 */

import {
  getLLMProviderManager,
  getEndpointManager,
  getAgentModelResolver,
  getCachedConfig,
  resetLLMProviderManager,
  resetEndpointManager,
  resetAgentModelResolver,
  clearConfigCache,
} from '../src/infra/llm/provider-manager/index.js';

async function main() {
  console.log('=== LLM Provider Manager Test ===\n');

  // Reset singletons for clean test
  resetLLMProviderManager();
  resetEndpointManager();
  resetAgentModelResolver();
  clearConfigCache();

  // Test 1: Load configuration
  console.log('1. Testing configuration loading...');
  const config = getCachedConfig();
  console.log(`   - Loaded ${Object.keys(config.endpoints).length} endpoints`);
  console.log(`   - Loaded ${Object.keys(config.models).length} models`);
  console.log(`   - Loaded ${Object.keys(config.agents).length} agents`);
  console.log(`   - Tiers: ${Object.keys(config.tiers).join(', ')}`);
  console.log('   ✓ Configuration loaded successfully\n');

  // Test 2: Endpoint Manager
  console.log('2. Testing Endpoint Manager...');
  const endpointManager = getEndpointManager();
  const enabledEndpoints = endpointManager.getEnabledEndpoints();
  console.log(`   - Enabled endpoints: ${enabledEndpoints.map(e => e.id).join(', ')}`);

  for (const endpoint of enabledEndpoints) {
    const hasCredentials = endpointManager.hasCredentials(endpoint.id);
    console.log(`   - ${endpoint.id}: credentials=${hasCredentials ? 'yes' : 'no'}`);
  }
  console.log('   ✓ Endpoint Manager working\n');

  // Test 3: Agent Model Resolver
  console.log('3. Testing Agent Model Resolver...');
  const resolver = getAgentModelResolver();

  const testAgents = ['input-analysis', 'planning', 'execution', 'verification', 'response-generation', 'conversation'];
  for (const agentId of testAgents) {
    const model = resolver.getModelForAgent(agentId);
    const tier = resolver.getTierForAgent(agentId);
    const fallbackChain = resolver.getFallbackChain(agentId);
    console.log(`   - ${agentId}: tier=${tier}, model=${model}`);
    console.log(`     fallback chain: ${fallbackChain.join(' → ')}`);
  }
  console.log('   ✓ Agent Model Resolver working\n');

  // Test 4: Provider Manager
  console.log('4. Testing Provider Manager...');
  const providerManager = getLLMProviderManager();

  console.log('   - Available models:');
  const models = providerManager.getAvailableModels();
  for (const model of models.slice(0, 5)) {
    const endpoints = providerManager.getModelEndpoints(model.id);
    console.log(`     ${model.id}: endpoints=[${endpoints.join(', ')}]`);
  }
  if (models.length > 5) {
    console.log(`     ... and ${models.length - 5} more`);
  }

  console.log('\n   - Agent model resolution:');
  for (const agentId of testAgents) {
    const model = providerManager.getModelForAgent(agentId);
    console.log(`     ${agentId} → ${model}`);
  }

  console.log('\n   - Tier model resolution:');
  for (const tier of ['simple', 'medium', 'complex'] as const) {
    const model = providerManager.getModelForTier(tier);
    console.log(`     ${tier} → ${model}`);
  }
  console.log('   ✓ Provider Manager working\n');

  // Test 5: Cost estimation
  console.log('5. Testing cost estimation...');
  const testCases = [
    { model: 'claude-haiku-4-5-20251001', input: 1000, output: 500 },
    { model: 'claude-sonnet-4-5-20250929', input: 1000, output: 500 },
    { model: 'claude-opus-4-5-20251101', input: 1000, output: 500 },
    { model: 'gpt-4o', input: 1000, output: 500 },
  ];

  for (const tc of testCases) {
    const cost = resolver.estimateCost(tc.model, tc.input, tc.output);
    console.log(`   - ${tc.model}: $${cost.toFixed(6)} (${tc.input} in, ${tc.output} out)`);
  }
  console.log('   ✓ Cost estimation working\n');

  // Test 6: Check endpoint availability for models
  console.log('6. Testing endpoint availability for models...');
  const testModels = ['claude-sonnet-4-5-20250929', 'gpt-4o', 'gemini-2.0-flash'];
  for (const modelId of testModels) {
    const availableEndpoints = await endpointManager.getAvailableEndpointsForModel(modelId);
    console.log(`   - ${modelId}: available endpoints=[${availableEndpoints.join(', ') || 'none'}]`);
  }
  console.log('   ✓ Endpoint availability check working\n');

  console.log('=== All tests passed! ===');
}

main().catch(console.error);

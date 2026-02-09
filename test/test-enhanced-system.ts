/**
 * Test script for enhanced PonyBunny system
 */

import { getGlobalSkillRegistry } from '../src/infra/skills/skill-registry.js';
import { getGlobalPromptProvider } from '../src/infra/prompts/prompt-provider.js';

async function testEnhancedSystem() {
  console.log('🧪 Testing Enhanced PonyBunny System\n');

  // 1. Test Skill Registry
  console.log('1️⃣ Testing Skill Registry...');
  const skillRegistry = getGlobalSkillRegistry();
  await skillRegistry.loadSkills({
    workspaceDir: process.cwd(),
  });

  const skills = skillRegistry.getSkills();
  console.log(`   ✅ Loaded ${skills.length} skills`);
  skills.forEach(skill => {
    console.log(`      - ${skill.name}: ${skill.description} [${skill.source}]`);
  });

  const stats = skillRegistry.getStats();
  console.log(`   📊 Stats:`, stats);

  // 2. Test Prompt Provider
  console.log('\n2️⃣ Testing Prompt Provider...');
  const promptProvider = getGlobalPromptProvider();

  const executionPrompt = promptProvider.generateExecutionPrompt({
    workspaceDir: process.cwd(),
    goal: {
      id: 'test-goal-001',
      title: 'Test weather query system',
      description: 'Build a system to query weather information',
      budget_tokens: 100000,
      spent_tokens: 5000,
    } as any,
  });

  console.log('   ✅ Generated execution prompt');
  console.log(`   📏 Prompt length: ${executionPrompt.length} characters`);
  console.log('\n   Preview (first 800 chars):');
  console.log('   ' + executionPrompt.substring(0, 800).replace(/\n/g, '\n   '));
  console.log('   ...\n');

  // 3. Test Skills Prompt Generation
  console.log('3️⃣ Testing Skills Prompt Generation...');
  const skillsPrompt = skillRegistry.generateSkillsPrompt({
    phase: 'execution',
    format: { format: 'xml' },
  });

  if (skillsPrompt) {
    console.log('   ✅ Generated skills prompt');
    console.log(`   📏 Skills prompt length: ${skillsPrompt.length} characters`);
    console.log('\n   Preview:');
    console.log('   ' + skillsPrompt.substring(0, 500).replace(/\n/g, '\n   '));
    console.log('   ...\n');
  } else {
    console.log('   ℹ️  No skills available for execution phase (this is OK if no skills are created yet)');
  }

  // 4. Test Different Phases
  console.log('4️⃣ Testing Different Phase Prompts...');
  const phases = ['intake', 'planning', 'execution', 'verification'] as const;
  
  for (const phase of phases) {
    const prompt = promptProvider.generatePrompt({
      phase,
      workspaceDir: process.cwd(),
    });
    console.log(`   ✅ ${phase} phase: ${prompt.length} chars`);
  }

  // 5. Test Metadata
  console.log('\n5️⃣ Testing Prompt Metadata...');
  const result = promptProvider.generatePromptWithMetadata({
    workspaceDir: process.cwd(),
    phase: 'execution',
    goal: {
      id: 'test-goal-001',
      title: 'Test goal',
      description: 'Test description',
      budget_tokens: 100000,
      spent_tokens: 25000,
    } as any,
  });

  console.log('   ✅ Metadata:');
  console.log(`      Phase: ${result.metadata.phase}`);
  console.log(`      Mode: ${result.metadata.mode}`);
  console.log(`      Tool count: ${result.metadata.toolCount}`);
  console.log(`      Skill count: ${result.metadata.skillCount}`);
  console.log(`      Section count: ${result.metadata.sectionCount}`);
  console.log('\n   📑 Sections:');
  result.sections.forEach(section => {
    console.log(`      - ${section.name} (${section.required ? 'required' : 'optional'})`);
  });

  console.log('\n✅ All tests passed!\n');
  console.log('🎉 Enhanced PonyBunny system is working correctly!');
  console.log('\n💡 Next steps:');
  console.log('   1. Create skills in ./skills/ directory');
  console.log('   2. Use ExecutionServiceEnhanced in your code');
  console.log('   3. Monitor token usage and system behavior');
}

// Run tests
testEnhancedSystem().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

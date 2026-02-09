/**
 * System Prompt Builder Tests
 */

import { describe, it, expect } from '@jest/globals';
import { buildSystemPrompt } from './system-prompt-builder.js';
import type { SystemPromptContext } from './types.js';

describe('SystemPromptBuilder', () => {
  const baseContext: SystemPromptContext = {
    agentPhase: 'execution',
    workspaceDir: '/test/workspace',
    availableTools: [
      { name: 'read', description: 'Read file contents', category: 'core' },
      { name: 'write', description: 'Write file contents', category: 'core' },
      { name: 'exec', description: 'Execute shell commands', category: 'core' },
    ],
  };

  describe('build()', () => {
    it('should build a full system prompt', () => {
      const result = buildSystemPrompt(baseContext);

      expect(result.prompt).toContain('PonyBunny');
      expect(result.prompt).toContain('execution');
      expect(result.prompt).toContain('## Tooling');
      expect(result.metadata.phase).toBe('execution');
      expect(result.metadata.mode).toBe('full');
      expect(result.metadata.toolCount).toBe(3);
    });

    it('should build a minimal system prompt', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        promptMode: 'minimal',
      });

      expect(result.prompt).toContain('PonyBunny');
      expect(result.prompt).toContain('## Tooling');
      expect(result.prompt).not.toContain('## Skills');
      expect(result.metadata.mode).toBe('minimal');
    });

    it('should build a none mode system prompt', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        promptMode: 'none',
      });

      expect(result.prompt).toContain('autonomous AI agent');
      expect(result.prompt).not.toContain('## Tooling');
      expect(result.metadata.mode).toBe('none');
    });

    it('should include phase-specific guidance', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        agentPhase: 'planning',
      });

      expect(result.prompt).toContain('Planning Phase Objectives');
      expect(result.prompt).toContain('Decompose the goal into a DAG');
    });

    it('should include skills section when skills are provided', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        availableSkills: [
          {
            name: 'test-runner',
            description: 'Run automated tests',
            location: './skills/test-runner/SKILL.md',
          },
        ],
      });

      expect(result.prompt).toContain('## Skills');
      expect(result.prompt).toContain('test-runner');
      expect(result.metadata.skillCount).toBe(1);
    });

    it('should include budget information when provided', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        budgetTokens: 100000,
        spentTokens: 25000,
      });

      expect(result.prompt).toContain('Budget Awareness');
      expect(result.prompt).toContain('100000 tokens');
      expect(result.prompt).toContain('25000 tokens');
      expect(result.prompt).toContain('75000 tokens');
    });

    it('should include goal context when provided', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        goalId: 'goal-123',
        goalTitle: 'Build authentication system',
        goalDescription: 'Implement JWT-based auth',
      });

      expect(result.prompt).toContain('goal-123');
      expect(result.prompt).toContain('Build authentication system');
      expect(result.prompt).toContain('JWT-based auth');
    });

    it('should group tools by category', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        availableTools: [
          { name: 'read', description: 'Read files', category: 'core' },
          { name: 'search', description: 'Search code', category: 'skill' },
          { name: 'mcp_tool', description: 'MCP tool', category: 'mcp' },
        ],
      });

      expect(result.prompt).toContain('### Core Tools');
      expect(result.prompt).toContain('### Skill Tools');
      expect(result.prompt).toContain('### MCP Tools');
    });

    it('should include project context files', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        projectContext: [
          {
            filename: 'SOUL.md',
            content: 'You are a helpful assistant.',
          },
        ],
      });

      expect(result.prompt).toContain('## Project Context');
      expect(result.prompt).toContain('SOUL.md');
      expect(result.prompt).toContain('helpful assistant');
    });

    it('should include memory section when enabled', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        memoryEnabled: true,
        citationsEnabled: true,
      });

      expect(result.prompt).toContain('## Memory Recall');
      expect(result.prompt).toContain('memory_search');
      expect(result.prompt).toContain('Citations');
    });

    it('should include runtime information', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        modelName: 'gpt-4',
        runtimeInfo: {
          platform: 'darwin',
          nodeVersion: 'v20.0.0',
        },
      });

      expect(result.prompt).toContain('## Runtime');
      expect(result.prompt).toContain('model=gpt-4');
      expect(result.prompt).toContain('platform=darwin');
      expect(result.prompt).toContain('node=v20.0.0');
    });

    it('should include extra system prompt', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        extraSystemPrompt: 'Custom instructions for this agent.',
      });

      expect(result.prompt).toContain('## Additional Context');
      expect(result.prompt).toContain('Custom instructions');
    });
  });

  describe('Phase-specific guidance', () => {
    it('should provide intake phase guidance', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        agentPhase: 'intake',
      });

      expect(result.prompt).toContain('Intake Phase Objectives');
      expect(result.prompt).toContain('Validate that the goal');
    });

    it('should provide elaboration phase guidance', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        agentPhase: 'elaboration',
      });

      expect(result.prompt).toContain('Elaboration Phase Objectives');
      expect(result.prompt).toContain('Detect ambiguities');
    });

    it('should provide execution phase guidance', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        agentPhase: 'execution',
      });

      expect(result.prompt).toContain('Execution Phase Objectives');
      expect(result.prompt).toContain('ReAct pattern');
    });

    it('should provide verification phase guidance', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        agentPhase: 'verification',
      });

      expect(result.prompt).toContain('Verification Phase Objectives');
      expect(result.prompt).toContain('quality gates');
    });
  });

  describe('Safety levels', () => {
    it('should include standard safety guidelines', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        safetyLevel: 'standard',
      });

      expect(result.prompt).toContain('## Safety');
      expect(result.prompt).toContain('Escalation Policy');
    });

    it('should include maximum safety guidelines', () => {
      const result = buildSystemPrompt({
        ...baseContext,
        safetyLevel: 'maximum',
      });

      expect(result.prompt).toContain('## Safety');
      expect(result.prompt).toContain('no independent goals');
      expect(result.prompt).toContain('self-preservation');
    });
  });
});

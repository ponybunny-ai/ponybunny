import { ClarifyService } from '../../../src/app/lifecycle/clarify/clarify-service.js';
import type { IClarificationResponse } from '../../../src/domain/clarify/types.js';

describe('ClarifyService', () => {
  let service: ClarifyService;

  beforeEach(() => {
    service = new ClarifyService();
  });

  describe('analyzeGoal', () => {
    it('should return high confidence for well-defined goals', async () => {
      const result = await service.analyzeGoal({
        title: 'Implement user authentication',
        description: 'Create a JWT-based authentication system with login, logout, and token refresh endpoints. Use bcrypt for password hashing.',
        success_criteria: [
          { description: 'Users can register with email and password' },
          { description: 'Users can login and receive JWT token' },
          { description: 'Token refresh works correctly' },
        ],
      });

      expect(result.needsClarification).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should detect ambiguous language patterns', async () => {
      const result = await service.analyzeGoal({
        title: 'Improve some things',
        description: 'Make the app better and maybe add various features etc.',
        success_criteria: [],
      });

      expect(result.needsClarification).toBe(true);
      expect(result.confidence).toBeLessThan(0.7);
      expect(result.ambiguousAreas).toBeDefined();
      expect(result.ambiguousAreas!.length).toBeGreaterThan(0);
    });

    it('should flag missing success criteria', async () => {
      const result = await service.analyzeGoal({
        title: 'Add feature X',
        description: 'Implement feature X for the application',
        success_criteria: [],
      });

      expect(result.needsClarification).toBe(true);
      expect(result.ambiguousAreas).toContain('no_success_criteria');
    });

    it('should flag short descriptions', async () => {
      const result = await service.analyzeGoal({
        title: 'Fix bug',
        description: 'Fix the bug',
        success_criteria: [],
      });

      expect(result.needsClarification).toBe(true);
      expect(result.ambiguousAreas).toContain('description_too_short');
    });

    it('should generate questions when clarification needed', async () => {
      const result = await service.analyzeGoal({
        title: 'Deploy API',
        description: 'Deploy the API soon',
        success_criteria: [],
      });

      expect(result.needsClarification).toBe(true);
      expect(result.questions.length).toBeGreaterThan(0);
    });
  });

  describe('generateQuestions', () => {
    it('should generate scope questions for goals with multiple items', async () => {
      const questions = await service.generateQuestions({
        title: 'Add features A and B',
        description: 'Implement A and also B',
      });

      const scopeQuestion = questions.find(q =>
        q.question.toLowerCase().includes('features') ||
        q.question.toLowerCase().includes('components')
      );
      expect(scopeQuestion).toBeDefined();
    });

    it('should generate keyword-based questions for API goals', async () => {
      const questions = await service.generateQuestions({
        title: 'Build REST API',
        description: 'Create an API for user management',
      });

      const apiQuestion = questions.find(q =>
        q.question.toLowerCase().includes('api') ||
        q.context?.toLowerCase().includes('api')
      );
      expect(apiQuestion).toBeDefined();
    });

    it('should generate database questions for database goals', async () => {
      const questions = await service.generateQuestions({
        title: 'Set up database',
        description: 'Configure the database for the application',
      });

      const dbQuestion = questions.find(q =>
        q.question.toLowerCase().includes('database') ||
        q.context?.toLowerCase().includes('database')
      );
      expect(dbQuestion).toBeDefined();
    });

    it('should limit questions to 5', async () => {
      const questions = await service.generateQuestions({
        title: 'Complex API with database and authentication',
        description: 'Build an API that integrates with database and has authentication for deployment',
      });

      expect(questions.length).toBeLessThanOrEqual(5);
    });

    it('should filter by category', async () => {
      const questions = await service.generateQuestions(
        { title: 'Test goal', description: 'Test description' },
        ['priority']
      );

      const priorityQuestion = questions.find(q =>
        q.question.toLowerCase().includes('priority')
      );
      expect(priorityQuestion).toBeDefined();
    });
  });

  describe('initializeState', () => {
    it('should create pending state with questions', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      const state = await service.initializeState('goal-1', questions);

      expect(state.goalId).toBe('goal-1');
      expect(state.status).toBe('pending');
      expect(state.questions.length).toBeGreaterThan(0);
      expect(state.responses).toHaveLength(0);
      expect(state.startedAt).toBeDefined();
    });

    it('should create completed state if no questions', async () => {
      const state = await service.initializeState('goal-2', []);

      expect(state.status).toBe('completed');
      expect(state.completedAt).toBeDefined();
    });
  });

  describe('addResponses', () => {
    it('should add responses to state', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      await service.initializeState('goal-1', questions);

      const response: IClarificationResponse = {
        questionId: questions[0].id,
        value: 'All tests pass with 80% coverage',
        timestamp: Date.now(),
      };

      const state = await service.addResponses('goal-1', [response]);

      expect(state.responses).toHaveLength(1);
      expect(state.responses[0].value).toBe('All tests pass with 80% coverage');
    });

    it('should update status to in_progress when not all required answered', async () => {
      // Create questions with multiple required ones
      const questions = [
        { id: 'q1', question: 'Question 1?', type: 'text' as const, required: true },
        { id: 'q2', question: 'Question 2?', type: 'text' as const, required: true },
      ];

      await service.initializeState('goal-1', questions);

      // Answer only one of the two required questions
      const response: IClarificationResponse = {
        questionId: 'q1',
        value: 'Test answer',
        timestamp: Date.now(),
      };

      const state = await service.addResponses('goal-1', [response]);

      expect(state.status).toBe('in_progress');
    });

    it('should complete when all required questions answered', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      await service.initializeState('goal-1', questions);

      const responses = questions
        .filter(q => q.required)
        .map(q => ({
          questionId: q.id,
          value: 'Answer',
          timestamp: Date.now(),
        }));

      const state = await service.addResponses('goal-1', responses);

      expect(state.status).toBe('completed');
      expect(state.completedAt).toBeDefined();
    });

    it('should throw for non-existent goal', async () => {
      await expect(
        service.addResponses('non-existent', [])
      ).rejects.toThrow('No clarification state found');
    });

    it('should update existing response', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      await service.initializeState('goal-1', questions);

      await service.addResponses('goal-1', [{
        questionId: questions[0].id,
        value: 'First answer',
        timestamp: Date.now(),
      }]);

      const state = await service.addResponses('goal-1', [{
        questionId: questions[0].id,
        value: 'Updated answer',
        timestamp: Date.now(),
      }]);

      expect(state.responses).toHaveLength(1);
      expect(state.responses[0].value).toBe('Updated answer');
    });
  });

  describe('processResponses', () => {
    it('should extract success criteria from responses', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      await service.initializeState('goal-1', questions);

      const successQuestion = questions.find(q =>
        q.question.toLowerCase().includes('verify') ||
        q.question.toLowerCase().includes('success')
      );

      if (successQuestion) {
        const result = await service.processResponses('goal-1', [{
          questionId: successQuestion.id,
          value: 'All tests pass',
          timestamp: Date.now(),
        }]);

        expect(result.updatedCriteria).toBeDefined();
        expect(result.updatedCriteria![0].description).toBe('All tests pass');
      }
    });

    it('should store responses as additional context', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['constraints']);

      await service.initializeState('goal-1', questions);

      const result = await service.processResponses('goal-1', [{
        questionId: questions[0].id,
        value: 'Use Node.js 20',
        timestamp: Date.now(),
      }]);

      expect(result.additionalContext).toBeDefined();
    });

    it('should throw for non-existent goal', async () => {
      await expect(
        service.processResponses('non-existent', [])
      ).rejects.toThrow('No clarification state found');
    });
  });

  describe('isComplete', () => {
    it('should return true when all required questions answered', () => {
      const state = {
        goalId: 'goal-1',
        status: 'in_progress' as const,
        questions: [
          { id: 'q1', question: 'Q1', type: 'text' as const, required: true },
          { id: 'q2', question: 'Q2', type: 'text' as const, required: false },
        ],
        responses: [
          { questionId: 'q1', value: 'A1', timestamp: Date.now() },
        ],
      };

      expect(service.isComplete(state)).toBe(true);
    });

    it('should return false when required questions not answered', () => {
      const state = {
        goalId: 'goal-1',
        status: 'pending' as const,
        questions: [
          { id: 'q1', question: 'Q1', type: 'text' as const, required: true },
          { id: 'q2', question: 'Q2', type: 'text' as const, required: true },
        ],
        responses: [
          { questionId: 'q1', value: 'A1', timestamp: Date.now() },
        ],
      };

      expect(service.isComplete(state)).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return state for existing goal', async () => {
      await service.initializeState('goal-1', []);
      const state = await service.getState('goal-1');

      expect(state).not.toBeNull();
      expect(state!.goalId).toBe('goal-1');
    });

    it('should return null for non-existent goal', async () => {
      const state = await service.getState('non-existent');
      expect(state).toBeNull();
    });
  });

  describe('skip', () => {
    it('should skip existing clarification', async () => {
      const questions = await service.generateQuestions({
        title: 'Test',
        description: 'Test goal',
      }, ['success_criteria']);

      await service.initializeState('goal-1', questions);
      await service.skip('goal-1', 'User already knows requirements');

      const state = await service.getState('goal-1');
      expect(state!.status).toBe('skipped');
      expect(state!.skippedReason).toBe('User already knows requirements');
    });

    it('should create skipped state for non-initialized goal', async () => {
      await service.skip('goal-2', 'Clear requirements');

      const state = await service.getState('goal-2');
      expect(state!.status).toBe('skipped');
      expect(state!.skippedReason).toBe('Clear requirements');
    });
  });

  describe('clearState', () => {
    it('should remove state for a goal', async () => {
      await service.initializeState('goal-1', []);
      service.clearState('goal-1');

      const state = await service.getState('goal-1');
      expect(state).toBeNull();
    });
  });
});

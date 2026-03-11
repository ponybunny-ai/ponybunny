import { handleTaskCompatibilityEvent } from '../../../src/cli/tui/task-event-compatibility.js';

describe('task event compatibility handling', () => {
  it('keeps legacy task.narration updates goal-scoped when goalId is present', () => {
    const handlers = {
      updateSimpleMessageByGoalId: jest.fn(),
      appendTimelineByGoalId: jest.fn(),
      updateLatestProcessingMessage: jest.fn(),
      appendTimelineLatest: jest.fn(),
      extractActionHints: jest.fn(() => []),
    };

    handleTaskCompatibilityEvent('task.narration', {
      goalId: 'goal-1',
      stage: 'Execution update',
      message: 'Still working',
      statusText: 'Executing...',
    }, handlers);

    expect(handlers.appendTimelineByGoalId).toHaveBeenCalledWith(
      'goal-1',
      'Execution update',
      'Still working'
    );
    expect(handlers.updateSimpleMessageByGoalId).toHaveBeenCalledWith('goal-1', {
      statusText: 'Executing...',
      status: 'processing',
    });
    expect(handlers.appendTimelineLatest).not.toHaveBeenCalled();
    expect(handlers.updateLatestProcessingMessage).not.toHaveBeenCalled();
  });

  it('keeps legacy task.result updates on the latest processing message when goalId is absent', () => {
    const handlers = {
      updateSimpleMessageByGoalId: jest.fn(),
      appendTimelineByGoalId: jest.fn(),
      updateLatestProcessingMessage: jest.fn(),
      appendTimelineLatest: jest.fn(),
      extractActionHints: jest.fn(() => [{ label: 'Open file', kind: 'file' as const, target: './result.md' }]),
    };

    handleTaskCompatibilityEvent('task.result', {
      summary: 'Wrote ./result.md',
      success: true,
    }, handlers);

    expect(handlers.extractActionHints).toHaveBeenCalledWith('Wrote ./result.md');
    expect(handlers.updateLatestProcessingMessage).toHaveBeenCalledWith({
      resultSummary: 'Wrote ./result.md',
      actions: [{ label: 'Open file', kind: 'file', target: './result.md' }],
      status: 'completed',
    });
    expect(handlers.appendTimelineLatest).toHaveBeenCalledWith(
      'Final result generated',
      'Wrote ./result.md'
    );
    expect(handlers.updateSimpleMessageByGoalId).not.toHaveBeenCalled();
    expect(handlers.appendTimelineByGoalId).not.toHaveBeenCalled();
  });
});

import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { registerEvaluationHandlers } from '../../../src/gateway/rpc/handlers/evaluation-handlers.js';

function createSession(permissions: Array<'read' | 'write' | 'admin'> = ['read']): Session {
  return new Session({
    id: 'sess-eval-1',
    publicKey: 'pk-eval',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

function makeReport(goalId: string, trigger: 'goal_completed' | 'goal_failed' = 'goal_completed') {
  return {
    goalId,
    timestamp: Date.now(),
    trigger,
    workItemResults: [],
    summary: { total: 0, publish: 0, retry: 0, replan: 0, escalate: 0, skipped: 0 },
    unactionableDecisions: [],
  };
}

describe('evaluation handlers', () => {
  let rpc: RpcHandler;
  let session: Session;
  let ipcBridge: { listEvaluationReports: jest.Mock };

  beforeEach(() => {
    rpc = new RpcHandler();
    session = createSession();
    ipcBridge = {
      listEvaluationReports: jest.fn(async () => ({ reports: [] })),
    };
    registerEvaluationHandlers(rpc, ipcBridge as any);
  });

  describe('evaluation.list', () => {
    it('returns reports from IPCBridge', async () => {
      const reports = [makeReport('goal-1'), makeReport('goal-2')];
      ipcBridge.listEvaluationReports.mockResolvedValue({ reports });

      const result = await rpc.handle('evaluation.list', {}, session) as { reports: unknown[] };

      expect(result.reports).toEqual(reports);
      expect(ipcBridge.listEvaluationReports).toHaveBeenCalledTimes(1);
    });

    it('passes goalId and limit params to IPCBridge', async () => {
      ipcBridge.listEvaluationReports.mockResolvedValue({ reports: [] });

      await rpc.handle('evaluation.list', { goalId: 'goal-99', limit: 10 }, session);

      expect(ipcBridge.listEvaluationReports).toHaveBeenCalledWith({
        goalId: 'goal-99',
        limit: 10,
      });
    });

    it('passes undefined params when none provided', async () => {
      ipcBridge.listEvaluationReports.mockResolvedValue({ reports: [] });

      await rpc.handle('evaluation.list', {}, session);

      expect(ipcBridge.listEvaluationReports).toHaveBeenCalledWith({
        goalId: undefined,
        limit: undefined,
      });
    });
  });

  describe('evaluation.get', () => {
    it('returns null when no reports match', async () => {
      ipcBridge.listEvaluationReports.mockResolvedValue({ reports: [] });

      const result = await rpc.handle('evaluation.get', { goalId: 'goal-missing' }, session) as { report: unknown };

      expect(result.report).toBeNull();
      expect(ipcBridge.listEvaluationReports).toHaveBeenCalledWith({
        goalId: 'goal-missing',
        limit: 1,
      });
    });

    it('returns the last report when reports exist', async () => {
      const report = makeReport('goal-1');
      ipcBridge.listEvaluationReports.mockResolvedValue({ reports: [report] });

      const result = await rpc.handle('evaluation.get', { goalId: 'goal-1' }, session) as { report: unknown };

      expect(result.report).toEqual(report);
    });

    it('throws when goalId is missing', async () => {
      await expect(rpc.handle('evaluation.get', {}, session)).rejects.toThrow('goalId is required');
    });
  });
});

import { ExecutionEngineAdapter as GatewayExecutionEngineAdapter } from '../../../src/gateway/integration/execution-engine-adapter.js';
import { ExecutionEngineAdapter } from '../../../src/scheduler/composition/execution-engine-adapter.js';

describe('gateway ExecutionEngineAdapter compatibility surface', () => {
  it('keeps the gateway path as a compatibility re-export of the scheduler-owned adapter', () => {
    expect(GatewayExecutionEngineAdapter).toBe(ExecutionEngineAdapter);
  });
});

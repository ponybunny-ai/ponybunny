import { readFileSync } from 'fs';
import path from 'path';

import * as rootCompatibility from '../../src/compatibility.js';
import * as rootIndex from '../../src/index.js';
import * as rootPublic from '../../src/public.js';
import { DaemonEventEmitterMixin } from '../../src/runtime/events/daemon-event-emitter.js';
import { ReActIntegration } from '../../src/runtime/react/react-integration.js';
import { WorkOrderDatabase } from '../../src/work-order/database/manager.js';
import { GoalHarness } from '../../src/harness/goal-harness.js';
import { HarnessDaemon } from '../../src/harness/harness-daemon.js';

describe('root public surface split', () => {
  test('historical mixed root barrel delegates through explicit live and compatibility entrypoints', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8');

    expect(source).toContain("export * from './public.js';");
    expect(source).toContain("export * from './compatibility.js';");
  });

  test('live root surface keeps package-boundary exports separate from compatibility exports', () => {
    expect(rootPublic.WorkOrderDatabase).toBe(WorkOrderDatabase);
    expect('AutonomyDaemon' in rootPublic).toBe(false);
    expect('ReActIntegration' in rootPublic).toBe(false);
    expect('DaemonEventEmitterMixin' in rootPublic).toBe(false);
  });

  test('live root surface exports GoalHarness and HarnessDaemon (ADR-001)', () => {
    expect(rootPublic.GoalHarness).toBe(GoalHarness);
    expect(rootPublic.HarnessDaemon).toBe(HarnessDaemon);
  });

  test('root compatibility surface keeps historical daemon/execution exports explicit', () => {
    expect(rootCompatibility.ReActIntegration).toBe(ReActIntegration);
    expect(rootCompatibility.DaemonEventEmitterMixin).toBe(DaemonEventEmitterMixin);
    expect('WorkOrderDatabase' in rootCompatibility).toBe(false);
    expect('AutonomyDaemon' in rootCompatibility).toBe(false);
  });

  test('historical mixed root barrel still preserves legacy named exports', () => {
    expect(rootIndex.WorkOrderDatabase).toBe(WorkOrderDatabase);
    expect('AutonomyDaemon' in rootIndex).toBe(false);
    expect(rootIndex.ReActIntegration).toBe(ReActIntegration);
    expect(rootIndex.DaemonEventEmitterMixin).toBe(DaemonEventEmitterMixin);
  });

  test('historical mixed root barrel includes GoalHarness and HarnessDaemon', () => {
    expect(rootIndex.GoalHarness).toBe(GoalHarness);
    expect(rootIndex.HarnessDaemon).toBe(HarnessDaemon);
  });
});

import { readFileSync } from 'fs';
import path from 'path';

import * as rootCompatibility from '../../src/compatibility.js';
import * as rootIndex from '../../src/index.js';
import * as rootPublic from '../../src/public.js';
import { AutonomyDaemon } from '../../src/autonomy/daemon.js';
import { DaemonEventEmitterMixin } from '../../src/autonomy/daemon-event-emitter.js';
import { ReActIntegration } from '../../src/autonomy/react-integration.js';
import { WorkOrderDatabase } from '../../src/work-order/database/manager.js';

describe('root public surface split', () => {
  test('historical mixed root barrel delegates through explicit live and compatibility entrypoints', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8');

    expect(source).toContain("export * from './public.js';");
    expect(source).toContain("export * from './compatibility.js';");
  });

  test('live root surface keeps package-boundary exports separate from compatibility exports', () => {
    expect(rootPublic.WorkOrderDatabase).toBe(WorkOrderDatabase);
    expect(rootPublic.AutonomyDaemon).toBe(AutonomyDaemon);
    expect('ReActIntegration' in rootPublic).toBe(false);
    expect('DaemonEventEmitterMixin' in rootPublic).toBe(false);
  });

  test('root compatibility surface keeps historical daemon/execution exports explicit', () => {
    expect(rootCompatibility.ReActIntegration).toBe(ReActIntegration);
    expect(rootCompatibility.DaemonEventEmitterMixin).toBe(DaemonEventEmitterMixin);
    expect('WorkOrderDatabase' in rootCompatibility).toBe(false);
    expect('AutonomyDaemon' in rootCompatibility).toBe(false);
  });

  test('historical mixed root barrel still preserves legacy named exports', () => {
    expect(rootIndex.WorkOrderDatabase).toBe(WorkOrderDatabase);
    expect(rootIndex.AutonomyDaemon).toBe(AutonomyDaemon);
    expect(rootIndex.ReActIntegration).toBe(ReActIntegration);
    expect(rootIndex.DaemonEventEmitterMixin).toBe(DaemonEventEmitterMixin);
  });
});

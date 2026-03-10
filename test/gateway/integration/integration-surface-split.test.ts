import * as integrationBoundaries from '../../../src/gateway/integration/boundaries.js';
import * as integrationCompatibility from '../../../src/gateway/integration/compatibility.js';
import * as integrationIndex from '../../../src/gateway/integration/index.js';
import { DaemonBridge } from '../../../src/gateway/integration/daemon-bridge.js';
import { GatewayDaemonAttachment } from '../../../src/gateway/integration/gateway-daemon-attachment.js';
import { SchedulerBridge } from '../../../src/gateway/integration/scheduler-bridge.js';
import { createScheduler } from '../../../src/gateway/integration/scheduler-compatibility.js';

describe('gateway integration surface split', () => {
  test('live boundaries barrel keeps gateway-owned seams separate from compatibility exports', () => {
    expect(integrationBoundaries.GatewayDaemonAttachment).toBe(GatewayDaemonAttachment);
    expect(integrationBoundaries.SchedulerBridge).toBe(SchedulerBridge);
    expect('DaemonBridge' in integrationBoundaries).toBe(false);
    expect('createScheduler' in integrationBoundaries).toBe(false);
  });

  test('compatibility barrel keeps historical exports explicit', () => {
    expect(integrationCompatibility.DaemonBridge).toBe(DaemonBridge);
    expect(integrationCompatibility.createScheduler).toBe(createScheduler);
    expect('GatewayDaemonAttachment' in integrationCompatibility).toBe(false);
    expect('SchedulerBridge' in integrationCompatibility).toBe(false);
  });

  test('historical mixed barrel still preserves legacy named exports', () => {
    expect(integrationIndex.GatewayDaemonAttachment).toBe(GatewayDaemonAttachment);
    expect(integrationIndex.SchedulerBridge).toBe(SchedulerBridge);
    expect(integrationIndex.DaemonBridge).toBe(DaemonBridge);
    expect(integrationIndex.createScheduler).toBe(createScheduler);
  });
});

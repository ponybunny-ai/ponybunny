import { readFileSync } from 'fs';
import path from 'path';

describe('TUI event protocol boundary', () => {
  it('handles legacy task.* events through the explicit compatibility branch', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/cli/tui/app.tsx'), 'utf8');

    expect(source).toContain('if (isGatewayCompatibilityEventType(event.event))');
    expect(source).toContain('handleTaskCompatibilityEvent(event.event, data, {');
    expect(source).not.toContain("case 'task.narration':");
    expect(source).not.toContain("case 'task.result':");
  });
});

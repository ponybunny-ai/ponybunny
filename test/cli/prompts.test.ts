jest.mock('chalk', () => {
  const chalk = {
    bold: (value: string) => value,
    gray: (value: string) => value,
    green: (value: string) => value,
    red: (value: string) => value,
    yellow: (value: string) => value,
  };

  return {
    __esModule: true,
    default: chalk,
    ...chalk,
  };
});

jest.mock('../../src/infra/prompts/template-loader.js', () => ({
  getPromptDoctorReport: jest.fn(),
}));

describe('pb prompts doctor', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    jest.clearAllMocks();
    process.exitCode = originalExitCode;
  });

  test('prints healthy message when no issues', async () => {
    const { createPromptsCommand } = await import('../../src/cli/commands/prompts.js');
    const { getPromptDoctorReport } = await import('../../src/infra/prompts/template-loader.js');

    (getPromptDoctorReport as jest.Mock).mockReturnValue({
      promptDir: '/tmp/.ponybunny/prompts',
      defaultManifestPath: '/repo/defaults/manifest.json',
      userManifestPath: '/tmp/.ponybunny/prompts/manifest.json',
      checkedTemplates: 25,
      issues: [],
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const command = createPromptsCommand();

    await command.parseAsync(['node', 'pb', 'doctor']);

    const output = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('Prompt templates are healthy');
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
  });

  test('prints issues and sets non-zero exit code on errors', async () => {
    const { createPromptsCommand } = await import('../../src/cli/commands/prompts.js');
    const { getPromptDoctorReport } = await import('../../src/infra/prompts/template-loader.js');

    (getPromptDoctorReport as jest.Mock).mockReturnValue({
      promptDir: '/tmp/.ponybunny/prompts',
      defaultManifestPath: '/repo/defaults/manifest.json',
      userManifestPath: '/tmp/.ponybunny/prompts/manifest.json',
      checkedTemplates: 25,
      issues: [
        {
          severity: 'error',
          code: 'template_missing',
          path: '/tmp/.ponybunny/prompts/system/identity.md',
          message: 'Missing template file: /tmp/.ponybunny/prompts/system/identity.md',
        },
        {
          severity: 'warning',
          code: 'manifest_version_mismatch',
          path: 'system/workspace.md',
          message: 'Version mismatch for system/workspace.md: local=1.0.0 default=1.1.0',
        },
      ],
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;

    const command = createPromptsCommand();
    await command.parseAsync(['node', 'pb', 'doctor']);

    const output = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('[template_missing]');
    expect(output).toContain('[manifest_version_mismatch]');
    expect(output).toContain('Errors: 1');
    expect(output).toContain('Warnings: 1');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
  });
});

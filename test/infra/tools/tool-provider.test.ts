import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../src/infra/tools/tool-registry.js';
import { ToolProvider } from '../../../src/infra/tools/tool-provider.js';
import { ReadFileTool } from '../../../src/infra/tools/implementations/read-file-tool.js';
import { WebSearchTool } from '../../../src/infra/tools/implementations/web-search-tool.js';

describe('ToolProvider manifest integration', () => {
  it('prefers manifest input schema for tool definitions', () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());

    const provider = new ToolProvider(new ToolEnforcer(registry, new ToolAllowlist(['read_file'])));
    provider.setRegistry(registry);

    const definitions = provider.getToolDefinitions();
    const readFile = definitions.find((tool) => tool.name === 'read_file');

    expect(readFile).toBeDefined();
    expect(readFile?.parameters.required).toEqual(['path']);
    expect(readFile?.parameters.properties.path).toBeDefined();
  });

  it('returns manifest list from registry tools', () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WebSearchTool());

    const provider = new ToolProvider(new ToolEnforcer(registry, new ToolAllowlist(['read_file', 'web_search'])));
    provider.setRegistry(registry);

    const manifests = provider.getToolManifests();

    expect(manifests.length).toBeGreaterThanOrEqual(2);
    expect(manifests.some((manifest) => manifest.tool_ref === 'local://read_file')).toBe(true);
    expect(manifests.some((manifest) => manifest.tool_ref === 'local://web_search')).toBe(true);
  });
});

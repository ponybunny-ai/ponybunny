export function buildOpenAIModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  if (normalized.endsWith('/v1')) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

export async function testOpenAIProtocolConnection(baseUrl: string, apiKey: string): Promise<void> {
  const modelsEndpoint = buildOpenAIModelsEndpoint(baseUrl);
  const response = await fetch(modelsEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

export async function fetchOpenAIProtocolModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const modelsEndpoint = buildOpenAIModelsEndpoint(baseUrl);
  const response = await fetch(modelsEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch models from ${modelsEndpoint}: HTTP ${response.status} ${errorText}`);
  }

  const payload = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ id?: string } | string> };
  const idsFromData = Array.isArray(payload.data)
    ? payload.data.map((item) => (typeof item?.id === 'string' ? item.id : '')).filter((id) => id.length > 0)
    : [];
  const idsFromModels = Array.isArray(payload.models)
    ? payload.models
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        return typeof item?.id === 'string' ? item.id : '';
      })
      .filter((id) => id.length > 0)
    : [];

  return Array.from(new Set([...idsFromData, ...idsFromModels])).sort((a, b) => a.localeCompare(b));
}

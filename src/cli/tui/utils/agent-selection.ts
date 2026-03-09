export function resolveInitialAgentIndex(
  agents: Array<{ id: string }>,
  runtimeMainAgentId: string | null,
  currentIndex: number
): number {
  if (agents.length === 0) {
    return 0;
  }

  if (runtimeMainAgentId) {
    const preferredIndex = agents.findIndex((agent) => agent.id === runtimeMainAgentId);
    if (preferredIndex >= 0) {
      return preferredIndex;
    }
  }

  return Math.max(0, currentIndex % agents.length);
}

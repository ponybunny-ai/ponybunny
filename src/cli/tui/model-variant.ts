export function getNextReasoningEffortIndex(reasoningEfforts: string[] | undefined, currentIndex: number): number {
  if (!Array.isArray(reasoningEfforts) || reasoningEfforts.length <= 1) {
    return currentIndex;
  }

  return (currentIndex + 1) % reasoningEfforts.length;
}

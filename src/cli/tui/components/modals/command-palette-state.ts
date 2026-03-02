export function clampSelectedIndex(selectedIndex: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(selectedIndex, total - 1));
}

export function nextScrollOffset(params: {
  selectedIndex: number;
  currentOffset: number;
  maxVisible: number;
  total: number;
}): number {
  const { selectedIndex, currentOffset, maxVisible, total } = params;
  if (total <= 0 || maxVisible <= 0) {
    return 0;
  }

  let next = currentOffset;
  if (selectedIndex < currentOffset) {
    next = selectedIndex;
  } else if (selectedIndex >= currentOffset + maxVisible) {
    next = selectedIndex - maxVisible + 1;
  }

  const maxOffset = Math.max(0, total - maxVisible);
  return Math.max(0, Math.min(next, maxOffset));
}

export function normalizeSlashCommandInput(previousValue: string, nextValue: string): string {
  if (previousValue.startsWith('/') && nextValue.includes('/') && !nextValue.startsWith('/')) {
    const slashIndex = nextValue.indexOf('/');
    const withoutSlash = nextValue.slice(0, slashIndex) + nextValue.slice(slashIndex + 1);
    return `/${withoutSlash}`;
  }

  return nextValue;
}

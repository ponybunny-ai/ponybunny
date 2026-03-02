export function shouldHandleSuggestionNavigation(options: {
  focus: boolean;
  hasActiveModal: boolean;
  showSuggestions: boolean;
  suggestionCount: number;
}): boolean {
  return options.focus
    && !options.hasActiveModal
    && options.showSuggestions
    && options.suggestionCount > 0;
}

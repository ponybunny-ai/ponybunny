import { shouldHandleSuggestionNavigation } from '../../../../src/cli/tui/components/layout/input-focus-guard.js';

describe('input bar modal focus isolation', () => {
  it('disables suggestion key handling when modal is active', () => {
    const result = shouldHandleSuggestionNavigation({
      focus: true,
      hasActiveModal: true,
      showSuggestions: true,
      suggestionCount: 3,
    });

    expect(result).toBe(false);
  });

  it('enables suggestion key handling only when focused with visible suggestions and no modal', () => {
    const result = shouldHandleSuggestionNavigation({
      focus: true,
      hasActiveModal: false,
      showSuggestions: true,
      suggestionCount: 2,
    });

    expect(result).toBe(true);
  });
});

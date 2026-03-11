export type CompatibilityModelSource = 'tui_selected' | 'scheduler_selector';

function normalizeCompatibilityModelValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Compatibility projection only.
 *
 * These helpers materialize legacy/public model-selection fields after the
 * authority-side model has already been resolved elsewhere. They must not
 * become a second source of truth for model-selection precedence.
 */
export function materializeCompatibilitySelectedModelProjection(input: {
  selectedModel?: unknown;
  modelSource?: CompatibilityModelSource;
}): {
  selected_model: string | undefined;
  model: string | undefined;
  model_source: CompatibilityModelSource | undefined;
} {
  const selectedModel = normalizeCompatibilityModelValue(input.selectedModel);
  return {
    selected_model: selectedModel,
    model: selectedModel,
    model_source: input.modelSource,
  };
}

/**
 * Compatibility projection only.
 *
 * `selected_model`, `actual_model`, and `model_source` remain legacy
 * completion/event metadata. This helper preserves that shape without taking
 * ownership of effective-model resolution.
 */
export function materializeCompatibilityRunModelProjection(input: {
  selectedModel?: unknown;
  actualModel?: unknown;
  modelSource?: CompatibilityModelSource;
}): {
  selected_model: string | undefined;
  actual_model: string | undefined;
  model_source: CompatibilityModelSource | undefined;
} {
  return {
    selected_model: normalizeCompatibilityModelValue(input.selectedModel),
    actual_model: normalizeCompatibilityModelValue(input.actualModel),
    model_source: input.modelSource,
  };
}

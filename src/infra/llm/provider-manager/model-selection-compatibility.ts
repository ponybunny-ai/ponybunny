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
 * Direct-execution run creation still persists `selected_model` and
 * `requested_model` as legacy context mirrors before cycle execution begins.
 * This helper keeps that initial materialization at the same projection
 * boundary without taking ownership of request precedence or runtime model
 * resolution.
 */
export function materializeCompatibilityDirectExecutionRunProjection(input: {
  selectedModel?: unknown;
  requestedModel?: unknown;
}): {
  selected_model: string | undefined;
  requested_model: string | undefined;
} {
  const selectedModelProjection = materializeCompatibilitySelectedModelProjection({
    selectedModel: input.selectedModel,
  });

  return {
    selected_model: selectedModelProjection.selected_model,
    requested_model: typeof input.requestedModel === 'string'
      ? input.requestedModel
      : undefined,
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

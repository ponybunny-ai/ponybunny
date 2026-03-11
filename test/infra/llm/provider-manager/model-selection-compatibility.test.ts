import {
  materializeCompatibilityDirectExecutionRunProjection,
  materializeCompatibilityRunModelProjection,
  materializeCompatibilitySelectedModelProjection,
} from '../../../../src/infra/llm/provider-manager/model-selection-compatibility.js';

describe('model-selection compatibility projections', () => {
  it('materializes selected-model compatibility fields without taking authority ownership', () => {
    expect(materializeCompatibilitySelectedModelProjection({
      selectedModel: 'openai.gpt-5.3',
      modelSource: 'scheduler_selector',
    })).toEqual({
      selected_model: 'openai.gpt-5.3',
      model: 'openai.gpt-5.3',
      model_source: 'scheduler_selector',
    });
  });

  it('preserves undefined compatibility fields when no selected model exists', () => {
    expect(materializeCompatibilitySelectedModelProjection({})).toEqual({
      selected_model: undefined,
      model: undefined,
      model_source: undefined,
    });
  });

  it('materializes run completion compatibility fields with the same legacy names', () => {
    expect(materializeCompatibilityRunModelProjection({
      selectedModel: 'selected-model',
      actualModel: 'actual-model',
    })).toEqual({
      selected_model: 'selected-model',
      actual_model: 'actual-model',
      model_source: undefined,
    });
  });

  it('materializes direct-execution run context with preserved requested-model shape', () => {
    expect(materializeCompatibilityDirectExecutionRunProjection({
      selectedModel: 'selected-model',
      requestedModel: ' requested-model ',
    })).toEqual({
      selected_model: 'selected-model',
      requested_model: ' requested-model ',
    });
  });
});

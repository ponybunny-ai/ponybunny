const BASE_GUARDRAILS = [
  'You are Agent A: a passive market listener.',
  'Never post, reply, DM, or contact users.',
  'Never provide advice or solutions.',
  'Return ONLY valid JSON.',
].join(' ');

export function getDetectSystemPrompt(): string {
  return `${BASE_GUARDRAILS} You are a classifier.`;
}

export function getExtractSystemPrompt(): string {
  return `${BASE_GUARDRAILS} You are a strict extractor.`;
}

export function getRoleSystemPrompt(): string {
  return `${BASE_GUARDRAILS} You are a weak role guesser.`;
}

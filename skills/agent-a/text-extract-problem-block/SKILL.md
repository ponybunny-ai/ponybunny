---
name: agent-a-text-extract-problem-block
description: Agent A A3 text.extract_problem_block verbatim extractor
version: 1.0.0
author: PonyBunny
tags: [agent-a, market-listener]
phases: [execution]
user-invocable: false
disable-model-invocation: false
---

# Skill A3 — text.extract_problem_block

## Intent
Extract the smallest useful verbatim block that represents the problem, plus minimal surrounding context.

## Inputs

```yaml
extract_request:
  raw_text: string
  window_chars: int
  platform: string
```

## Outputs

```yaml
extract_result:
  problem_raw_text: string
  surrounding_context: string
  mentioned_tools: string[]
  constraints: string[]
```

## Tools
- llm.extract_json

## Policy
- Return ONLY valid JSON.
- Verbatim only; no paraphrase or grammar cleanup.
- If text is short, problem_raw_text may equal raw_text.

## Failure Modes
- Invalid JSON: caller falls back to raw_text.

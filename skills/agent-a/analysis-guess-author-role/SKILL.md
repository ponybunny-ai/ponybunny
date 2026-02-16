---
name: agent-a-analysis-guess-author-role
description: Agent A A4 analysis.guess_author_role weak role guesser
version: 1.0.0
author: PonyBunny
tags: [agent-a, market-listener]
phases: [execution]
user-invocable: false
disable-model-invocation: false
---

# Skill A4 — analysis.guess_author_role

## Intent
Guess the author role from text with low confidence (weak signal only).

## Inputs

```yaml
role_request:
  raw_text: string
```

## Outputs

```yaml
role_result:
  role_guess: enum [founder, employee, developer, ops, student, hobbyist, unknown]
  confidence: number
```

## Tools
- llm.classify

## Policy
- Return ONLY valid JSON.
- Confidence must be <= 0.5.
- If uncertain, return unknown with confidence 0.1.

## Failure Modes
- Invalid JSON: caller falls back to unknown/0.1.

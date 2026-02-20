# PonyBunny Prompt Templates

This directory defines the default prompt template set copied into `~/.config/ponybunny/prompts`.

`manifest.json` in this directory tracks version metadata for each prompt file.

## Structure

- `system/`
  - `identity.md`, `identity-none.md`
  - `tooling.md`, `tool-call-style.md`
  - `skills.md`, `memory.md`, `workspace.md`, `project-context.md`, `runtime.md`, `additional-context.md`
  - `safety/`: `core.md`, `escalation.md`, `budget.md`
  - `phases/`: one file per lifecycle phase (`intake.md`, `planning.md`, etc.)
- `persona/`
  - `base.md`
  - `guidelines.md`

## Placeholders

Use double curly braces placeholders such as `{{AGENT_PHASE}}` or `{{CURRENT_DATE}}`.
Dynamic tool/skill/mcp content is injected by code and should not be hardcoded into templates.

## Edit Policy

- Keep brand/product identity in code-level constants.
- Keep policy and wording in markdown templates.
- Keep templates plain markdown text; avoid executable snippets.

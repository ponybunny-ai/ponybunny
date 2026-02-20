# Prompt Template Layout

This project stores editable prompt templates in `~/.config/ponybunny/prompts`.

## Directory Standard

```text
~/.config/ponybunny/prompts/
  README.md
  manifest.json
  system/
    identity.md
    identity-none.md
    tooling.md
    tool-call-style.md
    skills.md
    memory.md
    workspace.md
    project-context.md
    runtime.md
    additional-context.md
    safety/
      core.md
      escalation.md
      budget.md
    phases/
      intake.md
      elaboration.md
      planning.md
      execution.md
      verification.md
      evaluation.md
      publish.md
      monitor.md
      conversation.md
  persona/
    base.md
    guidelines.md
```

## Ownership Rules

- Keep brand identity and product identity constants in code.
- Keep wording/policy blocks in markdown templates.
- Keep dynamic runtime/tool/skill/mcp/model sections injected by code.
- Keep template files pure markdown text (no shell or executable logic).

## Placeholders

Templates use `{{PLACEHOLDER}}` values. Examples:

- `{{AGENT_PHASE}}`, `{{PHASE_DESCRIPTION}}`
- `{{WORKSPACE_DIR}}`
- `{{CURRENT_DATE}}`, `{{CURRENT_TIME}}`, `{{TIMEZONE}}`

Unfilled placeholders are left as-is, so template edits should be validated by running prompt generation with debug enabled.

## Initialization

- `pb init` now seeds these templates into `~/.config/ponybunny/prompts`.
- Existing files are not overwritten unless `pb init --force` is used.
- Missing template files can be restored by re-running `pb init`.

## Version Manifest

- `manifest.json` stores version metadata for each prompt file.
- New prompt files are registered in the default manifest and auto-seeded when missing.
- Existing prompt files are not overwritten automatically.
- Version mismatches are surfaced in prompt debug logs.

## Debugging

Set `PONY_BUNNY_DEBUG=1` to print:

- template load source path
- injection steps and counts
- full final prompts (system and persona)

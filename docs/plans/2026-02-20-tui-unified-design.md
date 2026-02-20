# Unified TUI Design (Gateway-Only, Streamed)

Date: 2026-02-20

## Goals
- Replace the current simple/expert split with a single unified TUI.
- Default UI is minimal and calm, with commands and shortcuts to open more functionality.
- Use `/` in the input to show a filtered command list below the input (arrow keys select, Enter confirms; first item selected by default; list filters as you type).
- TUI must only interact with the gateway via the WebSocket stream and gateway RPCs.

## Non-goals
- Do not add local data sources, direct DB access, or HTTP polling.
- Do not keep the old simple/expert toggles or `/simple` `/expert` commands.

## UX Overview
- Main screen shows a simple message stream plus two compact summary blocks: goal counts and current work items.
- Input stays at the bottom; normal text submits a goal; slash input shows command suggestions.
- Commands and shortcuts open “sub-windows” (modals or lightweight views) for goals, events, help, new goal, and escalations.

## Interaction Details
- Slash command suggestions appear only when input starts with `/`.
- Filtering matches command name and aliases (prefix and substring).
- Arrow Up/Down changes the highlighted command (initially the first match).
- Enter executes the highlighted command; if only `/` is present, the first command is chosen.
- Esc closes suggestions; if suggestions are closed, Esc only unfocuses the input.

## Shortcuts (Unified)
- Tab: cycle among lightweight sub-views (e.g., main summary → events → help).
- Ctrl+N: open goal creation modal.
- Ctrl+E: open escalations modal.

## Data Flow (Gateway-Only, Streamed)
- TUI connects to the gateway using the existing WebSocket client.
- Initial data load is a one-time RPC after connection (listGoals, listEscalations, listWorkItems).
- Ongoing state updates come only from gateway event frames.
- All actions (submit, cancel, approve, resolve) are RPC requests to the gateway.

## Error Handling
- Disconnected state keeps the UI visible and disables submit actions.
- Show a reconnect hint while gateway reconnects (no local retries beyond the client’s reconnect logic).
- Command execution errors are surfaced in the event log and, where relevant, as inline message status updates.

## Testing
- Add unit tests for command filtering and selection behavior.
- Add UI interaction tests for slash list navigation and Enter-to-execute.
- Validate that no code path accesses local storage or DB for TUI state.

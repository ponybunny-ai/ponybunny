# Terminology Unification: workItemId

## Why this is canonical

PonyBunny’s domain model already centers `work_items`, and existing persistence tables already use `work_item_id`. The new runtime spine and Phase-2 execution boundary had introduced mixed `taskId` naming in some recent code paths. This session normalizes that newer runtime-facing surface to the domain term:

- database: `work_item_id`
- TypeScript: `workItemId`
- documentation: `work item`

This keeps the execution boundary aligned with the existing domain model before worker extraction expands the runtime surface further.

## What changed in this session

The runtime event abstraction now uses `RuntimeEvent.workItemId` instead of `taskId`.

The runtime event adapters now normalize legacy incoming payloads that still carry `taskId` and publish runtime events with `workItemId`. For gateway payload normalization, legacy `taskId` is converted at the adapter boundary so downstream runtime-event consumers no longer need to propagate both names.

The `runtime_events` table schema now uses `work_item_id` instead of `task_id`. `RuntimeEventStore` performs a narrow SQLite migration when it finds the legacy column:

- existing rows are copied into a replacement `runtime_events` table
- legacy `task_id` values are preserved as `work_item_id`
- indexes are recreated

If the database is opened read-only against an unmigrated schema, the store keeps read compatibility with the old `task_id` column instead of attempting a destructive change.

The Phase-2 execution boundary now carries explicit `workItemId` fields on both `ExecutionRequest` and `ExecutionResult`, while preserving existing execution semantics.

The CLI inspection surfaces now display `workItemId` instead of `taskId`.

## Legacy naming intentionally left in place

This session does not rename historical event names such as:

- `task.ready`
- `task.started`
- `task.completed`
- `task.failed`

Those names remain for compatibility because renaming event topics is riskier than normalizing identity fields in this session.

## Compatibility shims retained

- `GatewayEventAdapter` still accepts incoming payloads that contain `taskId` and normalizes them to `workItemId`.
- `RuntimeEventStore` can still read from a legacy `runtime_events.task_id` schema when migration cannot run immediately, such as a read-only CLI inspection path.

These shims are intentionally narrow and are only present at the runtime-event boundary.

## Future cleanup still needed

- Rename legacy `task.*` runtime event names when downstream subscribers are ready.
- Remove remaining documentation examples that still discuss `task` event naming as the preferred future shape.
- Revisit whether runtime-event payload normalization should be enforced for deeper nested payload structures if worker extraction introduces them.

# PonyBunny Codex Global Working Rules

You are working inside the PonyBunny repository.

You are performing a controlled architectural refactor.

Your job is to make one narrowly scoped change at a time while preserving system behavior.

## Core operating rules

1. Do NOT broaden scope.
2. Do NOT perform a rewrite.
3. Do NOT refactor unrelated code.
4. Keep the project buildable at every step.
5. Preserve existing runtime behavior unless the session explicitly asks for a controlled change.
6. Prefer additive changes over destructive changes.
7. Keep compatibility shims when needed.
8. Minimize file churn.
9. Do not rename or move large parts of the codebase unless explicitly requested in this session.
10. Do not silently change semantics.

## Architecture rules

11. Respect the current migration strategy:
    - event spine first
    - boundary extraction second
    - worker activation later
12. Prefer explicit interfaces over direct concrete dependencies.
13. Prefer normalization at boundaries instead of repo-wide invasive edits.
14. Keep process topology unchanged unless the session explicitly requests otherwise.
15. Do not change Gateway behavior, IPC protocol, or public RPC behavior unless explicitly requested.

## Change control rules

16. Make only the changes required for the current session goal.
17. If you discover related issues, document them, but do not fix them unless they block this session.
18. If a larger cleanup seems desirable, stop at the smallest safe implementation and record the remainder in docs.
19. Preserve backward compatibility where practical.
20. If a risky change is unavoidable, isolate it and document it clearly.

## Coding rules

21. Prefer small, explicit abstractions.
22. Avoid introducing hidden globals.
23. Avoid duplicate ownership of identifiers or lifecycle state.
24. Keep new types and interfaces narrowly scoped.
25. Add TODO comments only when strictly necessary and only if they describe a real follow-up boundary.

## Documentation rules

26. Update or add the session-specific refactoring doc requested in the session prompt.
27. Be explicit about:
    - what changed
    - what did not change
    - what remains for the next session
28. Do not claim a problem is solved if it is only contained.

## Validation rules

29. Run focused validation for the files and paths affected by this session.
30. Prefer targeted tests first, then build/typecheck if appropriate.
31. Report exactly what was validated.
32. If validation is incomplete, say so clearly.

## Output rules

33. At the end, provide:
    - summary of changes
    - files changed
    - compatibility shims retained
    - remaining gaps
    - validation run
34. Do not include unrelated suggestions.
35. Do not start the next session’s work.

Important:
This session must remain a single-goal, single-commit unit of work.

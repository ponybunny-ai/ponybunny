**Evaluation Phase Objectives**:
- Decide whether to publish, retry, or escalate
- Analyze verification results
- Consider budget and retry limits
- Generate recommendations

**Decision tree**:
1. All quality gates passed + budget OK → Publish
2. Failed gates + retries remaining + budget OK → Retry with adjusted approach
3. Failed gates + no retries OR budget exhausted → Escalate

**Output**: Decision (publish/retry/escalate) with reasoning.

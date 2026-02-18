import {
  getNextCronFireTimeMs,
  validateCronExpression,
} from '../../../src/infra/scheduler/cron-adapter.js';

describe('cron adapter', () => {
  it('rejects expressions that are not 5-field', () => {
    const result = validateCronExpression('*/5 * * * * *');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('exactly 5 fields');
    }
  });

  it('rejects invalid timezones', () => {
    const result = validateCronExpression('*/5 * * * *', 'America/Not_A_Zone');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid timezone');
    }
  });

  it('computes next fire time deterministically in UTC', () => {
    const fromMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const nextMs = getNextCronFireTimeMs({
      cron: '*/15 * * * *',
      fromMs,
      tz: 'UTC',
    });

    expect(nextMs).toBe(Date.UTC(2025, 0, 1, 0, 15, 0));
  });

  it('respects DST boundaries for America/Los_Angeles', () => {
    const fromMs = Date.UTC(2024, 2, 10, 9, 59, 0);
    const nextMs = getNextCronFireTimeMs({
      cron: '0 2 * * *',
      fromMs,
      tz: 'America/Los_Angeles',
    });

    expect(nextMs).toBe(Date.UTC(2024, 2, 10, 10, 0, 0));
  });
});

import { CronExpressionParser } from 'cron-parser';

export type CronValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export interface CronNextFireInput {
  cron: string;
  fromMs: number;
  tz?: string;
}

const CRON_FIELD_COUNT = 5;

function splitCronFields(expression: string): string[] {
  return expression.trim().split(/\s+/);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function validateCronExpression(expression: string, tz?: string): CronValidationResult {
  if (!expression || expression.trim().length === 0) {
    return { ok: false, error: 'Cron expression is required.' };
  }

  const fields = splitCronFields(expression);
  if (fields.length !== CRON_FIELD_COUNT) {
    return {
      ok: false,
      error: `Cron expression must have exactly ${CRON_FIELD_COUNT} fields (min hour dom month dow). ` +
        `Received ${fields.length}.`,
    };
  }

  if (tz && !isValidTimeZone(tz)) {
    return { ok: false, error: `Invalid timezone: ${tz}.` };
  }

  try {
    CronExpressionParser.parse(expression, { currentDate: new Date(0), tz });
  } catch (error) {
    return {
      ok: false,
      error: `Invalid cron expression: ${(error as Error).message}`,
    };
  }

  return { ok: true };
}

export function getNextCronFireTimeMs(input: CronNextFireInput): number {
  const validation = validateCronExpression(input.cron, input.tz);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  if (!Number.isFinite(input.fromMs)) {
    throw new Error('fromMs must be a finite timestamp in milliseconds.');
  }

  const currentDate = new Date(input.fromMs + 1);

  try {
    const interval = CronExpressionParser.parse(input.cron, {
      currentDate,
      tz: input.tz,
    });
    const next = interval.next();
    return next.getTime();
  } catch (error) {
    throw new Error(`Failed to compute next cron fire time: ${(error as Error).message}`);
  }
}

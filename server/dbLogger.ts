/**
 * Structured Database Activity Logger for CIRCOR E2E Tracker backend.
 * Provides real-time console visibility into SQL queries, transactions,
 * record counts, execution duration, and database connection events.
 */

export type DbAction =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'UPSERT'
  | 'DELETE'
  | 'TX:START'
  | 'TX:COMMIT'
  | 'TX:ROLLBACK'
  | 'SCHEMA'
  | 'CONNECTION';

const isColorSupported = Boolean(process.stdout && process.stdout.isTTY);

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function colorize(color: keyof typeof COLORS, text: string): string {
  if (!isColorSupported) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function getActionColor(action: DbAction): keyof typeof COLORS {
  switch (action) {
    case 'SELECT':
      return 'cyan';
    case 'INSERT':
    case 'UPSERT':
      return 'green';
    case 'UPDATE':
      return 'yellow';
    case 'DELETE':
      return 'red';
    case 'TX:START':
    case 'TX:COMMIT':
    case 'TX:ROLLBACK':
      return 'magenta';
    case 'SCHEMA':
    case 'CONNECTION':
      return 'blue';
    default:
      return 'reset';
  }
}

export function logDbActivity(
  action: DbAction,
  target: string,
  summary: string,
  meta?: { orgId?: string; durationMs?: number; count?: number; error?: string }
): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const actionBadge = colorize(getActionColor(action), `[${action.padEnd(8)}]`);
  const targetText = colorize('bold', target);
  
  let details = summary;
  if (meta?.count !== undefined) {
    details += ` (${meta.count} item${meta.count === 1 ? '' : 's'})`;
  }
  if (meta?.orgId) {
    details += ` ${colorize('dim', `[org: ${meta.orgId}]`)}`;
  }
  if (meta?.durationMs !== undefined) {
    const durColor = meta.durationMs > 200 ? 'yellow' : 'dim';
    details += ` ${colorize(durColor, `${meta.durationMs.toFixed(1)}ms`)}`;
  }

  if (meta?.error) {
    console.error(`[DB ${timestamp}] ${actionBadge} ${targetText}: ${details} - ${colorize('red', `ERROR: ${meta.error}`)}`);
  } else {
    console.log(`[DB ${timestamp}] ${actionBadge} ${targetText}: ${details}`);
  }
}

/**
 * Wraps an asynchronous database operation, measures execution time,
 * and logs the outcome (success or failure) automatically.
 */
export async function measureDbOp<T>(
  action: DbAction,
  target: string,
  summary: string,
  orgId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - start;
    let count: number | undefined;
    if (Array.isArray(result)) {
      count = result.length;
    }
    logDbActivity(action, target, summary, { orgId, durationMs, count });
    return result;
  } catch (err: any) {
    const durationMs = performance.now() - start;
    const errorMsg = err?.message || String(err);
    logDbActivity(action, target, `${summary} FAILED`, { orgId, durationMs, error: errorMsg });
    throw err;
  }
}

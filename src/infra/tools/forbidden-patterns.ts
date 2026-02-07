/**
 * Forbidden Operations
 *
 * Patterns that match Layer 3 (forbidden) operations.
 * These operations are never allowed, regardless of approval.
 */

import type { IForbiddenPattern } from '../../domain/permission/types.js';

/**
 * Forbidden shell command patterns
 */
export const FORBIDDEN_SHELL_PATTERNS: IForbiddenPattern[] = [
  {
    id: 'shell_rm_rf_root',
    pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?[\/~]\s*$/i,
    description: 'Delete root or home directory',
    category: 'shell',
    severity: 'critical',
    examples: ['rm -rf /', 'rm -rf ~'],
  },
  {
    id: 'shell_rm_rf_system',
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(usr|bin|sbin|etc|var|lib|boot|sys|proc)/i,
    description: 'Delete system directories',
    category: 'shell',
    severity: 'critical',
    examples: ['rm -rf /usr', 'rm -rf /etc'],
  },
  {
    id: 'shell_format_disk',
    pattern: /mkfs|format\s+[a-zA-Z]:|fdisk\s+-l.*\|\s*xargs/i,
    description: 'Format disk or partition',
    category: 'shell',
    severity: 'critical',
    examples: ['mkfs.ext4 /dev/sda1', 'format C:'],
  },
  {
    id: 'shell_dd_disk',
    pattern: /dd\s+.*of=\/dev\/(sd[a-z]|nvme|hd[a-z]|disk)/i,
    description: 'Direct disk write with dd',
    category: 'shell',
    severity: 'critical',
    examples: ['dd if=/dev/zero of=/dev/sda'],
  },
  {
    id: 'shell_fork_bomb',
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    description: 'Fork bomb',
    category: 'shell',
    severity: 'critical',
    examples: [':(){ :|:& };:'],
  },
  {
    id: 'shell_chmod_dangerous',
    pattern: /chmod\s+(-[a-zA-Z]+\s+)?777\s+\//i,
    description: 'Dangerous chmod on root',
    category: 'shell',
    severity: 'high',
    examples: ['chmod -R 777 /'],
  },
  {
    id: 'shell_chown_root',
    pattern: /chown\s+(-[a-zA-Z]+\s+)?[a-zA-Z]+:[a-zA-Z]+\s+\//i,
    description: 'Dangerous chown on root',
    category: 'shell',
    severity: 'high',
    examples: ['chown -R user:user /'],
  },
];

/**
 * Forbidden database patterns
 */
export const FORBIDDEN_DATABASE_PATTERNS: IForbiddenPattern[] = [
  {
    id: 'db_drop_database',
    pattern: /DROP\s+DATABASE/i,
    description: 'Drop entire database',
    category: 'database',
    severity: 'critical',
    examples: ['DROP DATABASE production'],
  },
  {
    id: 'db_truncate_all',
    pattern: /TRUNCATE\s+.*\*/i,
    description: 'Truncate all tables',
    category: 'database',
    severity: 'critical',
    examples: ['TRUNCATE TABLE *'],
  },
  {
    id: 'db_delete_all_no_where',
    pattern: /DELETE\s+FROM\s+\w+\s*;?\s*$/i,
    description: 'Delete all rows without WHERE clause',
    category: 'database',
    severity: 'high',
    examples: ['DELETE FROM users;'],
  },
  {
    id: 'db_update_all_no_where',
    pattern: /UPDATE\s+\w+\s+SET\s+.*(?!WHERE)/i,
    description: 'Update all rows without WHERE clause',
    category: 'database',
    severity: 'high',
    examples: ['UPDATE users SET deleted=1;'],
  },
];

/**
 * Forbidden filesystem patterns
 */
export const FORBIDDEN_FILESYSTEM_PATTERNS: IForbiddenPattern[] = [
  {
    id: 'fs_write_system',
    pattern: /^\/(etc\/passwd|etc\/shadow|etc\/sudoers|boot\/|sys\/|proc\/)/,
    description: 'Write to critical system files',
    category: 'filesystem',
    severity: 'critical',
    examples: ['/etc/passwd', '/etc/shadow'],
  },
  {
    id: 'fs_write_ssh_keys',
    pattern: /\.ssh\/(authorized_keys|id_rsa|id_ed25519)/,
    description: 'Modify SSH keys',
    category: 'filesystem',
    severity: 'high',
    examples: ['~/.ssh/authorized_keys', '~/.ssh/id_rsa'],
  },
  {
    id: 'fs_write_credentials',
    pattern: /\.(env|credentials|secrets?|keys?|tokens?)$/i,
    description: 'Modify credential files',
    category: 'filesystem',
    severity: 'high',
    examples: ['.env', 'credentials.json', 'secrets.yaml'],
  },
];

/**
 * Forbidden network patterns
 */
export const FORBIDDEN_NETWORK_PATTERNS: IForbiddenPattern[] = [
  {
    id: 'net_internal_metadata',
    pattern: /169\.254\.169\.254|metadata\.google\.internal/,
    description: 'Access cloud metadata service',
    category: 'network',
    severity: 'critical',
    examples: ['http://169.254.169.254/latest/meta-data/'],
  },
  {
    id: 'net_localhost_admin',
    pattern: /localhost:(22|3306|5432|6379|27017|9200)/,
    description: 'Access sensitive local services',
    category: 'network',
    severity: 'high',
    examples: ['localhost:22', 'localhost:5432'],
  },
];

/**
 * Forbidden git patterns
 */
export const FORBIDDEN_GIT_PATTERNS: IForbiddenPattern[] = [
  {
    id: 'git_force_push_main',
    pattern: /git\s+push\s+(-f|--force)\s+.*\s*(main|master)/i,
    description: 'Force push to main/master branch',
    category: 'git',
    severity: 'high',
    examples: ['git push -f origin main'],
  },
  {
    id: 'git_reset_hard_origin',
    pattern: /git\s+reset\s+--hard\s+origin\/(main|master)/i,
    description: 'Hard reset to origin main/master',
    category: 'git',
    severity: 'high',
    examples: ['git reset --hard origin/main'],
  },
];

/**
 * All forbidden patterns combined
 */
export const ALL_FORBIDDEN_PATTERNS: IForbiddenPattern[] = [
  ...FORBIDDEN_SHELL_PATTERNS,
  ...FORBIDDEN_DATABASE_PATTERNS,
  ...FORBIDDEN_FILESYSTEM_PATTERNS,
  ...FORBIDDEN_NETWORK_PATTERNS,
  ...FORBIDDEN_GIT_PATTERNS,
];

/**
 * Check if a command/argument matches any forbidden pattern
 */
export function matchesForbiddenPattern(
  input: string,
  category?: string
): IForbiddenPattern | null {
  const patterns = category
    ? ALL_FORBIDDEN_PATTERNS.filter(p => p.category === category)
    : ALL_FORBIDDEN_PATTERNS;

  for (const pattern of patterns) {
    if (pattern.pattern.test(input)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Check multiple inputs against forbidden patterns
 */
export function checkForbiddenPatterns(
  inputs: Record<string, unknown>,
  category?: string
): { forbidden: boolean; pattern?: IForbiddenPattern; field?: string } {
  for (const [field, value] of Object.entries(inputs)) {
    if (typeof value === 'string') {
      const match = matchesForbiddenPattern(value, category);
      if (match) {
        return { forbidden: true, pattern: match, field };
      }
    }
  }

  return { forbidden: false };
}

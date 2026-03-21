/**
 * Centralized Environment Variable Registry
 *
 * All environment variables used by PonyBunny are registered here with
 * their descriptions, default values, and accessor functions.
 * Feature modules should import from here instead of reading process.env directly.
 */

// ============================================================================
// Debug Configuration
// ============================================================================

/** Master debug toggle (see also debug-flags.ts for the canonical check) */
export const PONY_BUNNY_DEBUG = () => process.env.PONY_BUNNY_DEBUG;

/** Debug output mode: 'console', 'file', or 'console,file' */
export const PONY_BUNNY_DEBUG_OUTPUT = () => process.env.PONY_BUNNY_DEBUG_OUTPUT;

/** File path for debug log output (used when debug output includes 'file') */
export const PONY_BUNNY_DEBUG_LOG_FILE = () => process.env.PONY_BUNNY_DEBUG_LOG_FILE;

// ============================================================================
// Model Tier Overrides
// ============================================================================

/** Override model for 'simple' tier (e.g. 'openai.gpt-4o-mini') */
export const PONY_MODEL_SIMPLE = () => process.env.PONY_MODEL_SIMPLE;

/** Override model for 'medium' tier */
export const PONY_MODEL_MEDIUM = () => process.env.PONY_MODEL_MEDIUM;

/** Override model for 'complex' tier */
export const PONY_MODEL_COMPLEX = () => process.env.PONY_MODEL_COMPLEX;

/** Fallback model for 'simple' tier */
export const PONY_MODEL_SIMPLE_FALLBACK = () => process.env.PONY_MODEL_SIMPLE_FALLBACK;

/** Fallback model for 'medium' tier */
export const PONY_MODEL_MEDIUM_FALLBACK = () => process.env.PONY_MODEL_MEDIUM_FALLBACK;

/** Fallback model for 'complex' tier */
export const PONY_MODEL_COMPLEX_FALLBACK = () => process.env.PONY_MODEL_COMPLEX_FALLBACK;

// ============================================================================
// Memory / Embedding
// ============================================================================

/** Model to use for local embeddings (default: 'text-embedding-3-small') */
export const PONY_MEMORY_EMBEDDING_MODEL = () => process.env.PONY_MEMORY_EMBEDDING_MODEL;

/** Base URL for embedding API */
export const PONY_MEMORY_OPENAI_BASE_URL = () => process.env.PONY_MEMORY_OPENAI_BASE_URL;

/** API key override specifically for embedding requests */
export const PONY_MEMORY_EMBEDDING_API_KEY = () => process.env.PONY_MEMORY_EMBEDDING_API_KEY;

// ============================================================================
// Feature Flags
// ============================================================================

/** Enable skill suggestion system in ReAct loop ('1' to enable) */
export const PONY_SKILL_SUGGESTIONS = () => process.env.PONY_SKILL_SUGGESTIONS;

// ============================================================================
// API Keys (external services)
// ============================================================================

/** Perplexity API key for web search */
export const PERPLEXITY_API_KEY = () => process.env.PERPLEXITY_API_KEY;

/** OpenRouter API key for web search fallback */
export const OPENROUTER_API_KEY = () => process.env.OPENROUTER_API_KEY;

/** Brave Search API key */
export const BRAVE_API_KEY = () => process.env.BRAVE_API_KEY;

/** OpenAI API key (used as fallback for embedding service) */
export const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY;

/** OpenAI base URL override */
export const OPENAI_BASE_URL = () => process.env.OPENAI_BASE_URL;

// ============================================================================
// Path Overrides
// ============================================================================

/** Override the PonyBunny config directory (default: ~/.config/ponybunny) */
export const PONYBUNNY_CONFIG_DIR = () => process.env.PONYBUNNY_CONFIG_DIR;

/** Override the skills directory */
export const PONYBUNNY_SKILLS_DIR = () => process.env.PONYBUNNY_SKILLS_DIR;

/** Override prompt defaults directory */
export const PONYBUNNY_PROMPT_DEFAULTS_DIR = () => process.env.PONYBUNNY_PROMPT_DEFAULTS_DIR;

/** Override agent schema path */
export const PONYBUNNY_AGENT_SCHEMA_PATH = () => process.env.PONYBUNNY_AGENT_SCHEMA_PATH;

// ============================================================================
// Internal / Process Management
// ============================================================================

/** Subagent worker ID (set by parent process) */
export const PONY_SUBAGENT_ID = () => process.env.PONY_SUBAGENT_ID;

/** Antigravity service endpoint */
export const PB_ANTIGRAVITY_ENDPOINT = () => process.env.PB_ANTIGRAVITY_ENDPOINT;

// ============================================================================
// CLI Daemon Flags
// ============================================================================

/** Set when gateway is started in background mode */
export const PONY_GATEWAY_BACKGROUND = () => process.env.PONY_GATEWAY_BACKGROUND;

/** Set for gateway daemon child process */
export const PONY_GATEWAY_DAEMON_CHILD = () => process.env.PONY_GATEWAY_DAEMON_CHILD;

/** Set when scheduler is started in background mode */
export const PONY_SCHEDULER_BACKGROUND = () => process.env.PONY_SCHEDULER_BACKGROUND;

// ============================================================================
// Startup Validation
// ============================================================================

/**
 * Validate that required environment variables are set.
 * Call during application startup to surface configuration errors early.
 * Currently only warns — does not throw.
 */
export function validateEnvVars(): string[] {
  const warnings: string[] = [];

  // No strictly required vars for now — API keys come from credentials.json.
  // Add checks here as requirements emerge, e.g.:
  // if (!OPENAI_API_KEY() && !PERPLEXITY_API_KEY()) {
  //   warnings.push('No search API key configured (OPENAI_API_KEY or PERPLEXITY_API_KEY)');
  // }

  return warnings;
}

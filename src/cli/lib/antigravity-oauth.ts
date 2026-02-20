import { createHash, randomBytes } from 'crypto';
import {
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_TOKEN_URL,
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_LOAD_ENDPOINTS,
  ANTIGRAVITY_CLIENT_METADATA,
  GEMINI_CLI_CLIENT_METADATA,
  getRandomizedHeaders,
} from './antigravity-constants.js';
import { isAntigravityDebugEnabled } from '../../infra/config/debug-flags.js';

interface PkcePair {
  verifier: string;
  challenge: string;
}

interface AntigravityAuthState {
  verifier: string;
  projectId: string;
}

export interface AntigravityAuthorization {
  url: string;
  verifier: string;
  projectId: string;
  state: string;
}

interface AntigravityTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface AntigravityUserInfo {
  email?: string;
}

export interface AntigravityTokenExchangeSuccess {
  type: 'success';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  projectId?: string;
  managedProjectId?: string;
}

export interface AntigravityTokenExchangeFailure {
  type: 'failed';
  error: string;
}

export type AntigravityTokenExchangeResult =
  | AntigravityTokenExchangeSuccess
  | AntigravityTokenExchangeFailure;

const FETCH_TIMEOUT_MS = 10000;

function logDebug(message: string, extra?: Record<string, unknown>): void {
  if (isAntigravityDebugEnabled()) {
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[Antigravity OAuth] ${message}${suffix}`);
  }
}

function logWarn(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.warn(`[Antigravity OAuth] ${message}${suffix}`);
}

function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function encodeState(payload: AntigravityAuthState): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeState(state: string): AntigravityAuthState {
  const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  const parsed = JSON.parse(json);

  if (typeof parsed?.verifier !== 'string') {
    throw new Error('Missing PKCE verifier in state');
  }

  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
  };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProjectId(accessToken: string): Promise<{ projectId?: string; managedProjectId?: string }> {
  const errors: string[] = [];
  const cliHeaders = getRandomizedHeaders('gemini-cli');

  const loadHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': cliHeaders['User-Agent'],
    'X-Goog-Api-Client': cliHeaders['X-Goog-Api-Client'],
    'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
  };

  const loadEndpoints = Array.from(new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS]));

  for (const baseEndpoint of loadEndpoints) {
    try {
      const url = `${baseEndpoint}/v1internal:loadCodeAssist`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: loadHeaders,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      });

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        errors.push(`loadCodeAssist ${response.status} at ${baseEndpoint}${message ? `: ${message}` : ''}`);
        continue;
      }

      const data = await response.json() as {
        cloudaicompanionProject?: string | { id?: string; managedProjectId?: string };
      };

      if (typeof data.cloudaicompanionProject === 'string') {
        return { projectId: data.cloudaicompanionProject };
      }

      if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject.id === 'string') {
        return {
          projectId: data.cloudaicompanionProject.id,
          managedProjectId: data.cloudaicompanionProject.managedProjectId,
        };
      }

      errors.push(`loadCodeAssist missing project id at ${baseEndpoint}`);
    } catch (error) {
      errors.push(`loadCodeAssist error at ${baseEndpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length) {
    logWarn('Failed to resolve Antigravity project via loadCodeAssist', { errors: errors.join('; ') });
  }

  return {};
}

export function authorizeAntigravity(projectId = ''): AntigravityAuthorization {
  const pkce = generatePkce();
  const state = encodeState({ verifier: pkce.verifier, projectId: projectId || '' });

  const url = new URL(ANTIGRAVITY_AUTH_URL);
  url.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '));
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    projectId: projectId || '',
    state,
  };
}

export async function exchangeAntigravityCode(
  code: string,
  state: string,
): Promise<AntigravityTokenExchangeResult> {
  try {
    const { verifier, projectId } = decodeState(state);
    const startTime = Date.now();
    const cliHeaders = getRandomizedHeaders('gemini-cli');

    const tokenResponse = await fetch(ANTIGRAVITY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: '*/*',
        'User-Agent': cliHeaders['User-Agent'],
        'X-Goog-Api-Client': cliHeaders['X-Goog-Api-Client'],
      },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => tokenResponse.statusText);
      return { type: 'failed', error: errorText || tokenResponse.statusText };
    }

    const tokens = await tokenResponse.json() as AntigravityTokenResponse;
    if (!tokens.refresh_token) {
      return { type: 'failed', error: 'Missing refresh token in response' };
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'User-Agent': cliHeaders['User-Agent'],
        'X-Goog-Api-Client': cliHeaders['X-Goog-Api-Client'],
      },
    });

    let email: string | undefined;
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json() as AntigravityUserInfo;
      email = userInfo.email;
    }

    let resolvedProjectId = projectId;
    let managedProjectId: string | undefined;
    if (!resolvedProjectId) {
      const resolved = await fetchProjectId(tokens.access_token);
      resolvedProjectId = resolved.projectId || '';
      managedProjectId = resolved.managedProjectId;
    }

    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;
    const expiresAt = startTime + expiresIn * 1000;

    logDebug('OAuth token exchange complete', { email, projectId: resolvedProjectId });

    return {
      type: 'success',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      email,
      projectId: resolvedProjectId || undefined,
      managedProjectId,
    };
  } catch (error) {
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildUserInfoHeaders(): Record<string, string> {
  const cliHeaders = getRandomizedHeaders('gemini-cli');
  return {
    'User-Agent': cliHeaders['User-Agent'],
    'X-Goog-Api-Client': cliHeaders['X-Goog-Api-Client'],
    'Client-Metadata': GEMINI_CLI_CLIENT_METADATA,
  };
}

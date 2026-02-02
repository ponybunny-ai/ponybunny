export const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const ANTIGRAVITY_CLIENT_SECRET = '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';

export const ANTIGRAVITY_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

export const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';

export const ANTIGRAVITY_ENDPOINT_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';
export const ANTIGRAVITY_ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';

export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
] as const;

export const ANTIGRAVITY_LOAD_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
] as const;

export const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY;
export const GEMINI_CLI_ENDPOINT = ANTIGRAVITY_ENDPOINT_PROD;

export const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc';
export const ANTIGRAVITY_VERSION = '1.15.8' as const;

export const ANTIGRAVITY_CLIENT_METADATA =
  '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';
export const GEMINI_CLI_CLIENT_METADATA =
  'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI';

const ANTIGRAVITY_PLATFORMS = ['windows/amd64', 'darwin/arm64', 'linux/amd64', 'darwin/amd64', 'linux/arm64'] as const;

const ANTIGRAVITY_USER_AGENTS = ANTIGRAVITY_PLATFORMS.map(
  (platform) => `antigravity/${ANTIGRAVITY_VERSION} ${platform}`,
);

const ANTIGRAVITY_API_CLIENTS = [
  'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'google-cloud-sdk vscode/1.96.0',
  'google-cloud-sdk jetbrains/2024.3',
  'google-cloud-sdk vscode/1.95.0',
] as const;

const GEMINI_CLI_USER_AGENTS = [
  'google-api-nodejs-client/9.15.1',
  'google-api-nodejs-client/9.14.0',
  'google-api-nodejs-client/9.13.0',
] as const;

const GEMINI_CLI_API_CLIENTS = [
  'gl-node/22.17.0',
  'gl-node/22.12.0',
  'gl-node/20.18.0',
  'gl-node/21.7.0',
] as const;

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type HeaderStyle = 'antigravity' | 'gemini-cli';

export type HeaderSet = {
  'User-Agent': string;
  'X-Goog-Api-Client': string;
  'Client-Metadata': string;
};

export function getRandomizedHeaders(style: HeaderStyle): HeaderSet {
  if (style === 'gemini-cli') {
    return {
      'User-Agent': randomFrom(GEMINI_CLI_USER_AGENTS),
      'X-Goog-Api-Client': randomFrom(GEMINI_CLI_API_CLIENTS),
      'Client-Metadata': GEMINI_CLI_CLIENT_METADATA,
    };
  }

  return {
    'User-Agent': randomFrom(ANTIGRAVITY_USER_AGENTS),
    'X-Goog-Api-Client': randomFrom(ANTIGRAVITY_API_CLIENTS),
    'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
  };
}

/**
 * Configuration module exports
 */
export {
  type EndpointCredential,
  type CredentialsFile,
  CredentialsValidationError,
  getConfigDir,
  getCredentialsPath,
  getCredentialsSchemaPath,
  loadCredentialsFile,
  validateCredentials,
  getEndpointCredential,
  saveCredentialsFile,
  setEndpointCredential,
  removeEndpointCredential,
  listConfiguredEndpoints,
  credentialsFileExists,
  getCachedCredentials,
  getCachedEndpointCredential,
  clearCredentialsCache,
} from './credentials-loader.js';

// Onboarding
export {
  type OnboardingFile,
  type InitFileResult,
  type InitOptions,
  CREDENTIALS_SCHEMA_TEMPLATE,
  CREDENTIALS_TEMPLATE,
  LLM_CONFIG_SCHEMA_TEMPLATE,
  LLM_CONFIG_TEMPLATE,
  MCP_CONFIG_SCHEMA_TEMPLATE,
  MCP_CONFIG_TEMPLATE,
  getOnboardingFiles,
  initConfigFile,
  initAllConfigFiles,
  checkMissingConfigFiles,
  isOnboardingNeeded,
} from './onboarding.js';

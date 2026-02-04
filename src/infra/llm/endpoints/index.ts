// Endpoint types and configuration
export type { EndpointId, EndpointConfig, ResolvedEndpointCredentials } from './endpoint-config.js';
export { hasRequiredCredentials, resolveCredentials } from './endpoint-config.js';

// Endpoint registry
export {
  ENDPOINT_CONFIGS,
  getEndpointConfig,
  getAllEndpointConfigs,
  getAvailableEndpoints,
  getEndpointsByProtocol,
} from './endpoint-registry.js';

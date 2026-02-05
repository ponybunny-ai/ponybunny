/**
 * Gateway Client Module - Exports for TUI gateway communication
 */

export { GatewayClient, type GatewayClientOptions } from './gateway-client.js';
export {
  TuiGatewayClient,
  type TuiGatewayClientOptions,
  type GoalSubmitParams,
  type GoalListParams,
  type WorkItemListParams,
  type GatewayStatus,
  type GatewayEvent,
} from './tui-gateway-client.js';

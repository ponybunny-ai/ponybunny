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
  type ConversationNewParams,
  type ConversationNewResult,
  type ConversationMessageParams,
  type ConversationMessageResult,
  type ConversationListParams,
  type ConversationListResult,
  type ConversationStatusResult,
  type ConversationArchiveResult,
  type ConversationResumeResult,
  type ConversationHistoryResult,
} from './tui-gateway-client.js';

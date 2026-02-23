export interface SubagentInitPayload {
  parentAgentId: string;
  subagentId: string;
  runKey: string;
  goalId?: string;
}

export type SubagentParentMessage =
  | { type: 'init'; payload: SubagentInitPayload }
  | { type: 'shutdown' };

export type SubagentChildMessage =
  | { type: 'ready'; payload: { subagentId: string; runKey: string } }
  | { type: 'heartbeat'; payload: { subagentId: string; runKey: string; timestamp: number } }
  | { type: 'shutdown_ack'; payload: { subagentId: string } };

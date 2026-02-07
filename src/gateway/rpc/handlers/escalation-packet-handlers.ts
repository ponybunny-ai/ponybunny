/**
 * Escalation Packet Validation Handlers - RPC handlers for packet validation
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { EscalationPacketValidator } from '../../../app/escalation/escalation-validator.js';
import type { IEscalationPacket, IValidationError } from '../../../domain/escalation/types.js';
import type { EscalationType } from '../../../work-order/types/index.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface PacketValidateParams {
  packet: Partial<IEscalationPacket>;
}

export interface PacketBuildParams {
  packet: Partial<IEscalationPacket>;
}

export interface PacketCanSubmitParams {
  packet: Partial<IEscalationPacket>;
}

export interface PacketRequiredFieldsParams {
  type: EscalationType;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerEscalationPacketHandlers(
  rpcHandler: RpcHandler,
  validator: EscalationPacketValidator
): void {
  // escalation.packet.validate - Validate an escalation packet
  rpcHandler.register<PacketValidateParams, {
    valid: boolean;
    errors: IValidationError[];
    warnings: IValidationError[];
    completenessScore: number;
  }>(
    'escalation.packet.validate',
    ['read'],
    async (params) => {
      if (!params.packet) {
        throw GatewayError.invalidParams('packet is required');
      }

      return validator.validate(params.packet);
    }
  );

  // escalation.packet.canSubmit - Check if a packet can be submitted
  rpcHandler.register<PacketCanSubmitParams, { canSubmit: boolean }>(
    'escalation.packet.canSubmit',
    ['read'],
    async (params) => {
      if (!params.packet) {
        throw GatewayError.invalidParams('packet is required');
      }

      return { canSubmit: validator.canSubmit(params.packet) };
    }
  );

  // escalation.packet.build - Build a complete packet from partial data
  rpcHandler.register<PacketBuildParams, { packet: IEscalationPacket }>(
    'escalation.packet.build',
    ['read'],
    async (params) => {
      if (!params.packet) {
        throw GatewayError.invalidParams('packet is required');
      }

      return { packet: validator.buildPacket(params.packet) };
    }
  );

  // escalation.packet.requiredFields - Get required fields for an escalation type
  rpcHandler.register<PacketRequiredFieldsParams, { fields: string[] }>(
    'escalation.packet.requiredFields',
    ['read'],
    async (params) => {
      if (!params.type) {
        throw GatewayError.invalidParams('type is required');
      }

      const validTypes: EscalationType[] = ['stuck', 'ambiguous', 'risk', 'credential', 'validation_failed'];
      if (!validTypes.includes(params.type)) {
        throw GatewayError.invalidParams(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
      }

      return { fields: validator.getRequiredFields(params.type) };
    }
  );
}

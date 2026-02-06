/**
 * Persona Handlers - RPC handlers for persona operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { IPersonaEngine } from '../../../app/conversation/persona-engine.js';
import type { IPersona, IPersonaSummary } from '../../../domain/conversation/persona.js';

export interface PersonaGetParams {
  id: string;
}

export function registerPersonaHandlers(
  rpcHandler: RpcHandler,
  personaEngine: IPersonaEngine
): void {
  // persona.list - List all available personas
  rpcHandler.register<Record<string, never>, { personas: IPersonaSummary[] }>(
    'persona.list',
    ['read'],
    async () => {
      const personas = await personaEngine.listPersonas();
      return { personas };
    }
  );

  // persona.get - Get a specific persona by ID
  rpcHandler.register<PersonaGetParams, IPersona | null>(
    'persona.get',
    ['read'],
    async (params) => {
      if (!params.id) {
        throw GatewayError.invalidParams('id is required');
      }

      const persona = await personaEngine.getPersona(params.id);

      if (!persona) {
        throw GatewayError.invalidParams(`Persona not found: ${params.id}`);
      }

      return persona;
    }
  );

  // persona.default - Get the default persona ID
  rpcHandler.register<Record<string, never>, { personaId: string }>(
    'persona.default',
    ['read'],
    async () => {
      return { personaId: personaEngine.getDefaultPersonaId() };
    }
  );
}

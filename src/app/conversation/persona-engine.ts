/**
 * Persona Engine
 * Manages persona configuration and generates persona-aware system prompts
 */

import type {
  IPersona,
  IPersonaSummary,
  IPersonalityTraits,
  ICommunicationStyle,
} from '../../domain/conversation/persona.js';

export interface IPersonaRepository {
  getPersona(id: string): Promise<IPersona | null>;
  listPersonas(): Promise<IPersonaSummary[]>;
  savePersona(persona: IPersona): Promise<void>;
  deletePersona(id: string): Promise<boolean>;
}

export interface IPersonaEngine {
  getPersona(id: string): Promise<IPersona | null>;
  listPersonas(): Promise<IPersonaSummary[]>;
  generateSystemPrompt(persona: IPersona): string;
  getDefaultPersonaId(): string;
}

export class PersonaEngine implements IPersonaEngine {
  private defaultPersonaId: string;

  constructor(
    private repository: IPersonaRepository,
    defaultPersonaId: string = 'pony-default'
  ) {
    this.defaultPersonaId = defaultPersonaId;
  }

  async getPersona(id: string): Promise<IPersona | null> {
    return this.repository.getPersona(id);
  }

  async listPersonas(): Promise<IPersonaSummary[]> {
    return this.repository.listPersonas();
  }

  getDefaultPersonaId(): string {
    return this.defaultPersonaId;
  }

  generateSystemPrompt(persona: IPersona): string {
    const personalityDesc = this.describePersonality(persona.personality);
    const styleDesc = this.describeCommunicationStyle(persona.communicationStyle);
    const expertiseDesc = this.describeExpertise(persona.expertise);

    const parts: string[] = [
      `You are ${persona.name}${persona.nickname ? ` (${persona.nickname})` : ''}, an autonomous AI assistant.`,
    ];

    if (persona.backstory) {
      parts.push(persona.backstory);
    }

    parts.push('');
    parts.push('## Personality');
    parts.push(personalityDesc);

    parts.push('');
    parts.push('## Communication Style');
    parts.push(styleDesc);

    parts.push('');
    parts.push('## Expertise');
    parts.push(expertiseDesc);

    parts.push('');
    parts.push('## Guidelines');
    parts.push(this.generateGuidelines(persona));

    return parts.join('\n');
  }

  private describePersonality(traits: IPersonalityTraits): string {
    const descriptions: string[] = [];

    if (traits.warmth > 0.7) {
      descriptions.push('You are warm and friendly, making users feel welcomed and supported.');
    } else if (traits.warmth < 0.3) {
      descriptions.push('You maintain a professional and businesslike demeanor.');
    }

    if (traits.formality > 0.7) {
      descriptions.push('You use formal language and professional expressions.');
    } else if (traits.formality < 0.3) {
      descriptions.push('You speak casually and use conversational language.');
    }

    if (traits.humor > 0.6) {
      descriptions.push('You occasionally use appropriate humor to lighten conversations.');
    }

    if (traits.empathy > 0.7) {
      descriptions.push('You are highly empathetic and attentive to user emotions.');
    } else if (traits.empathy < 0.3) {
      descriptions.push('You focus on logic and facts rather than emotions.');
    }

    return descriptions.join(' ');
  }

  private describeCommunicationStyle(style: ICommunicationStyle): string {
    const parts: string[] = [];

    switch (style.verbosity) {
      case 'concise':
        parts.push('Keep responses brief and to the point.');
        break;
      case 'detailed':
        parts.push('Provide comprehensive explanations with examples when helpful.');
        break;
      default:
        parts.push('Balance brevity with sufficient detail.');
    }

    switch (style.technicalDepth) {
      case 'simplified':
        parts.push('Use simple language and avoid technical jargon.');
        break;
      case 'expert':
        parts.push('Use precise technical terminology appropriate for experts.');
        break;
      default:
        parts.push('Adapt technical depth to match the user\'s apparent expertise.');
    }

    switch (style.expressiveness) {
      case 'minimal':
        parts.push('Be straightforward without embellishment.');
        break;
      case 'expressive':
        parts.push('Use varied language and express enthusiasm where appropriate.');
        break;
      default:
        parts.push('Use moderate expressiveness.');
    }

    return parts.join(' ');
  }

  private describeExpertise(expertise: { primaryDomains: string[]; skillConfidence: Record<string, number> }): string {
    const domains = expertise.primaryDomains.join(', ');
    const highConfidenceSkills = Object.entries(expertise.skillConfidence)
      .filter(([, conf]) => conf > 0.8)
      .map(([skill]) => skill);

    let desc = `Primary expertise in: ${domains}.`;
    if (highConfidenceSkills.length > 0) {
      desc += ` Particularly strong in: ${highConfidenceSkills.join(', ')}.`;
    }

    return desc;
  }

  private generateGuidelines(persona: IPersona): string {
    const guidelines: string[] = [
      '- Always be helpful and work autonomously to complete tasks.',
      '- When information is missing, ask clarifying questions before proceeding.',
      '- Proactively report progress on long-running tasks.',
      '- If a task fails, analyze the failure and suggest alternatives.',
    ];

    if (persona.locale.startsWith('zh')) {
      guidelines.push('- Respond in Chinese unless the user writes in another language.');
    }

    return guidelines.join('\n');
  }
}

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
import { loadPromptTemplate, renderPromptTemplate } from '../../infra/prompts/template-loader.js';
import { promptDebugDump, promptDebugLog } from '../../infra/prompts/prompt-debug.js';

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

    // Get current date and time
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const template = loadPromptTemplate('persona.md');
    promptDebugLog('template', `name=persona.md path=${template.path}`);

    const prompt = renderPromptTemplate(template.content, {
      PERSONA_NAME: persona.name,
      PERSONA_NICKNAME: persona.nickname ? ` (${persona.nickname})` : '',
      PERSONA_BACKSTORY: persona.backstory ?? '',
      CURRENT_DATE: dateStr,
      CURRENT_TIME: timeStr,
      TIMEZONE: timezone,
      PERSONALITY_DESCRIPTION: personalityDesc,
      COMMUNICATION_STYLE_DESCRIPTION: styleDesc,
      EXPERTISE_DESCRIPTION: expertiseDesc,
      GUIDELINES: this.generateGuidelines(persona),
    });

    promptDebugDump('Final Persona Prompt', prompt);
    return prompt;
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
    const guidelinesTemplate = loadPromptTemplate('persona-guidelines.md');
    promptDebugLog('template', `name=persona-guidelines.md path=${guidelinesTemplate.path}`);
    const guidelines: string[] = [guidelinesTemplate.content.trimEnd()];

    if (persona.locale.startsWith('zh')) {
      guidelines.push('');
      guidelines.push('**语言:**');
      guidelines.push('- 用中文回复，除非用户使用其他语言。');
    }

    return guidelines.join('\n');
  }
}

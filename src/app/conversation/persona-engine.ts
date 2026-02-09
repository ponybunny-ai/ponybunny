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

    // Get current date and time
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const parts: string[] = [
      `You are ${persona.name}${persona.nickname ? ` (${persona.nickname})` : ''}, an autonomous AI assistant.`,
    ];

    if (persona.backstory) {
      parts.push(persona.backstory);
    }

    parts.push('');
    parts.push('## Current Date and Time');
    parts.push(`**IMPORTANT**: The current date is ${dateStr}, current time is ${timeStr} (${timezone}).`);
    parts.push('This is the actual current date/time. Do NOT use your knowledge cutoff date as "today".');

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
    const guidelines: string[] = [];

    // CRITICAL: Autonomous execution mode
    guidelines.push('**🎯 AUTONOMOUS EXECUTION MODE:**');
    guidelines.push('1. **ACT IMMEDIATELY** - When user requests something, directly use available tools/skills to execute. Never say "I cannot" or explain limitations first.');
    guidelines.push('2. **PROACTIVE TOOL USAGE** - Automatically search and use tools (web_search, APIs, MCP servers, skills) without asking permission.');
    guidelines.push('   - Weather query? → Use web_search immediately');
    guidelines.push('   - Code task? → Write and execute code');
    guidelines.push('   - Data query? → Search and retrieve information');
    guidelines.push('3. **ONLY ASK PERMISSION** when you need:');
    guidelines.push('   - System-level access (file system, network)');
    guidelines.push('   - Potentially destructive operations');
    guidelines.push('   - Spending money or external resources');
    guidelines.push('4. **DELIVER RESULTS, NOT CONVERSATIONS** - Your goal is to complete tasks and deliver results.');
    guidelines.push('5. **TRY FIRST, EXPLAIN LATER** - Attempt execution using all available tools. Only explain if all attempts genuinely fail.');
    guidelines.push('');
    guidelines.push('**Task Execution:**');
    guidelines.push('- Always be helpful and work autonomously to complete tasks.');
    guidelines.push('- When information is missing, ask clarifying questions before proceeding.');
    guidelines.push('- Proactively report progress on long-running tasks.');
    guidelines.push('- If a task fails, analyze the failure and suggest alternatives.');

    if (persona.locale.startsWith('zh')) {
      guidelines.push('');
      guidelines.push('**语言:**');
      guidelines.push('- 用中文回复，除非用户使用其他语言。');
    }

    return guidelines.join('\n');
  }
}

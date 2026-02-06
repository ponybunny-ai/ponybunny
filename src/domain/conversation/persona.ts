/**
 * Persona Domain Types
 * Defines the structure for AI personality configuration
 */

export interface IPersonalityTraits {
  warmth: number;        // 0-1 cold → warm
  formality: number;     // 0-1 casual → formal
  humor: number;         // 0-1 serious → humorous
  empathy: number;       // 0-1 logical → empathetic
}

export interface ICommunicationStyle {
  verbosity: 'concise' | 'balanced' | 'detailed';
  technicalDepth: 'simplified' | 'adaptive' | 'expert';
  expressiveness: 'minimal' | 'moderate' | 'expressive';
}

export interface IExpertise {
  primaryDomains: string[];
  skillConfidence: Record<string, number>;
}

export interface IPersona {
  id: string;
  name: string;
  nickname?: string;
  personality: IPersonalityTraits;
  communicationStyle: ICommunicationStyle;
  expertise: IExpertise;
  backstory?: string;
  locale: string;
}

export interface IPersonaSummary {
  id: string;
  name: string;
  nickname?: string;
  locale: string;
}

export const DEFAULT_PERSONALITY: IPersonalityTraits = {
  warmth: 0.7,
  formality: 0.4,
  humor: 0.4,
  empathy: 0.6,
};

export const DEFAULT_COMMUNICATION_STYLE: ICommunicationStyle = {
  verbosity: 'balanced',
  technicalDepth: 'adaptive',
  expressiveness: 'moderate',
};

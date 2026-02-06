/**
 * Input Analysis Domain Types
 * Types for intent recognition, emotion analysis, and purpose extraction
 */

// Intent Categories
export type IntentCategory =
  | 'greeting'
  | 'farewell'
  | 'small_talk'
  | 'task_request'
  | 'question'
  | 'status_inquiry'
  | 'cancellation'
  | 'confirmation'
  | 'clarification'
  | 'feedback'
  | 'unknown';

// Emotional States
export type EmotionalState =
  | 'neutral'
  | 'happy'
  | 'frustrated'
  | 'confused'
  | 'excited'
  | 'anxious'
  | 'grateful'
  | 'disappointed';

// Urgency Levels
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface IExtractedEntity {
  type: string;
  value: string;
  confidence: number;
  startIndex?: number;
  endIndex?: number;
}

export interface IIntentAnalysis {
  primary: IntentCategory;
  confidence: number;
  secondary?: IntentCategory;
  entities: IExtractedEntity[];
}

export interface IEmotionAnalysis {
  primary: EmotionalState;
  intensity: number;  // 0-1
  urgency: UrgencyLevel;
}

export interface IPurposeAnalysis {
  isActionable: boolean;
  extractedGoal?: string;
  missingInfo: string[];
  successCriteria?: string[];
  constraints?: string[];
}

export interface IInputAnalysis {
  intent: IIntentAnalysis;
  emotion: IEmotionAnalysis;
  purpose: IPurposeAnalysis;
  rawInput: string;
  analyzedAt: number;
}

export interface IExtractedRequirements {
  title: string;
  description: string;
  successCriteria: string[];
  constraints?: string[];
  priority?: 'low' | 'medium' | 'high';
  estimatedComplexity?: 'simple' | 'medium' | 'complex';
}

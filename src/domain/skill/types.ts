export interface Skill {
  name: string;
  description: string;
  version?: string;
  path: string;
  content?: string; // Loaded JIT
}

export interface SkillMetadata {
  name: string;
  description: string;
  emoji?: string;
  requires?: {
    bins?: string[];
    env?: string[];
  };
}

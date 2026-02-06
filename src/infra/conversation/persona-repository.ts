/**
 * Persona Repository
 * Manages persona storage and retrieval
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IPersona, IPersonaSummary } from '../../domain/conversation/persona.js';
import type { IPersonaRepository } from '../../app/conversation/persona-engine.js';

export class FilePersonaRepository implements IPersonaRepository {
  private personasDir: string;
  private cache = new Map<string, IPersona>();

  constructor(personasDir: string) {
    this.personasDir = personasDir;
    this.loadAllPersonas();
  }

  private loadAllPersonas(): void {
    if (!fs.existsSync(this.personasDir)) {
      fs.mkdirSync(this.personasDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(this.personasDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(
            path.join(this.personasDir, file),
            'utf-8'
          );
          const persona = JSON.parse(content) as IPersona;
          this.cache.set(persona.id, persona);
        } catch (error) {
          console.error(`[PersonaRepository] Failed to load ${file}:`, error);
        }
      }
    }
  }

  async getPersona(id: string): Promise<IPersona | null> {
    return this.cache.get(id) || null;
  }

  async listPersonas(): Promise<IPersonaSummary[]> {
    return Array.from(this.cache.values()).map(p => ({
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      locale: p.locale,
    }));
  }

  async savePersona(persona: IPersona): Promise<void> {
    const filePath = path.join(this.personasDir, `${persona.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(persona, null, 2), 'utf-8');
    this.cache.set(persona.id, persona);
  }

  async deletePersona(id: string): Promise<boolean> {
    const filePath = path.join(this.personasDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.cache.delete(id);
      return true;
    }
    return false;
  }
}

/**
 * In-memory persona repository for testing
 */
export class InMemoryPersonaRepository implements IPersonaRepository {
  private personas = new Map<string, IPersona>();

  async getPersona(id: string): Promise<IPersona | null> {
    return this.personas.get(id) || null;
  }

  async listPersonas(): Promise<IPersonaSummary[]> {
    return Array.from(this.personas.values()).map(p => ({
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      locale: p.locale,
    }));
  }

  async savePersona(persona: IPersona): Promise<void> {
    this.personas.set(persona.id, persona);
  }

  async deletePersona(id: string): Promise<boolean> {
    return this.personas.delete(id);
  }

  // Helper for testing
  addPersona(persona: IPersona): void {
    this.personas.set(persona.id, persona);
  }
}

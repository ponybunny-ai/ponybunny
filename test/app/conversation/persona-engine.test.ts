import { PersonaEngine } from '../../../src/app/conversation/persona-engine.js';
import { InMemoryPersonaRepository } from '../../../src/infra/conversation/persona-repository.js';

describe('PersonaEngine prompt overrides', () => {
  it('applies configured placeholder overrides when provided', async () => {
    const repository = new InMemoryPersonaRepository();
    repository.addPersona({
      id: 'pony-default',
      name: 'Pony',
      personality: { warmth: 0.8, formality: 0.4, humor: 0.5, empathy: 0.7 },
      communicationStyle: { verbosity: 'balanced', technicalDepth: 'adaptive', expressiveness: 'moderate' },
      expertise: {
        primaryDomains: ['software-engineering'],
        skillConfidence: { coding: 0.9 },
      },
      backstory: 'Default backstory',
      locale: 'en-GB',
    });

    const engine = new PersonaEngine(repository, 'pony-default', {
      personalityDescription: 'Configured personality description',
      communicationStyleDescription: 'Configured communication description',
      expertiseDescription: 'Configured expertise description',
      guidelines: 'Configured guidelines',
      backstory: 'Configured backstory',
    });

    const persona = await engine.getPersona('pony-default');
    expect(persona).not.toBeNull();

    const prompt = engine.generateSystemPrompt(persona!);
    expect(prompt).toContain('Configured personality description');
    expect(prompt).toContain('Configured communication description');
    expect(prompt).toContain('Configured expertise description');
    expect(prompt).toContain('Configured guidelines');
    expect(prompt).toContain('Configured backstory');
  });
});

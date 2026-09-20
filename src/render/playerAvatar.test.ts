import { describe, expect, it } from 'vitest';
import { CLASS_DEFINITIONS } from '../config/classes';
import { classModelFile } from './playerAvatar';

describe('classModelFile', () => {
  it('resolves every playable class to one of the 4 vendored character models', () => {
    const validModels = new Set(['Barbarian', 'Knight', 'Mage', 'Rogue']);
    for (const classDef of CLASS_DEFINITIONS) {
      const file = classModelFile(classDef.id);
      expect(file, `no model mapped for class "${classDef.id}"`).toBeDefined();
      expect(validModels.has(file!), `"${classDef.id}" maps to unknown model "${file}"`).toBe(true);
    }
  });
});

/** Crafting materials monsters drop — each tied to one vendor specialty's crafting recipes. */
export interface MaterialDefinition {
  id: string;
  name: string;
  description: string;
  color: number;
}

export const MATERIAL_DEFINITIONS: MaterialDefinition[] = [
  { id: 'mat_iron_ore', name: 'Minério de Ferro', description: 'Bruto, mas o suficiente para uma boa forja.', color: 0x8a8478 },
  { id: 'mat_leather', name: 'Couro Curtido', description: 'Flexível e resistente.', color: 0x8a6a3f },
  { id: 'mat_herb', name: 'Erva Medicinal', description: 'Cresce mesmo onde a Sede já passou.', color: 0x6fcf97 },
  { id: 'mat_arcane_shard', name: 'Fragmento Arcano', description: 'Pulsa com energia residual.', color: 0x8a4fd8 },
];

export function getMaterialById(id: string): MaterialDefinition {
  const found = MATERIAL_DEFINITIONS.find((m) => m.id === id);
  if (!found) throw new Error(`Material desconhecido: ${id}`);
  return found;
}

/** Chance any given defeated enemy drops one unit of a random material, independent of the existing equipment-loot roll. */
export const MATERIAL_DROP_CHANCE = 0.45;

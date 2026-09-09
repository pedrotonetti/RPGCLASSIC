import { RARITY_ORDER, RARITY_STAT_MULTIPLIER } from '../config/rarity';
import type { EquipmentInstance, EquipmentTemplate, ItemRarity, Stats } from '../config/types';

export const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  // --- weapons ---------------------------------------------------------
  { id: 'espada_curta', name: 'Espada Curta', slot: 'arma', description: 'Lâmina leve e equilibrada.', statWeights: { attack: 4 } },
  { id: 'machado_guerra', name: 'Machado de Guerra', slot: 'arma', description: 'Golpes pesados e brutais.', statWeights: { attack: 5, speed: -1 } },
  { id: 'cajado_arcano', name: 'Cajado Arcano', slot: 'arma', description: 'Canaliza energia mágica pura.', statWeights: { magicAttack: 4 } },
  { id: 'arco_longo', name: 'Arco Longo', slot: 'arma', description: 'Alcance e precisão em cada tiro.', statWeights: { attack: 3, speed: 2 } },
  { id: 'adaga_sombria', name: 'Adaga Sombria', slot: 'arma', description: 'Forjada para golpes rápidos e certeiros.', statWeights: { attack: 2, speed: 3, luck: 1 } },
  { id: 'grimorio_amaldicoado', name: 'Grimório Amaldiçoado', slot: 'arma', description: 'Páginas escritas com tinta de sombra.', statWeights: { magicAttack: 3, luck: 2 } },
  { id: 'manoplas_combate', name: 'Manoplas de Combate', slot: 'arma', description: 'Para golpes marciais encadeados.', statWeights: { attack: 3, speed: 2 } },
  { id: 'martelo_sagrado', name: 'Martelo Sagrado', slot: 'arma', description: 'Pesa como a fé de quem o carrega.', statWeights: { attack: 3, magicDefense: 2 } },

  // --- armor -------------------------------------------------------------
  { id: 'armadura_couro', name: 'Armadura de Couro', slot: 'armadura', description: 'Leve e flexível.', statWeights: { defense: 3, speed: 1 } },
  { id: 'armadura_placas', name: 'Armadura de Placas', slot: 'armadura', description: 'Proteção pesada de metal.', statWeights: { defense: 4, maxHp: 6 } },
  { id: 'vestes_arcanas', name: 'Vestes Arcanas', slot: 'armadura', description: 'Tecidas com fios encantados.', statWeights: { magicDefense: 4, maxMp: 6 } },
  { id: 'manto_sagrado', name: 'Manto Sagrado', slot: 'armadura', description: 'Abençoado por rituais antigos.', statWeights: { magicDefense: 3, maxHp: 5 } },

  // --- accessories ---------------------------------------------------------
  { id: 'anel_sorte', name: 'Anel da Sorte', slot: 'acessorio', description: 'Favorece quem o usa.', statWeights: { luck: 4 } },
  { id: 'amuleto_vitalidade', name: 'Amuleto da Vitalidade', slot: 'acessorio', description: 'Pulsa com energia vital.', statWeights: { maxHp: 8 } },
  { id: 'bracelete_arcano', name: 'Bracelete Arcano', slot: 'acessorio', description: 'Amplifica o fluxo de mana.', statWeights: { maxMp: 6, magicAttack: 2 } },
  { id: 'talisma_velocidade', name: 'Talismã de Velocidade', slot: 'acessorio', description: 'Deixa os passos mais leves.', statWeights: { speed: 4 } },
];

export function getEquipmentTemplate(id: string): EquipmentTemplate {
  const found = EQUIPMENT_TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`Equipamento desconhecido: ${id}`);
  return found;
}

/** Flat stat bonuses an equipped instance grants, after rarity and item-level scaling. */
export function computeEquipmentBonus(instance: EquipmentInstance): Partial<Stats> {
  const template = getEquipmentTemplate(instance.templateId);
  const rarityMult = RARITY_STAT_MULTIPLIER[instance.rarity];
  const levelMult = 1 + (instance.itemLevel - 1) * 0.12;
  const bonus: Partial<Stats> = {};
  for (const [stat, weight] of Object.entries(template.statWeights) as Array<[keyof Stats, number]>) {
    bonus[stat] = Math.round(weight * rarityMult * levelMult * 10) / 10;
  }
  return bonus;
}

function pickWeightedRarity(luckBias = 0): ItemRarity {
  // Base weights strongly favor common drops; luck nudges toward rarer tiers.
  const weights = [50, 27, 14, 7, 2].map((w, i) => Math.max(1, w + luckBias * i));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RARITY_ORDER[i];
  }
  return RARITY_ORDER[0];
}

let lootCounter = 0;
function nextUid(): string {
  lootCounter += 1;
  return `item_${Date.now().toString(36)}_${lootCounter}`;
}

/** Rolls a random equipment drop appropriate for the given character level. */
export function generateLoot(characterLevel: number, luckBias = 0): EquipmentInstance {
  const template = EQUIPMENT_TEMPLATES[Math.floor(Math.random() * EQUIPMENT_TEMPLATES.length)];
  const rarity = pickWeightedRarity(luckBias);
  const itemLevel = Math.max(1, characterLevel + Math.round(Math.random() * 2 - 1));
  return { uid: nextUid(), templateId: template.id, rarity, itemLevel };
}

export function createStarterItem(templateId: string, rarity: ItemRarity = 'verde', itemLevel = 1): EquipmentInstance {
  return { uid: nextUid(), templateId, rarity, itemLevel };
}

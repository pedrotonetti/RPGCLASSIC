import { RARITY_ORDER, RARITY_STAT_MULTIPLIER } from '../config/rarity';
import type { EquipmentInstance, EquipmentTemplate, ItemRarity, Stats } from '../config/types';
import { getGemById } from './gems';

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

/** Flat stat bonuses an equipped instance grants, after rarity and item-level scaling, plus its socketed gem's bonus if any. */
export function computeEquipmentBonus(instance: EquipmentInstance): Partial<Stats> {
  const template = getEquipmentTemplate(instance.templateId);
  const rarityMult = RARITY_STAT_MULTIPLIER[instance.rarity];
  const levelMult = 1 + (instance.itemLevel - 1) * 0.12;
  const bonus: Partial<Stats> = {};
  for (const [stat, weight] of Object.entries(template.statWeights) as Array<[keyof Stats, number]>) {
    bonus[stat] = Math.round(weight * rarityMult * levelMult * 10) / 10;
  }
  if (instance.socketedGemId) {
    const gem = getGemById(instance.socketedGemId);
    for (const [stat, value] of Object.entries(gem.statBonus) as Array<[keyof Stats, number]>) {
      bonus[stat] = (bonus[stat] ?? 0) + value;
    }
  }
  return bonus;
}

function pickWeightedRarity(bias = 0): ItemRarity {
  // Base weights strongly favor common drops; `bias` (player luck plus, for
  // real drops, the defeated enemy's own tier — see generateLoot) nudges
  // toward rarer tiers. The common weight itself (index 0, multiplied by
  // bias*0) is never touched by this bias, so even a very high bias — a
  // tough, high-level kill with a lucky character — still leaves common a
  // live outcome; it just stops being the overwhelming favorite.
  const weights = [50, 27, 14, 7, 2].map((w, i) => Math.max(1, w + bias * i));
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

// generateLoot anchors the dropped item's level mostly to the DEFEATED
// ENEMY's own difficulty tier (EnemyDefinition.level), not the player's
// current level — a tough kill should drop something worth using regardless
// of whether the player is under-leveled for it, and a trivial kill
// shouldn't get to coast on the player's own level being high. The
// player's level still contributes a smaller nudge on top, so a
// high-level character stomping a low-tier enemy isn't handed pure junk
// either, and a low-level character punching above their weight is
// rewarded more than one who isn't.
const ENEMY_LEVEL_WEIGHT = 0.7;
const PLAYER_LEVEL_WEIGHT = 0.3;
/**
 * How much each point of the defeated enemy's level nudges rarity odds
 * upward, on top of the player's luck stat (see pickWeightedRarity). A
 * level-1 slime barely moves the needle; the level-18 boss shifts the table
 * hard toward rare-and-up — "harder enemy = better loot" applies to rarity,
 * not just item level.
 */
const ENEMY_TIER_RARITY_BIAS_PER_LEVEL = 0.6;

/** Rolls a random equipment drop for defeating the given enemy (by its own difficulty tier), with the player's own level and luck as secondary factors. */
export function generateLoot(enemyLevel: number, characterLevel: number, luckBias = 0): EquipmentInstance {
  const template = EQUIPMENT_TEMPLATES[Math.floor(Math.random() * EQUIPMENT_TEMPLATES.length)];
  const rarityBias = luckBias + enemyLevel * ENEMY_TIER_RARITY_BIAS_PER_LEVEL;
  const rarity = pickWeightedRarity(rarityBias);
  const anchor = enemyLevel * ENEMY_LEVEL_WEIGHT + characterLevel * PLAYER_LEVEL_WEIGHT;
  const itemLevel = Math.max(1, Math.round(anchor + (Math.random() * 2 - 1)));
  return { uid: nextUid(), templateId: template.id, rarity, itemLevel };
}

export function createStarterItem(templateId: string, rarity: ItemRarity = 'verde', itemLevel = 1): EquipmentInstance {
  return { uid: nextUid(), templateId, rarity, itemLevel };
}

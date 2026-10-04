import { RARITY_ORDER, RARITY_STAT_MULTIPLIER } from '../config/rarity';
import type { EquipmentInstance, EquipmentTemplate, ItemRarity, Stats } from '../config/types';
import { pityFloor, recordDrop, type LootPityState } from '../systems/LootPity';
import { AFFIX_COUNT_BY_RARITY, affixStatBonus, getAffixDefinition, rollAffixes } from './affixes';
import { getGemById } from './gems';
import { SET_PIECE_DROP_CHANCE, SET_TEMPLATES, UNIQUE_AFFIX_COUNT, UNIQUE_DROP_CHANCE, UNIQUE_TEMPLATES } from './uniques';

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

const TEMPLATE_BY_ID = new Map<string, EquipmentTemplate>([...EQUIPMENT_TEMPLATES, ...UNIQUE_TEMPLATES, ...SET_TEMPLATES].map((t) => [t.id, t]));

export function getEquipmentTemplate(id: string): EquipmentTemplate {
  const found = TEMPLATE_BY_ID.get(id);
  if (!found) throw new Error(`Equipamento desconhecido: ${id}`);
  return found;
}

/** Name shown to the player: uniques and set pieces keep their own name, a regular item borrows the title of its lead affix ("Espada Curta de Brasa"). */
export function itemDisplayName(instance: EquipmentInstance): string {
  const template = getEquipmentTemplate(instance.templateId);
  if (template.passiveId || template.setId) return template.name;
  const lead = instance.affixes?.[0];
  const title = lead ? getAffixDefinition(lead.id)?.title : undefined;
  return title ? `${template.name} ${title}` : template.name;
}

function affixCountFor(template: EquipmentTemplate, rarity: ItemRarity): number {
  if (template.passiveId) return UNIQUE_AFFIX_COUNT[rarity] ?? 0;
  return AFFIX_COUNT_BY_RARITY[rarity];
}

function rollInstanceAffixes(template: EquipmentTemplate, rarity: ItemRarity, itemLevel: number, rng: () => number): Pick<EquipmentInstance, 'affixes'> {
  const count = affixCountFor(template, rarity);
  return count > 0 ? { affixes: rollAffixes(template.slot, itemLevel, count, rng) } : {};
}

/** Flat stat bonuses an equipped instance grants, after rarity and item-level scaling, plus its flat-stat affixes and socketed gem's bonus if any. */
export function computeEquipmentBonus(instance: EquipmentInstance): Partial<Stats> {
  const template = getEquipmentTemplate(instance.templateId);
  const rarityMult = RARITY_STAT_MULTIPLIER[instance.rarity];
  const levelMult = 1 + (instance.itemLevel - 1) * 0.12;
  const bonus: Partial<Stats> = {};
  for (const [stat, weight] of Object.entries(template.statWeights) as Array<[keyof Stats, number]>) {
    bonus[stat] = Math.round(weight * rarityMult * levelMult * 10) / 10;
  }
  for (const [stat, value] of Object.entries(affixStatBonus(instance.affixes)) as Array<[keyof Stats, number]>) {
    bonus[stat] = (bonus[stat] ?? 0) + value;
  }
  if (instance.socketedGemId) {
    const gem = getGemById(instance.socketedGemId);
    for (const [stat, value] of Object.entries(gem.statBonus) as Array<[keyof Stats, number]>) {
      bonus[stat] = (bonus[stat] ?? 0) + value;
    }
  }
  return bonus;
}

/** Base odds weights by rarity tier; `bias` adds `bias * tier` to each, never dropping below 1, so common stays a live outcome at any bias. */
const BASE_RARITY_WEIGHTS = [50, 27, 14, 7, 2];

/** Probability of each rarity for a given bias, with tiers below `floor` (a pity guarantee) removed — the single source both the roll and any odds readout use. */
export function rarityOdds(bias = 0, floor: ItemRarity | null = null): Record<ItemRarity, number> {
  const floorTier = floor ? RARITY_ORDER.indexOf(floor) : 0;
  const weights = BASE_RARITY_WEIGHTS.map((w, i) => (i < floorTier ? 0 : Math.max(1, w + bias * i)));
  const total = weights.reduce((a, b) => a + b, 0);
  const odds = {} as Record<ItemRarity, number>;
  RARITY_ORDER.forEach((rarity, i) => {
    odds[rarity] = weights[i] / total;
  });
  return odds;
}

function pickWeightedRarity(bias: number, rng: () => number, floor: ItemRarity | null): ItemRarity {
  const odds = rarityOdds(bias, floor);
  let roll = rng();
  for (const rarity of RARITY_ORDER) {
    roll -= odds[rarity];
    if (roll < 0) return rarity;
  }
  return RARITY_ORDER[RARITY_ORDER.length - 1];
}

function pickFrom<T>(list: T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** Lendário/Mítico drops are usually a unique with its own passive; Raro-or-better ones are sometimes a set piece. */
function pickTemplate(rarity: ItemRarity, rng: () => number): EquipmentTemplate {
  const uniqueChance = UNIQUE_DROP_CHANCE[rarity] ?? 0;
  if (uniqueChance > 0 && rng() < uniqueChance) {
    const uniques = UNIQUE_TEMPLATES.filter((t) => t.fixedRarity === rarity);
    if (uniques.length > 0) return pickFrom(uniques, rng);
  }
  if (RARITY_ORDER.indexOf(rarity) >= 1 && rng() < SET_PIECE_DROP_CHANCE) return pickFrom(SET_TEMPLATES, rng);
  return pickFrom(EQUIPMENT_TEMPLATES, rng);
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

export interface LootOptions {
  rng?: () => number;
  /** The player's pity counters: read for a guaranteed rarity floor, then updated in place with this drop. */
  pity?: LootPityState;
}

/** Rarity bias a drop rolls with — the player's luck plus the defeated enemy's own tier. */
export function lootRarityBias(enemyLevel: number, luckBias = 0): number {
  return luckBias + enemyLevel * ENEMY_TIER_RARITY_BIAS_PER_LEVEL;
}

/** Rolls a random equipment drop for defeating the given enemy (by its own difficulty tier), with the player's own level and luck as secondary factors. */
export function generateLoot(enemyLevel: number, characterLevel: number, luckBias = 0, opts: LootOptions = {}): EquipmentInstance {
  const rng = opts.rng ?? Math.random;
  const rarity = pickWeightedRarity(lootRarityBias(enemyLevel, luckBias), rng, opts.pity ? pityFloor(opts.pity) : null);
  if (opts.pity) recordDrop(opts.pity, rarity);
  const template = pickTemplate(rarity, rng);
  const anchor = enemyLevel * ENEMY_LEVEL_WEIGHT + characterLevel * PLAYER_LEVEL_WEIGHT;
  const itemLevel = Math.max(1, Math.round(anchor + (rng() * 2 - 1)));
  return { uid: nextUid(), templateId: template.id, rarity, itemLevel, ...rollInstanceAffixes(template, rarity, itemLevel, rng) };
}

export function createStarterItem(templateId: string, rarity: ItemRarity = 'verde', itemLevel = 1, rng: () => number = Math.random): EquipmentInstance {
  const affixes = rarity === 'verde' ? {} : rollInstanceAffixes(getEquipmentTemplate(templateId), rarity, itemLevel, rng);
  return { uid: nextUid(), templateId, rarity, itemLevel, ...affixes };
}

import type { EquipmentSlot, ItemAffix, ItemRarity, Stats } from '../config/types';

/** Combat/economy effects items can grant, summed across everything equipped — fractions (0.05 = 5%) unless noted. */
export interface ItemModifiers {
  critChance: number;
  /** Added to the 1.6x crit multiplier. */
  critDamage: number;
  damageDealt: number;
  /** Positive = takes more damage (a risk). */
  damageTaken: number;
  damageReduction: number;
  lifeSteal: number;
  /** Share of damage taken reflected to the attacker. */
  thorns: number;
  /** Flat MP per second. */
  mpRegen: number;
  /** Share of max MP per second. */
  mpRegenPct: number;
  /** Share shaved off every skill's MP cost. */
  mpCost: number;
  /** Faster class-meter fill. */
  meterGain: number;
  goldFind: number;
  /** Flat nudge toward rarer drops, same scale as the luck stat. */
  lootBias: number;
  bleedChance: number;
  burnChance: number;
  poisonChance: number;
  slowChance: number;
}

export type ItemModifierKey = keyof ItemModifiers;

export function emptyModifiers(): ItemModifiers {
  return {
    critChance: 0,
    critDamage: 0,
    damageDealt: 0,
    damageTaken: 0,
    damageReduction: 0,
    lifeSteal: 0,
    thorns: 0,
    mpRegen: 0,
    mpRegenPct: 0,
    mpCost: 0,
    meterGain: 0,
    goldFind: 0,
    lootBias: 0,
    bleedChance: 0,
    burnChance: 0,
    poisonChance: 0,
    slowChance: 0,
  };
}

/** Hard ceilings applied after summing every source, so stacked affixes and passives can't break the combat math. */
const MODIFIER_CAPS: Partial<Record<ItemModifierKey, number>> = {
  critChance: 0.35,
  lifeSteal: 0.25,
  thorns: 0.5,
  damageReduction: 0.6,
  mpCost: 0.5,
  bleedChance: 0.6,
  burnChance: 0.6,
  poisonChance: 0.6,
  slowChance: 0.6,
};

export function addModifiers(target: ItemModifiers, source: Partial<ItemModifiers>): void {
  for (const [key, value] of Object.entries(source) as Array<[ItemModifierKey, number]>) {
    target[key] += value;
  }
}

export function capModifiers(mods: ItemModifiers): ItemModifiers {
  for (const [key, cap] of Object.entries(MODIFIER_CAPS) as Array<[ItemModifierKey, number]>) {
    mods[key] = Math.min(cap, mods[key]);
  }
  mods.damageDealt = Math.max(-0.9, mods.damageDealt);
  mods.damageTaken = Math.max(-0.9, mods.damageTaken);
  return mods;
}

type AffixFormat = 'flat' | 'percent' | 'decimal';

export interface AffixDefinition {
  id: string;
  kind: 'prefix' | 'suffix';
  /** Gender-neutral "de X" phrase — the lead affix lends it to the item's display name. */
  title: string;
  /** Exactly one of `stat` (flat stat bonus) or `modifier` (combat effect) is set. */
  stat?: keyof Stats;
  modifier?: ItemModifierKey;
  min: number;
  max: number;
  format: AffixFormat;
  /** Flat stat affixes grow with item level like base stats; percentage effects don't. */
  scalesWithLevel?: boolean;
  /** Omitted = any slot. */
  slots?: EquipmentSlot[];
  /** pt-BR line shown on the item; `{v}` is replaced by the formatted value. */
  text: string;
}

export const AFFIXES: AffixDefinition[] = [
  { id: 'precisao', kind: 'prefix', title: 'de Precisão', modifier: 'critChance', min: 0.02, max: 0.05, format: 'percent', slots: ['arma', 'acessorio'], text: '+{v} de chance crítica' },
  { id: 'ruina', kind: 'prefix', title: 'de Ruína', modifier: 'critDamage', min: 0.1, max: 0.25, format: 'percent', slots: ['arma', 'acessorio'], text: '+{v} de dano crítico' },
  { id: 'brutalidade', kind: 'prefix', title: 'de Brutalidade', stat: 'attack', min: 2, max: 5, format: 'flat', scalesWithLevel: true, slots: ['arma', 'acessorio'], text: '{v} de Ataque' },
  { id: 'arcanismo', kind: 'prefix', title: 'de Arcanismo', stat: 'magicAttack', min: 2, max: 5, format: 'flat', scalesWithLevel: true, slots: ['arma', 'acessorio'], text: '{v} de Ataque Mágico' },
  { id: 'brasa', kind: 'prefix', title: 'de Brasa', modifier: 'burnChance', min: 0.08, max: 0.16, format: 'percent', slots: ['arma'], text: '{v} de chance de queimar ao acertar' },
  { id: 'veneno', kind: 'prefix', title: 'de Veneno', modifier: 'poisonChance', min: 0.08, max: 0.16, format: 'percent', slots: ['arma'], text: '{v} de chance de envenenar ao acertar' },
  { id: 'gelo', kind: 'prefix', title: 'de Gelo', modifier: 'slowChance', min: 0.1, max: 0.2, format: 'percent', slots: ['arma'], text: '{v} de chance de retardar ao acertar' },
  { id: 'sangria', kind: 'prefix', title: 'de Sangria', modifier: 'bleedChance', min: 0.08, max: 0.16, format: 'percent', slots: ['arma'], text: '{v} de chance de causar sangramento ao acertar' },
  { id: 'impeto', kind: 'prefix', title: 'de Ímpeto', modifier: 'meterGain', min: 0.08, max: 0.18, format: 'percent', slots: ['arma', 'armadura', 'acessorio'], text: '+{v} de ganho do recurso de classe' },
  { id: 'vento', kind: 'prefix', title: 'de Vento', stat: 'speed', min: 1, max: 3, format: 'flat', scalesWithLevel: true, slots: ['arma', 'armadura', 'acessorio'], text: '{v} de Velocidade' },

  { id: 'sangue', kind: 'suffix', title: 'de Sangue', modifier: 'lifeSteal', min: 0.02, max: 0.05, format: 'percent', slots: ['arma', 'acessorio'], text: '{v} de roubo de vida' },
  { id: 'fonte', kind: 'suffix', title: 'de Fonte', modifier: 'mpRegen', min: 0.4, max: 1.2, format: 'decimal', slots: ['arma', 'armadura', 'acessorio'], text: '+{v} de regeneração de MP por segundo' },
  { id: 'espinhos', kind: 'suffix', title: 'de Espinhos', modifier: 'thorns', min: 0.08, max: 0.2, format: 'percent', slots: ['armadura'], text: 'Reflete {v} do dano recebido' },
  { id: 'resguardo', kind: 'suffix', title: 'de Resguardo', modifier: 'damageReduction', min: 0.02, max: 0.05, format: 'percent', slots: ['armadura', 'acessorio'], text: '{v} menos dano recebido' },
  { id: 'vitalidade', kind: 'suffix', title: 'de Vitalidade', stat: 'maxHp', min: 6, max: 14, format: 'flat', scalesWithLevel: true, slots: ['armadura', 'acessorio'], text: '{v} de Vida máxima' },
  { id: 'mente', kind: 'suffix', title: 'de Mente', stat: 'maxMp', min: 5, max: 12, format: 'flat', scalesWithLevel: true, slots: ['arma', 'armadura', 'acessorio'], text: '{v} de Mana máxima' },
  { id: 'pedra', kind: 'suffix', title: 'de Pedra', stat: 'defense', min: 2, max: 5, format: 'flat', scalesWithLevel: true, slots: ['armadura', 'acessorio'], text: '{v} de Defesa' },
  { id: 'resiliencia', kind: 'suffix', title: 'de Resiliência', stat: 'magicDefense', min: 2, max: 5, format: 'flat', scalesWithLevel: true, slots: ['armadura', 'acessorio'], text: '{v} de Resistência Mágica' },
  { id: 'fortuna', kind: 'suffix', title: 'de Fortuna', stat: 'luck', min: 1, max: 3, format: 'flat', scalesWithLevel: true, text: '{v} de Sorte' },
  { id: 'saque', kind: 'suffix', title: 'de Saque', modifier: 'goldFind', min: 0.05, max: 0.12, format: 'percent', slots: ['arma', 'acessorio'], text: '+{v} de ouro encontrado' },
  { id: 'pressagio', kind: 'suffix', title: 'de Presságio', modifier: 'lootBias', min: 1, max: 2.5, format: 'decimal', slots: ['acessorio'], text: '+{v} de chance de itens raros' },
];

/** How many affixes a regular (non-unique) item rolls at each rarity. */
export const AFFIX_COUNT_BY_RARITY: Record<ItemRarity, number> = { verde: 0, azul: 1, amarelo: 2, vermelho: 3, laranja: 4 };

const AFFIX_LEVEL_SCALING = 0.1;

export function getAffixDefinition(id: string): AffixDefinition | undefined {
  return AFFIXES.find((a) => a.id === id);
}

function formatValue(value: number, format: AffixFormat): string {
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'decimal') return value.toFixed(1).replace('.', ',');
  return value >= 0 ? `+${value}` : `${value}`;
}

/** The pt-BR line for a rolled affix, or null when its id is no longer in the table. */
export function describeAffix(affix: ItemAffix): string | null {
  const def = getAffixDefinition(affix.id);
  return def ? def.text.replace('{v}', formatValue(affix.value, def.format)) : null;
}

function rollValue(def: AffixDefinition, itemLevel: number, rng: () => number): number {
  const base = def.min + (def.max - def.min) * rng();
  const scaled = def.scalesWithLevel ? base * (1 + (Math.max(1, itemLevel) - 1) * AFFIX_LEVEL_SCALING) : base;
  if (def.format === 'flat') return Math.max(1, Math.round(scaled));
  if (def.format === 'decimal') return Math.round(scaled * 10) / 10;
  return Math.round(scaled * 100) / 100;
}

function pickFrom<T>(list: T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** Rolls `count` distinct affixes valid for `slot`, alternating prefix/suffix so an item reads as a mix of offense and utility. */
export function rollAffixes(
  slot: EquipmentSlot,
  itemLevel: number,
  count: number,
  rng: () => number = Math.random,
): ItemAffix[] {
  const pool = AFFIXES.filter((a) => !a.slots || a.slots.includes(slot));
  const chosen: AffixDefinition[] = [];
  while (chosen.length < count && chosen.length < pool.length) {
    const remaining = pool.filter((a) => !chosen.includes(a));
    const wanted = chosen.length % 2 === 0 ? 'prefix' : 'suffix';
    const preferred = remaining.filter((a) => a.kind === wanted);
    chosen.push(pickFrom(preferred.length > 0 ? preferred : remaining, rng));
  }
  return chosen.map((def) => ({ id: def.id, value: rollValue(def, itemLevel, rng) }));
}

/** Flat stat bonuses from an item's affixes — ids missing from the table (removed or renamed) are ignored. */
export function affixStatBonus(affixes: ItemAffix[] | undefined): Partial<Stats> {
  const bonus: Partial<Stats> = {};
  for (const affix of affixes ?? []) {
    const def = getAffixDefinition(affix.id);
    if (def?.stat) bonus[def.stat] = (bonus[def.stat] ?? 0) + affix.value;
  }
  return bonus;
}

/** Combat modifiers from an item's affixes. */
export function affixModifiers(affixes: ItemAffix[] | undefined): Partial<ItemModifiers> {
  const mods: Partial<ItemModifiers> = {};
  for (const affix of affixes ?? []) {
    const def = getAffixDefinition(affix.id);
    if (def?.modifier) mods[def.modifier] = (mods[def.modifier] ?? 0) + affix.value;
  }
  return mods;
}

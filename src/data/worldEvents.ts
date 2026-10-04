import { defaultAppearance } from '../config/customization';
import type { ChoiceEffect } from '../systems/ChoiceSystem';
import type { NpcDefinition } from './npcs';

/**
 * Local, temporary happenings the world rolls on its own while the player
 * explores (roadmap section 16) — the data side of `systems/EventSystem.ts`,
 * which schedules/resolves them and never needs to change to add a new one.
 * `kind` only tells OverworldEvents (screens/OverworldEvents.ts) which stage
 * dressing to build; every number the scheduler reads lives here.
 */
export type WorldEventKind = 'invasao' | 'mercador' | 'arvore_corrompida' | 'nevoa';

/**
 * How an event ends well: 'defeat' = every invader is beaten, 'interact' = the
 * player activates its spot, 'timed' = nothing to do, it just runs its course
 * (weather, a passing merchant) and never counts as failed.
 */
export type WorldEventResolution = 'defeat' | 'interact' | 'timed';

/** Every bound is inclusive and optional; all given bounds must hold. */
export interface WorldEventConditions {
  minCorruption?: number;
  maxCorruption?: number;
  minHope?: number;
  maxHope?: number;
  minPlayerLevel?: number;
  maxPlayerLevel?: number;
  /** See GameClock.isNight. Omit for either. */
  time?: 'day' | 'night';
}

/** Scales an event's `weight` while `when` holds — how "corruption > 70 → more invasions" is expressed. Modifiers stack multiplicatively. */
export interface WorldEventWeightModifier {
  when: WorldEventConditions;
  multiplier: number;
}

/** A ChoiceEffect (worldState/faction/gold/item...) plus XP, with optional per-player-level scaling so a reward stays worth chasing as the character grows. */
export interface WorldEventReward extends ChoiceEffect {
  xp?: number;
  xpPerLevel?: number;
  goldPerLevel?: number;
}

export interface WorldEventDefinition {
  id: string;
  kind: WorldEventKind;
  name: string;
  /** One line shown on the HUD banner while it runs. */
  objective: string;
  startMessage: string;
  successMessage?: string;
  /** Shown when it times out unresolved (or is abandoned by leaving the zone). */
  endMessage: string;
  resolution: WorldEventResolution;
  /** Omit for any open-world zone (dungeons never roll events). */
  zoneIds?: string[];
  conditions: WorldEventConditions;
  /** Relative frequency — see EventSystem's startChance: the sum of every eligible weight sets how often ANY event starts, so raising one weight makes events more frequent overall, not just shifts the mix. */
  weight: number;
  weightModifiers?: WorldEventWeightModifier[];
  durationSeconds: number;
  /** Minimum quiet time (of active play) before this same event can roll again. */
  cooldownSeconds: number;
  /** 'near_player' picks a free grass tile within `placementRadius` tiles of the player when it starts; 'none' = nowhere in particular (weather). */
  placement: 'near_player' | 'none';
  placementRadius?: [number, number];
  /** Applied once on success. */
  reward?: WorldEventReward;
  /** Applied once if it times out or is abandoned unresolved. */
  consequence?: ChoiceEffect;
  /** Invasion only: how many monsters the band fields. */
  enemyCount?: [number, number];
}

export const WORLD_EVENT_DEFINITIONS: WorldEventDefinition[] = [
  {
    id: 'invasao_sede',
    kind: 'invasao',
    name: 'Invasão da Sede',
    objective: 'Derrote os invasores',
    startMessage: 'A Sede ergueu um bando de criaturas por perto! Marcado no mapa.',
    successMessage: 'Invasão repelida!',
    endMessage: 'Os invasores recuaram para as Raízes — e a Sede ficou mais forte.',
    resolution: 'defeat',
    conditions: { minPlayerLevel: 3 },
    weight: 2.2,
    weightModifiers: [
      { when: { minCorruption: 71 }, multiplier: 3 },
      { when: { maxCorruption: 30 }, multiplier: 0.4 },
    ],
    durationSeconds: 240,
    cooldownSeconds: 420,
    placement: 'near_player',
    placementRadius: [9, 15],
    enemyCount: [3, 4],
    reward: { xp: 30, xpPerLevel: 12, grantGold: 15, goldPerLevel: 6, worldStateDelta: { corruption: -2, hope: 2 } },
    consequence: { worldStateDelta: { corruption: 4, hope: -3 } },
  },
  {
    id: 'mercador_itinerante',
    kind: 'mercador',
    name: 'Mercador Itinerante',
    objective: 'Um mascate montou banca por perto',
    startMessage: 'Um mercador itinerante armou banca por perto, com estoque raro. Marcado no mapa.',
    endMessage: 'O mercador itinerante levantou acampamento e seguiu viagem.',
    resolution: 'timed',
    conditions: { time: 'day' },
    weight: 1.3,
    weightModifiers: [
      { when: { minHope: 60 }, multiplier: 1.5 },
      { when: { minCorruption: 85 }, multiplier: 0.5 },
    ],
    durationSeconds: 300,
    cooldownSeconds: 600,
    placement: 'near_player',
    placementRadius: [5, 9],
  },
  {
    id: 'arvore_corrompida',
    kind: 'arvore_corrompida',
    name: 'Árvore Corrompida',
    objective: 'Purifique a Ipê-árvore corrompida',
    startMessage: 'Uma Ipê-árvore apodreceu de repente por perto, drenada pela Sede. Marcada no mapa.',
    successMessage: 'A árvore foi purificada!',
    endMessage: 'A Ipê-árvore secou de vez, e a Sede se alastrou pelas raízes.',
    resolution: 'interact',
    conditions: { minCorruption: 35 },
    weight: 1.6,
    weightModifiers: [{ when: { minCorruption: 71 }, multiplier: 1.6 }],
    durationSeconds: 300,
    cooldownSeconds: 480,
    placement: 'near_player',
    placementRadius: [8, 14],
    reward: { xp: 25, xpPerLevel: 8, grantGold: 10, goldPerLevel: 4, worldStateDelta: { corruption: -4, hope: 2, natureBalance: 3 } },
    consequence: { worldStateDelta: { corruption: 3, natureBalance: -3 } },
  },
  {
    id: 'nevoa_ipera',
    kind: 'nevoa',
    name: 'Névoa',
    objective: 'Uma névoa densa cobre a região',
    startMessage: 'Uma névoa densa desce sobre a região...',
    endMessage: 'A névoa se dissipa aos poucos.',
    resolution: 'timed',
    conditions: {},
    weight: 2.2,
    weightModifiers: [
      { when: { minCorruption: 60 }, multiplier: 1.4 },
      { when: { time: 'night' }, multiplier: 1.3 },
    ],
    durationSeconds: 150,
    cooldownSeconds: 360,
    placement: 'none',
  },
];

export function getWorldEventById(id: string): WorldEventDefinition | undefined {
  return WORLD_EVENT_DEFINITIONS.find((d) => d.id === id);
}

export const ITINERANT_MERCHANT_ID = 'mercador_itinerante';

/**
 * The merchant is a regular NpcDefinition (so dialogue, the shop overlay and
 * minimap markers all just work) built on demand at the event's tile instead
 * of listed in NPC_DEFINITIONS. `stockRarity`/`priceMultiplier` (see
 * VendorInfo) are what make the stock rarer than any fixed shop's.
 */
export function createItinerantMerchantNpc(zoneId: string, tile: { x: number; y: number }): NpcDefinition {
  return {
    id: ITINERANT_MERCHANT_ID,
    name: 'Mascate Zequiel',
    role: 'Mercador Itinerante',
    classAnalogId: 'archer',
    zoneId,
    mapX: tile.x,
    mapY: tile.y,
    appearance: { ...defaultAppearance(0x8a5a2b, 0xe0b23a), hairStyle: 'coque', facialHair: 'longa', bodyType: 'robusto' },
    dialogue: [
      'Poeira de três serras na bota e um carrinho cheio do que a Sede ainda não alcançou. Dê uma olhada.',
      'Não fico muito num lugar só — onde a Sede chega, o freguês some. Aproveite enquanto estou por aqui.',
    ],
    vendor: {
      kind: 'artesao',
      itemIds: ['potion_hp', 'potion_mp'],
      equipmentTemplateIds: ['espada_curta', 'machado_guerra', 'arco_longo', 'cajado_arcano', 'armadura_couro', 'vestes_arcanas', 'anel_sorte', 'talisma_velocidade'],
      craftMaterialId: 'mat_leather',
      stockRarity: 'azul',
      priceMultiplier: 1.6,
      noCrafting: true,
    },
  };
}

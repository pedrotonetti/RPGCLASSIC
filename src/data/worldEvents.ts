import { defaultAppearance } from '../config/customization';
import type { ChoiceEffect } from '../systems/ChoiceSystem';
import { CLASS_ZONE_THEMES } from './classZones';
import type { NpcDefinition } from './npcs';
import { MAIN_CITY_ID } from './zones';

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
  /** Invasion only: the band is drawn from these enemy ids instead of the zone's own pool (or Pedravale's level-weighted one). */
  enemyIds?: string[];
  /** Interactive (tree) events only: the prompt shown next to the spot — omit for the corrupted tree's default "Purificar" wording. */
  interactPrompt?: { key: string; touch: string };
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

  // --- Expansão de conteúdo ----------------------------------------------
  // Each reuses an existing `kind`'s stage dressing (OverworldEvents never
  // needs a new branch) and sets only what makes it its own event.
  {
    // A night swarm of the new tier-3 vagalumes (data/enemies.ts) — an early
    // invasion for characters still below the regular one's real threat.
    id: 'revoada_brasas',
    kind: 'invasao',
    name: 'Revoada de Brasas',
    objective: 'Apague a revoada de vagalumes de brasa',
    startMessage: 'Uma revoada de vagalumes de brasa desceu por perto — onde pousam, o mato chia e seca! Marcada no mapa.',
    successMessage: 'A revoada se apagou',
    endMessage: 'A revoada passou, e deixou um rastro de mato chamuscado para trás.',
    resolution: 'defeat',
    zoneIds: [MAIN_CITY_ID, ...CLASS_ZONE_THEMES.flatMap((t) => [t.startVillageId, t.secondaryVillageId])],
    conditions: { time: 'night', minPlayerLevel: 4, maxPlayerLevel: 12 },
    weight: 1.2,
    weightModifiers: [{ when: { minCorruption: 60 }, multiplier: 1.5 }],
    durationSeconds: 200,
    cooldownSeconds: 480,
    placement: 'near_player',
    placementRadius: [8, 13],
    enemyCount: [3, 4],
    enemyIds: ['vagalume_brasa'],
    reward: {
      xp: 20,
      xpPerLevel: 8,
      grantGold: 10,
      goldPerLevel: 4,
      worldStateDelta: { natureBalance: 2 },
      grantItems: [{ itemId: 'cha_capim_santo', qty: 1 }],
      markEventId: 'revoada_brasas',
    },
    consequence: { worldStateDelta: { natureBalance: -3, corruption: 2 } },
  },
  {
    // The corrupted tree's mirror image: an Ipê that hasn't rotted yet — a
    // Raiz calling out at night, asking only to be heard (what an Escolhido
    // Verde can do and nobody else can — see LORE.md).
    id: 'ipe_sussurrante',
    kind: 'arvore_corrompida',
    name: 'Ipê Sussurrante',
    objective: 'Ouça o que a Raiz do Ipê tem a dizer',
    startMessage: 'Uma Ipê-árvore por perto está sussurrando — uma Raiz pede para ser ouvida antes que a Sede a cale. Marcada no mapa.',
    successMessage: 'A Raiz foi ouvida e voltou a dormir em paz',
    endMessage: 'O sussurro do ipê se calou sem que ninguém o ouvisse.',
    resolution: 'interact',
    conditions: { time: 'night', maxCorruption: 80 },
    weight: 0.9,
    weightModifiers: [{ when: { minHope: 55 }, multiplier: 1.5 }],
    durationSeconds: 240,
    cooldownSeconds: 600,
    placement: 'near_player',
    placementRadius: [7, 12],
    interactPrompt: { key: '[E] Ouvir a Raiz do Ipê', touch: 'Toque para ouvir a Raiz do Ipê' },
    reward: { xp: 30, xpPerLevel: 9, worldStateDelta: { hope: 3, natureBalance: 2 }, grantItems: [{ itemId: 'potion_mp', qty: 1 }] },
    consequence: { worldStateDelta: { hope: -2 } },
  },
  {
    // Weather, like the névoa (same `kind`, so the same fog visuals/audio):
    // what a corrupted region's sky does once the Sede has burned enough of it.
    id: 'chuva_de_cinzas',
    kind: 'nevoa',
    name: 'Chuva de Cinzas',
    objective: 'Cinza fina cai do céu',
    startMessage: 'O céu escurece e começa a cair cinza fina — mato queimado de sede, longe daqui...',
    endMessage: 'A chuva de cinzas cessa, e o vento leva o que restou.',
    resolution: 'timed',
    conditions: { minCorruption: 60 },
    weight: 1.0,
    weightModifiers: [{ when: { minCorruption: 80 }, multiplier: 1.6 }],
    durationSeconds: 140,
    cooldownSeconds: 540,
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

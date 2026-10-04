import type { ItemRarity } from '../config/types';
import type { CodexSection } from '../systems/CodexSystem';
import { CLASS_ZONE_THEMES } from './classZones';
import { MAIN_CITY_ID, REGIONAL_SETTLEMENTS } from './zones';

export type AchievementCategory = 'combate' | 'codex' | 'itens' | 'exploracao' | 'progressao' | 'historia';

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  combate: 'Combate',
  codex: 'Códex',
  itens: 'Itens e Ofícios',
  exploracao: 'Exploração',
  progressao: 'Progressão',
  historia: 'História',
};

export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = ['combate', 'codex', 'itens', 'exploracao', 'progressao', 'historia'];

/** Tallies only the hooks in `AchievementSystem` ever bump — everything else a condition reads is derived from state the player already persists (level, quests, chests...). */
export type AchievementCounter = 'kills' | 'bossKills' | 'deaths' | 'materialsCollected' | 'itemsCrafted' | 'rareCrafted';

export type AchievementFlag = 'flawlessBoss';

export type AchievementCondition =
  | { kind: 'counter'; key: AchievementCounter; target: number }
  | { kind: 'flag'; key: AchievementFlag }
  | { kind: 'level'; target: number }
  /** Códex entries "completed" (a defeated enemy/boss, or simply found for the other sections); 'all' = every entry. */
  | { kind: 'codex'; section: CodexSection; target: number | 'all' }
  | { kind: 'bossDefeated'; enemyId: string }
  | { kind: 'quest'; questId: string }
  /** The player's own class's "calling" chain in Pedravale (see data/quests.ts's CLASS_CALLING_QUESTS). */
  | { kind: 'classCalling' }
  | { kind: 'events'; eventIds: string[] }
  | { kind: 'ending'; ending: 'corte' | 'cura' | 'abraco' }
  | { kind: 'chests'; target: number | 'all' }
  | { kind: 'dungeonsCleared'; target: number }
  | { kind: 'zones'; zoneIds: string[] }
  | { kind: 'equippedRarity'; min: ItemRarity };

export interface AchievementReward {
  gold?: number;
  xp?: number;
  title?: string;
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  condition: AchievementCondition;
  reward?: AchievementReward;
  /** Shown as "???" (name and description) until unlocked — for spoilers, e.g. Ato 3's endings. */
  hidden?: boolean;
}

/** Pedravale, every class's secondary village and both regional settlements — the places any character can actually walk to (a class's own start village is only ever one class's home). */
export const EXPLORATION_ZONE_IDS: string[] = [
  MAIN_CITY_ID,
  ...CLASS_ZONE_THEMES.map((t) => t.secondaryVillageId),
  ...REGIONAL_SETTLEMENTS.map((s) => s.zoneId),
];

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // --- Combate -----------------------------------------------------------
  {
    id: 'primeira_gota',
    name: 'Primeira Gota',
    description: 'Liberte a primeira Raiz que a Sede virou do avesso.',
    category: 'combate',
    condition: { kind: 'counter', key: 'kills', target: 1 },
    reward: { gold: 10 },
  },
  {
    id: 'cem_raizes',
    name: 'Cem Raízes Libertas',
    description: 'Derrote 100 criaturas corrompidas pela Sede.',
    category: 'combate',
    condition: { kind: 'counter', key: 'kills', target: 100 },
    reward: { gold: 100, xp: 120 },
  },
  {
    id: 'quinhentas_memorias',
    name: 'Quinhentas Memórias',
    description: 'Derrote 500 criaturas. Cada uma carregava uma lembrança de Ipêra.',
    category: 'combate',
    condition: { kind: 'counter', key: 'kills', target: 500 },
    reward: { gold: 400, xp: 600, title: 'Ceifador de Sede' },
  },
  {
    id: 'primeiro_guardiao',
    name: 'Quem Guarda a Raiz',
    description: 'Derrote um chefe pela primeira vez.',
    category: 'combate',
    condition: { kind: 'counter', key: 'bossKills', target: 1 },
    reward: { gold: 60 },
  },
  {
    id: 'guardiao_dragao',
    name: 'Fim do Guardião Corrompido',
    description: 'Derrote o Guardião-Dragão Corrompido e devolva o descanso a um antigo protetor de Ipêra.',
    category: 'combate',
    condition: { kind: 'bossDefeated', enemyId: 'young_dragon' },
    reward: { gold: 200, xp: 200, title: 'Algoz do Guardião' },
  },
  {
    id: 'sem_um_arranhao',
    name: 'Sem um Arranhão',
    description: 'Derrote um chefe sem sofrer nenhum dano durante a luta.',
    category: 'combate',
    condition: { kind: 'flag', key: 'flawlessBoss' },
    reward: { gold: 150, title: 'Intocável' },
  },
  {
    id: 'terra_que_acolhe',
    name: 'Terra que Acolhe',
    description: 'Seja derrotado pela primeira vez. Toda Raiz já foi uma semente enterrada.',
    category: 'combate',
    condition: { kind: 'counter', key: 'deaths', target: 1 },
    reward: { xp: 20 },
  },

  // --- Códex -------------------------------------------------------------
  {
    id: 'bestiario_de_ipera',
    name: 'Bestiário de Ipêra',
    description: 'Derrote todos os tipos de criatura comum e complete a página do Bestiário no Códex.',
    category: 'codex',
    condition: { kind: 'codex', section: 'enemies', target: 'all' },
    reward: { gold: 250, xp: 250, title: 'Bestiarista' },
  },
  {
    id: 'prosa_de_fogueira',
    name: 'Prosa de Fogueira',
    description: 'Converse com 20 habitantes diferentes de Ipêra.',
    category: 'codex',
    condition: { kind: 'codex', section: 'npcs', target: 20 },
    reward: { gold: 80, xp: 100 },
  },
  {
    id: 'oficio_completo',
    name: 'Mãos na Terra',
    description: 'Encontre todos os tipos de material de ofício e registre-os no Códex.',
    category: 'codex',
    condition: { kind: 'codex', section: 'materials', target: 'all' },
    reward: { gold: 60 },
  },

  // --- Itens e Ofícios ---------------------------------------------------
  {
    id: 'colheita_farta',
    name: 'Colheita Farta',
    description: 'Colete 50 materiais de ofício.',
    category: 'itens',
    condition: { kind: 'counter', key: 'materialsCollected', target: 50 },
    reward: { gold: 80 },
  },
  {
    id: 'maos_de_artesao',
    name: 'Mãos de Artesão',
    description: 'Crie um equipamento raro numa bancada de ofício.',
    category: 'itens',
    condition: { kind: 'counter', key: 'rareCrafted', target: 1 },
    reward: { gold: 50, title: 'Artesão' },
  },
  {
    id: 'brilho_raro',
    name: 'Brilho de Ipê',
    description: 'Equipe um item de raridade Raro ou superior.',
    category: 'itens',
    condition: { kind: 'equippedRarity', min: 'azul' },
    reward: { gold: 40 },
  },
  {
    id: 'lenda_nas_maos',
    name: 'Lenda nas Mãos',
    description: 'Equipe um item Lendário ou superior.',
    category: 'itens',
    condition: { kind: 'equippedRarity', min: 'vermelho' },
    reward: { gold: 150, xp: 150, title: 'Portador de Lendas' },
  },

  // --- Exploração --------------------------------------------------------
  {
    id: 'faro_para_segredos',
    name: 'Faro para Segredos',
    description: 'Abra 3 baús escondidos fora das trilhas conhecidas.',
    category: 'exploracao',
    condition: { kind: 'chests', target: 3 },
    reward: { gold: 80 },
  },
  {
    id: 'andarilho_de_ipera',
    name: 'Andarilho de Ipêra',
    description: 'Pise em Pedravale, nas aldeias de todas as classes e nos assentamentos distantes.',
    category: 'exploracao',
    condition: { kind: 'zones', zoneIds: EXPLORATION_ZONE_IDS },
    reward: { gold: 200, xp: 200, title: 'Andarilho de Ipêra' },
  },
  {
    id: 'raizes_fundas',
    name: 'Raízes Fundas',
    description: 'Conclua uma masmorra e derrote o guardião que repousa no fundo dela.',
    category: 'exploracao',
    condition: { kind: 'dungeonsCleared', target: 1 },
    reward: { gold: 80, xp: 80 },
  },

  // --- Progressão --------------------------------------------------------
  {
    id: 'raiz_firme',
    name: 'Raiz Firme',
    description: 'Alcance o nível 10.',
    category: 'progressao',
    condition: { kind: 'level', target: 10 },
    reward: { gold: 50 },
  },
  {
    id: 'voz_das_raizes',
    name: 'Voz das Raízes',
    description: 'Alcance o nível 20.',
    category: 'progressao',
    condition: { kind: 'level', target: 20 },
    reward: { gold: 120, title: 'Voz das Raízes' },
  },
  {
    id: 'escolhido_pleno',
    name: 'Escolhido Pleno',
    description: 'Alcance o nível 30. A voz das Raízes já não é um sussurro.',
    category: 'progressao',
    condition: { kind: 'level', target: 30 },
    reward: { gold: 300, title: 'Escolhido Pleno' },
  },

  // --- História ----------------------------------------------------------
  {
    id: 'chamado_cumprido',
    name: 'Chamado Cumprido',
    description: 'Conclua a missão de chamado da sua própria classe em Pedravale.',
    category: 'historia',
    condition: { kind: 'classCalling' },
    reward: { gold: 100, xp: 100 },
  },
  {
    id: 'final_corte',
    name: 'O Silêncio das Raízes',
    description: 'Conclua o Ato 3 escolhendo O Corte.',
    category: 'historia',
    condition: { kind: 'ending', ending: 'corte' },
    reward: { gold: 200, title: 'Selador de Ipêra' },
    hidden: true,
  },
  {
    id: 'final_cura',
    name: 'A Ferida Tratada',
    description: 'Conclua o Ato 3 escolhendo A Cura Tentada.',
    category: 'historia',
    condition: { kind: 'ending', ending: 'cura' },
    reward: { gold: 200, title: 'Curandeiro de Ipêra' },
    hidden: true,
  },
  {
    id: 'final_abraco',
    name: 'Raízes que Abraçam',
    description: 'Conclua o Ato 3 escolhendo O Abraço.',
    category: 'historia',
    condition: { kind: 'ending', ending: 'abraco' },
    reward: { gold: 200, title: 'Abraço das Raízes' },
    hidden: true,
  },
];

export function getAchievementById(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_DEFINITIONS.find((a) => a.id === id);
}

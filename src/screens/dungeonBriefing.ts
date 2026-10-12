import { RARITY_LABEL } from '../config/rarity';
import { getDungeonModifier } from '../data/dungeonModifiers';
import type { DungeonDefinition } from '../data/dungeons';
import { combineDungeonModifiers, featuredModifierForDay, formatRewardBonus, planDungeonRun, type DungeonRunPlan } from '../systems/DungeonModifierSystem';
import { describeDungeonRecord, type DungeonRecord } from '../systems/DungeonRecordSystem';
import { chestRarityFloor } from '../systems/DungeonSystem';
import { DUNGEON_TIER_CAP, selectableDungeonTiers } from '../systems/DungeonTierSystem';
import { el } from '../ui/dom';

export interface DungeonBriefingOptions {
  dungeon: DungeonDefinition;
  bestTier: number;
  record: DungeonRecord | undefined;
  day: number;
  onEnter: (plan: DungeonRunPlan) => void;
  onCancel: () => void;
}

/**
 * Dungeons 2.0 portal panel (replaces the old tier-only picker's contents):
 * records, today's featured Distorção, one row per selectable tier and — for
 * the selected tier — exactly which Distorções that run will roll, its reward
 * bonus and the Baú da Distorção's guaranteed rarity. Plans are deterministic
 * per (dungeon, tier, day), so what's shown here is what the run gets.
 */
export function buildDungeonBriefingPanel(opts: DungeonBriefingOptions): HTMLElement {
  const { dungeon, bestTier, record, day } = opts;
  const tiers = selectableDungeonTiers(bestTier);
  const plans = new Map<number, DungeonRunPlan>(tiers.map((t) => [t, planDungeonRun(dungeon, t, day)]));
  let selected = tiers[tiers.length - 1];

  const featured = featuredModifierForDay(day);
  const detailsEl = el('div', { className: 'briefing-details' });
  const enterBtn = el('div', { className: 'btn primary', onClick: () => opts.onEnter(plans.get(selected)!) });
  const rowEls = tiers.map((tier) => {
    const cleared = tier <= bestTier;
    const label = cleared ? `Tier ${tier} (concluído)` : `Tier ${tier} (novo)`;
    return el('div', {
      className: 'tier-picker-row',
      text: label,
      onClick: () => {
        selected = tier;
        render();
      },
    });
  });

  function render(): void {
    rowEls.forEach((row, i) => row.classList.toggle('selected', tiers[i] === selected));
    const plan = plans.get(selected)!;
    const combined = combineDungeonModifiers(plan.modifierIds, plan.featuredId);
    const floor = chestRarityFloor(selected, combined.rewardBonus);
    detailsEl.replaceChildren(
      el('div', { className: 'briefing-heading', text: `Distorções do Tier ${selected}` }),
      ...plan.modifierIds.map((id) => {
        const def = getDungeonModifier(id);
        return el('div', { className: `briefing-mod${id === plan.featuredId ? ' featured' : ''}` }, [
          el('div', { className: 'mod-name', text: def?.name ?? id }),
          el('div', { className: 'mod-desc', text: def?.description ?? '' }),
        ]);
      }),
      el('div', {
        className: 'briefing-reward',
        text: `Recompensa ${formatRewardBonus(combined.rewardBonus)} · Baú da Distorção: ${RARITY_LABEL[floor]} ou melhor`,
      }),
    );
    enterBtn.textContent = `Entrar (Tier ${selected})`;
  }
  render();

  return el('div', { className: 'panel dungeon-tier-picker dungeon-briefing' }, [
    el('div', { className: 'dname', text: dungeon.name }),
    el('div', { className: 'briefing-record', text: describeDungeonRecord(bestTier, record) }),
    el('div', { className: 'briefing-featured', text: `Distorção do dia: ${featured.name}` }),
    ...rowEls,
    bestTier >= DUNGEON_TIER_CAP ? el('div', { className: 'tier-picker-cap', text: 'Tier máximo alcançado.' }) : null,
    detailsEl,
    el('div', { className: 'stack' }, [enterBtn, el('div', { className: 'btn tier-picker-close', text: 'Cancelar', onClick: () => opts.onCancel() })]),
  ]);
}

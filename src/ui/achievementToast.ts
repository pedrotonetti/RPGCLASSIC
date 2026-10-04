import type { Game } from '../engine/Game';
import type { Player } from '../entities/Player';
import { consumePendingUnlock, describeReward, observeAchievements } from '../systems/AchievementSystem';
import { audio } from '../systems/AudioSystem';
import { el } from './dom';

const TOAST_SECONDS = 4.5;
const POLL_SECONDS = 1;

export interface AchievementToastHandle {
  /** Call every frame from the overworld's own update loop. */
  update(dt: number): void;
}

/**
 * The overworld HUD's unlock toast: drains `player.achievements.pending` one
 * at a time, and doubles as the (1s) poll that lets every achievement derived
 * from existing state — a quest's XP level-up, a chest, a freshly equipped
 * item, an ending — unlock without each of those call sites knowing about
 * achievements at all.
 */
export function buildAchievementToast(game: Game, player: Player): AchievementToastHandle {
  const labelEl = el('div', { className: 'achievement-toast-label', text: 'Conquista desbloqueada' });
  const nameEl = el('div', { className: 'achievement-toast-name' });
  const rewardEl = el('div', { className: 'achievement-toast-reward' });
  const toastEl = el('div', { className: 'achievement-toast' }, [labelEl, nameEl, rewardEl]);
  toastEl.hidden = true;
  game.uiRoot.append(toastEl);

  let visibleFor = 0;
  let pollIn = 0;

  return {
    update(dt: number): void {
      pollIn -= dt;
      if (pollIn <= 0) {
        pollIn = POLL_SECONDS;
        observeAchievements(player);
      }
      if (visibleFor > 0) {
        visibleFor -= dt;
        if (visibleFor <= 0) toastEl.hidden = true;
        return;
      }
      const def = consumePendingUnlock(player);
      if (!def) return;
      nameEl.textContent = def.name;
      rewardEl.textContent = describeReward(def.reward);
      rewardEl.hidden = !def.reward;
      toastEl.hidden = false;
      visibleFor = TOAST_SECONDS;
      if (def.hidden) audio.secretFound();
      else audio.questComplete();
    },
  };
}

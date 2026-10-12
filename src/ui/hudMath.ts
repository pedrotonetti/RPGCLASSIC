/** Pure helpers behind the HUD polish in ui/hudPolish.ts — kept DOM-free so vitest (plain Node) can cover them. */

/** HP fraction at/below which the red low-HP vignette shows. */
export const LOW_HP_WARN = 0.35;
/** HP fraction at/below which it pulses harder. */
export const LOW_HP_CRITICAL = 0.15;

/** 0 = healthy, 1 = low, 2 = critical. A dead hero (0 HP) or a zero/invalid max reads as 0 — the defeat flow takes over there, not a warning. */
export function lowHpLevel(currentHp: number, maxHp: number): 0 | 1 | 2 {
  if (!(maxHp > 0) || currentHp <= 0) return 0;
  const fraction = currentHp / maxHp;
  if (fraction <= LOW_HP_CRITICAL) return 2;
  if (fraction <= LOW_HP_WARN) return 1;
  return 0;
}

/**
 * Seconds left on a cooldown as hotbar text: '' when ready (or within the
 * same 0.05s grace the hotbar's own no-mana check uses), one decimal with a
 * pt-BR comma under 10s ("2,4"), whole seconds rounded up from there ("12").
 */
export function formatCooldown(remaining: number): string {
  if (!(remaining > 0.05)) return '';
  const tenths = Math.ceil(remaining * 10) / 10;
  if (tenths < 10) return tenths.toFixed(1).replace('.', ',');
  return String(Math.ceil(remaining));
}

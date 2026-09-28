import type { Player } from '../entities/Player';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';

/**
 * The secret dev/admin panel — revealed by tapping SettingsScreen's own
 * title 7 times (see its onTitleTap), not a visible menu entry. Built for a
 * specific, real request: a save whose hero never got renamed off the
 * generic "Herói" default, and a way to jump levels for testing without
 * grinding. Both are ordinary Player mutations (player.name, the new
 * Player.debugSetLevel) immediately followed by a real saveGame — nothing
 * here reaches into localStorage directly or invents a parallel save path.
 *
 * `player` is null when this screen was reached from the main menu (no save
 * loaded yet) — there's no character to edit in that case, so this shows an
 * explanatory message instead of the rename/level tools.
 */
export function buildDevPanel(player: Player | null): HTMLElement {
  if (!player) {
    return el('div', { className: 'panel dev-panel' }, [
      el('h3', { text: 'Modo Desenvolvedor' }),
      el('div', { className: 'settings-hint', text: 'Abra este painel de dentro de uma aventura em andamento (Pausar > Configurações) para editar o personagem atual.' }),
    ]);
  }

  const statusEl = el('div', { className: 'dev-status' });
  const showStatus = (text: string) => {
    statusEl.textContent = text;
    window.setTimeout(() => {
      if (statusEl.textContent === text) statusEl.textContent = '';
    }, 3000);
  };

  const readout = el('div', {
    className: 'dev-readout',
    text: `${player.name} — ${player.classDef.name} Nv.${player.level}`,
  });

  const nameInput = el('input', {
    className: 'dev-input',
    attrs: { type: 'text', value: player.name, maxlength: '24' },
  }) as HTMLInputElement;
  const renameBtn = el('div', {
    className: 'btn',
    text: 'Renomear',
    onClick: () => {
      const trimmed = nameInput.value.trim();
      if (!trimmed) return;
      player.name = trimmed;
      saveGame(player);
      readout.textContent = `${player.name} — ${player.classDef.name} Nv.${player.level}`;
      showStatus(`Renomeado para "${trimmed}" e salvo.`);
    },
  });

  const levelInput = el('input', {
    className: 'dev-input dev-input-narrow',
    attrs: { type: 'number', min: '1', max: '100', value: String(player.level) },
  }) as HTMLInputElement;
  const levelBtn = el('div', {
    className: 'btn',
    text: 'Definir nível',
    onClick: () => {
      const n = Number(levelInput.value);
      if (!Number.isFinite(n)) return;
      player.debugSetLevel(n);
      levelInput.value = String(player.level);
      saveGame(player);
      readout.textContent = `${player.name} — ${player.classDef.name} Nv.${player.level}`;
      showStatus(`Nível ajustado para ${player.level} (HP/MP restaurados) e salvo.`);
    },
  });

  return el('div', { className: 'panel dev-panel' }, [
    el('h3', { text: 'Modo Desenvolvedor' }),
    el('div', { className: 'settings-hint', text: 'Ferramentas de teste — mudanças aqui salvam imediatamente no slot ativo.' }),
    readout,
    el('div', { className: 'settings-row' }, [nameInput, renameBtn]),
    el('div', { className: 'settings-row' }, [levelInput, levelBtn]),
    statusEl,
  ]);
}

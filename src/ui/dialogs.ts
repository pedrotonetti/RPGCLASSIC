import { el } from './dom';

export interface DialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Pass null for a notice with a single button. */
  cancelLabel?: string | null;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
}

/** In-game modal (the native confirm()/alert() break fullscreen and the game's look). Resolves true on confirm, false on cancel/Escape/backdrop click. */
export function showDialog(root: HTMLElement, options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean): void => {
      window.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      resolve(value);
    };
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      finish(false);
    };

    const cancelLabel = options.cancelLabel === undefined ? 'Cancelar' : options.cancelLabel;
    const buttons = [
      cancelLabel === null ? null : el('div', { className: 'btn', text: cancelLabel, onClick: () => finish(false) }),
      el('div', {
        className: `btn ${options.danger ? 'danger' : 'primary'}`,
        text: options.confirmLabel ?? 'Confirmar',
        onClick: () => finish(true),
      }),
    ];
    const backdrop = el('div', { className: 'dialog-backdrop', attrs: { role: 'dialog', 'aria-modal': 'true' } }, [
      el('div', { className: 'dialog panel' }, [
        el('h2', { text: options.title }),
        el('p', { text: options.message }),
        el('div', { className: 'row dialog-actions' }, buttons),
      ]),
    ]);
    window.addEventListener('keydown', onKeyDown, true);
    root.append(backdrop);
  });
}

export function confirmDialog(root: HTMLElement, options: Omit<DialogOptions, 'cancelLabel'>): Promise<boolean> {
  return showDialog(root, options);
}

export function noticeDialog(root: HTMLElement, title: string, message: string): Promise<void> {
  return showDialog(root, { title, message, confirmLabel: 'OK', cancelLabel: null }).then(() => undefined);
}

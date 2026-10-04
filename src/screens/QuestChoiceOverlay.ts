import type { QuestDefinition } from '../data/quests';
import type { QuestChoice } from '../systems/ChoiceSystem';
import { el } from '../ui/dom';

/** Modal panel listing a branching quest's options; the caller supplies onPick and gates input on isOpen. */
export class QuestChoiceOverlay {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descriptionEl: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private opened = false;

  constructor(parent: HTMLElement) {
    this.titleEl = el('h2');
    this.descriptionEl = el('p');
    this.optionsEl = el('div', { className: 'stack' });
    this.root = el('div', { className: 'panel quest-choice-overlay' }, [this.titleEl, this.descriptionEl, this.optionsEl]);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  show(quest: QuestDefinition, onPick: (choice: QuestChoice) => void): void {
    this.titleEl.textContent = quest.title;
    this.descriptionEl.textContent = quest.description;
    this.optionsEl.replaceChildren(
      ...(quest.choices ?? []).map((choice) =>
        el('div', { className: 'btn quest-choice-option', onClick: () => onPick(choice) }, [
          el('div', { className: 'quest-choice-label', text: choice.label }),
          el('div', { className: 'quest-choice-summary', text: choice.summary }),
        ]),
      ),
    );
    this.root.hidden = false;
    this.opened = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.opened = false;
  }
}

import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import {
  authAvailable,
  enrollTotp,
  getAssurance,
  listCloudSaves,
  listTotpFactorIds,
  pullCloudSave,
  pushCloudSave,
  removeFactor,
  resetPassword,
  signIn,
  signInWithProvider,
  signOut,
  signUp,
  verifyTotp,
  type AssuranceState,
  type CloudSaveInfo,
  type TotpEnrollment,
} from '../auth/AuthService';
import { NATIVE_PROVIDERS, OAUTH_PROVIDERS } from '../auth/authConfig';
import { validateCredentials } from '../auth/authErrors';
import { getClassById } from '../config/classes';
import { exportSlot, importSlot, listSaveSlots, previewImport } from '../systems/SaveSystem';
import { confirmDialog, noticeDialog } from '../ui/dialogs';
import { el } from '../ui/dom';

const SLOT_LABELS = [0, 1, 2];

function describeSave(name: string | null, classId: string | null, level: number | null): string {
  if (!name) return 'vazio';
  let cls = classId ?? '?';
  try {
    if (classId) cls = getClassById(classId).name;
  } catch {
    /* classe desconhecida: mostra o id */
  }
  return `${name} — ${cls} Nv.${level ?? '?'}`;
}

/** Conta opcional: o jogo inteiro roda como convidado, o login só habilita backup/continuação em outro aparelho. */
export class AuthScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private root!: HTMLElement;
  private panel!: HTMLElement;
  private statusEl!: HTMLElement;
  private mode: 'login' | 'signup' = 'login';
  private busy = false;
  private pendingFactorId: string | null = null;
  private enrollment: TotpEnrollment | null = null;

  constructor(
    private game: Game,
    private onBack: () => void,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x0d0a12);
    this.camera.position.set(0, 0, 5);
    this.statusEl = el('div', { className: 'settings-hint auth-status' });
    this.panel = el('div', { className: 'panel settings-panel auth-panel' });
    this.root = el('div', { className: 'settings-screen auth-screen screen' }, [
      el('div', { className: 'top-bar' }, [el('h1', { text: 'Conta' })]),
      this.panel,
      el('div', { className: 'bottom-bar' }, [el('div', { className: 'btn primary', text: '< Voltar', onClick: () => this.onBack() })]),
    ]);
    this.game.uiRoot.append(this.root);
    void this.refresh();
  }

  unmount(): void {}
  update(): void {}
  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private say(text: string): void {
    this.statusEl.textContent = text;
  }

  private async run(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say('Aguarde…');
    try {
      await task();
    } finally {
      this.busy = false;
      if (this.statusEl.textContent === 'Aguarde…') this.say('');
    }
  }

  private async refresh(): Promise<void> {
    if (!authAvailable()) return this.renderGuest();
    this.panel.replaceChildren(el('div', { className: 'settings-hint', text: 'Carregando…' }));
    const state = await getAssurance();
    if (!state.signedIn) return this.renderSignedOut();
    if (state.needsSecondStep) return this.renderSecondStep();
    return this.renderSignedIn(state);
  }

  private field(label: string, type: string, autocomplete: string): { row: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { className: 'dev-input auth-input', attrs: { type, autocomplete, 'aria-label': label, placeholder: label } }) as HTMLInputElement;
    return { row: el('div', { className: 'settings-row' }, [input]), input };
  }

  private renderGuest(): void {
    this.panel.replaceChildren(
      el('div', { className: 'settings-hint', text: 'Você está jogando como convidado: tudo fica salvo só neste aparelho. O login online (Google, Apple, Facebook ou e-mail, com verificação em duas etapas) será ativado quando o servidor do beta estiver configurado.' }),
      ...this.nativeRows(),
    );
  }

  private nativeRows(): HTMLElement[] {
    return NATIVE_PROVIDERS.map((p) =>
      el('div', { className: 'settings-row' }, [
        el('div', { className: 'btn disabled', text: p.label }),
        el('div', { className: 'settings-hint', text: 'Disponível no app das lojas (beta).' }),
      ]),
    );
  }

  private renderSignedOut(): void {
    const email = this.field('E-mail', 'email', 'email');
    const password = this.field('Senha', 'password', this.mode === 'login' ? 'current-password' : 'new-password');
    const submit = async (): Promise<void> => {
      const problem = validateCredentials(email.input.value, password.input.value, this.mode === 'signup');
      if (problem) return this.say(problem);
      await this.run(async () => {
        if (this.mode === 'signup') {
          const r = await signUp(email.input.value, password.input.value);
          if (!r.ok) return this.say(r.error);
          if (r.value.needsEmailConfirm) return this.say('Conta criada! Confirme o e-mail que enviamos e depois entre.');
        } else {
          const r = await signIn(email.input.value, password.input.value);
          if (!r.ok) return this.say(r.error);
        }
        await this.refresh();
      });
    };
    const forgot = async (): Promise<void> => {
      if (validateCredentials(email.input.value, 'x', false)) return this.say('Digite seu e-mail acima para receber o link de redefinição.');
      await this.run(async () => {
        const r = await resetPassword(email.input.value);
        this.say(r.ok ? 'Se o e-mail existir, enviamos um link para redefinir a senha.' : r.error);
      });
    };
    this.panel.replaceChildren(
      el('div', { className: 'settings-segmented' }, [
        el('div', { className: `btn settings-segment${this.mode === 'login' ? ' active' : ''}`, text: 'Entrar', onClick: () => { this.mode = 'login'; this.renderSignedOut(); } }),
        el('div', { className: `btn settings-segment${this.mode === 'signup' ? ' active' : ''}`, text: 'Criar conta', onClick: () => { this.mode = 'signup'; this.renderSignedOut(); } }),
      ]),
      email.row,
      password.row,
      el('div', { className: 'settings-row' }, [
        el('div', { className: 'btn primary', text: this.mode === 'login' ? 'Entrar' : 'Criar conta', onClick: () => void submit() }),
        this.mode === 'login' ? el('div', { className: 'btn small', text: 'Esqueci a senha', onClick: () => void forgot() }) : null,
      ]),
      el('div', { className: 'settings-hint', text: 'ou continue com' }),
      ...OAUTH_PROVIDERS.map((p) =>
        el('div', { className: 'settings-row' }, [
          el('div', { className: 'btn', text: p.label, onClick: () => void this.run(async () => {
            const r = await signInWithProvider(p.id);
            if (!r.ok) this.say(r.error);
          }) }),
        ]),
      ),
      ...this.nativeRows(),
      this.statusEl,
    );
  }

  private async renderSecondStep(): Promise<void> {
    const factorId = this.pendingFactorId ?? (await listTotpFactorIds())[0] ?? null;
    this.pendingFactorId = factorId;
    const code = this.field('Código de 6 dígitos', 'text', 'one-time-code');
    code.input.inputMode = 'numeric';
    code.input.maxLength = 6;
    const confirm = async (): Promise<void> => {
      if (!factorId) return this.say('Nenhum autenticador encontrado nesta conta.');
      if (!/^\d{6}$/.test(code.input.value.trim())) return this.say('Digite os 6 dígitos do app autenticador.');
      await this.run(async () => {
        const r = await verifyTotp(factorId, code.input.value);
        if (!r.ok) return this.say(r.error);
        this.pendingFactorId = null;
        await this.refresh();
      });
    };
    this.panel.replaceChildren(
      el('div', { className: 'settings-hint', text: 'Verificação em duas etapas: abra seu app autenticador (Google Authenticator, Authy…) e digite o código atual do Sede.' }),
      code.row,
      el('div', { className: 'settings-row' }, [
        el('div', { className: 'btn primary', text: 'Confirmar', onClick: () => void confirm() }),
        el('div', { className: 'btn small', text: 'Sair', onClick: () => void signOut().then(() => this.refresh()) }),
      ]),
      this.statusEl,
    );
  }

  private async renderSignedIn(state: Extract<AssuranceState, { signedIn: true }>): Promise<void> {
    const cloud = await listCloudSaves();
    const cloudBySlot = new Map<number, CloudSaveInfo>(cloud.ok ? cloud.value.map((c) => [c.slot, c]) : []);
    const local = listSaveSlots();

    const slotRows = SLOT_LABELS.map((slot) => {
      const entry = local[slot];
      const remote = cloudBySlot.get(slot);
      const when = remote ? new Date(remote.updatedAt).toLocaleString('pt-BR') : null;
      return el('div', { className: 'save-slot' }, [
        el('div', { className: 'slot-info', text: `Slot ${slot + 1}` }),
        el('div', { className: 'settings-hint', text: `Aparelho: ${entry ? describeSave(entry.summary.name, entry.summary.classId, entry.summary.level) : 'vazio'}` }),
        el('div', { className: 'settings-hint', text: `Nuvem: ${remote ? `${describeSave(remote.name, remote.classId, remote.level)} (${when})` : 'vazio'}` }),
        el('div', { className: 'row' }, [
          entry ? el('div', { className: 'btn small', text: 'Enviar para a nuvem', onClick: () => void this.upload(slot, remote) }) : null,
          remote ? el('div', { className: 'btn small', text: 'Baixar da nuvem', onClick: () => void this.download(slot, entry !== null) }) : null,
        ]),
      ]);
    });

    const twoFactor = state.hasTotp
      ? el('div', { className: 'settings-row' }, [
          el('div', { className: 'settings-label', text: 'Verificação em duas etapas: ativada' }),
          el('div', { className: 'btn danger small', text: 'Desativar', onClick: () => void this.disableTotp() }),
        ])
      : this.enrollment
        ? this.enrollmentBlock(this.enrollment)
        : el('div', { className: 'settings-row' }, [
            el('div', { className: 'settings-label', text: 'Verificação em duas etapas: desativada' }),
            el('div', { className: 'btn small', text: 'Ativar', onClick: () => void this.startEnroll() }),
          ]);

    this.panel.replaceChildren(
      el('div', { className: 'settings-hint', text: `Conectado como ${state.email}` }),
      twoFactor,
      el('div', { className: 'settings-hint', text: cloud.ok ? 'Saves na nuvem (você escolhe o que enviar ou baixar — nada é sobrescrito sozinho):' : `Nuvem indisponível: ${cloud.error}` }),
      ...slotRows,
      el('div', { className: 'settings-row' }, [el('div', { className: 'btn danger', text: 'Sair da conta', onClick: () => void signOut().then(() => this.refresh()) })]),
      this.statusEl,
    );
  }

  private enrollmentBlock(enrollment: TotpEnrollment): HTMLElement {
    const code = this.field('Código de 6 dígitos', 'text', 'one-time-code');
    code.input.inputMode = 'numeric';
    code.input.maxLength = 6;
    const img = el('img', { className: 'auth-qr', attrs: { src: enrollment.qrSvg, alt: 'QR code do autenticador' } });
    return el('div', { className: 'stack' }, [
      el('div', { className: 'settings-hint', text: '1) Leia o QR no app autenticador (ou digite a chave abaixo). 2) Digite o código que ele mostrar.' }),
      img,
      el('div', { className: 'settings-hint auth-secret', text: enrollment.secret }),
      code.row,
      el('div', { className: 'row' }, [
        el('div', { className: 'btn primary small', text: 'Confirmar', onClick: () => void this.run(async () => {
          const r = await verifyTotp(enrollment.factorId, code.input.value);
          if (!r.ok) return this.say(r.error);
          this.enrollment = null;
          await this.refresh();
        }) }),
        el('div', { className: 'btn small', text: 'Cancelar', onClick: () => void this.run(async () => {
          await removeFactor(enrollment.factorId);
          this.enrollment = null;
          await this.refresh();
        }) }),
      ]),
    ]);
  }

  private async startEnroll(): Promise<void> {
    await this.run(async () => {
      const r = await enrollTotp();
      if (!r.ok) return this.say(r.error);
      this.enrollment = r.value;
      await this.refresh();
    });
  }

  private async disableTotp(): Promise<void> {
    const ok = await confirmDialog(this.game.uiRoot, { title: 'Desativar verificação em duas etapas?', message: 'Sua conta ficará protegida só pela senha.', confirmLabel: 'Desativar', danger: true });
    if (!ok) return;
    await this.run(async () => {
      for (const id of await listTotpFactorIds()) {
        const r = await removeFactor(id);
        if (!r.ok) return this.say(r.error);
      }
      await this.refresh();
    });
  }

  private async upload(slot: number, remote: CloudSaveInfo | undefined): Promise<void> {
    const exported = exportSlot(slot);
    const entry = listSaveSlots()[slot];
    if (!exported || !entry) return void noticeDialog(this.game.uiRoot, 'Nada para enviar', 'Este slot está vazio ou ilegível.');
    if (remote) {
      const ok = await confirmDialog(this.game.uiRoot, {
        title: `Substituir o save da nuvem (slot ${slot + 1})?`,
        message: `Nuvem: ${describeSave(remote.name, remote.classId, remote.level)}\nAparelho: ${describeSave(entry.summary.name, entry.summary.classId, entry.summary.level)}`,
        confirmLabel: 'Enviar e substituir',
        danger: true,
      });
      if (!ok) return;
    }
    await this.run(async () => {
      const r = await pushCloudSave(slot, exported.text, { name: entry.summary.name, classId: entry.summary.classId, level: entry.summary.level });
      this.say(r.ok ? 'Save enviado para a nuvem.' : r.error);
      if (r.ok) await this.refresh();
    });
  }

  private async download(slot: number, hasLocal: boolean): Promise<void> {
    await this.run(async () => {
      const r = await pullCloudSave(slot);
      if (!r.ok) return this.say(r.error);
      const preview = previewImport(r.value);
      if (!preview.ok) return this.say(preview.error);
      const ok = await confirmDialog(this.game.uiRoot, {
        title: `Baixar para o slot ${slot + 1}?`,
        message: `${describeSave(preview.summary.name, preview.summary.classId, preview.summary.level)}${hasLocal ? '\nO save atual deste slot vai para o backup automático.' : ''}`,
        confirmLabel: 'Baixar',
        danger: hasLocal,
      });
      if (!ok) return this.say('');
      const done = importSlot(slot, r.value);
      this.say(done.ok ? 'Save baixado. Volte ao menu para continuar.' : done.error);
      if (done.ok) await this.refresh();
    });
  }
}

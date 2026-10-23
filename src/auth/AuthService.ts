import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { readAuthConfig, type OAuthProviderId } from './authConfig';
import { friendlyAuthError } from './authErrors';

export type AuthResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export interface TotpEnrollment {
  factorId: string;
  qrSvg: string;
  secret: string;
}

export interface CloudSaveInfo {
  slot: number;
  name: string | null;
  classId: string | null;
  level: number | null;
  updatedAt: string;
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** O SDK vai num chunk à parte: quem joga como convidado nunca baixa nada disso. */
function client(): Promise<SupabaseClient | null> {
  clientPromise ??= (async () => {
    const config = readAuthConfig();
    if (!config) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  })();
  return clientPromise;
}

export function authAvailable(): boolean {
  return readAuthConfig() !== null;
}

async function guard<T>(fn: (c: SupabaseClient) => Promise<{ data: T | null; error: { message: string } | null }>): Promise<AuthResult<T>> {
  const c = await client();
  if (!c) return { ok: false, error: 'O login online ainda não foi configurado neste servidor.' };
  try {
    const { data, error } = await fn(c);
    if (error || data === null) return { ok: false, error: friendlyAuthError(error?.message) };
    return { ok: true, value: data };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err instanceof Error ? err.message : String(err)) };
  }
}

export async function getSession(): Promise<Session | null> {
  const c = await client();
  if (!c) return null;
  return (await c.auth.getSession()).data.session;
}

export type AssuranceState = { signedIn: false } | { signedIn: true; email: string; needsSecondStep: boolean; hasTotp: boolean };

export async function getAssurance(): Promise<AssuranceState> {
  const c = await client();
  const session = c ? (await c.auth.getSession()).data.session : null;
  if (!c || !session) return { signedIn: false };
  const aal = (await c.auth.mfa.getAuthenticatorAssuranceLevel()).data;
  return {
    signedIn: true,
    email: session.user.email ?? 'conta',
    needsSecondStep: aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2',
    hasTotp: aal?.nextLevel === 'aal2',
  };
}

export async function signUp(email: string, password: string): Promise<AuthResult<{ needsEmailConfirm: boolean }>> {
  return guard(async (c) => {
    const { data, error } = await c.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
    return { data: data ? { needsEmailConfirm: !data.session } : null, error };
  });
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const r = await guard(async (c) => {
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    return { data: data?.session ? true : null, error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function signInWithProvider(provider: OAuthProviderId): Promise<AuthResult> {
  const r = await guard(async (c) => {
    const { data, error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
    return { data: data ? true : null, error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const r = await guard(async (c) => {
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    return { data: error ? null : true, error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function signOut(): Promise<void> {
  const c = await client();
  await c?.auth.signOut();
}

// --- 2ª etapa (TOTP: Google Authenticator, Authy, 1Password...) -------------------

export async function enrollTotp(): Promise<AuthResult<TotpEnrollment>> {
  return guard(async (c) => {
    const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Sede ${new Date().toISOString().slice(0, 10)}` });
    return { data: data ? { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret } : null, error };
  });
}

/** Confirma o código de 6 dígitos — vale tanto para ativar o 2FA quanto para completar um login. */
export async function verifyTotp(factorId: string, code: string): Promise<AuthResult> {
  const r = await guard(async (c) => {
    const challenge = await c.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) return { data: null, error: challenge.error };
    const verified = await c.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
    return { data: verified.data ? true : null, error: verified.error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function listTotpFactorIds(): Promise<string[]> {
  const c = await client();
  if (!c) return [];
  const { data } = await c.auth.mfa.listFactors();
  return (data?.totp ?? []).filter((f) => f.status === 'verified').map((f) => f.id);
}

export async function removeFactor(factorId: string): Promise<AuthResult> {
  const r = await guard(async (c) => {
    const { data, error } = await c.auth.mfa.unenroll({ factorId });
    return { data: data ? true : null, error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

// --- saves na nuvem -----------------------------------------------------------

export async function listCloudSaves(): Promise<AuthResult<CloudSaveInfo[]>> {
  return guard(async (c) => {
    const { data, error } = await c.from('cloud_saves').select('slot,name,class_id,level,updated_at').order('slot');
    return {
      data: data ? data.map((r) => ({ slot: r.slot, name: r.name, classId: r.class_id, level: r.level, updatedAt: r.updated_at })) : null,
      error,
    };
  });
}

export async function pushCloudSave(slot: number, payload: string, meta: { name: string; classId: string; level: number }): Promise<AuthResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Entre na sua conta primeiro.' };
  const r = await guard(async (c) => {
    const { error } = await c.from('cloud_saves').upsert({ user_id: session.user.id, slot, payload, name: meta.name, class_id: meta.classId, level: meta.level });
    return { data: error ? null : true, error };
  });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function pullCloudSave(slot: number): Promise<AuthResult<string>> {
  const r = await guard(async (c) => {
    const { data, error } = await c.from('cloud_saves').select('payload').eq('slot', slot).maybeSingle();
    return { data: data?.payload ?? null, error };
  });
  return r.ok ? r : { ok: false, error: r.error === 'Não foi possível concluir. Tente novamente em instantes.' ? 'Não há save na nuvem neste slot.' : r.error };
}

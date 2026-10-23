export interface AuthConfig {
  url: string;
  anonKey: string;
}

/** Credenciais públicas do projeto Supabase (a anon key é feita para ir no navegador; quem protege os dados é o RLS — ver supabase/migrations). Ausentes = o jogo roda só como convidado. */
export function readAuthConfig(env: Record<string, string | undefined> = import.meta.env): AuthConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !/^https:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export type OAuthProviderId = 'google' | 'facebook' | 'apple';

export const OAUTH_PROVIDERS: Array<{ id: OAuthProviderId; label: string }> = [
  { id: 'google', label: 'Entrar com Google' },
  { id: 'apple', label: 'Entrar com Apple' },
  { id: 'facebook', label: 'Entrar com Facebook' },
];

/** Logins nativos das lojas: só existem dentro do app empacotado (Capacitor), nunca na web. */
export const NATIVE_PROVIDERS = [
  { id: 'play-games', label: 'Google Play Games' },
  { id: 'game-center', label: 'Apple Game Center' },
] as const;

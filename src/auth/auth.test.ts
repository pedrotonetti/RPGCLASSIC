import { describe, expect, it } from 'vitest';
import { readAuthConfig } from './authConfig';
import { friendlyAuthError, validateCredentials } from './authErrors';

describe('readAuthConfig', () => {
  it('é nulo sem credenciais (modo convidado)', () => {
    expect(readAuthConfig({})).toBeNull();
    expect(readAuthConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
  });
  it('recusa URL que não seja https', () => {
    expect(readAuthConfig({ VITE_SUPABASE_URL: 'http://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });
  it('lê e normaliza a URL', () => {
    expect(readAuthConfig({ VITE_SUPABASE_URL: ' https://x.supabase.co/ ', VITE_SUPABASE_ANON_KEY: ' k ' })).toEqual({ url: 'https://x.supabase.co', anonKey: 'k' });
  });
});

describe('friendlyAuthError', () => {
  it('traduz erros comuns e não vaza texto técnico', () => {
    expect(friendlyAuthError('Invalid login credentials')).toMatch(/incorretos/);
    expect(friendlyAuthError('Email not confirmed')).toMatch(/Confirme/);
    expect(friendlyAuthError('Invalid TOTP code entered')).toMatch(/Código inválido/);
    expect(friendlyAuthError('Failed to fetch')).toMatch(/conexão/);
    expect(friendlyAuthError('algo estranho: stack trace')).toBe('Não foi possível concluir. Tente novamente em instantes.');
    expect(friendlyAuthError(undefined)).toMatch(/Tente novamente/);
  });
});

describe('validateCredentials', () => {
  it('valida e-mail, senha e tamanho mínimo no cadastro', () => {
    expect(validateCredentials('x', 'senha1234', false)).toMatch(/e-mail/i);
    expect(validateCredentials('a@b.co', '', false)).toMatch(/senha/i);
    expect(validateCredentials('a@b.co', 'curta', true)).toMatch(/8 caracteres/);
    expect(validateCredentials('a@b.co', 'curta', false)).toBeNull();
    expect(validateCredentials('a@b.co', 'umasenhaboa', true)).toBeNull();
  });
});

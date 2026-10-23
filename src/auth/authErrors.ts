const RULES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail antes de entrar (veja a caixa de entrada e o spam).'],
  [/user already registered|already been registered/i, 'Já existe uma conta com este e-mail. Tente entrar.'],
  [/password should be at least|weak password/i, 'A senha é fraca demais: use ao menos 8 caracteres.'],
  [/invalid.*(totp|code)|code.*invalid|expired/i, 'Código inválido ou expirado. Confira o app autenticador e tente de novo.'],
  [/rate limit|too many|over_email_send_rate_limit/i, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
  [/unable to validate email|invalid.*email/i, 'Este e-mail não parece válido.'],
  [/provider is not enabled|unsupported provider/i, 'Este método de login ainda não foi ativado neste servidor.'],
  [/failed to fetch|network|load failed/i, 'Sem conexão com o servidor. Verifique sua internet.'],
];

export function friendlyAuthError(message: string | undefined | null): string {
  const text = message ?? '';
  for (const [pattern, friendly] of RULES) if (pattern.test(text)) return friendly;
  return 'Não foi possível concluir. Tente novamente em instantes.';
}

export function validateCredentials(email: string, password: string, forSignUp: boolean): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Digite um e-mail válido.';
  if (!password) return 'Digite a senha.';
  if (forSignUp && password.length < 8) return 'A senha precisa ter ao menos 8 caracteres.';
  return null;
}

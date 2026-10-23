# Login, banco de dados e hospedagem (100% gratuito)

O jogo continua estático no **GitHub Pages**. A conta, a verificação em duas
etapas e os saves na nuvem usam o **Supabase** (plano grátis: 50 mil usuários
ativos/mês, 500 MB de banco). Sem configurar nada, o jogo roda normalmente
como convidado — o botão 👤 do menu só mostra que o login ainda não está ativo.

O que o código já faz: cadastro/login por e-mail e senha, recuperação de senha,
Google / Apple / Facebook, 2ª etapa por app autenticador (TOTP), e enviar/baixar
cada slot de save com confirmação (nada é sobrescrito sozinho). Os dados ficam
protegidos por RLS: cada jogador só acessa os próprios saves.

## Passo a passo (só você pode fazer — são contas e chaves suas)

1. **Criar o projeto**: https://supabase.com → New project (região São Paulo).
2. **Criar a tabela**: SQL Editor → cole `supabase/migrations/001_cloud_saves.sql` → Run.
3. **Chaves públicas**: Project Settings → API → copie `Project URL` e `anon public`.
   No GitHub: repositório → Settings → Secrets and variables → Actions →
   aba **Variables** → crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
   (A anon key é pública por design; **nunca** use a `service_role` no jogo.)
4. **Endereços permitidos**: Authentication → URL Configuration → Site URL =
   `https://pedrotonetti.github.io/RPGCLASSIC/` e adicione o mesmo em Redirect URLs
   (mais `http://localhost:5173/` para testes).
5. **2ª etapa**: Authentication → Sign In / Providers → (aba Multi-Factor) → TOTP: Enabled.
6. **Provedores sociais** (Authentication → Sign In / Providers). Cada um pede
   um cadastro no console do provedor; a URL de callback é a que o Supabase
   mostra na tela do provedor (`https://<projeto>.supabase.co/auth/v1/callback`):
   - **Google**: console.cloud.google.com → APIs e serviços → Credenciais →
     ID do cliente OAuth (aplicativo da Web). Grátis.
   - **Facebook**: developers.facebook.com → criar app → Facebook Login. Grátis.
   - **Apple**: exige conta Apple Developer (US$ 99/ano) e um Services ID.
     Pode ficar para quando for publicar na App Store.
7. **Publicar**: dê push no branch — o workflow já injeta as variáveis no build.

## Play Games e Game Center (lojas)

São logins **nativos**: só existem dentro do app empacotado, nunca no navegador.
Na web os botões aparecem desativados ("disponível no app das lojas"). Ligá-los
exige o app Capacitor (Android/iOS) com os plugins de Play Games Services e
Game Center e trocar o token por uma sessão do Supabase — fica para a etapa
de empacotamento, junto com `STORE_PUBLISHING.md`.

## Beta nas lojas (o que não dá para automatizar)

- **Google Play**: conta de desenvolvedor (US$ 25, única) → teste interno/fechado.
- **Apple**: conta Apple Developer (US$ 99/ano) → TestFlight.
- Lojas não aceitam só a URL: o pacote nativo está descrito em `STORE_PUBLISHING.md`.
  Caminho mais rápido para o beta Android: TWA (Bubblewrap/PWABuilder).

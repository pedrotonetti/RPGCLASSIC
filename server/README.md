# Sede — servidor de cadastro e serial de teste

Backend separado do jogo (que continua 100% estático — Vite build servido
pelo GitHub Pages, sem servidor nenhum). Este aqui existe só para a landing
page: cadastro por e-mail → gera um serial de teste único → o serial pode
ser validado (uma vez) depois.

## Por que essa stack

Ver `MULTIPLAYER.md` na raiz do repositório — a mesma pesquisa de "hospedagem
gratuita e realmente 24/7" feita para multiplayer se aplica aqui. Cloudflare
Workers é o único modelo genuinamente gratuito que não "dorme"/tem cold start
(ao contrário de Render, Railway, Fly.io no plano grátis) porque não é um
processo de servidor ficando ligado — é serverless/edge, acordado por
requisição. D1 é o banco SQL gratuito da própria Cloudflare, sem custo
separado de hospedagem.

**Limites do plano gratuito (Workers + D1), hoje:** 100.000 requisições/dia
(Workers), 5GB de armazenamento (D1) — para cadastro de uma landing page,
isso é bem folgado.

## O que este servidor faz (e não faz)

- `POST /api/register` — recebe `{ email, name? }`, gera um serial único tipo
  `SEDE-XXXX-XXXX`, salva no banco, devolve o serial na resposta. **Não
  envia e-mail** — quem chama essa API (a landing page) é quem mostra o
  serial na tela pro usuário. Enviar por e-mail automaticamente exigiria um
  provedor de e-mail transacional (Resend, SendGrid etc.) com sua própria
  chave de API — fácil de adicionar depois, mas precisa de uma conta sua
  nesse serviço.
- `POST /api/validate-serial` — recebe `{ serial }`, confere se existe e
  ainda não foi resgatado, marca como resgatado na primeira validação
  correta. Pensado para ser chamado tanto pela landing page quanto,
  futuramente, pelo próprio jogo (ainda não integrado — ver "Próximo passo"
  abaixo).
- `GET /api/admin/registrations?limit=50` — lista os cadastros mais
  recentes, protegido por um header `X-Admin-Key` (ver "Configurar o
  segredo de admin" abaixo). Serve pra você ver os cadastros sem precisar
  mexer no painel do Cloudflare.
- `GET /api/health` — checagem simples de que o servidor está no ar.

## Configuração inicial (uma vez só)

Precisa de uma conta Cloudflare (gratuita) — se ainda não tiver, crie em
https://dash.cloudflare.com/sign-up.

```bash
cd server
npm install
npx wrangler login          # abre o navegador pra autorizar
npx wrangler d1 create sede_db
```

O comando acima imprime um `database_id` — copie e cole em
`wrangler.toml`, no lugar de `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Depois, aplique o schema no banco remoto (o de verdade, na nuvem):

```bash
npm run db:init:remote
```

### Configurar o segredo de admin

```bash
npx wrangler secret put ADMIN_KEY
```

Vai pedir pra você digitar um valor (qualquer senha forte) — guarde-o, é o
que você vai mandar no header `X-Admin-Key` pra listar os cadastros depois.

### Ajustar as origens permitidas (CORS)

Edite `ALLOWED_ORIGINS` em `wrangler.toml` com o domínio real da sua landing
page antes de publicar (hoje está com `localhost` só, para testes locais).

## Publicar (deploy)

```bash
npm run deploy
```

Isso imprime a URL pública do seu servidor (algo como
`https://sede-server.<seu-usuário>.workers.dev`) — é essa URL que a landing
page vai chamar.

## Testar localmente antes de publicar

```bash
npm run db:init:local   # aplica o schema num banco D1 local (SQLite em disco)
npm run dev              # sobe o servidor em http://localhost:8787
```

```bash
curl -X POST http://localhost:8787/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@exemplo.com","name":"Teste"}'
```

## Próximo passo (ainda não decidido/implementado)

O jogo em si (o cliente estático) **ainda não verifica nenhum serial** —
hoje ele continua livre, sem cadastro nem trava nenhuma. Antes de integrar,
vale decidir: o serial deveria travar o jogo inteiro (só joga quem tem um
serial válido), ou só liberar um bônus/perk dentro do jogo (ex.: um item ou
cosmético exclusivo de quem se cadastrou)? São integrações bem diferentes —
me diga qual dos dois faz mais sentido pra landing page que você está
montando, e eu conecto o cliente a este servidor.

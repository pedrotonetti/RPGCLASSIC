# Sede

Um RPG 3D de ação (estilo ARPG mobile) ambientado em Ipêra, que roda no navegador e pode ser
instalado como app (PWA): criação de personagem com dezenas de opções de
aparência, 8 classes com árvore de habilidades própria, combate em tempo real
direto no mundo (sem tela de batalha separada), um mundo com uma vila e uma
cidade secundária por classe além da cidade principal compartilhada,
NPCs vendedores (ferreiro, boticário, artesã, joalheiro) com compra/venda e
fabricação a partir de materiais, gemas engastáveis em equipamentos, itens
com raridade, missões por classe que convergem numa missão principal
narrada por NPCs, e um ranking de poder entre jogadores.

## Tecnologias

- **[Three.js](https://threejs.org/)** — a biblioteca 3D mais usada e madura
  do ecossistema web (open source, MIT), usada aqui para renderizar o mundo,
  os personagens e as batalhas via WebGL.
- **TypeScript** — tipagem estática para todo o código do jogo.
- **Vite** — dev server instantâneo e build de produção otimizado.
- **vite-plugin-pwa** — gera o manifest + service worker para o jogo poder ser
  instalado como app no celular/desktop (PWA), a partir do mesmo código web.

Todo personagem humano — jogador ou NPC — ainda é montado por código a partir
de um "esqueleto" de primitivas (pernas, tronco, braços articulados, pescoço,
cabeça com rosto, cabelo, pelos faciais, acessórios) parametrizado por uma
`CharacterAppearance`, sem depender de nenhum asset externo.

Para vida selvagem/ambientação já existe também um pipeline de assets 3D reais
(`src/render/gltfModel.ts`, via `GLTFLoader` + `AnimationMixer` do Three.js),
usado hoje para as raposas animadas que vagam pelo mapa — modelo com licença
livre verificada, ver `public/models/CREDITS.md`. É o mesmo caminho para
trocar os personagens/inimigos por modelos `.glb` de verdade no futuro.

## Como rodar

```bash
npm install
npm run dev       # servidor de desenvolvimento (http://localhost:5173)
npm run build     # build de produção em dist/
npm run preview   # serve o build de produção localmente
npm run typecheck # só checagem de tipos, sem build
```

## Deploy

O repositório já está pronto para publicar — `vercel.json` na raiz define o
build (`vite`, `npm run build`, saída em `dist/`), e não há backend/variáveis
de ambiente necessárias.

- **Vercel** (recomendado): em [vercel.com/new](https://vercel.com/new),
  "Import Git Repository" → selecione `pedrotonetti/rpgclassic` → o Vercel
  detecta o `vercel.json` automaticamente → "Deploy". Leva menos de um
  minuto e cada novo push atualiza o link sozinho. *(Isso precisa ser feito
  pela própria conta Vercel do dono do repositório — o ambiente de
  desenvolvimento deste projeto não tem acesso de rede à API da Vercel para
  publicar automaticamente por aqui.)*
- **GitHub Pages** (alternativa, já configurada): o workflow
  `.github/workflows/deploy-pages.yml` builda e publica a cada push nesta
  branch, mas precisa ser habilitado uma única vez em **Settings → Pages →
  Source: GitHub Actions** no repositório — só quem tem acesso às
  configurações do repo consegue fazer esse passo.

## Como jogar

- **Setas / WASD** — mover livremente pelo mapa (movimento contínuo, não em
  grade, câmera em terceira pessoa acompanhando o personagem).
- **E** (ou toque no aviso na tela, em dispositivos sem teclado) — falar com
  um NPC próximo, ou entrar em uma dungeon — inclui NPCs comuns (diálogo) e
  vendedores (abre a loja ao fim do diálogo). Durante o diálogo, um botão
  "Pular »" fecha a conversa sem precisar ler linha por linha.
- Os monstros ficam visíveis andando pelo mapa, com sua própria IA
  (perseguem ao se aproximar); encostar neles inicia o combate diretamente
  no mundo, sem trocar de tela.
- Durante o combate, clique num ícone da barra de habilidades (ou tecle 1-6)
  para usá-la — cada uma tem seu próprio custo de mana e tempo de recarga,
  exibido como um preenchimento escuro sobre o ícone.
- **ESC** (ou o botão ☰ no canto superior direito, em dispositivos de toque)
  — abre o menu de pausa (Inventário, Árvore de Habilidades, Ranking Global,
  Salvar e Sair).
- Em dispositivos de toque, um joystick virtual aparece no canto inferior
  esquerdo — arraste o polegar para qualquer direção. A interface detecta
  automaticamente um dispositivo de toque (sem teclado/mouse) e adapta
  textos e controles a ele.
- O progresso é salvo automaticamente (`localStorage`) a cada passo, batalha e
  ao pausar.

## Arquitetura

```
src/
  config/        tipos, raridade, catálogo de customização, classes/skills, tiles
  data/          bancos de dados: itens, equipamentos, inimigos, NPCs, missões, ranking simulado
  entities/      Player e Enemy (estado de runtime, cálculo de stats)
  systems/       lógica pura: combate em tempo real, missões, power score, mapa, save/load
  engine/        Game (loop + troca de telas) e a interface Screen
  render/        geração procedural dos modelos 3D (personagens humanos + inimigos) e do mundo
  screens/       cada "tela" do jogo (menu, criação, mundo/combate, skills, inventário, ranking)
  ui/            helpers de DOM e o CSS de toda a interface (overlay HTML)
```

O jogo é **orientado a dados**: classes, inimigos, itens, NPCs, missões e
habilidades são listas de objetos TypeScript, não código espalhado pelas
telas. Toda a lógica de jogo (`config/`, `data/`, `entities/`, `systems/`) é
**independente da engine gráfica** — não importa nada de Three.js.

### Fluxo de telas

`MainMenu` → `CharacterSelect` (classe) → `CharacterCreation` (aparência) →
`Overworld`, com `SkillTree`, `Inventory` e `Ranking` acessíveis pelo menu de
pausa do `Overworld`. Não existe mais uma tela de batalha separada: o
combate acontece dentro do próprio `Overworld` contra monstros visíveis no
mapa (`systems/OverworldCombat.ts`), e trocar de zona (vila ↔ cidade) é uma
troca completa de `OverworldScreen` para o novo mapa (`data/zones.ts`). Cada
`Screen` (`src/screens/*.ts`) é dona da sua própria `THREE.Scene`/`THREE.Camera`
e constrói sua própria UI em HTML/CSS por cima do canvas (`game.uiRoot`) —
os menus e o HUD são DOM normal, não sprites de texto renderizados no WebGL.

## Criação de personagem

A tela de criação (`CharacterCreationScreen`) tem 15 categorias de
customização com mais de 80 opções combináveis no total (gênero, tom de pele,
compleição, altura, formato de rosto, cor dos olhos, sobrancelhas, estilo e
cor de cabelo, pelos faciais, acessório de cabeça, cores primária/secundária
da roupa, cicatriz e tatuagem), todas com preview 3D ao vivo. A definição
completa fica em `src/config/customization.ts`.

## As 8 classes e a árvore de habilidades

| Classe     | Perfil                                          |
|------------|--------------------------------------------------|
| Guerreiro  | Tanque físico, muita vida e defesa                |
| Mago       | Dano mágico em área, frágil                       |
| Arqueiro   | Rápido, físico equilibrado                        |
| Clérigo    | Suporte com cura e dano mágico leve                |
| Paladino   | Tanque sagrado, cura a si mesmo em combate         |
| Assassino  | Altíssima velocidade e crítico, baixa defesa       |
| Necromante | Magia sombria, dreno de vida                       |
| Monge      | Combate marcial encadeado, rápido e equilibrado    |

Cada classe tem um **ataque básico** (grátis, recarga curta) + **4
habilidades regulares** (nível 1 a 10, evoluídas gastando pontos de
habilidade ganhos ao subir de nível) + **1 ultimate** (nível 1 a 100,
evolui sozinha junto com o nível do personagem, sem gastar pontos). Isso dá
40 habilidades regulares + 8 ultimates no total. Cada habilidade tem seu
próprio custo de mana e tempo de recarga, que muda conforme o nível
(`src/systems/skillMath.ts` calcula tudo a partir de uma fórmula, então
adicionar uma habilidade é só declarar os valores base — nível 1 — e o
sistema deriva o resto).

## Combate em tempo real

A batalha não é mais por turnos: o jogador aciona habilidades quando quiser
(sujeitas ao próprio custo de mana e recarga) enquanto os inimigos agem
sozinhos em seus próprios temporizadores (`actionInterval` de cada
`EnemyDefinition`). Toda a lógica fica em `systems/CombatSystem.ts`
(`CombatEngine`), sem nenhuma dependência de Three.js ou DOM — só
`tick(dt)` e `useSkill(id, alvo?)`, o que o torna testável isoladamente.
Vitórias podem derrubar itens (ver abaixo) e sempre dão XP/ouro.

## Itens e raridade

Equipamentos (`src/data/equipment.ts`) têm 3 categorias (Arma, Armadura,
Acessório) e 5 níveis de raridade, cada um multiplicando os bônus de
atributo do item:

| Raridade | Cor      | Multiplicador |
|----------|----------|----------------|
| Comum    | Verde    | 1.0x           |
| Raro     | Azul     | 1.35x          |
| Épico    | Amarelo  | 1.85x          |
| Lendário | Vermelho | 2.5x           |
| Mítico   | Laranja  | 3.4x           |

Itens equipados (tela **Inventário**) somam diretamente aos atributos do
personagem e ao **Power Score**.

## Power Score e Ranking

`systems/PowerScore.ts` resume nível + atributos + equipamento + habilidades
num único número. A tela **Ranking Global** mostra sua posição estimada num
placar simulado de 50.000 jogadores (`src/data/leaderboard.ts`) — como o
jogo ainda não tem backend, é uma simulação local e transparente sobre isso;
plugar um serviço real (Firebase/Supabase/API própria) exigiria só trocar
`estimatePlayerRank`/`getTopRivals` por chamadas de rede.

## Mundo: vilas, cidades e zonas

Cada classe nasce na própria vila inicial (monstros fracos, primeiras
missões), evolui para uma vila secundária ainda ligada ao território da
classe (monstros mais fortes) e por fim chega a Pedravale, a cidade
principal compartilhada por todas as classes — 17 zonas no total
(`src/data/zones.ts`, `data/classZones.ts`), todas geradas por um único
gerador de mapa paramétrico (`generateVillageMap` em
`systems/MapGenerator.ts`) diferenciado por cor de destaque, NPCs e pool de
monstros. Atravessar um portão entre zonas recarrega o `Overworld` na nova
zona (ver `OverworldScreen.transitionToZone`).

## NPCs, vendedores e missões

Além de NPCs de diálogo puro, várias zonas têm NPCs vendedores
(`src/data/npcs.ts`, campo `vendor`): ferreiro e artesã (armas/armaduras/
acessórios), boticário (poções) e joalheiro (gemas). Cada um permite
**comprar** com ouro ou **fabricar** a partir de materiais dropados por
monstros (`src/data/materials.ts`) por um custo menor em ouro, trocando
material por uma raridade maior (equipamentos) ou o dobro da quantidade
(poções/gemas). O joalheiro também engasta gemas (`src/data/gems.ts`) nos
equipamentos já equipados, somando um bônus de atributo fixo e um brilho
emissivo visível na arma.

Cada classe tem sua própria cadeia de 3 missões iniciais (derrotar
monstros na vila inicial → viajar e falar com o mentor da vila secundária →
falar com o Guarda Bram no portão de Pedravale) que desemboca na missão
principal compartilhada (`src/data/quests.ts`, `systems/QuestSystem.ts`):
uma cadeia linear de 6 missões — do primeiro encontro com o Ancião Tobias
até o confronto com o Dragão Jovem nas ruínas — misturando objetivos de
diálogo, derrota de inimigos e nível alcançado, com recompensas em XP,
ouro e às vezes um item garantido.

## Como estender

- Novas **classes**: acrescente em `CLASS_DEFINITIONS`
  (`src/config/classes.ts`) com stats, skills (`makeSkill`/`makeUltimate` de
  `systems/skillMath.ts` cuidam da escala nível a nível) e um caso em
  `CLASS_ACCESSORY` (`src/render/characterModel.ts`) para o visual da arma.
- Novos **inimigos**: acrescente em `src/data/enemies.ts` e um caso em
  `buildEnemyModel` (`src/render/characterModel.ts`).
- Novos **itens/equipamentos**: `src/data/items.ts` (consumíveis) ou
  `EQUIPMENT_TEMPLATES` (`src/data/equipment.ts`).
- Novos **NPCs/missões**: `src/data/npcs.ts` e `src/data/quests.ts` — a
  cadeia de missões é apenas uma lista com `nextQuestId` encadeando cada uma.
- Novas **opções de customização**: acrescente ao catálogo em
  `src/config/customization.ts` e a um `switch` correspondente em
  `src/render/characterModel.ts`.

## Próximos passos sugeridos

- [ ] Ranking real (multiplayer) via backend (Firebase/Supabase/API própria).
- [ ] Trocar os modelos low-poly por modelos `.glb` reais (via `GLTFLoader`).
- [ ] Masmorras/instâncias separadas do overworld compartilhado.
- [ ] Empacotar como app nativo Android/iOS com
      [Capacitor](https://capacitorjs.com/) (o código web atual já funciona
      como base — é só rodar `npx cap init` / `npx cap add android|ios` sobre
      o build do Vite).
- [ ] Testes automatizados para `systems/CombatSystem.ts` e `QuestSystem.ts`
      (lógica pura, sem Three.js, ideal para testes unitários).

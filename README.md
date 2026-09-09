# RPG Classic

Um RPG 3D de ação (estilo ARPG mobile) que roda no navegador e pode ser
instalado como app (PWA): criação de personagem com dezenas de opções de
aparência, 8 classes com árvore de habilidades própria, combate em tempo real
com recarga de habilidades, itens com raridade, uma missão principal narrada
por NPCs na vila, e um ranking de poder entre jogadores.

## Tecnologias

- **[Three.js](https://threejs.org/)** — a biblioteca 3D mais usada e madura
  do ecossistema web (open source, MIT), usada aqui para renderizar o mundo,
  os personagens e as batalhas via WebGL.
- **TypeScript** — tipagem estática para todo o código do jogo.
- **Vite** — dev server instantâneo e build de produção otimizado.
- **vite-plugin-pwa** — gera o manifest + service worker para o jogo poder ser
  instalado como app no celular/desktop (PWA), a partir do mesmo código web.

Não há nenhum asset 3D externo (modelo, textura ou áudio): todo personagem
humano — jogador ou NPC — é montado por código a partir de um "esqueleto" de
primitivas (pernas, tronco, braços articulados, pescoço, cabeça com rosto,
cabelo, pelos faciais, acessórios) parametrizado por uma `CharacterAppearance`.
Isso mantém o repositório leve e evita qualquer questão de licença de asset;
trocar por modelos `.glb` de verdade depois é possível carregando-os via
`GLTFLoader` no lugar das funções em `src/render/characterModel.ts`.

## Como rodar

```bash
npm install
npm run dev       # servidor de desenvolvimento (http://localhost:5173)
npm run build     # build de produção em dist/
npm run preview   # serve o build de produção localmente
npm run typecheck # só checagem de tipos, sem build
```

## Como jogar

- **Setas / WASD** — mover pelo mapa (movimento em grade, câmera em terceira
  pessoa acompanhando o personagem).
- **E** — falar com um NPC próximo (aparece um aviso na tela quando há um por perto).
- Encostar na grama tem chance de iniciar uma batalha em tempo real.
- Na batalha, clique num ícone da barra de habilidades (ou tecle 1-6) para
  usá-la — cada uma tem seu próprio custo de mana e tempo de recarga, exibido
  como um preenchimento escuro sobre o ícone.
- **ESC** — abre o menu de pausa (Inventário, Árvore de Habilidades, Ranking
  Global, Salvar e Sair).
- Em dispositivos de toque, um D-pad aparece no canto inferior esquerdo.
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
  screens/       cada "tela" do jogo (menu, criação, mundo, batalha, skills, inventário, ranking)
  ui/            helpers de DOM e o CSS de toda a interface (overlay HTML)
```

O jogo é **orientado a dados**: classes, inimigos, itens, NPCs, missões e
habilidades são listas de objetos TypeScript, não código espalhado pelas
telas. Toda a lógica de jogo (`config/`, `data/`, `entities/`, `systems/`) é
**independente da engine gráfica** — não importa nada de Three.js.

### Fluxo de telas

`MainMenu` → `CharacterSelect` (classe) → `CharacterCreation` (aparência) →
`Overworld` ⇄ `Battle`, com `SkillTree`, `Inventory` e `Ranking` acessíveis
pelo menu de pausa do `Overworld`. Cada `Screen` (`src/screens/*.ts`) é dona
da sua própria `THREE.Scene`/`THREE.Camera` e constrói sua própria UI em
HTML/CSS por cima do canvas (`game.uiRoot`) — os menus e o HUD são DOM
normal, não sprites de texto renderizados no WebGL.

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

## NPCs, diálogos e missões

Pedravale, a vila inicial, tem 4 NPCs (`src/data/npcs.ts`) com diálogo
próprio; aproximar-se de um mostra um aviso `[E] Falar com...`. A missão
principal (`src/data/quests.ts`, `systems/QuestSystem.ts`) é uma cadeia
linear de 6 missões — do primeiro encontro com o Ancião Tobias até o
confronto com o Dragão Jovem nas ruínas — misturando objetivos de diálogo,
derrota de inimigos e nível alcançado, com recompensas em XP, ouro e às
vezes um item garantido.

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
- [ ] Loja na vila para comprar/vender itens com o ouro acumulado.
- [ ] Mapas maiores/múltiplos com transições entre áreas e masmorras.
- [ ] Efeitos de status (veneno, atordoamento) no combate em tempo real.
- [ ] Empacotar como app nativo Android/iOS com
      [Capacitor](https://capacitorjs.com/) (o código web atual já funciona
      como base — é só rodar `npx cap init` / `npx cap add android|ios` sobre
      o build do Vite).
- [ ] Testes automatizados para `systems/CombatSystem.ts` e `QuestSystem.ts`
      (lógica pura, sem Three.js, ideal para testes unitários).

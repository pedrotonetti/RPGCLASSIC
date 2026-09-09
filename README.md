# RPG Classic

Um RPG 3D (estilo JRPG clássico) que roda no navegador e pode ser instalado
como app (PWA), construído para ser fácil de expandir aos poucos.

## Tecnologias

- **[Three.js](https://threejs.org/)** — a biblioteca 3D mais usada e madura
  do ecossistema web (open source, MIT), usada aqui para renderizar o mundo,
  os personagens e as batalhas via WebGL.
- **TypeScript** — tipagem estática para todo o código do jogo.
- **Vite** — dev server instantâneo e build de produção otimizado.
- **vite-plugin-pwa** — gera o manifest + service worker para o jogo poder ser
  instalado como app no celular/desktop (PWA), a partir do mesmo código web.

Não há nenhum asset 3D externo (modelo, textura ou áudio): todos os
personagens, inimigos e cenários são gerados por código combinando formas
geométricas simples (cápsulas, esferas, cones, caixas) coloridas por classe —
um estilo "low-poly" deliberado. Isso mantém o repositório leve; trocar por
modelos `.glb` de verdade depois é só carregar via `GLTFLoader` no lugar das
funções em `src/render/characterModel.ts`.

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
- Encostar na grama tem chance de iniciar uma batalha aleatória.
- **ESC** — salva o progresso e volta ao menu principal.
- Em dispositivos de toque, um D-pad aparece no canto inferior esquerdo.
- O progresso é salvo automaticamente (`localStorage`) a cada passo, batalha e
  ao sair pelo ESC.

## Arquitetura

```
src/
  config/        tipos e dados de configuração (classes, tiles, constantes)
  data/          bancos de dados de itens e inimigos
  entities/      Player e Enemy (estado de runtime, cálculo de stats)
  systems/       lógica pura: combate, encontros aleatórios, mapa, save/load
  engine/        Game (loop + troca de telas) e a interface Screen
  render/        geração procedural dos modelos 3D e do mundo (Three.js)
  screens/       cada "tela" do jogo (menu, seleção, mundo, batalha)
  ui/            helpers de DOM e o CSS de toda a interface (overlay HTML)
```

O jogo é **orientado a dados**: classes, inimigos, itens e habilidades são
listas de objetos TypeScript, não código espalhado pelas telas. Toda a lógica
de jogo (`config/`, `data/`, `entities/`, `systems/`) é **independente da
engine gráfica** — não importa nada de Three.js — o que tornou a migração de
2D (Phaser) para 3D (Three.js) um trabalho isolado na camada visual.

### Como o jogo é montado

`main.ts` cria um único `Game` (dono do `WebGLRenderer` e do loop de
`requestAnimationFrame`) e manda ele ir para a primeira tela:

`MainMenu` → `CharacterSelect` → `Overworld` ⇄ `Battle`

Cada `Screen` (`src/screens/*.ts`) é dona da sua própria `THREE.Scene` e
`THREE.Camera`, e constrói sua própria UI em HTML/CSS por cima do canvas
(`game.uiRoot`) — os menus, o HUD e o menu de batalha são DOM normal, não
sprites de texto renderizados no WebGL, o que deixa a interface nítida em
qualquer resolução e fácil de estilizar.

- **Overworld**: mapa gerado proceduralmente (`systems/MapGenerator.ts`, uma
  grade 2D de tiles) com uma vila segura, uma estrada e um campo aberto com
  água/árvores como obstáculos. `render/worldBuilder.ts` transforma essa
  grade em malhas 3D (chão, trilhas, água, árvores instanciadas). O
  personagem se move de tile em tile (com interpolação suave) e a câmera o
  segue em terceira pessoa, virando conforme a direção. Passos na grama podem
  disparar batalha (`systems/EncounterSystem.ts`).
- **Battle**: arena 3D estática com o herói de um lado e os inimigos do
  outro, batalha por turnos clássica (Atacar / Habilidade / Item / Fugir),
  ordem de ação por velocidade. Toda a lógica de dano/cura/fuga fica isolada
  em `systems/CombatSystem.ts` (sem nenhuma dependência de Three.js ou do
  DOM — testável isoladamente). As barras de vida e os números de dano são
  elementos HTML posicionados por projeção da posição 3D para tela
  (`camera.project`).

## As 4 classes iniciais

| Classe    | Perfil                                  | Habilidades                          |
|-----------|------------------------------------------|---------------------------------------|
| Guerreiro | Tanque físico, muita vida e defesa       | Golpe Poderoso, Grito de Guerra (cura)|
| Mago      | Dano mágico alto, frágil                 | Bola de Fogo, Nevasca (área)          |
| Arqueiro  | Rápido, físico equilibrado               | Tiro Certeiro, Chuva de Flechas (área)|
| Clérigo   | Suporte com cura e dano mágico leve      | Cura, Julgamento                      |

## Como adicionar uma nova classe

Todo o sistema de classes é uma única lista em `src/config/classes.ts`. Basta
acrescentar um novo objeto ao array `CLASS_DEFINITIONS` com `id`, `name`,
`description`, `color` (cor do modelo 3D), `baseStats`, `growth` (quanto cada
stat sobe por nível) e `skills`. A tela de seleção de personagem, a criação
do `Player` e o sistema de combate já leem dessa lista automaticamente.
Para dar um visual próprio à nova classe, adicione um caso em
`CLASS_ACCESSORY` (`src/render/characterModel.ts`) ou crie um acessório novo
em `addClassAccessory`.

Da mesma forma:
- Novos **inimigos**: acrescente em `src/data/enemies.ts` e um caso em
  `buildEnemyModel` (`src/render/characterModel.ts`) para o visual dele.
- Novos **itens**: acrescente em `src/data/items.ts`.
- Novas **habilidades**: fazem parte da definição da classe/inimigo (`skills`).

## Próximos passos sugeridos

- [ ] Trocar os modelos low-poly por modelos `.glb` reais (via `GLTFLoader`).
- [ ] Sistema de equipamentos (armas/armaduras) e loja na vila.
- [ ] Mapas maiores/múltiplos com transições entre áreas e masmorras.
- [ ] Diálogos e NPCs na vila.
- [ ] Empacotar como app nativo Android/iOS com
      [Capacitor](https://capacitorjs.com/) (o código web atual já funciona
      como base — é só rodar `npx cap init` / `npx cap add android|ios` sobre
      o build do Vite).
- [ ] Testes automatizados para `systems/CombatSystem.ts` (é lógica pura, sem
      Three.js, ideal para testes unitários).

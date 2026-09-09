# RPG Classic

Um RPG 2D clássico (estilo JRPG) que roda no navegador e pode ser instalado como
app (PWA), construído para ser fácil de expandir aos poucos.

## Tecnologias

- **[Phaser 3](https://phaser.io/)** — a engine de jogos 2D open source (MIT) mais
  usada e madura do ecossistema JavaScript/TypeScript, com tudo que um RPG
  precisa (tilemaps, câmera, tweens, input, áudio) sem custo de licença.
- **TypeScript** — tipagem estática para o código do jogo.
- **Vite** — dev server instantâneo e build de produção otimizado.
- **vite-plugin-pwa** — gera o manifest + service worker para o jogo poder ser
  instalado como app no celular/desktop (PWA), a partir do mesmo código web.

Não há nenhum asset de imagem/áudio externo: todos os sprites e tiles são
gerados por código (`src/utils/textures.ts`) usando formas geométricas do
Phaser. Isso mantém o repositório leve e serve como placeholder — trocar por
pixel art de verdade depois é só substituir essas texturas por um
`spritesheet` carregado normalmente no `PreloadScene`.

## Como rodar

```bash
npm install
npm run dev       # servidor de desenvolvimento (http://localhost:5173)
npm run build     # build de produção em dist/
npm run preview   # serve o build de produção localmente
npm run typecheck # só checagem de tipos, sem build
```

## Como jogar

- **Setas / WASD** — mover pelo mapa.
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
  scenes/        cenas do Phaser (telas do jogo)
  ui/            (reservado para componentes de UI reutilizáveis futuros)
  utils/         geração procedural de texturas
```

O jogo é **orientado a dados**: classes, inimigos, itens e habilidades são
listas de objetos TypeScript, não código espalhado pelas cenas. Isso é o que
torna a ampliação simples.

### Cenas (`src/scenes`)

`Boot` → `Preload` → `MainMenu` → `CharacterSelect` → `Overworld` ⇄ `Battle`

- **Overworld**: mapa gerado proceduralmente (`systems/MapGenerator.ts`) com
  uma vila segura, uma estrada e um campo aberto com água/árvores como
  obstáculos. Câmera segue o jogador. Passos na grama podem disparar batalha
  (`systems/EncounterSystem.ts`).
- **Battle**: batalha por turnos clássica (Atacar / Habilidade / Item / Fugir),
  ordem de ação por velocidade, com toda a lógica de dano/cura/fuga isolada em
  `systems/CombatSystem.ts` (sem nenhuma dependência do Phaser — testável
  isoladamente).

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
`description`, `color` (cor do sprite placeholder), `baseStats`, `growth`
(quanto cada stat sobe por nível) e `skills`. A tela de seleção de personagem,
a criação do `Player` e o sistema de combate já leem dessa lista automaticamente
— nenhum outro arquivo precisa mudar.

Da mesma forma:
- Novos **inimigos**: acrescente em `src/data/enemies.ts`.
- Novos **itens**: acrescente em `src/data/items.ts`.
- Novas **habilidades**: fazem parte da definição da classe/inimigo (`skills`).

## Próximos passos sugeridos

- [ ] Trocar as texturas procedurais por spritesheets de pixel art reais.
- [ ] Sistema de equipamentos (armas/armaduras) e loja na vila.
- [ ] Mapas maiores/múltiplos com transições entre áreas e masmorras.
- [ ] Diálogos e NPCs na vila.
- [ ] Empacotar como app nativo Android/iOS com
      [Capacitor](https://capacitorjs.com/) (o código web atual já funciona
      como base — é só rodar `npx cap init` / `npx cap add android|ios` sobre
      o build do Vite).
- [ ] Testes automatizados para `systems/CombatSystem.ts` (é lógica pura, sem
      Phaser, ideal para testes unitários).

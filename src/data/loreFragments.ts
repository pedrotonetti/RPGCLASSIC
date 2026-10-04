// Fragmentos de Memória: environmental lore. Texts avoid naming Amara/Ilva (those reveals belong to their quest chains).
export interface LoreFragmentDefinition {
  id: string;
  title: string;
  zoneId: string;
  atTile: { x: number; y: number };
  lines: string[];
  nightOnly?: boolean;
}

export const LORE_FRAGMENTS: LoreFragmentDefinition[] = [
  // --- Pedravale (main city / Verdegal) -------------------------------------
  {
    id: 'frag_ultima_florescencia',
    title: 'A Última Florescência',
    zoneId: 'main_city',
    atTile: { x: 46, y: 17 },
    lines: [
      '(A raiz ainda está morna, como se alguém tivesse acabado de soltá-la.) Eu era criança na última Florescência. Toda Ipê-árvore abriu na mesma noite — amarelo até onde a vista alcançava.',
      'Minha avó disse que, nesses dias, o véu fica fino. Ela conversou com o marido morto a madrugada inteira. De manhã as flores caíram, e ela só disse: "até a próxima geração".',
    ],
  },
  {
    id: 'frag_oferenda_recusada',
    title: 'Oferenda Recusada',
    zoneId: 'main_city',
    atTile: { x: 149, y: 41 },
    lines: [
      '(Há um prato de barro rachado ao pé da raiz, com migalhas de pão seco.) Deixamos pão e água todo ano, para os que descem. Este ano a raiz não aceitou o pão.',
      'A água, sim: sumiu antes do amanhecer. Não evaporou — foi bebida, de baixo para cima, como quem tem pressa.',
    ],
  },
  {
    id: 'frag_voto_dos_sete',
    title: 'O Voto dos Sete',
    zoneId: 'main_city',
    atTile: { x: 24, y: 64 },
    nightOnly: true,
    lines: [
      '(Só à noite a raiz fala — baixo, com voz de quem já cansou de repetir.) Éramos sete. Juramos vigiar a ferida e nunca falar dela a ninguém.',
      'Jurar calar foi a parte fácil. A difícil é lembrar, todo dia, do que se está calando — e ver os netos crescerem sem saber o que herdaram.',
    ],
  },

  // --- Villages --------------------------------------------------------------
  {
    id: 'frag_forja_fria',
    title: 'A Forja Que Esfriou',
    zoneId: 'warrior_start',
    atTile: { x: 86, y: 18 },
    lines: [
      '(Carvão queimado ao lado de uma raiz exposta, ainda sem fumaça.) O ferro daqui parou de esquentar direito. Jogamos carvão de manhã e à tarde, e nada.',
      'O mestre disse que o calor também foi bebido. Anotou isso no caderno — e depois riscou, "para não assustar os aprendizes".',
    ],
  },
  {
    id: 'frag_calculos_da_rede',
    title: 'Cálculos na Raiz',
    zoneId: 'mage_secondary',
    atTile: { x: 109, y: 80 },
    lines: [
      '(Símbolos de giz foram gravados na casca, linha sobre linha.) Mapeei a rede de raízes de Ipêra por três invernos. Ela não é uma rede — é um corpo.',
      'E esse corpo está doente exatamente nos pontos onde, uma geração atrás, alguém colheu. Não é coincidência. É a mesma ferida, reaberta por quem não sabia que ela estava ali.',
    ],
  },
  {
    id: 'frag_cantiga_das_criancas',
    title: 'Cantiga das Crianças',
    zoneId: 'archer_start',
    atTile: { x: 17, y: 30 },
    lines: [
      '(Um fiapo de melodia sobe da raiz, infantil e desafinado.) "Raiz, raiz, desce e dorme; quando a flor voltar, eu volto."',
      'As crianças de Ipêra cantam isso sem saber o que significa. Foi escrita por alguém que sabia que não voltaria — e que quis, ao menos, que a cantiga voltasse por ele.',
    ],
  },
  {
    id: 'frag_ultimo_que_ouvia',
    title: 'O Último Que Ouvia',
    zoneId: 'paladin_secondary',
    atTile: { x: 116, y: 30 },
    lines: [
      '(A memória é de um estranho, visto de longe.) O último que ouvia as Raízes passou por aqui antes da guerra. Andava de cabeça baixa — não de humildade, de cansaço.',
      'Quem ouve tudo nunca tem silêncio. As crianças o seguiam com os olhos; os adultos, só até a esquina. Ninguém ofereceu abrigo. Ele não pediu.',
    ],
  },
  {
    id: 'frag_canto_dos_ossos',
    title: 'A Primeira Colheita',
    zoneId: 'necromancer_start',
    atTile: { x: 90, y: 68 },
    nightOnly: true,
    lines: [
      '(A noite abre a raiz como uma ferida antiga.) Disseram que era só um pouco. Uma raiz por aldeia, para atravessar a seca. Quando a raiz gritou, chamaram de vento.',
      'Quando a segunda gritou, chamaram de ventania. Na terceira, ninguém mais chamou de nada — só empilharam a lenha ao lado, para o frio que viria.',
    ],
  },
  {
    id: 'frag_respiracao_da_terra',
    title: 'A Respiração da Terra',
    zoneId: 'monk_secondary',
    atTile: { x: 38, y: 30 },
    nightOnly: true,
    lines: [
      '(A raiz pulsa devagar, no ritmo de quem tenta não acordar.) Treinei a noite toda para respirar junto com a terra. Perto do amanhecer, a terra parou de respirar.',
      'Segurei o ar até doer, esperando que ela voltasse primeiro. Não voltou. Tive que soltar o ar sozinho — e foi a coisa mais solitária que já fiz.',
    ],
  },
  {
    id: 'frag_santuario_vazio',
    title: 'Prece Sem Resposta',
    zoneId: 'cleric_secondary',
    atTile: { x: 29, y: 85 },
    lines: [
      '(Alguém entalhou um nome na casca e depois tentou raspá-lo — só uma folha de ipê restou.) Rezei aqui desde menina e a raiz sempre respondia, com calor ou com saudade.',
      'Agora responde com sede. Não mais com "estou aqui" — com "me dê". Aprendi que há preces que a gente faz em voz alta e outras que só se faz calando.',
    ],
  },

  // --- Regional settlements --------------------------------------------------
  {
    id: 'frag_sal_na_madeira',
    title: 'Sal na Madeira',
    zoneId: 'ancoradouro_vau',
    atTile: { x: 68, y: 52 },
    lines: [
      '(Há cristais de sal brancos na casca de uma raiz que nunca viu o mar.) Os barcos do outro lado chegaram famintos, não furiosos. Vi homens beberem a lama do vau com as mãos em concha.',
      'Ninguém contou isso na história que ensinam às crianças. Mas quem já teve sede de verdade reconhece sede em outra língua — e eu reconheci.',
    ],
  },
  {
    id: 'frag_raiz_sem_voz',
    title: 'Saudade em Outra Língua',
    zoneId: 'baluarte_amanhecer',
    atTile: { x: 110, y: 75 },
    lines: [
      '(A raiz na areia é grossa demais, e escura demais.) Encostei a mão e não ouvi palavras — ouvi saudade, mas numa língua em que "casa" soa muito parecido com "sede".',
      'Se é verdade que a Sede nasceu aqui, nenhuma raiz de Ipêra sabe dizer como. Esta, que veio do outro lado, talvez saiba. E talvez já tenha tentado nos contar.',
    ],
  },
];

export function loreFragmentsInZone(zoneId: string): LoreFragmentDefinition[] {
  return LORE_FRAGMENTS.filter((f) => f.zoneId === zoneId);
}

export function getLoreFragmentById(id: string): LoreFragmentDefinition {
  const found = LORE_FRAGMENTS.find((f) => f.id === id);
  if (!found) throw new Error(`Fragmento de memória desconhecido: ${id}`);
  return found;
}

export function isLoreFragmentAvailable(def: LoreFragmentDefinition, night: boolean): boolean {
  return !def.nightOnly || night;
}

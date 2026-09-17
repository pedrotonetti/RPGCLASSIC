/**
 * Per-class starting territory, in the spirit of classic MMO "each race/class
 * starts in its own village" structure: every class has its own starting
 * village (weak monsters, first quests), a secondary village further along
 * (mid-tier monsters, still that class's own territory), and from there a
 * road into the shared main city — Pedravale, since Tobias and the existing
 * Chapter 1 story are already anchored there.
 */
export interface ClassZoneTheme {
  classId: string;
  startVillageId: string;
  startVillageName: string;
  secondaryVillageId: string;
  secondaryVillageName: string;
  /** Ground/path tint for this class's territory, distinct from every other class's. */
  accentColor: number;
  elderName: string;
  elderTitle: string;
  elderGreeting: string[];
  mentorName: string;
  mentorTitle: string;
  mentorGreeting: string[];
  /** Enemy ids available in the starting village's field. */
  startMonsters: string[];
  /** Enemy ids available in the secondary village's field. */
  secondaryMonsters: string[];
}

export const CLASS_ZONE_THEMES: ClassZoneTheme[] = [
  {
    classId: 'warrior',
    startVillageId: 'warrior_start',
    startVillageName: 'Vila da Pedra Vermelha',
    secondaryVillageId: 'warrior_secondary',
    secondaryVillageName: 'Forte de Ferro',
    accentColor: 0xb33a3a,
    elderName: 'Ancião Rurik',
    elderTitle: 'Guardião da Pedra Vermelha',
    elderGreeting: [
      'Todo guerreiro de Ipêra começou aqui, com as mãos calejadas e pouca paciência.',
      'Prove seu valor contra as criaturas do campo antes de seguir para o Forte de Ferro.',
    ],
    mentorName: 'Comandante Gael',
    mentorTitle: 'Comandante do Forte de Ferro',
    mentorGreeting: [
      'Chegou longe para um recruta. O Forte forja quem sobrevive à Pedra Vermelha.',
      'Quando estiver pronto, a estrada ao sul leva a Pedravale — lá o Ancião Tobias tem respostas que nem eu tenho.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['goblin', 'bandit', 'dark_wolf'],
  },
  {
    classId: 'mage',
    startVillageId: 'mage_start',
    startVillageName: 'Vila do Véu Azul',
    secondaryVillageId: 'mage_secondary',
    secondaryVillageName: 'Torre dos Arcanos',
    accentColor: 0x3a5fb3,
    elderName: 'Arquimaga Selene',
    elderTitle: 'Guardiã do Véu Azul',
    elderGreeting: [
      'A mana desta vila responde a quem ainda nem sabe o próprio poder.',
      'Afaste as criaturas do véu com magia — é assim que todo mago aprende a canalizar.',
    ],
    mentorName: 'Magíster Orin',
    mentorTitle: 'Guardião da Torre dos Arcanos',
    mentorGreeting: [
      'A Torre sente talento à distância. O seu já acende as pedras arcanas do saguão.',
      'Pedravale fica a sul. O Ancião Tobias vai querer saber de um Vozeiro capaz de manejar magia.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['goblin', 'giant_spider', 'skeleton'],
  },
  {
    classId: 'archer',
    startVillageId: 'archer_start',
    startVillageName: 'Vila da Folhagem',
    secondaryVillageId: 'archer_secondary',
    secondaryVillageName: 'Posto da Trilha Verde',
    accentColor: 0x3fae5b,
    elderName: 'Mestre Ilan',
    elderTitle: 'Guarda-Florestas da Folhagem',
    elderGreeting: [
      'Aqui se aprende a ouvir o mato antes de vê-lo se mexer.',
      'Cace as criaturas que rondam a folhagem. A mira vem com a prática, não com pressa.',
    ],
    mentorName: 'Capitã Fenn',
    mentorTitle: 'Capitã do Posto da Trilha Verde',
    mentorGreeting: [
      'Poucos atiradores chegam ao Posto com a mira que você já tem.',
      'A trilha ao sul leva a Pedravale. Tobias vai gostar de ouvir sobre você.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['goblin', 'bandit', 'giant_spider'],
  },
  {
    classId: 'cleric',
    startVillageId: 'cleric_start',
    startVillageName: 'Vila do Bambu',
    secondaryVillageId: 'cleric_secondary',
    secondaryVillageName: 'Santuário da Aurora',
    accentColor: 0xe0c34a,
    elderName: 'Irmã Yara',
    elderTitle: 'Guardiã da Vila do Bambu',
    elderGreeting: [
      'Aqui entre o bambu, aprendemos que curar é também uma forma de golpear a Sede.',
      'Vá, ajude quem precisar contra as criaturas do campo. A fé se prova em ação.',
    ],
    mentorName: 'Alto-Sacerdote Doran',
    mentorTitle: 'Guardião do Santuário da Aurora',
    mentorGreeting: [
      'A Aurora reconhece um dom raro em você.',
      'Pedravale precisa de curandeiros como você. Tobias a sul vai querer conversar.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['skeleton', 'goblin', 'fire_elemental'],
  },
  {
    classId: 'paladin',
    startVillageId: 'paladin_start',
    startVillageName: 'Vila do Escudo Branco',
    secondaryVillageId: 'paladin_secondary',
    secondaryVillageName: 'Bastião da Fé',
    accentColor: 0xcfd6dc,
    elderName: 'Ancião Berthold',
    elderTitle: 'Guardião do Escudo Branco',
    elderGreeting: [
      'Um escudo levantado a tempo salva mais vidas que cem espadas atrasadas.',
      'Proteja esta vila das criaturas do campo — é o primeiro juramento de todo paladino.',
    ],
    mentorName: 'Grão-Mestre Alaric',
    mentorTitle: 'Guardião do Bastião da Fé',
    mentorGreeting: [
      'O Bastião já ouviu falar do seu juramento na Vila do Escudo Branco.',
      'Siga a sul até Pedravale. Tobias tem um fardo que talvez você ajude a carregar.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['orc', 'skeleton', 'dark_wolf'],
  },
  {
    classId: 'assassin',
    startVillageId: 'assassin_start',
    startVillageName: 'Vila das Sombras',
    secondaryVillageId: 'assassin_secondary',
    secondaryVillageName: 'Refúgio Silencioso',
    accentColor: 0x2a2a35,
    elderName: 'Mestra Nyx',
    elderTitle: 'Guardiã da Vila das Sombras',
    elderGreeting: [
      'Ninguém nasce silencioso. Isso se treina, golpe a golpe, nas sombras do campo.',
      'Elimine as criaturas que rondam por aqui sem ser vista. É o primeiro teste.',
    ],
    mentorName: 'Sombra Kael',
    mentorTitle: 'Guardião do Refúgio Silencioso',
    mentorGreeting: [
      'Poucos chegam ao Refúgio sem serem notados. Você chegou.',
      'A sul fica Pedravale. Tobias não vai perguntar como você chegou tão rápido — melhor assim.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['bandit', 'giant_spider', 'dark_wolf'],
  },
  {
    classId: 'necromancer',
    startVillageId: 'necromancer_start',
    startVillageName: 'Vila dos Ossos',
    secondaryVillageId: 'necromancer_secondary',
    secondaryVillageName: 'Cripta Esquecida',
    accentColor: 0x2f1f3a,
    elderName: 'Ancião Morwen',
    elderTitle: 'Guardião da Vila dos Ossos',
    elderGreeting: [
      'Aqui aprendemos que a Sede não é a única coisa que mexe sob a terra.',
      'Drene a força das criaturas do campo. É assim que seu dom cresce.',
    ],
    mentorName: 'Necromante Ashka',
    mentorTitle: 'Guardiã da Cripta Esquecida',
    mentorGreeting: [
      'A Cripta sussurra seu nome desde que você chegou à Vila dos Ossos.',
      'Pedravale é a sul. Tobias esconde mais sobre a Sede do que admite — cuidado.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['skeleton', 'stone_golem', 'goblin'],
  },
  {
    classId: 'monk',
    startVillageId: 'monk_start',
    startVillageName: 'Vila do Punho de Jade',
    secondaryVillageId: 'monk_secondary',
    secondaryVillageName: 'Mosteiro da Serra',
    accentColor: 0xd97a2e,
    elderName: 'Mestre Feng',
    elderTitle: 'Guardião do Punho de Jade',
    elderGreeting: [
      'O corpo é a primeira arma. Aqui você aprende a não precisar de outra.',
      'Enfrente as criaturas do campo de punhos limpos. A disciplina vem depois da dor.',
    ],
    mentorName: 'Grão-Mestre Wen',
    mentorTitle: 'Guardião do Mosteiro da Serra',
    mentorGreeting: [
      'O Mosteiro sente disciplina real quando ela chega. A sua chegou.',
      'A estrada ao sul leva a Pedravale. Tobias precisa de gente como você, com a cabeça no lugar.',
    ],
    startMonsters: ['slime', 'bat'],
    secondaryMonsters: ['orc', 'goblin', 'giant_spider'],
  },
];

export function getClassZoneTheme(classId: string): ClassZoneTheme {
  const found = CLASS_ZONE_THEMES.find((t) => t.classId === classId);
  if (!found) throw new Error(`Sem território definido para a classe: ${classId}`);
  return found;
}

export type Gender = 'masculino' | 'feminino';
export type BodyType = 'magro' | 'atletico' | 'robusto' | 'musculoso' | 'esbelto' | 'ampulheta';
export type FaceShape = 'oval' | 'quadrado' | 'redondo' | 'anguloso' | 'coracao' | 'alongado';
export type EyebrowStyle = 'fina' | 'grossa' | 'arqueada' | 'reta' | 'juntas' | 'assimetrica';
export type FacialHairStyle = 'nenhuma' | 'bigode' | 'cavanhaque' | 'completa' | 'longa' | 'costeleta' | 'circulo';
export type HeadAccessory = 'nenhum' | 'elmo' | 'chapeu' | 'coroa' | 'capuz' | 'bandana' | 'chifres';
export type ScarStyle = 'nenhuma' | 'olho' | 'bochecha' | 'queixo' | 'testa' | 'labio';
export type TattooStyle = 'nenhuma' | 'braco' | 'rosto' | 'pescoco' | 'ambosbracos';
export type HairStyle =
  | 'careca'
  | 'curto'
  | 'medio'
  | 'longo'
  | 'moicano'
  | 'afro'
  | 'coque'
  | 'trancado'
  | 'topete'
  | 'rabocavalo'
  | 'chiquinhas'
  | 'espetado'
  | 'franja'
  | 'entradas';

export interface CharacterAppearance {
  gender: Gender;
  skinTone: number;
  hairStyle: HairStyle;
  hairColor: number;
  eyeColor: number;
  bodyType: BodyType;
  heightScale: number;
  faceShape: FaceShape;
  eyebrowStyle: EyebrowStyle;
  facialHair: FacialHairStyle;
  primaryColor: number;
  secondaryColor: number;
  headAccessory: HeadAccessory;
  scarStyle: ScarStyle;
  tattooStyle: TattooStyle;
}

export interface SwatchOption {
  id: string;
  label: string;
  value: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
}

export const SKIN_TONES: SwatchOption[] = [
  { id: 'st1', label: 'Alabastro', value: 0xf3d9c4 },
  { id: 'st2', label: 'Marfim', value: 0xe8bf9a },
  { id: 'st3', label: 'Dourado', value: 0xd2a679 },
  { id: 'st4', label: 'Âmbar', value: 0xb8875a },
  { id: 'st5', label: 'Bronze', value: 0x93643f },
  { id: 'st6', label: 'Terracota', value: 0x74492f },
  { id: 'st7', label: 'Ébano', value: 0x4a2f20 },
  { id: 'st8', label: 'Cinza-pedra', value: 0x8a8f96 },
  { id: 'st9', label: 'Rosado', value: 0xe8b4a0 },
  { id: 'st10', label: 'Oliva', value: 0x9a8a5a },
  { id: 'st11', label: 'Carvão', value: 0x2e2620 },
  { id: 'st12', label: 'Mármore', value: 0xe0e4e8 },
  { id: 'st13', label: 'Cobre', value: 0xb87333 },
  { id: 'st14', label: 'Cinza-espectral', value: 0x8a95a0 },
];

export const HAIR_COLORS: SwatchOption[] = [
  { id: 'hc1', label: 'Preto', value: 0x1c1712 },
  { id: 'hc2', label: 'Castanho', value: 0x4a2f20 },
  { id: 'hc3', label: 'Castanho-claro', value: 0x7a5233 },
  { id: 'hc4', label: 'Loiro', value: 0xd9b464 },
  { id: 'hc5', label: 'Ruivo', value: 0xa5502a },
  { id: 'hc6', label: 'Branco', value: 0xe8e4dc },
  { id: 'hc7', label: 'Azul', value: 0x3a5fb3 },
  { id: 'hc8', label: 'Rosa', value: 0xd97fa8 },
  { id: 'hc9', label: 'Verde', value: 0x3f8a5b },
  { id: 'hc10', label: 'Roxo', value: 0x7a4fb3 },
  { id: 'hc11', label: 'Prateado', value: 0xc9d0d6 },
  { id: 'hc12', label: 'Grisalho', value: 0x9a9a9a },
];

export const EYE_COLORS: SwatchOption[] = [
  { id: 'ec1', label: 'Castanho', value: 0x4a2f20 },
  { id: 'ec2', label: 'Azul', value: 0x3f7fbf },
  { id: 'ec3', label: 'Verde', value: 0x4a9a5a },
  { id: 'ec4', label: 'Âmbar', value: 0xc7871f },
  { id: 'ec5', label: 'Cinza', value: 0x9aa0a6 },
  { id: 'ec6', label: 'Violeta', value: 0x8a5fbf },
  { id: 'ec7', label: 'Vermelho', value: 0xb33a3a },
  { id: 'ec8', label: 'Prateado', value: 0xc9d0d6 },
];

export const GARMENT_COLORS: SwatchOption[] = [
  { id: 'gc1', label: 'Carmesim', value: 0xb33a3a },
  { id: 'gc2', label: 'Azul-real', value: 0x3a5fb3 },
  { id: 'gc3', label: 'Verde-floresta', value: 0x3fae5b },
  { id: 'gc4', label: 'Dourado', value: 0xe0c34a },
  { id: 'gc5', label: 'Roxo', value: 0x7a4fb3 },
  { id: 'gc6', label: 'Preto', value: 0x2a2a35 },
  { id: 'gc7', label: 'Branco-osso', value: 0xe8e0d0 },
  { id: 'gc8', label: 'Laranja', value: 0xd9762e },
  { id: 'gc9', label: 'Turquesa', value: 0x2ea89a },
  { id: 'gc10', label: 'Rosa-choque', value: 0xd93fa0 },
  { id: 'gc11', label: 'Cinza-aço', value: 0x5a626b },
  { id: 'gc12', label: 'Bronze', value: 0x9a6a3a },
];

export const HAIR_STYLES: ChoiceOption[] = [
  { id: 'careca', label: 'Careca' },
  { id: 'curto', label: 'Curto' },
  { id: 'medio', label: 'Médio' },
  { id: 'longo', label: 'Longo' },
  { id: 'moicano', label: 'Moicano' },
  { id: 'afro', label: 'Afro' },
  { id: 'coque', label: 'Coque' },
  { id: 'trancado', label: 'Trançado' },
  { id: 'topete', label: 'Topete' },
  { id: 'rabocavalo', label: 'Rabo de Cavalo' },
  { id: 'chiquinhas', label: 'Chiquinhas' },
  { id: 'espetado', label: 'Espetado' },
  { id: 'franja', label: 'Franja' },
  { id: 'entradas', label: 'Entradas' },
];

export const BODY_TYPES: ChoiceOption[] = [
  { id: 'magro', label: 'Magro' },
  { id: 'atletico', label: 'Atlético' },
  { id: 'robusto', label: 'Robusto' },
  { id: 'musculoso', label: 'Musculoso' },
  { id: 'esbelto', label: 'Esbelto' },
  { id: 'ampulheta', label: 'Ampulheta' },
];

export const FACE_SHAPES: ChoiceOption[] = [
  { id: 'oval', label: 'Oval' },
  { id: 'quadrado', label: 'Quadrado' },
  { id: 'redondo', label: 'Redondo' },
  { id: 'anguloso', label: 'Anguloso' },
  { id: 'coracao', label: 'Coração' },
  { id: 'alongado', label: 'Alongado' },
];

export const EYEBROW_STYLES: ChoiceOption[] = [
  { id: 'fina', label: 'Fina' },
  { id: 'grossa', label: 'Grossa' },
  { id: 'arqueada', label: 'Arqueada' },
  { id: 'reta', label: 'Reta' },
  { id: 'juntas', label: 'Juntas' },
  { id: 'assimetrica', label: 'Assimétrica' },
];

export const FACIAL_HAIR_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'bigode', label: 'Bigode' },
  { id: 'cavanhaque', label: 'Cavanhaque' },
  { id: 'completa', label: 'Barba Completa' },
  { id: 'longa', label: 'Barba Longa' },
  { id: 'costeleta', label: 'Costeletas' },
  { id: 'circulo', label: 'Circular' },
];

export const HEAD_ACCESSORIES: ChoiceOption[] = [
  { id: 'nenhum', label: 'Nenhum' },
  { id: 'elmo', label: 'Elmo' },
  { id: 'chapeu', label: 'Chapéu' },
  { id: 'coroa', label: 'Coroa' },
  { id: 'capuz', label: 'Capuz' },
  { id: 'bandana', label: 'Bandana' },
  { id: 'chifres', label: 'Chifres' },
];

export const SCAR_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'olho', label: 'Sobre o olho' },
  { id: 'bochecha', label: 'Na bochecha' },
  { id: 'queixo', label: 'No queixo' },
  { id: 'testa', label: 'Na testa' },
  { id: 'labio', label: 'No lábio' },
];

export const TATTOO_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'braco', label: 'No braço' },
  { id: 'rosto', label: 'No rosto' },
  { id: 'pescoco', label: 'No pescoço' },
  { id: 'ambosbracos', label: 'Nos dois braços' },
];

export const GENDERS: ChoiceOption[] = [
  { id: 'masculino', label: 'Masculino' },
  { id: 'feminino', label: 'Feminino' },
];

/** Height slider goes across five fixed notches rather than a free float. */
export const HEIGHT_NOTCHES = [0.9, 0.95, 1.0, 1.05, 1.1];

export function defaultAppearance(primaryColor: number, secondaryColor: number): CharacterAppearance {
  return {
    gender: 'masculino',
    skinTone: SKIN_TONES[0].value,
    hairStyle: 'curto',
    hairColor: HAIR_COLORS[0].value,
    eyeColor: EYE_COLORS[0].value,
    bodyType: 'atletico',
    heightScale: 1.0,
    faceShape: 'oval',
    eyebrowStyle: 'reta',
    facialHair: 'nenhuma',
    primaryColor,
    secondaryColor,
    headAccessory: 'nenhum',
    scarStyle: 'nenhuma',
    tattooStyle: 'nenhuma',
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizeAppearance(base: CharacterAppearance): CharacterAppearance {
  return {
    ...base,
    gender: pick(GENDERS).id as Gender,
    skinTone: pick(SKIN_TONES).value,
    hairStyle: pick(HAIR_STYLES).id as HairStyle,
    hairColor: pick(HAIR_COLORS).value,
    eyeColor: pick(EYE_COLORS).value,
    bodyType: pick(BODY_TYPES).id as BodyType,
    heightScale: pick(HEIGHT_NOTCHES),
    faceShape: pick(FACE_SHAPES).id as FaceShape,
    eyebrowStyle: pick(EYEBROW_STYLES).id as EyebrowStyle,
    facialHair: pick(FACIAL_HAIR_STYLES).id as FacialHairStyle,
    headAccessory: pick(HEAD_ACCESSORIES).id as HeadAccessory,
    scarStyle: pick(SCAR_STYLES).id as ScarStyle,
    tattooStyle: pick(TATTOO_STYLES).id as TattooStyle,
  };
}

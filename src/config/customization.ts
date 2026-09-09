export type Gender = 'masculino' | 'feminino';
export type BodyType = 'magro' | 'atletico' | 'robusto';
export type FaceShape = 'oval' | 'quadrado' | 'redondo' | 'anguloso';
export type EyebrowStyle = 'fina' | 'grossa' | 'arqueada' | 'reta';
export type FacialHairStyle = 'nenhuma' | 'bigode' | 'cavanhaque' | 'completa' | 'longa';
export type HeadAccessory = 'nenhum' | 'elmo' | 'chapeu' | 'coroa' | 'capuz';
export type ScarStyle = 'nenhuma' | 'olho' | 'bochecha' | 'queixo';
export type TattooStyle = 'nenhuma' | 'braco' | 'rosto';
export type HairStyle =
  | 'careca'
  | 'curto'
  | 'medio'
  | 'longo'
  | 'moicano'
  | 'afro'
  | 'coque'
  | 'trancado';

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
];

export const EYE_COLORS: SwatchOption[] = [
  { id: 'ec1', label: 'Castanho', value: 0x4a2f20 },
  { id: 'ec2', label: 'Azul', value: 0x3f7fbf },
  { id: 'ec3', label: 'Verde', value: 0x4a9a5a },
  { id: 'ec4', label: 'Âmbar', value: 0xc7871f },
  { id: 'ec5', label: 'Cinza', value: 0x9aa0a6 },
  { id: 'ec6', label: 'Violeta', value: 0x8a5fbf },
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
];

export const BODY_TYPES: ChoiceOption[] = [
  { id: 'magro', label: 'Magro' },
  { id: 'atletico', label: 'Atlético' },
  { id: 'robusto', label: 'Robusto' },
];

export const FACE_SHAPES: ChoiceOption[] = [
  { id: 'oval', label: 'Oval' },
  { id: 'quadrado', label: 'Quadrado' },
  { id: 'redondo', label: 'Redondo' },
  { id: 'anguloso', label: 'Anguloso' },
];

export const EYEBROW_STYLES: ChoiceOption[] = [
  { id: 'fina', label: 'Fina' },
  { id: 'grossa', label: 'Grossa' },
  { id: 'arqueada', label: 'Arqueada' },
  { id: 'reta', label: 'Reta' },
];

export const FACIAL_HAIR_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'bigode', label: 'Bigode' },
  { id: 'cavanhaque', label: 'Cavanhaque' },
  { id: 'completa', label: 'Barba Completa' },
  { id: 'longa', label: 'Barba Longa' },
];

export const HEAD_ACCESSORIES: ChoiceOption[] = [
  { id: 'nenhum', label: 'Nenhum' },
  { id: 'elmo', label: 'Elmo' },
  { id: 'chapeu', label: 'Chapéu' },
  { id: 'coroa', label: 'Coroa' },
  { id: 'capuz', label: 'Capuz' },
];

export const SCAR_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'olho', label: 'Sobre o olho' },
  { id: 'bochecha', label: 'Na bochecha' },
  { id: 'queixo', label: 'No queixo' },
];

export const TATTOO_STYLES: ChoiceOption[] = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'braco', label: 'No braço' },
  { id: 'rosto', label: 'No rosto' },
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

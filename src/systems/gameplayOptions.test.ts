import { describe, expect, it } from 'vitest';
import { easeAngle, easeFactor, orbitDragDelta, orbitKeyDelta, wrapAngle } from './cameraControl';
import { autosaveIntervalSeconds, nearestIndex, shouldAutoSalvage, textCharsPerSecond, visibleChars } from './gameplayOptions';
import { cameraFarFor, fogRangeFor, fpsGateAllows, particleScaleFor, pixelRatioFor, shadowMapSizeFor } from './graphicsOptions';

describe('saque automático', () => {
  const collectAll = { lootPickup: 'tudo' as const };
  const salvageCommons = { lootPickup: 'desmontar-comuns' as const };

  it('never auto-salvages with "coletar tudo"', () => {
    expect(shouldAutoSalvage({ rarity: 'verde' }, collectAll)).toBe(false);
  });

  it('only salvages plain Comum drops', () => {
    expect(shouldAutoSalvage({ rarity: 'verde' }, salvageCommons)).toBe(true);
    expect(shouldAutoSalvage({ rarity: 'azul' }, salvageCommons)).toBe(false);
    expect(shouldAutoSalvage({ rarity: 'verde', upgradeLevel: 1 }, salvageCommons)).toBe(false);
    expect(shouldAutoSalvage({ rarity: 'verde', enchantCount: 2 }, salvageCommons)).toBe(false);
    expect(shouldAutoSalvage({ rarity: 'verde', socketedGemId: 'rubi' }, salvageCommons)).toBe(false);
  });
});

describe('alvo automático', () => {
  it('picks the nearest candidate on the XZ plane', () => {
    const from = { x: 0, z: 0 };
    expect(nearestIndex(from, [{ x: 5, z: 0 }, { x: 1, z: 1 }, { x: -3, z: 0 }])).toBe(1);
    expect(nearestIndex(from, [])).toBe(-1);
  });
});

describe('salvamento automático', () => {
  it('converts minutes to seconds (0 = off)', () => {
    expect(autosaveIntervalSeconds(0)).toBe(0);
    expect(autosaveIntervalSeconds(2)).toBe(120);
  });
});

describe('velocidade do texto', () => {
  it('instant shows the whole line immediately', () => {
    expect(visibleChars(40, 0, 'instantaneo')).toBe(40);
    expect(textCharsPerSecond('instantaneo')).toBe(Infinity);
  });

  it('slower speeds reveal progressively and never overshoot', () => {
    expect(textCharsPerSecond('rapido')).toBeGreaterThan(textCharsPerSecond('normal'));
    expect(textCharsPerSecond('normal')).toBeGreaterThan(textCharsPerSecond('lento'));
    expect(visibleChars(100, 0, 'normal')).toBe(0);
    expect(visibleChars(100, 1, 'normal')).toBe(45);
    expect(visibleChars(100, 60, 'lento')).toBe(100);
  });
});

describe('câmera: giro e suavização', () => {
  it('rotate keys turn at a speed scaled by sensitivity, and invert flips them', () => {
    const base = orbitKeyDelta(1, 0.5, 1, false);
    expect(base).toBeGreaterThan(0);
    expect(orbitKeyDelta(1, 0.5, 2, false)).toBeCloseTo(base * 2);
    expect(orbitKeyDelta(1, 0.5, 1, true)).toBeCloseTo(-base);
    expect(orbitKeyDelta(0, 0.5, 1, false)).toBe(0);
  });

  it('mouse drag scales with sensitivity and flips with invert', () => {
    expect(orbitDragDelta(100, 1, false)).toBeCloseTo(-orbitDragDelta(100, 1, true));
    expect(Math.abs(orbitDragDelta(100, 2, false))).toBeCloseTo(Math.abs(orbitDragDelta(100, 1, false)) * 2);
  });

  it('wraps angles into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
  });

  it('eases along the shorter way round, or snaps with smoothing off', () => {
    const next = easeAngle(3, -3, 0.016, true);
    expect(next).toBeGreaterThan(3); // crosses π instead of swinging back through 0
    expect(easeAngle(0, 1, 0.016, false)).toBe(1);
    expect(easeFactor(0.016, 6, false)).toBe(1);
    expect(easeFactor(0.016, 6, true)).toBeLessThan(1);
  });
});

describe('gráficos (pure helpers)', () => {
  it('render scale multiplies the device-capped pixel ratio', () => {
    expect(pixelRatioFor(3, false, 1)).toBe(2);
    expect(pixelRatioFor(3, true, 1)).toBe(1.5);
    expect(pixelRatioFor(2, false, 0.5)).toBe(1);
    expect(pixelRatioFor(1, false, 0.1)).toBe(0.5); // clamped to 50%
  });

  it('maps shadow quality to map size (0 = off)', () => {
    expect(shadowMapSizeFor('off')).toBe(0);
    expect(shadowMapSizeFor('baixa')).toBe(1024);
    expect(shadowMapSizeFor('alta')).toBe(2048);
  });

  it('scales fog with view distance and only culls the far plane on Curta', () => {
    const base = { near: 16, far: 46 };
    expect(fogRangeFor(base, 'media')).toEqual(base);
    expect(fogRangeFor(base, 'curta').far).toBeLessThan(46);
    expect(fogRangeFor(base, 'longa').far).toBeGreaterThan(46);
    expect(cameraFarFor(200, 32, 'curta')).toBe(36);
    expect(cameraFarFor(200, 64, 'longa')).toBe(200);
  });

  it('halves particles on Baixo', () => {
    expect(particleScaleFor('baixo')).toBe(0.5);
    expect(particleScaleFor('alto')).toBe(1);
  });

  it('the FPS limiter draws ~30 of 60 display frames at a 30 cap, all of them at 60 or uncapped', () => {
    const run = (cap: number) => {
      const state = { next: 0 };
      let drawn = 0;
      for (let i = 0; i < 60; i++) if (fpsGateAllows(state, 1000 + i * (1000 / 60), cap)) drawn++;
      return drawn;
    };
    expect(run(30)).toBe(30);
    expect(run(60)).toBe(60);
    expect(run(0)).toBe(60);
  });
});

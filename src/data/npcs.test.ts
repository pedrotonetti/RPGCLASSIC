import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TEMPLATES, getEquipmentTemplate } from './equipment';
import { GEM_DEFINITIONS } from './gems';
import { ITEM_DEFINITIONS } from './items';
import { NPC_DEFINITIONS, type VendorKind } from './npcs';

const vendors = NPC_DEFINITIONS.filter((n) => n.vendor);
function vendorOf(kind: VendorKind) {
  const found = vendors.find((n) => n.vendor!.kind === kind);
  if (!found) throw new Error(`no ${kind} vendor`);
  return found.vendor!;
}

describe('vendor stock matches each vendor\'s own trade', () => {
  it('the apothecary sells consumables only; the jeweler sells gems only', () => {
    const botica = vendorOf('boticario');
    expect(botica.itemIds?.length).toBeGreaterThan(0);
    expect(botica.equipmentTemplateIds ?? []).toEqual([]);
    expect(botica.gemIds ?? []).toEqual([]);
    for (const id of botica.itemIds!) expect(ITEM_DEFINITIONS.some((i) => i.id === id), id).toBe(true);

    const joalheria = vendorOf('joalheiro');
    expect(joalheria.gemIds?.length).toBe(GEM_DEFINITIONS.length);
    expect(joalheria.equipmentTemplateIds ?? []).toEqual([]);
    expect(joalheria.itemIds ?? []).toEqual([]);
  });

  it('the weaver sells body armor only — cloth and leather, never plate', () => {
    const ids = vendorOf('tecelao').equipmentTemplateIds!;
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(getEquipmentTemplate(id).slot, id).toBe('armadura');
    expect(ids).not.toContain('armadura_placas');
  });

  it('the blacksmith sells forged gear only — no woven armor, bows, staves or books', () => {
    const ids = vendorOf('ferreiro').equipmentTemplateIds!;
    for (const woven of ['armadura_couro', 'vestes_arcanas', 'manto_sagrado', 'arco_longo', 'cajado_arcano', 'grimorio_amaldicoado']) {
      expect(ids, woven).not.toContain(woven);
    }
    for (const id of ids) expect(getEquipmentTemplate(id).slot, id).not.toBe('acessorio');
  });

  it('the artisan carries every accessory', () => {
    const ids = vendorOf('artesao').equipmentTemplateIds!;
    for (const t of EQUIPMENT_TEMPLATES.filter((t) => t.slot === 'acessorio')) expect(ids, t.id).toContain(t.id);
  });

  it('splitting the stock left nothing unbuyable: every equipment template is sold by exactly one vendor', () => {
    for (const t of EQUIPMENT_TEMPLATES) {
      const sellers = vendors.filter((n) => n.vendor!.equipmentTemplateIds?.includes(t.id));
      expect(sellers.map((n) => n.id), t.id).toHaveLength(1);
    }
  });
});

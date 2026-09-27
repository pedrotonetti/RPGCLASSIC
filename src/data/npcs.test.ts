import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TEMPLATES, getEquipmentTemplate } from './equipment';
import { GEM_DEFINITIONS } from './gems';
import { ITEM_DEFINITIONS } from './items';
import { dialogueLinesFor, getNpcById, NPC_DEFINITIONS, type VendorKind } from './npcs';

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

describe('Capitã Jussara (Baluarte do Amanhecer) speaks to where the player actually is in the story', () => {
  const jussara = getNpcById('jussara_baluarte');

  it('turns away anyone who hasn\'t reached the story\'s climax yet with her default lines', () => {
    expect(dialogueLinesFor(jussara, ['act3_q8_gathering', null], ['q6_dragon'])).toBe(jussara.dialogue);
  });

  it('asks a post-climax player whose side slot is still busy to come back with their hands free', () => {
    const lines = dialogueLinesFor(jussara, ['nilza_r1_barracas', null], ['act3_q2_confront']);
    expect(lines).not.toBe(jussara.dialogue);
    expect(lines.join(' ')).toContain('mãos livres');
  });

  it('briefs the chain\'s first quest once it\'s been handed out, and closes on its own completed line', () => {
    const r1 = dialogueLinesFor(jussara, [null, 'baluarte_r1_muralha'], ['act3_q2_confront']);
    expect(r1.join(' ')).toContain('muralha');
    const done = dialogueLinesFor(jussara, [null, null], ['act3_q2_confront', 'baluarte_r1_muralha', 'baluarte_r2_batedora', 'baluarte_r3_cisterna']);
    expect(done.join(' ')).toContain('cisterna cheia');
  });
});

describe('faction-reputation dialogue (Dona Ilma / Vigia Talma warm to Pedravale as its reputation grows)', () => {
  const ilma = getNpcById('dona_ilma');
  const talma = getNpcById('vigia_talma');

  it('shows the default (wary/fearful) lines when Pedravale reputation is neutral or omitted entirely', () => {
    expect(dialogueLinesFor(ilma, [null, null], [])).toBe(ilma.dialogue);
    expect(dialogueLinesFor(ilma, [null, null], [], { pedravale: 0 })).toBe(ilma.dialogue);
    expect(dialogueLinesFor(talma, [null, null], [])).toBe(talma.dialogue);
  });

  it('still shows the default lines just below the trust threshold', () => {
    expect(dialogueLinesFor(ilma, [null, null], [], { pedravale: 14 })).toBe(ilma.dialogue);
  });

  it('switches to the warmer lines once Pedravale reputation reaches the threshold', () => {
    const ilmaLines = dialogueLinesFor(ilma, [null, null], [], { pedravale: 15 });
    expect(ilmaLines).not.toBe(ilma.dialogue);
    expect(ilmaLines.join(' ')).toContain('medo');

    const talmaLines = dialogueLinesFor(talma, [null, null], [], { pedravale: 26 });
    expect(talmaLines).not.toBe(talma.dialogue);
  });

  it('never lets a faction the NPC does not care about affect its lines', () => {
    expect(dialogueLinesFor(ilma, [null, null], [], { alguma_outra_faccao: 100 })).toBe(ilma.dialogue);
  });
});

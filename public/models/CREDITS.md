# Third-party 3D assets

Vendored glTF/GLB assets used by this project, with their exact license and
authorship — required for the Creative Commons attribution licenses below.
Keep this file up to date whenever a new model is added under `public/models/`.

## fox.glb

Source: [Khronos Group glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox)
(fetched from `raw.githubusercontent.com`, unmodified).

- © 2014, PixelMannen — model — [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode)
- © 2014, tomkranis — rigging & animation — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode)
- glTF conversion by @AsoboStudio and @scurest

Used in-game as ambient wildlife in the overworld (`OverworldScreen`), driven
by `render/gltfModel.ts`. Animation clips: `Survey` (idle), `Walk`, `Run`.

## characters/Barbarian.glb, Knight.glb, Mage.glb, Rogue.glb

Source: [KayKit — Adventurers Character Pack (1.0)](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)), fetched from
GitHub, unmodified.

- [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode)
  — free for personal/commercial use, no attribution required (credited here
  anyway, per the pack's request).

Each file is a fully rigged, self-contained character (~3.5MB, mostly the
baked-in animation data) with the same 76-clip animation library: `Idle`,
`Walking_A/B/Backwards`, `Running_A/B`, `Running_Strafe_Left/Right`,
`1H_Melee_Attack_*`, `2H_Melee_Attack_*`, `Dualwield_Melee_Attack_*`,
`Unarmed_Melee_Attack_*`, `Block`, `Block_Attack`, `Block_Hit`,
`Dodge_Forward/Backward/Left/Right`, `Hit_A/B`, `Death_A/B`,
`Spellcast_Long/Raise/Shoot`, `1H_Ranged_*`, `2H_Ranged_*`, `Jump_*`, plus
sit/lie/interact/cheer variety animations. Not yet wired into the game as of
this commit — intended to replace/extend the procedural player model in
`render/characterModel.ts` via the existing `render/gltfModel.ts` pipeline
(`loadSkinnedInstance` + `GltfActor`), mapped across the 8 classes (e.g.
Knight → warrior/paladin, Mage → mage/necromancer/cleric, Rogue →
archer/assassin/monk, Barbarian as an alternate/heavier build).

## weapons/*.gltf

Source: same KayKit Adventurers Character Pack as above (the pack's
`Assets/gltf` folder), same license and author. 26 weapon/accessory props
(swords, axes, daggers, staff, wand, crossbow, bow arrows/quiver, shields,
spellbooks, mugs, smokebomb) meant to be attached to a character's hand bone
for the matching class. Not yet wired in.

---

Everything else in the game (enemies, mounts, environment props) is still
built procedurally in code (`render/characterModel.ts`,
`render/worldBuilder.ts`) — no external assets. This file exists so we have
one place tracking license terms as we bring in more real 3D assets.

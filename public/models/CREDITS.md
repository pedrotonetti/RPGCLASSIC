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

---

Everything else in the game (character rigs, enemies, mounts, environment
props) is still built procedurally in code (`render/characterModel.ts`,
`render/worldBuilder.ts`) — no external assets. This file exists so we have
one place tracking license terms as we bring in more real 3D assets.

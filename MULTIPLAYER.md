# Multiplayer — architecture proposal

This is a proposal, not a commitment or a spec to build against yet. No
hosting/service has been chosen, and nothing here should be treated as
already decided. It exists to give a concrete starting point for that
decision, grounded in what the codebase actually looks like today.

## Where the game is today

Everything is static and client-only: TypeScript + Three.js + Vite, built
to a `dist/` folder and served from Vercel or GitHub Pages, with all state
in `localStorage` (`src/systems/SaveSystem.ts`). There is no account system,
no server, and — worth being honest about — nothing stops a player from
editing their own `localStorage` save today (this task's own balance-testing
used a temporary `window.__rpgDebug` hook to do exactly that). Any move
toward a *trusted* shared leaderboard or PvP has to solve that, not just
add networking.

The README's claim that `config/`, `data/`, `entities/`, and `systems/` are
"independent of the graphics engine" is accurate and is the single biggest
asset multiplayer has to build on: `systems/CombatSystem.ts`'s
`CombatEngine` is a plain class with a `tick(dt)` / `useSkill(id, target)`
API that returns a `CombatEvent[]`, no Three.js or DOM in sight. That shape
— intents in, an event log out — is *already* what a server-authoritative
combat loop looks like. That's a rare head start.

The gap: `systems/OverworldCombat.ts` (monster AI, positioning, aggro) is
**not** similarly pure — it imports `three` directly and mutates
`THREE.Group` positions as part of the same class that drives the
`CombatEngine` lifecycle. That's fine for a single-player client and was a
deliberate, reasonable choice (monsters live physically in the world, not
as invisible dice rolls) — but it means "server-authoritative monsters"
isn't free; see below.

## Client/server authority — the actual question

For a real-time action-combat game, the core design decision is: **who
decides whether a hit landed?**

- **Full server authority** (server runs the simulation, clients send
  input and render server-confirmed results): the "correct" answer for
  anything competitive (PvP, a trusted leaderboard, shared boss fights) —
  it's the only model a client can't cheat. It's also the most engineering:
  client-side prediction + server reconciliation to hide latency, lag
  compensation, and a server-side port of monster AI that today lives
  half-in-Three.js.
- **Client authority with a thin server** (each player's own fights stay
  simulated locally, exactly as now; the server only relays state — other
  players' positions, chat, "this monster is now dead for everyone") is
  far cheaper to build and ship first, and is honest about what it is: a
  *shared world*, not yet *trustworthy shared combat*. It's a fine
  foundation as long as nothing built on top of it (a real leaderboard,
  PvP) assumes numbers coming from clients are true.

The recommendation below is a phased path from the second to the first,
rather than picking one up front — see "Phased plan."

## Candidate tech stacks

| Option | Fit | Tradeoffs |
|---|---|---|
| **Custom WebSocket server** (Node + `ws`/`uWebSockets.js`) | Full control; since the game logic is already plain TypeScript, `systems/`, `data/`, `config/`, `entities/` could run **unmodified** inside a Node process | You build room/session lifecycle, interest management, and reconciliation yourself — the most flexible and the most work |
| **[Colyseus](https://colyseus.io/)** | Purpose-built Node.js multiplayer framework: room-based schema state sync, client SDKs, matchmaking. Node/TS-native, so the pure `CombatEngine`/`data/` modules can run inside a Colyseus `Room` with light adaptation | Framework lock-in and a state-schema layer to learn; still a server you run/host yourself (or Colyseus Cloud) |
| **[PartyKit](https://www.partykit.io/)** | Cloudflare-Workers-based (Durable Objects), one "party" per room, TypeScript-native, deploys like the rest of a static site — closest to "no backend today" since there's no server to provision. Good fit if the near-term goal is presence/chat, not authoritative combat | Smaller ecosystem, fewer game-specific primitives than Colyseus (interest management, room lifecycle helpers) — more of it is DIY |
| **Firebase Realtime DB / Firestore** | Not built for sub-100ms real-time combat, but a very fast way to add a **real** leaderboard (replacing the simulated one in `data/leaderboard.ts`) and simple presence ("N players online") with zero server code | Wrong tool for synchronizing live combat ticks; only a fit for the non-combat slice |

Given the "no backend, static hosting" starting point, PartyKit or Colyseus
are the more natural next step than a from-scratch WebSocket server — both
let the *client* stay a static Vite build, adding only a small SDK import,
while the *server* is where the reused game-logic modules would live.
Firebase/Supabase is worth having in parallel for the account/leaderboard
slice regardless of which room framework is picked for real-time play,
since that part isn't a real-time-sync problem at all.

## What carries over vs. what needs rework

**Carries over close to as-is:**
- `config/` (classes, skill formulas, customization catalog) — pure data.
- `data/` (enemies, items, equipment, quests, zones, materials) — pure data.
- `systems/skillMath.ts`, `systems/PowerScore.ts` — pure functions.
- `systems/CombatSystem.ts`'s `CombatEngine` — already shaped like a
  server-side simulation (`tick`/`useSkill` in, `CombatEvent[]` out). This
  is the one piece that could plausibly run on a server almost unchanged.

**Needs real rework:**
- `systems/OverworldCombat.ts` mixes monster simulation (aggro, HP, state
  machine) with direct Three.js mutation of `THREE.Group` positions. A
  server-authoritative shared world needs the simulation half split out
  into something that can run without a renderer (positions/state as plain
  data), with the client-side half becoming a pure "draw whatever the
  server/local sim says" layer. This is the single biggest refactor a
  shared-monsters phase would require.
- `systems/SaveSystem.ts` reads/writes `localStorage` directly, and
  `Player`'s XP/gold/loot are mutated client-side inside `CombatEngine`
  and then persisted locally with nothing to check them. Any trusted
  leaderboard or PvP needs the server to hold canonical `PlayerSaveData`
  and validate state transitions (level-ups, loot rolls) instead of taking
  the client's word — `localStorage` becomes a cache/offline copy at best,
  not the source of truth.
- `entities/Player.ts`'s stat getters (`get stats()`, `get xpToNextLevel()`
  etc.) are fine to reuse server-side, but the class currently has no
  concept of "this is someone else's player, read-only" for rendering
  other people's characters — `render/characterModel.ts`'s
  `buildPlayerCharacter`/`buildHumanCharacter` already take an appearance +
  class-id shape generically, so this is more wiring than rewrite.

**Unaffected by design:**
- `render/`, `screens/`, `engine/Game.ts` stay client-only as they are
  today. Adding multiplayer UI (other players' nameplates, chat, a
  connection-status indicator) is new `screens/OverworldScreen.ts` surface
  area, not a restructuring of what's there — same pattern the recent
  code-splitting work (Task 1) leaned on, where new capability slots in at
  existing seams (`Game.goTo`, per-screen `mount()`) instead of touching
  the render pipeline.

## Rough phased plan

1. **Real leaderboard + presence, no gameplay networking.** Replace
   `data/leaderboard.ts`'s local simulation with a real backend (Firebase/
   Supabase) keyed by a lightweight account (even just a device-bound id
   to start): submit Power Score + level + class on save, show "N players
   online." Zero changes to combat. Smallest possible slice that makes the
   game feel less solitary.
2. **Shared-world presence (cosmetic).** Pick PartyKit or Colyseus, one
   room per zone. Each client broadcasts its own position/animation at a
   low tick rate (~10Hz) and renders other connected players walking
   around the same zone, plus text/emote chat. Monsters and combat stay
   entirely per-client, exactly as today — this phase never touches
   `CombatEngine` or `OverworldCombat`.
3. **Shared world objects.** Promote monster state (alive/dead, position,
   aggro target) to the room server, using the `OverworldCombat` refactor
   described above so a monster one player kills disappears for everyone
   in that zone. Combat resolution can still happen client-side for
   whoever's fighting, with only the outcome reported — loot/XP stay
   individual/instanced. This is the phase that actually needs the
   render/simulation split, not before.
4. **Party play.** Let 2+ players fight the *same* monster together,
   which requires an authoritative combat resolver in the room server —
   at this point porting `CombatEngine` server-side pays off directly:
   clients send `useSkill` intents, the server resolves them and
   broadcasts the same `CombatEvent[]` shape the client already knows how
   to render, just sourced from the network instead of a local `tick()`.
5. **Competitive (PvP, a trustworthy leaderboard).** Once combat is
   server-authoritative for party play, extending it to PvP — and finally
   making the leaderboard resistant to a client lying about its own
   Power Score — is incremental rather than a rewrite.

Each phase ships something a player can feel, and none of them requires
committing to the harder, full-authority combat model before it's actually
needed for competitive play.

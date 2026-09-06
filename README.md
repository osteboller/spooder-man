# GRIB — projektstruktur

Ingen build-step. Bare ES-moduler (`<script type="module">`), så det virker
direkte med VS Code Live Server eller GitHub Pages — samme workflow som
jeres andre projekter.

## Sådan kører du det
Åbn `index.html` via en lokal server (Live Server, eller `python3 -m http.server`).
**Ikke** direkte som `file://` — browsere blokerer ES-modul-imports og
billed-loading over `file://`.

## Spillets to mekanikker

1. **Hop fra greb til greb** — sigte-vinklen roterer af sig selv og power
   bygges op i tre trin; slip for at affyre. Rækkevidden er `v²/g`, altså
   ca. 510 / 970 / 1800px ved power 1 / 2 / 3.
2. **Reb-sving** — kun i luften: træk og slip for at skyde et reb ud i en
   fast 45°-vinkel (kun venstre/højre styres af trækket). Ankeret er et
   usynligt, beregnet punkt over skærmkanten, så rebet er altid ~930px og
   en fuld bue dækker ~1310px vandret. Tryk igen for at slippe, eller træk
   igen midt i svinget for at kaste et nyt reb uden at miste fart.

## Struktur

- `index.html` — kun markup + canvas, ingen spillogik.
- `styles/style.css` — HUD-chips, besked-overlay, layout.
- `src/main.js` — startpunkt: loader assets, binder input, starter loopet.
- `src/assets.js` — ét sted at registrere alle billeder (`ASSET_MANIFEST`) + preloader.
- `src/camera.js` — kamera-position/zoom → skærm-koordinater (`toScreen`).
- `src/physics.js` — tyngdekraft + bane-simulation.
- `src/level.js` — genererer grib-punkter (start, checkpoints, mål) samt fjender.
- `src/animator.js` — generisk sprite-strip-afspiller. Kan både køre på tid
  (`frameDuration`) og drives udefra af en 0-1-værdi (`setFrameByPhase`), som
  sving-animationerne bruger til at følge rebets faktiske vinkel.
- `src/player.js` — klip-definitioner (`PLAYER_CLIPS`), animations-state, tegning.
- `src/background.js` — vælger og scroller én af by-baggrundene med parallax.
- `src/audio.js` — syntetiserede placeholder-SFX via Web Audio + loopet baggrundsmusik.
- `src/ui.js` — DOM-baserede HUD-chips (score, tid, liv) og besked-overlay.
- `src/input.js` — mus/touch/mellemrum → tryk/slip, inkl. træk-afstand til reb-kast.
- `src/game.js` — state machine der samler det hele (`idle → charging → flying ↔ swinging → dead/won`).

## Assets

- `assets/sprites/player_*.png` — ét klip per fil, vandret strip med kvadratiske
  frames. Frame-størrelse og -antal læses automatisk ud af billedet, så du kan
  bruge hvilken opløsning du vil. Klip: `idle`, `windup`, `roll`, `grab`,
  `attack`, `hurt`, `swing1`, `swing2`, `swing_turn`, `swing_stop`.
- `assets/sprites/enemy.png` — pladsholder, se planerne nedenfor.
- `assets/backgrounds/*.png` — by-baggrunde til banerne + `Titlescreen background.png`.
  Tilføj flere ved at droppe dem her og udvide `BACKGROUND_KEYS` i
  `background.js` + `ASSET_MANIFEST` i `assets.js`.
- `assets/audio/bgm/*.mp3` — baggrundsmusik. `audio.js` peger lige nu fast på
  ét nummer (`BGM_TRACK`).

---

# Planer / næste skridt

## 1. Titlescreen + menu (SNES/Megadrive-stil)

En klassisk startskærm før spillet går i gang, med `Titlescreen background.png`
som baggrund:

- **Titelskærm** med credits.
- **Sværhedsgrad**: Easy / Normal / Hard.
- **SFX on/off** og **Musik on/off** som toggles.
- **Start**-knap.

**Sværhedsgrad — hvad den skal styre.** Antal liv er givet (`MAX_LIVES`
i `game.js`, lige nu fast 3). Til den anden akse er der allerede knapper der
kunne bindes op på den, hvis en af dem lyder rigtig:

| Kandidat | Konstant | Effekt |
|---|---|---|
| Antal fjender | `generateEnemies(nodes, count)` | flere/færre fjender på banen |
| Hvor hårdt fjender rammer | `ENEMY_HIT_MARGIN` / `PUNCH_RANGE` | deres rækkevidde vs. din |
| Lande-tolerance | `LAND_FORGIVENESS` | hvor præcist man skal ramme et greb |
| Reb som begrænset ressource | *(ny)* | fx kun X reb per bane — var oprindeligt tænkt som en senere mekanik |
| Bane-længde | `waves` i `generateLevel()` | kortere/længere kurs |

**Sådan hænger det teknisk sammen.** Menuen bør være sit eget modul
(`src/menu.js`) plus et lille scene-skift i `main.js` — den behøver ikke ligge
inde i `game.js`. `createGame()` skal til gengæld kunne tage imod indstillinger
(liv, SFX til/fra, musik til/fra) i stedet for at læse `MAX_LIVES` som konstant,
og `audio.js` skal have et par flag der kan slå henholdsvis `playSfx()` og
`startBgm()` fra.

## 2. Fjender må ikke spawne oven i et greb

`generateEnemies()` i `level.js` placerer en fjende midtvejs mellem to
naboknuder (`t = 0.45–0.55`). Med de nye, meget længere baner kan den
midtvejsposition lande oven i et *tredje* greb, som ikke er en af de to den
regner ud fra — så man bliver ramt i samme øjeblik man lander.

Målt over 500 genererede baner (1000 fjender), hvor hele fjendens bobbe-interval
tælles med: **7,6% overlapper direkte et greb**, og **11,9% er inden for en
spillerbredde af et**. Med to fjender per bane betyder det omkring hver syvende
bane har mindst ét dårligt spawn.

**Regel der skal ind**: efter en kandidatposition er valgt, tjek afstanden til
*alle* knuder, ikke kun de to i gapet, og kassér/flyt positionen hvis den er
tættere end fx `node.r + fjendens radius + luft`. Husk at fjender bobber
lodret (`amplitude` 45-75px), så tjekket bør bruge hele bobbe-intervallet og
ikke bare `baseY`.

Custom sprites til fjender mangler stadig — `enemy.png` er pladsholder.

## 3. Refaktorering af `game.js`

Filen er vokset til **868 linjer**, altså 56% af hele kodebasen (1541 linjer i
alt). To ting stikker ud:

- `update()` er **268 linjer** i én funktion (linje 360-627). Den laver timing,
  hitstop, sigte-opladning, animations-kæder, flugt- og svingfysik, reb-clamp,
  fjende-kollision, lande- og dødstjek, kamera-fokus og zoom.
- Tegne-koden fylder **214 linjer** (linje 628-841) og er allerede en naturligt
  adskilt gruppe: den læser kun state, den ændrer ingenting.

**Anbefalet rækkefølge**, mindst risiko først:

1. **Træk tegningen ud** til `src/render.js`. Alle `draw*`-funktionerne er
   read-only og rører kun `ctx`, `cam` og state — de kan flyttes uden at
   ændre nogen opførsel. Det alene halverer `game.js`.
2. **Træk reb-mekanikken ud** til `src/rope.js`: `maybeCastRope`, `releaseRope`,
   `swapRope`, selve clamp-fysikken og sving-animationens fase-styring, plus de
   `SWING_*`/`ROPE_*`-konstanter der kun bruges der. Det er en sammenhængende
   enhed på ca. 200 linjer.
3. **Del `update()` op** i navngivne trin (`updateAim`, `updateFlight`,
   `updateCamera`), så den lange blok bliver til et kort overblik.

**Forhindringen** er at alt lige nu deler mutérbar state inde i én closure
(`state`, `flight`, `cam`, `anim`, `swingSlot`…). En opsplitning kræver enten at
sende et fælles kontekst-objekt rundt, eller at lave `createGame` om til et
objekt med felter. Det er mekanisk, men det rører mange linjer.

**Timing**: punkt 1 kan tages når som helst — det er ren flytning uden
adfærdsændring. Punkt 2 og 3 er lettere at lave *efter* menuen, fordi menuen
alligevel lægger et scene-lag ovenpå og dermed flytter på grænsefladen til
`game.js`.

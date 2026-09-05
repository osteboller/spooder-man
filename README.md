# GRIB — projektstruktur

Ingen build-step. Bare ES-moduler (`<script type="module">`), så det virker
direkte med VS Code Live Server eller GitHub Pages — samme workflow som
jeres andre projekter.

## Sådan kører du det
Åbn `index.html` via en lokal server (Live Server, eller `python3 -m http.server`).
**Ikke** direkte som `file://` — browsere blokerer ES-modul-imports og
billed-loading over `file://`.

## Struktur

- `index.html` — kun markup + canvas, ingen spillogik.
- `styles/style.css` — HUD-chip, besked-overlay, layout.
- `src/main.js` — starter punkt: loader assets, binder input, starter loopet.
- `src/assets.js` — ét sted at registrere alle billeder (`ASSET_MANIFEST`) + preloader.
- `src/camera.js` — kamera-position/zoom → skærm-koordinater (`toScreen`).
- `src/physics.js` — tyngdekraft + bane-simulation.
- `src/level.js` — genererer grib-punkter (start, checkpoints, mål).
- `src/player.js` — sprite-sheet-konstanter, animations-state, tegning.
- `src/background.js` — vælger og scroller én af by-baggrundene med parallax.
- `src/audio.js` — syntetiserede placeholder-lyde via Web Audio (ingen lydfiler endnu).
- `src/ui.js` — DOM-baseret point-chip og besked-overlay.
- `src/input.js` — mus/touch/mellemrum → tryk/slip.
- `src/game.js` — state machine der samler det hele (svarer til hele den gamle `<script>`-blok).

## Assets

- `assets/sprites/player.png` — pladsholder-sprite-ark (idle, 8 spin-frames, fald). Udskift med rigtig Aseprite-eksport i samme grid (64×64 pr. frame).
- `assets/backgrounds/*.png` — de tre by-baggrunde. Tilføj flere ved at droppe dem her og udvide `BACKGROUND_KEYS` i `background.js` + `ASSET_MANIFEST` i `assets.js`.

## Lyd — næste skridt

`audio.js` bruger lige nu syntetiserede "bip"-lyde, så der ikke kræves
eksterne lydfiler for at spillet virker. Når I har rigtige SFX/musik:
læg dem i `assets/audio/`, tilføj dem til `ASSET_MANIFEST`, og udskift
kroppen af `playSfx()` med `new Audio(...)`/`AudioBufferSourceNode`-afspilning.
Kaldene fra `game.js` (`playSfx('launch')` osv.) skal ikke ændres.

## Point-overlay

Allerede DOM-baseret (`#hud` chip + `#msg`), styret via `ui.js`. For at
tilføje fx et højeste-score-tal: føj et element til `index.html`, en
`setBest()`-funktion til `ui.js`, og kald den fra `game.js` hvor `landSuccess`
opdaterer scoren.

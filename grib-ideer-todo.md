# GRIB — idéer / TODO (brainstorm)

Samlet fra brainstorm-session. Ikke prioriteret indbyrdes ud over grupperingen — se noter under hvert punkt for afhængigheder.

## Attack
- [ ] Kort frys/QTE-vindue når fjenden går fra "warn" til "engaged" — genbrug `ENEMY_WARN_MARGIN`/`e.engaged` fra `enemy.js`/`game.js` som trigger. Tryk i vinduet = hit, intet tryk = kollision.
- [ ] Attack-animation skal variere efter retning: oppefra, nedefra, samme plan (sprites findes allerede) — vælges ud fra relativ vinkel mellem spiller og fjende når hittet resolves.

## Skade & liv
- [ ] Kollision med fjende skal ikke automatisk koste et helt liv.
- [ ] Rammer man en fjende *mens man svinger i reb*, skal man miste grebet/rebet i stedet for et liv.
- [ ] Rebet skal **knække** ved et hit — anden visuel/lyd end normal, rolig release.
- [ ] Åbent spørgsmål: skal der være et kort usårligheds-vindue lige efter et tvunget slip, så man ikke straks rammer samme fjende igen på vej ned?

## Web/reb som ressource
- [ ] Spider-Man-stil HUD: lodret bar (ladning i nuværende kapsel) + `xN`-tal (antal kapsler).
- [ ] Hver kapsel = 10 ladninger, hvert rebkast koster 1 ladning.
- [ ] Kapsel tom → skift til næste kapsel (bar fylder til 10 igen), kapsel-tal falder med 1.
- [ ] Løber man helt tør (0 kapsler, 0 ladning): kan ikke kaste reb, kun hoppe, indtil pickup.
- [ ] Ny pickup: web-kapsel, giver +1 kapsel.
- [ ] Antagelse (ikke endeligt bekræftet): at hoppe forbliver frit/ubegrænset uanset web-status.

## Andre pickups
- [ ] Midlertidig 2x score-buff (tidsbegrænset).
- [ ] 1-up (ekstra liv) — sprite mangler stadig.

## Bane/level-struktur
- [ ] Større bane generelt: mere plads vertikalt og horisontalt.
- [ ] Mere naturligt skift mellem baner + en run-opsummering (point m.m.) efter et run — hænger sammen med den eksisterende titlescreen/menu-plan fra README'en. Overvej en rigtig scene-manager frem for at bolte det på separat.
- [ ] **Win-screen** som sit eget, adskilt fra den funktionelle run-opsummering: score-reveal (tal der tæller op), evt. stjerner/rating, "juicy" pause der føles som en belønning, før man går videre til næste bane.

## Fjender
- [ ] Større flyvende fjende sat på pause — mangler sprite, nok reelt tiltænkt som en boss-type senere, ikke en almindelig forhindring.

## Miljø
- [ ] Fortov forbliver rent visuelt/atmosfærisk, ikke en landbar flade — undgår at åbne en helt ny "sikker grund"-mekanik. Nuværende tileset (med fortov, stor variation, mange stemninger) kan blive ved med at være bagtæppe uden at blive spil-mekanik.
- [ ] Overvej at udfase de 4 rippede SNES-baggrunde — færre bygningstyper (~5 i alt) og mulig opløsnings-mismatch mod resten af sættet (se note nedenfor). Vejes op mod at de æstetisk er flotte og tiler sømløst.
- [ ] Baggrunds-opløsning: `scaleFor()` i `background.js` skalerer med heltal ud fra `canvasH / img.height` per baggrund — blandede kildehøjder (fx 256 vs. 512 vs. 600px) kan give forskellig "pixel-tæthed"/chunkiness mellem baner selvom tiling forbliver sømløs. Tjek ved at sammenligne eksporter side om side i samme zoom.

## UI/options
- [ ] Options-overlay skal revampes: for lille nu, skal dække næsten hele spilvinduet.
- [ ] Options-grafikken rammes formentlig utilsigtet af samme "dæmpningseffekt" som resten af spillet, mens spillet er pauset — det har aldrig været meningen og skal fikses.

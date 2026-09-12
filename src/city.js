import { ANCHOR_X } from './camera.js';

// The street-level city: buildings stitched edge to edge along a continuous
// sidewalk, drawn in the SAME plane as the grips (parallax 1.0, so they move
// exactly with the world) and behind everything you interact with. It's
// scenery the course stands in, not a layer in front of it.
//
// A theme is one landmark, a pool of buildings, and one sidewalk tile. Each
// course lays out: the landmark once at the start, then buildings drawn at
// random from the pool, each placed flush against the previous one's right
// edge until the row runs past the goal.
//
// What the art has to satisfy — there is no measuring step any more, these
// are simply assumed:
//   1. A building PNG's FULL width is its footprint. Any transparent columns
//      at its edges are deliberate spacing (a gap, a fence, an alley) and are
//      kept — the art decides how far apart buildings stand, not the code.
//   2. Its bottom pixel row is street level: every building is anchored so
//      that row sits on the sidewalk, which is what lets heights vary freely
//      without ever moving the pavement line.
//   3. The sidewalk tile repeats along the whole street, gaps included, so it
//      has to tile against itself horizontally. It's the only tiling rule.
//   4. Everything in a theme shares one native pixel scale (the 16px grid the
//      art is built on) — one SCALE below serves the whole set.
// `landmark` is optional — a theme without one simply opens on a pool
// building. The first three courses step through these in order (see
// pickCityTheme), so a, b, c is the sequence a new player sees.
export const CITY_THEMES = [
  { // Red brick, dark blue stone, night — the Daily Bugle's street.
    key: 'a',
    landmark: 'bldgBugle',
    buildings: ['bldgA1', 'bldgA2', 'bldgA3', 'bldgA4', 'bldgA5', 'bldgA6'],
    sidewalk: 'sidewalkA',
  },
  { // Bright red brick, grey stone, gargoyles over the windows — daylight.
    key: 'b',
    buildings: ['bldgB1', 'bldgB2', 'bldgB3', 'bldgB4'],
    sidewalk: 'sidewalkB',
  },
  { // Olive brick, grey trim, fire escapes — muted.
    key: 'c',
    buildings: ['bldgC1', 'bldgC2', 'bldgC3', 'bldgC4', 'bldgC5'],
    sidewalk: 'sidewalkC',
  },
];

// World px per source px — the knob that decides how much of the view the
// buildings take up. Strict pixel parity with the player works out to 3.125
// (PLAYER_DISPLAY_SIZE 400 over a 128px frame); lower values leave more of the
// parallax skyline visible above the rooflines.
const SCALE = 3.8;
// 1.0 = exactly the world's own scroll rate, which is what puts the buildings
// on the same plane as the grips. Raising it would make them slide past faster
// and read as closer to the camera than the course itself.
const PARALLAX_X = 1.0;
// World px of street laid out before the first grip and after the goal, so
// the row already fills the screen at the start and never runs out at the end.
const LEAD_IN = 1200;
const TAIL_OUT = 1600;
// City blocks: a run of buildings, then an empty stretch of sidewalk (sky
// above) before the next run — the cross-streets that break up a New York
// avenue. The landmark counts as the first building of the first block. The
// gap is measured in sidewalk tiles so it always lands on the tile grid.
const BLOCK_MIN = 3, BLOCK_MAX = 5;   // buildings per block
const GAP_TILES_MIN = 2, GAP_TILES_MAX = 3;

function wrap(v, m){
  return ((v % m) + m) % m;
}

// One course picks one theme. Same fixed-order-then-random shape as
// pickBackground, so every theme gets seen before anything repeats. The key
// is what pickBackground filters against (a background can name themes it
// must not appear behind).
export function pickCityTheme(cycleIndex){
  return cycleIndex < CITY_THEMES.length
    ? CITY_THEMES[cycleIndex]
    : CITY_THEMES[Math.floor(Math.random() * CITY_THEMES.length)];
}

// The very bottom of the sidewalk — the absolute floor of the visible world.
// The camera clamps against this so nothing below the pavement is ever shown.
export function cityBottomY(city){
  if(!city) return Infinity;
  return city.streetY + city.sidewalk.height * SCALE;
}

// Laid out once, when the course is generated, so the street stays put across a
// mid-course respawn instead of reshuffling under the player.
export function generateCity(nodes, streetY, images, theme){
  const pool = theme.buildings.map(k => images[k]).filter(Boolean);
  const sidewalk = images[theme.sidewalk];
  const landmark = theme.landmark ? images[theme.landmark] : null;
  if(!pool.length || !sidewalk) return null;

  const from = nodes[0].x * PARALLAX_X - LEAD_IN;
  const to = nodes[nodes.length - 1].x * PARALLAX_X + TAIL_OUT;

  const placed = [];
  let x = from;
  let maxH = 0;
  const place = (img) => {
    placed.push({ img, x });
    x += img.width * SCALE;
    if(img.height > maxH) maxH = img.height;
  };

  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  // The landmark opens the street, exactly once, as the first building of the
  // first block.
  let inBlock = 0;
  let blockLen = randInt(BLOCK_MIN, BLOCK_MAX);
  if(landmark){ place(landmark); inBlock = 1; }

  // Then the pool, at random — never the same building twice in a row, which
  // is the one repeat that's actually noticeable — with a cross-street gap
  // once each block has run its length. The gap is inserted just BEFORE the
  // next building rather than after the last, so a block can never end the
  // row on empty pavement.
  let prev = null;
  while(x < to){
    if(inBlock >= blockLen){
      x += randInt(GAP_TILES_MIN, GAP_TILES_MAX) * sidewalk.width * SCALE;
      inBlock = 0;
      blockLen = randInt(BLOCK_MIN, BLOCK_MAX);
    }
    let img;
    do { img = pool[Math.floor(Math.random() * pool.length)]; }
    while(img === prev && pool.length > 1);
    place(img);
    inBlock++;
    prev = img;
  }

  return { streetY, placed, sidewalk, maxH, themeKey: theme.key };
}

export function drawCity(ctx, city, cam, canvasW, canvasH){
  if(!city) return;

  const s = SCALE * cam.zoom; // source px -> screen px
  const streetY = (city.streetY - cam.y) * cam.zoom + canvasH / 2;
  // Nothing to do while even the tallest building's roof is still below the
  // view, which is most of the time — the cheap early-out that keeps this
  // layer close to free.
  if(streetY - city.maxH * s > canvasH) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Everything rides the same transform, so the sidewalk can't drift against
  // the buildings standing on it.
  const base = -cam.x * PARALLAX_X * cam.zoom + canvasW * ANCHOR_X;

  const sw = city.sidewalk;
  const walkW = sw.width * s, walkH = sw.height * s;
  for(let x = wrap(base, walkW) - walkW; x < canvasW; x += walkW){
    ctx.drawImage(sw, Math.round(x), Math.round(streetY), Math.ceil(walkW), Math.ceil(walkH));
  }

  // Each building's on-screen right edge is computed as the NEXT building's
  // rounded left edge, rather than rounding its own width. Rounding the two
  // independently leaves a hairline gap or overlap wherever they disagree by a
  // pixel, and with flush stitching every seam is such a spot.
  for(let i = 0; i < city.placed.length; i++){
    const p = city.placed[i];
    const x = base + p.x * cam.zoom;
    const xRight = base + (p.x + p.img.width * SCALE) * cam.zoom;
    if(xRight < 0 || x > canvasW) continue;
    const left = Math.round(x);
    const w = Math.round(xRight) - left;
    const h = p.img.height * s;
    ctx.drawImage(p.img, left, Math.round(streetY - h), w, Math.ceil(h));
  }

  ctx.restore();
}

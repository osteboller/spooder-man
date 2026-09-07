import { ANCHOR_X } from './camera.js';

// The street-level city: buildings standing on a continuous sidewalk, drawn in
// the SAME plane as the grips (parallax 1.0, so they move exactly with the
// world) and behind everything you interact with. It's scenery the course
// stands in, not a layer in front of it.
//
// The source sheet is one strip, but its two halves want opposite treatment —
// the sidewalk has to run unbroken along the whole street while the buildings
// need gaps of sky between them — so they're drawn from two separate source
// rects of the same image instead of being placed as one unit. Both rects land
// on the art's own 32px grid, so nothing gets cut mid-tile.
export const BLOCK_SRC = { x: 32, y: 64, w: 640, h: 416 };
export const WALK_SRC = { x: 0, y: 480, w: 672, h: 80 };

// World px per source px — the one knob that decides how much of the view the
// buildings take up. Strict pixel parity with the player would be 3.125
// (PLAYER_DISPLAY_SIZE 400 over a 128px frame); 2.0 keeps the rooflines low
// enough that the parallax skyline still shows above them.
const SCALE = 2.0;
// 1.0 = exactly the world's own scroll rate, which is what puts the buildings
// on the same plane as the grips. Raising it would make them slide past faster
// and read as closer to the camera than the course itself.
const PARALLAX_X = 1.0;
const GAP_MIN = 400, GAP_MAX = 1600; // world px of sky between blocks

function wrap(v, m){
  return ((v % m) + m) % m;
}

// The very bottom of the sidewalk — the absolute floor of the visible world.
// The camera clamps against this so nothing below the pavement is ever shown.
export function cityBottomY(city){
  return city ? city.streetY + WALK_SRC.h * SCALE : Infinity;
}

// Laid out once, when the course is generated, so the street stays put across a
// mid-course respawn instead of reshuffling under the player.
export function generateCity(nodes, streetY){
  const blockW = BLOCK_SRC.w * SCALE;
  const from = nodes[0].x * PARALLAX_X - blockW * 2;
  const to = nodes[nodes.length - 1].x * PARALLAX_X + blockW * 2;

  const blocks = [];
  for(let x = from; x < to; x += blockW + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)){
    blocks.push({ x });
  }
  return { streetY, blocks };
}

export function drawCity(ctx, img, city, cam, canvasW, canvasH){
  if(!img || !city) return;

  const s = SCALE * cam.zoom; // source px -> screen px
  const streetY = (city.streetY - cam.y) * cam.zoom + canvasH / 2;
  const blockH = BLOCK_SRC.h * s;
  // Nothing to do while the whole street is still below the view, which is most
  // of the time — the cheap early-out that keeps this layer close to free.
  if(streetY - blockH > canvasH) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Everything rides the same transform, so the sidewalk can't drift against
  // the buildings standing on it.
  const base = -cam.x * PARALLAX_X * cam.zoom + canvasW * ANCHOR_X;

  const walkW = WALK_SRC.w * s, walkH = WALK_SRC.h * s;
  for(let x = wrap(base, walkW) - walkW; x < canvasW; x += walkW){
    ctx.drawImage(
      img, WALK_SRC.x, WALK_SRC.y, WALK_SRC.w, WALK_SRC.h,
      Math.round(x), Math.round(streetY), Math.ceil(walkW), Math.ceil(walkH)
    );
  }

  const blockW = BLOCK_SRC.w * s;
  for(const b of city.blocks){
    const x = base + b.x * cam.zoom;
    if(x + blockW < 0 || x > canvasW) continue;
    ctx.drawImage(
      img, BLOCK_SRC.x, BLOCK_SRC.y, BLOCK_SRC.w, BLOCK_SRC.h,
      Math.round(x), Math.round(streetY - blockH), Math.ceil(blockW), Math.ceil(blockH)
    );
  }

  ctx.restore();
}

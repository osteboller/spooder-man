import { ANCHOR_X } from './camera.js';

// The street-level city block layer, drawn IN FRONT of everything else.
//
// The source sheet is one strip: buildings standing on a continuous sidewalk.
// Those two halves need opposite treatment — the sidewalk has to run unbroken
// along the whole street, while the buildings want gaps of sky between them —
// so they're drawn from two separate source rects of the same image instead of
// being placed as one unit. Both rects land on the 32px grid the art is built
// on (640x416 and 672x80), so nothing gets cut mid-tile.
export const BLOCK_SRC = { x: 32, y: 64, w: 640, h: 416 };
export const WALK_SRC = { x: 0, y: 480, w: 672, h: 80 };

// World px per source px, and the one knob worth touching here: it decides how
// much of the screen the buildings take up.
//
// Strict pixel parity with the player would be 3.125 (PLAYER_DISPLAY_SIZE 400
// over a 128px frame), which is also about what the background works out to.
// But at 3.125 a block is 1300 world px tall against a play band of only ±620,
// which puts the roofline ABOVE the middle of the course — the buildings then
// never leave the screen and sit permanently faded over the play area. 2.0
// trades some of that pixel-size match for a layer that behaves like a
// foreground: rooftops along the bottom edge in normal play, full buildings
// only once you drop toward the street.
const SCALE = 2.0;
// Above 1 so the layer slides past faster than the world does. That speed
// difference is the whole reason it reads as "close to the camera" rather than
// as part of the level.
const PARALLAX_X = 1.2;
const GAP_MIN = 400, GAP_MAX = 1600; // world px of sky between blocks

// The layer sits at the death floor, so normally the player is far above it and
// it isn't even on screen. Dive down into it, though, and a solid wall of
// building would hide them at the worst possible moment — so it fades back once
// they drop below the roofline instead of swallowing them.
const FADE_OVER = 420;
const MIN_ALPHA = 0.4;

function wrap(v, m){
  return ((v % m) + m) % m;
}

// Lays out the blocks once, when the course is generated, so they stay put
// across a mid-course respawn instead of reshuffling under the player.
export function generateForeground(nodes, streetY){
  const blockW = BLOCK_SRC.w * SCALE;
  // The layer is scrolled by cam.x * PARALLAX_X, so it has to be laid out
  // across that stretched range rather than the course's own width — at 1.2
  // it runs out a fifth of a course early otherwise.
  const from = nodes[0].x * PARALLAX_X - blockW * 2;
  const to = nodes[nodes.length - 1].x * PARALLAX_X + blockW * 2;

  const blocks = [];
  for(let x = from; x < to; x += blockW + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)){
    blocks.push({ x });
  }
  return { streetY, blocks };
}

export function drawForeground(ctx, img, fg, cam, canvasW, canvasH, playerY){
  if(!img || !fg) return;

  const s = SCALE * cam.zoom; // source px -> screen px
  const streetY = (fg.streetY - cam.y) * cam.zoom + canvasH / 2;
  const blockH = BLOCK_SRC.h * s;
  // Nothing to do when the whole street is still below the view, which is most
  // of the time — this is the cheap early-out that keeps the layer free.
  if(streetY - blockH > canvasH) return;

  const roofY = fg.streetY - BLOCK_SRC.h * SCALE;
  let alpha = 1;
  if(playerY != null && playerY > roofY){
    alpha = 1 - (1 - MIN_ALPHA) * Math.min(1, (playerY - roofY) / FADE_OVER);
  }

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;

  // Everything rides the same transform as the blocks below, so the sidewalk
  // can't drift against the buildings standing on it.
  const base = -cam.x * PARALLAX_X * cam.zoom + canvasW * ANCHOR_X;

  const walkW = WALK_SRC.w * s, walkH = WALK_SRC.h * s;
  for(let x = wrap(base, walkW) - walkW; x < canvasW; x += walkW){
    ctx.drawImage(
      img, WALK_SRC.x, WALK_SRC.y, WALK_SRC.w, WALK_SRC.h,
      Math.round(x), Math.round(streetY), Math.ceil(walkW), Math.ceil(walkH)
    );
  }

  const blockW = BLOCK_SRC.w * s;
  for(const b of fg.blocks){
    const x = base + b.x * cam.zoom;
    if(x + blockW < 0 || x > canvasW) continue;
    ctx.drawImage(
      img, BLOCK_SRC.x, BLOCK_SRC.y, BLOCK_SRC.w, BLOCK_SRC.h,
      Math.round(x), Math.round(streetY - blockH), Math.ceil(blockW), Math.ceil(blockH)
    );
  }

  ctx.restore();
}

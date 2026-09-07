import { ANCHOR_X } from './camera.js';

// The street-level city: buildings standing on a continuous sidewalk, drawn in
// the SAME plane as the grips (parallax 1.0, so they move exactly with the
// world) and behind everything you interact with. It's scenery the course
// stands in, not a layer in front of it.
//
// Sheets are measured rather than hard-coded (see measureSheet), so a variant
// can be any size with any number of buildings. The only rules a sheet has to
// follow are the ones the measurement relies on:
//   1. Buildings on top, separated by fully transparent gaps.
//   2. One unbroken band of full-width opaque pixels at the bottom = sidewalk.
//   3. That band has to tile against itself, since it repeats along the street.
export const CITY_SHEET_KEYS = ['cityBlock', 'cityEvening'];

// World px per source px — the knob that decides how much of the view the
// buildings take up. Strict pixel parity with the player works out to 3.125
// (PLAYER_DISPLAY_SIZE 400 over a 128px frame); lower values leave more of the
// parallax skyline visible above the rooflines.
const SCALE = 3.8;
// 1.0 = exactly the world's own scroll rate, which is what puts the buildings
// on the same plane as the grips. Raising it would make them slide past faster
// and read as closer to the camera than the course itself.
const PARALLAX_X = 1.0;
const GAP_MIN = 400, GAP_MAX = 1600; // world px of sky between blocks

function wrap(v, m){
  return ((v % m) + m) % m;
}

// One course picks one sheet. Same fixed-order-then-random shape as
// pickBackground, so every variant gets seen before anything repeats.
// Returns the key alongside the image: the course picks its street first, and
// pickBackground needs the key to filter out skylines that don't belong behind
// it.
export function pickCitySheet(images, cycleIndex){
  const key = cycleIndex < CITY_SHEET_KEYS.length
    ? CITY_SHEET_KEYS[cycleIndex]
    : CITY_SHEET_KEYS[Math.floor(Math.random() * CITY_SHEET_KEYS.length)];
  return { key, img: images[key] };
}

// Reads the two source rects straight off the art. Hard-coding them meant every
// new sheet had to be pixel-identical to the first one; measuring means a
// variant just has to follow the convention above.
function measureSheet(img){
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, img.width, img.height);

  const W = img.width, H = img.height;
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];
  const rowIsFull = (y) => {
    for(let x = 0; x < W; x++) if(alphaAt(x, y) === 0) return false;
    return true;
  };

  // Sidewalk: walk UP from the bottom edge for as long as rows stay full width.
  // Scanning down from the top for the first full row would instead stop at any
  // building wide enough to span the sheet.
  let walkTop = H;
  while(walkTop > 0 && rowIsFull(walkTop - 1)) walkTop--;
  const walk = walkTop < H ? { x: 0, y: walkTop, w: W, h: H - walkTop } : null;

  // Buildings: the opaque bounding box of everything above the sidewalk. Taken
  // as one rect on purpose — the buildings on a sheet can be joined by a fire
  // escape or an awning, so slicing them apart would cut those in half.
  let minX = W, minY = walkTop, maxX = -1, maxY = -1;
  for(let y = 0; y < walkTop; y++){
    for(let x = 0; x < W; x++){
      if(alphaAt(x, y) === 0) continue;
      if(x < minX) minX = x;
      if(x > maxX) maxX = x;
      if(y < minY) minY = y;
      if(y > maxY) maxY = y;
    }
  }
  if(maxX < 0) return null; // nothing above the band — not a city sheet
  return { block: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, walk };
}

const sliceCache = new WeakMap();

function sliceSheet(img){
  const cached = sliceCache.get(img);
  if(cached) return cached;

  let slice = null;
  try{
    slice = measureSheet(img);
  } catch(e){
    // getImageData throws on a tainted canvas — which is what you get opening
    // the game over file:// instead of a local server. Not worth failing over.
    console.warn('Could not measure city sheet, using it whole:', e);
  }
  // Fall back to treating the sheet as one block with no separate sidewalk,
  // which still draws something sensible rather than nothing.
  if(!slice) slice = { block: { x: 0, y: 0, w: img.width, h: img.height }, walk: null };

  sliceCache.set(img, slice);
  return slice;
}

// The very bottom of the sidewalk — the absolute floor of the visible world.
// The camera clamps against this so nothing below the pavement is ever shown.
export function cityBottomY(city){
  if(!city) return Infinity;
  return city.streetY + (city.walk ? city.walk.h * SCALE : 0);
}

// Laid out once, when the course is generated, so the street stays put across a
// mid-course respawn instead of reshuffling under the player.
export function generateCity(nodes, streetY, img){
  if(!img) return null;
  const { block, walk } = sliceSheet(img);
  const blockW = block.w * SCALE;

  const from = nodes[0].x * PARALLAX_X - blockW * 2;
  const to = nodes[nodes.length - 1].x * PARALLAX_X + blockW * 2;

  const blocks = [];
  for(let x = from; x < to; x += blockW + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)){
    blocks.push({ x });
  }
  return { streetY, blocks, img, block, walk };
}

export function drawCity(ctx, city, cam, canvasW, canvasH){
  if(!city || !city.img) return;

  const s = SCALE * cam.zoom; // source px -> screen px
  const streetY = (city.streetY - cam.y) * cam.zoom + canvasH / 2;
  const blockH = city.block.h * s;
  // Nothing to do while the whole street is still below the view, which is most
  // of the time — the cheap early-out that keeps this layer close to free.
  if(streetY - blockH > canvasH) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Everything rides the same transform, so the sidewalk can't drift against
  // the buildings standing on it.
  const base = -cam.x * PARALLAX_X * cam.zoom + canvasW * ANCHOR_X;

  if(city.walk){
    const walkW = city.walk.w * s, walkH = city.walk.h * s;
    for(let x = wrap(base, walkW) - walkW; x < canvasW; x += walkW){
      ctx.drawImage(
        city.img, city.walk.x, city.walk.y, city.walk.w, city.walk.h,
        Math.round(x), Math.round(streetY), Math.ceil(walkW), Math.ceil(walkH)
      );
    }
  }

  const blockW = city.block.w * s;
  for(const b of city.blocks){
    const x = base + b.x * cam.zoom;
    if(x + blockW < 0 || x > canvasW) continue;
    ctx.drawImage(
      city.img, city.block.x, city.block.y, city.block.w, city.block.h,
      Math.round(x), Math.round(streetY - blockH), Math.ceil(blockW), Math.ceil(blockH)
    );
  }

  ctx.restore();
}

// Picks one city skyline per level and tiles it horizontally, scrolling slower
// than the world (parallax) so there's depth behind the course.
export const BACKGROUND_KEYS = ['bgGrassy', 'bgCity', 'bgDay1', 'bgNight1', 'bgNight2', 'bgEvening1'];

// The first time through, courses step through BACKGROUND_KEYS in this fixed
// order (one per call — game.js advances `cycleIndex` each time a course
// starts, i.e. on level-complete or game-over, not on a mid-course respawn),
// so a new player sees all of them deliberately. Once cycleIndex runs past the
// list, it's random from then on.
export function pickBackground(images, cycleIndex){
  const key = cycleIndex < BACKGROUND_KEYS.length
    ? BACKGROUND_KEYS[cycleIndex]
    : BACKGROUND_KEYS[Math.floor(Math.random() * BACKGROUND_KEYS.length)];
  return images[key];
}

// Wraps v into [0, m) — plain % in JS can return negative results for
// negative v, which was causing an occasional gap/jump at the tile seam.
function wrap(v, m){
  return ((v % m) + m) % m;
}

// Whole-number scale only. Fitting the art to the canvas height (the old
// behaviour) gave fractional factors like 2.52, which duplicates pixel rows
// unevenly — and for art taller than the canvas it went BELOW 1 and started
// dropping rows outright, which is what mangled the 512x600 skyline. Never
// less than 2 so a short source still covers the canvas with room to pan.
const MIN_SCALE = 2;

function scaleFor(img, canvasH){
  return Math.max(MIN_SCALE, Math.ceil(canvasH / img.height));
}

// parallaxY only does anything for art tall enough to have slack after
// covering the canvas — the taller the source, the further it can pan before
// clamping at its own top or bottom edge.
export function drawBackground(ctx, img, cam, canvasW, canvasH, parallax = 0.35, parallaxY = 0.45){
  if(!img) return;

  const scale = scaleFor(img, canvasH);
  const drawW = img.width * scale;   // integer, so consecutive tiles line up exactly
  const drawH = img.height * scale;

  // Pan within whatever vertical slack the art has, then clamp so its own top
  // and bottom edges can never come into view.
  const slack = Math.max(0, drawH - canvasH);
  const drawY = Math.round(
    Math.max(-slack, Math.min(0, -slack / 2 - cam.y * parallaxY))
  );

  const offsetX = wrap(-(cam.x * parallax), drawW);
  const startX = Math.round(offsetX - drawW);

  ctx.save();
  // Pixel art scaled up with smoothing on gets anti-aliased at each tile's
  // own edge independently — that's the actual seam, even though the
  // source art tiles perfectly. Turning smoothing off also keeps the art
  // crisp instead of blurry, which you want for this style anyway.
  ctx.imageSmoothingEnabled = false;
  for(let x = startX; x < canvasW; x += drawW){
    ctx.drawImage(img, 0, 0, img.width, img.height, x, drawY, drawW, drawH);
  }
  ctx.restore();
}

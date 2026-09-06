// Picks one of the city skyline images per level and tiles it horizontally,
// scrolling slower than the foreground (parallax) so the world feels deep.
export const BACKGROUND_KEYS = ['bgDay1', 'bgNight1', 'bgNight2', 'bgEvening1'];

// The first time through, courses step through BACKGROUND_KEYS in this fixed
// order (one per call — game.js advances `cycleIndex` each time a course
// starts, i.e. on level-complete or game-over, not on a mid-course respawn),
// so a new player sees all four deliberately. Once cycleIndex runs past the
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

export function drawBackground(ctx, img, cam, canvasW, canvasH, parallax = 0.35){
  if(!img) return;
  const scale = canvasH / img.height;
  // Round to a whole pixel width so every tile is identically sized —
  // fractional widths (e.g. 645.87px) mean consecutive drawImage calls
  // don't land on exactly matching boundaries, leaving a hairline gap.
  const drawW = Math.round(img.width * scale);
  const offsetX = wrap(-(cam.x * parallax), drawW);
  const startX = Math.round(offsetX - drawW);

  ctx.save();
  // Pixel art scaled up with smoothing on gets anti-aliased at each tile's
  // own edge independently — that's the actual seam, even though the
  // source art tiles perfectly. Turning smoothing off also keeps the art
  // crisp instead of blurry, which you want for this style anyway.
  ctx.imageSmoothingEnabled = false;
  for(let x = startX; x < canvasW; x += drawW){
    ctx.drawImage(img, 0, 0, img.width, img.height, x, 0, drawW, canvasH);
  }
  ctx.restore();
}
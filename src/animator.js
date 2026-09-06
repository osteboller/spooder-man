// A generic sprite-strip animator. Each "clip" is one horizontal PNG strip
// (one animation = one file) with square frames — frame size is read
// straight off the image (frameSize = image.height), and frame count is
// derived from width/height, so nothing here needs to know exact dimensions
// or frame counts in advance. Drop in whatever size art you like.

export function createAnimator(clipDefs){
  return {
    defs: clipDefs, // { name: { imgKey, frameDuration, loop } }
    current: null,
    frameIndex: 0,
    frameTimer: 0,
    finished: false
  };
}

export function playClip(anim, name, { restart = true } = {}){
  if(!restart && anim.current === name) return;
  anim.current = name;
  anim.frameIndex = 0;
  anim.frameTimer = 0;
  anim.finished = false;
}

export function isFinished(anim){
  return anim.finished;
}

function frameCountOf(def, images){
  const img = images[def.imgKey];
  if(!img) return 1;
  return Math.max(1, Math.round(img.width / img.height));
}

export function updateAnimator(anim, images, dt){
  const def = anim.defs[anim.current];
  if(!def || anim.finished) return;
  const img = images[def.imgKey];
  if(!img) return;

  const frameCount = frameCountOf(def, images);

  anim.frameTimer += dt;
  while(anim.frameTimer >= def.frameDuration){
    anim.frameTimer -= def.frameDuration;
    anim.frameIndex++;
    if(anim.frameIndex >= frameCount){
      if(def.loop){
        anim.frameIndex = 0;
      } else {
        anim.frameIndex = frameCount - 1;
        anim.finished = true;
        break;
      }
    }
  }
}

export function drawAnimator(ctx, anim, images, screenX, screenY, zoom, displaySize, flip){
  const def = anim.defs[anim.current];
  if(!def) return;
  const img = images[def.imgKey];
  if(!img) return;

  const frameSize = img.height;
  const dw = displaySize * zoom, dh = displaySize * zoom;

  ctx.save();
  ctx.translate(screenX, screenY);
  if(flip) ctx.scale(-1, 1);
  ctx.drawImage(img, anim.frameIndex * frameSize, 0, frameSize, frameSize, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// Drives a clip's frame directly from an external 0..1 value instead of the
// normal time-based playback — for an animation that should track a physical
// quantity (like how far into a swing you are) rather than elapsed time.
// The clip's own frameDuration/loop settings are ignored when driven this way.
export function setFrameByPhase(anim, images, phase){
  const def = anim.defs[anim.current];
  if(!def) return;
  const count = frameCountOf(def, images);
  // floor into count EQUAL-width buckets, not round against (count-1) frame
  // positions — round() gives the two end frames half the span of every
  // middle frame (their bucket only extends one way, not both), so they
  // flash by while the middle frame(s) linger. Floor gives every frame the
  // same 1/count share of the phase range.
  const clamped = Math.max(0, Math.min(0.999999, phase));
  anim.frameIndex = Math.floor(clamped * count);
}

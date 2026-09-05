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

export function updateAnimator(anim, images, dt){
  const def = anim.defs[anim.current];
  if(!def || anim.finished) return;
  const img = images[def.imgKey];
  if(!img) return;

  const frameSize = img.height;
  const frameCount = Math.max(1, Math.round(img.width / frameSize));

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

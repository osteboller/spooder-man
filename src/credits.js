// SNES-style developer/publisher credit cards, shown once between the
// loading gate and the title screen. Each card fades in from black, holds,
// fades back to black — the classic console-boot look, regardless of the
// card art's own (white) background — a tap/click/key doesn't skip the
// whole sequence outright, it jumps to the next fade boundary, so mashing
// through still reads as "fade in, fade out" for each card, just fast.
const FADE_MS = 500;
const HOLD_MS = 1400;
const CARD_MS = FADE_MS + HOLD_MS + FADE_MS;

function clamp01(t){ return Math.max(0, Math.min(1, t)); }

// Alpha for one card given its own local elapsed time (0..CARD_MS).
function cardAlpha(localMs){
  if(localMs < FADE_MS) return clamp01(localMs / FADE_MS);
  if(localMs < FADE_MS + HOLD_MS) return 1;
  return clamp01(1 - (localMs - FADE_MS - HOLD_MS) / FADE_MS);
}

// Contain, not cover — these are text/logo cards, so letterboxing beats
// cropping off any of the artwork.
function drawContained(ctx, img, canvasW, canvasH){
  if(!img) return;
  const scale = Math.min(canvasW / img.width, canvasH / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
}

export function runCredits(canvas, images, cardKeys = ['creditsNiba', 'creditsOsteboller']){
  return new Promise(resolve => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const totalMs = CARD_MS * cardKeys.length;

    // Every phase boundary across the whole sequence, in order — a tap jumps
    // straight to whichever is next instead of skipping everything at once.
    const boundaries = [];
    for(let i = 0; i < cardKeys.length; i++){
      const base = i * CARD_MS;
      boundaries.push(base + FADE_MS, base + FADE_MS + HOLD_MS, base + CARD_MS);
    }

    let startTime = null;
    let skipOffsetMs = 0;
    let stopped = false;

    function elapsedMs(now){ return (now - startTime) + skipOffsetMs; }

    function handleInput(e){
      e.preventDefault();
      const current = elapsedMs(performance.now());
      const next = boundaries.find(b => b > current + 1);
      if(next === undefined){
        stopped = true;
        detach();
        resolve();
        return;
      }
      skipOffsetMs += next - current;
    }

    function attach(){
      canvas.addEventListener('mousedown', handleInput);
      canvas.addEventListener('touchstart', handleInput, { passive: false });
      window.addEventListener('keydown', handleInput);
    }
    function detach(){
      canvas.removeEventListener('mousedown', handleInput);
      canvas.removeEventListener('touchstart', handleInput);
      window.removeEventListener('keydown', handleInput);
    }

    function frame(now){
      if(stopped) return;
      if(startTime === null) startTime = now;
      const elapsed = elapsedMs(now);

      if(elapsed >= totalMs){
        stopped = true;
        detach();
        resolve();
        return;
      }

      const cardIndex = Math.min(cardKeys.length - 1, Math.floor(elapsed / CARD_MS));
      const localMs = elapsed - cardIndex * CARD_MS;
      const alpha = cardAlpha(localMs);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000'; // card art is fully transparent apart from the lettering, so this IS the card's background
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawContained(ctx, images[cardKeys[cardIndex]], W, H);
      ctx.restore();

      requestAnimationFrame(frame);
    }

    attach();
    requestAnimationFrame(frame);
  });
}

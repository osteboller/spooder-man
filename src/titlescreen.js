// Animated title card: three layered PNGs (bg, logo, player) ease in one
// after another, then a tap/click/key hands off to the game. A press during
// the intro skips straight to the settled state instead of being ignored —
// nobody wants to sit through the same intro every time they retry.
const BG_FADE_MS = 700;
const LOGO_START_MS = 400, LOGO_DURATION_MS = 600, LOGO_SLIDE_PX = 50; // starts this far above rest
const PLAYER_START_MS = 800, PLAYER_DURATION_MS = 600, PLAYER_SLIDE_PX = 70; // starts this far right of rest
const SETTLED_MS = PLAYER_START_MS + PLAYER_DURATION_MS;
const PROMPT_BLINK_MS = 700;

function clamp01(t){ return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

// Draws an image scaled to a target box while preserving its own aspect
// ratio (contain, not stretch) — used for both the full-bleed background
// (which ends up covering, since it's wider than it is tall relative to the
// canvas) and the logo/player art sized against canvas height.
function drawContained(ctx, img, cx, cy, boxW, boxH, alpha){
  if(!img || alpha <= 0) return;
  const scale = Math.max(boxW / img.width, boxH / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
}

// Resolves once the player has actually chosen to start (not on the
// skip-the-intro tap). onProceed fires exactly then — the right moment to
// unlock/start audio, since it's a genuine user gesture and it's also when
// gameplay actually begins.
export function runTitleScreen(canvas, images, onProceed){
  return new Promise(resolve => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    let startTime = null;
    let skippedAt = null; // elapsed-ms clock offset applied once the intro is skipped
    let settled = false;
    let stopped = false;

    function elapsedMs(now){
      if(skippedAt !== null) return SETTLED_MS;
      return now - startTime;
    }

    function handleInput(e){
      e.preventDefault();
      if(!settled){
        skippedAt = performance.now(); // freezes elapsedMs() at "fully settled" from here on
        settled = true;
        return;
      }
      stopped = true;
      detach();
      if(onProceed) onProceed();
      resolve();
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
      if(elapsed >= SETTLED_MS) settled = true;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // Background covers the full canvas — its own 320x256 proportions are
      // narrower than the canvas's, so this crops the sides slightly rather
      // than stretching the art out of shape.
      drawContained(ctx, images.titleBg, W / 2, H / 2, W, H, clamp01(elapsed / BG_FADE_MS));

      const logoP = easeOutCubic(clamp01((elapsed - LOGO_START_MS) / LOGO_DURATION_MS));
      if(logoP > 0){
        const logo = images.titleLogo;
        const boxH = H * 0.34;
        const boxW = logo ? boxH * (logo.width / logo.height) : boxH;
        drawContained(ctx, logo, W / 2, H * 0.24 - LOGO_SLIDE_PX * (1 - logoP), boxW, boxH, logoP);
      }

      const playerP = easeOutCubic(clamp01((elapsed - PLAYER_START_MS) / PLAYER_DURATION_MS));
      if(playerP > 0){
        const player = images.titlePlayer;
        const boxH = H * 0.62;
        const boxW = player ? boxH * (player.width / player.height) : boxH;
        drawContained(ctx, player, W * 0.68 + PLAYER_SLIDE_PX * (1 - playerP), H * 0.66, boxW, boxH, playerP);
      }

      if(settled){
        const blink = 0.5 + 0.5 * Math.sin(now / PROMPT_BLINK_MS * Math.PI * 2);
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * blink;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px Arial';
        ctx.strokeText('PRESS TO START', W / 2, H * 0.9);
        ctx.fillText('PRESS TO START', W / 2, H * 0.9);
        ctx.restore();
      }

      requestAnimationFrame(frame);
    }

    attach();
    requestAnimationFrame(frame);
  });
}

// Animated title card. bg/logo/player are all the same 320x256 frame,
// pre-composed to align when simply stacked — so all three MUST share the
// exact same scale/position (computed once, from whichever loads); only the
// background gets its own independent zoom/pan, everything else rides the
// shared transform untouched.
//
// Sequence: background starts zoomed in and panned up (so it reads as
// looking up at the moon), settles like a camera panning down — then the
// logo fades+slides down into place, then the player fades+slides in from
// the right. Finally "PRESS TO START" blinks and waits for a tap/click/key.
// A press during the intro skips straight to the settled state instead of
// being ignored — nobody wants to sit through the same intro every retry.
// A held zoom (not an animated one) just big enough to create vertical slack
// to pan within — the pan itself is the whole effect; if the zoom animated
// too it reads as "shrinking" instead of "camera panning down".
const BG_ZOOM = 1.15;
const BG_PAN_MS = 1900; // how long the pan-down settle takes

const LOGO_SCALE = 0.85;  // vs. the shared base size — full size clipped at the top
const PLAYER_SCALE = 0.90;
const LOGO_START_MS = BG_PAN_MS + 100, LOGO_DURATION_MS = 500, LOGO_SLIDE_PX = 50;
const PLAYER_START_MS = LOGO_START_MS + 300, PLAYER_DURATION_MS = 500, PLAYER_SLIDE_PX = 70;
const SETTLED_MS = PLAYER_START_MS + PLAYER_DURATION_MS;
const PROMPT_BLINK_MS = 700;

function clamp01(t){ return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

// The shared "cover the canvas" transform every layer is drawn at (before
// each layer's own small entrance offset) — computed once from whichever
// title-screen image is available, since they're all the same dimensions.
function coverTransform(img, canvasW, canvasH){
  const scale = Math.max(canvasW / img.width, canvasH / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  return { dw, dh, dx: (canvasW - dw) / 2, dy: (canvasH - dh) / 2 };
}

// Scales a box by `factor` around its own center, so shrinking a layer (the
// logo, clipped at the top at full size; the player, just meant to read
// slightly smaller) pulls its edges in evenly instead of shifting it toward
// one corner.
function centeredScale(box, factor){
  const dw = box.dw * factor, dh = box.dh * factor;
  const cx = box.dx + box.dw / 2, cy = box.dy + box.dh / 2;
  return { dw, dh, dx: cx - dw / 2, dy: cy - dh / 2 };
}

// Resolves once the player has actually chosen to start (not on the
// skip-the-intro tap) — the caller awaits this to know when to move on to
// the actual game. Audio doesn't hook in here: the intro bgm already started
// off the tap-to-continue gate before this ever ran (main.js), and the level
// bgm starts alongside game.start() — this function doesn't need to know
// about either.
export function runTitleScreen(canvas, images){
  return new Promise(resolve => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const ref = images.titleBg || images.titleLogo || images.titlePlayer;
    const base = ref ? coverTransform(ref, W, H) : { dw: W, dh: H, dx: 0, dy: 0 };

    let startTime = null;
    let skippedAt = null; // freezes elapsedMs() at "fully settled" once set
    let settled = false;
    let stopped = false;

    function elapsedMs(now){
      return skippedAt !== null ? SETTLED_MS : now - startTime;
    }

    function handleInput(e){
      e.preventDefault();
      if(!settled){ settled = true; skippedAt = performance.now(); return; }
      stopped = true;
      detach();
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

      if(images.titleBg){
        // Scale is CONSTANT — only the vertical position animates. Animating
        // both at once (the previous version) reads as "shrinking"; a pure
        // slide reads as a camera pan. dy starts at 0 (image top flush with
        // the canvas top, so we see as much sky as the held zoom allows and
        // the street is cropped off the bottom) and eases down to the normal
        // centered crop — the image itself slides UP on screen, which is
        // exactly a camera panning DOWN over it.
        const dw = base.dw * BG_ZOOM, dh = base.dh * BG_ZOOM;
        const dyEnd = (H - dh) / 2;
        const t = easeOutCubic(clamp01(elapsed / BG_PAN_MS));
        const dy = dyEnd * t; // 0 -> dyEnd
        ctx.save();
        ctx.globalAlpha = clamp01(elapsed / (BG_PAN_MS * 0.4));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(images.titleBg, (W - dw) / 2, dy, dw, dh);
        ctx.restore();
      }

      const logoBox = centeredScale(base, LOGO_SCALE);
      const logoT = easeOutCubic(clamp01((elapsed - LOGO_START_MS) / LOGO_DURATION_MS));
      if(logoT > 0 && images.titleLogo){
        ctx.save();
        ctx.globalAlpha = logoT;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(images.titleLogo, logoBox.dx, logoBox.dy - LOGO_SLIDE_PX * (1 - logoT), logoBox.dw, logoBox.dh);
        ctx.restore();
      }

      const playerBox = centeredScale(base, PLAYER_SCALE);
      const playerT = easeOutCubic(clamp01((elapsed - PLAYER_START_MS) / PLAYER_DURATION_MS));
      if(playerT > 0 && images.titlePlayer){
        ctx.save();
        ctx.globalAlpha = playerT;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(images.titlePlayer, playerBox.dx + PLAYER_SLIDE_PX * (1 - playerT), playerBox.dy, playerBox.dw, playerBox.dh);
        ctx.restore();
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

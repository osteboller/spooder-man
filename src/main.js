import { loadAllImages } from './assets.js';
import { createUI } from './ui.js';
import { bindInput } from './input.js';
import { createGame } from './game.js';
import { loadBgm, startBgm, setBgmMuted, isBgmMuted, setSfxMuted, isSfxMuted } from './audio.js';
import { runTitleScreen } from './titlescreen.js';

// Toolbar (options / music / SFX) is independent of the game and the title
// screen — wired once, works the same regardless of which is showing.
function bindToolbar(){
  const musicBtn = document.getElementById('btn-music');
  const sfxBtn = document.getElementById('btn-sfx');
  const optionsBtn = document.getElementById('btn-options');
  const optionsOverlay = document.getElementById('options-overlay');
  const optionsClose = document.getElementById('options-close');

  musicBtn.addEventListener('click', () => {
    setBgmMuted(!isBgmMuted());
    musicBtn.classList.toggle('icon-btn-muted', isBgmMuted());
  });
  sfxBtn.addEventListener('click', () => {
    setSfxMuted(!isSfxMuted());
    sfxBtn.textContent = isSfxMuted() ? '🔇' : '🔊';
    sfxBtn.classList.toggle('icon-btn-muted', isSfxMuted());
  });
  optionsBtn.addEventListener('click', () => { optionsOverlay.hidden = false; });
  optionsClose.addEventListener('click', () => { optionsOverlay.hidden = true; });
}

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();
  const loadingEl = document.getElementById('loading');
  const loadingFillEl = document.getElementById('loading-fill');
  bindToolbar();

  const [images] = await Promise.all([
    loadAllImages(undefined, (loaded, total) => {
      loadingFillEl.style.width = Math.round((loaded / total) * 100) + '%';
    }),
    // Music is a nice-to-have — a failed fetch/decode shouldn't block the
    // game, but silently swallowing the error also means "it's not playing"
    // is undiagnosable. Log it instead.
    loadBgm().catch(err => console.warn('Background music failed to load:', err))
  ]);
  loadingEl.style.display = 'none';

  const game = createGame(canvas, images);

  // The title screen owns the canvas (and its own input) until the player
  // actually starts — bindInput/game.start only happen after that, so the
  // two never fight over the same clicks.
  await runTitleScreen(canvas, images, () => startBgm());

  document.getElementById('hud').style.display = 'flex';
  bindInput(canvas, {
    onDown: (pos) => game.handleDown(ui, pos),
    onUp: (dragDelta) => game.handleUp(ui, dragDelta)
  });

  game.start(ui);
}

boot();

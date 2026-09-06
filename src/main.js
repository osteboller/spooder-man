import { loadAllImages } from './assets.js';
import { createUI } from './ui.js';
import { bindInput } from './input.js';
import { createGame } from './game.js';
import {
  loadBgm, startBgm,
  getBgmVolume, getSfxVolume, setBgmVolume, setSfxVolume,
  isBgmMuted, isSfxMuted, toggleBgmMute, toggleSfxMute
} from './audio.js';
import { runTitleScreen } from './titlescreen.js';
import { runCredits } from './credits.js';

const FADE_MS = 350;

function fadeScreen(opaque){
  return new Promise(resolve => {
    const fadeEl = document.getElementById('screen-fade');
    fadeEl.classList.toggle('opaque', opaque);
    setTimeout(resolve, FADE_MS);
  });
}

// Toolbar (options / music / SFX) and the options overlay's own sliders are
// two views of the exact same persisted volume state in audio.js — reading
// current values into both on bind, and re-syncing both any time either one
// changes, so neither can drift out of step with the other or with what got
// saved last session.
//
// `getGame` is a getter, not the game itself: this binds before the game
// exists (the toolbar is meant to work from page load, before assets even
// finish loading), and needs whatever the CURRENT game is at click-time to
// pause/resume it — a plain captured reference would still be null forever.
function bindToolbar(getGame){
  const musicBtn = document.getElementById('btn-music');
  const sfxBtn = document.getElementById('btn-sfx');
  const optionsBtn = document.getElementById('btn-options');
  const optionsOverlay = document.getElementById('options-overlay');
  const optionsClose = document.getElementById('options-close');
  const sfxSlider = document.getElementById('sfx-volume');
  const bgmSlider = document.getElementById('bgm-volume');

  function refreshToolbarIcons(){
    musicBtn.classList.toggle('icon-btn-muted', isBgmMuted());
    sfxBtn.textContent = isSfxMuted() ? '🔇' : '🔊';
    sfxBtn.classList.toggle('icon-btn-muted', isSfxMuted());
  }
  function refreshSliders(){
    bgmSlider.value = Math.round(getBgmVolume() * 100);
    sfxSlider.value = Math.round(getSfxVolume() * 100);
  }

  refreshToolbarIcons();
  refreshSliders();

  musicBtn.addEventListener('click', () => { toggleBgmMute(); refreshToolbarIcons(); refreshSliders(); });
  sfxBtn.addEventListener('click', () => { toggleSfxMute(); refreshToolbarIcons(); refreshSliders(); });
  bgmSlider.addEventListener('input', () => { setBgmVolume(bgmSlider.value / 100); refreshToolbarIcons(); });
  sfxSlider.addEventListener('input', () => { setSfxVolume(sfxSlider.value / 100); refreshToolbarIcons(); });

  optionsBtn.addEventListener('click', () => {
    refreshSliders();
    optionsOverlay.classList.add('open');
    const game = getGame();
    if(game) game.setPaused(true);
  });
  optionsClose.addEventListener('click', () => {
    optionsOverlay.classList.remove('open');
    const game = getGame();
    if(game) game.setPaused(false);
  });
}

// Resolves on the first genuine user gesture anywhere on the page. Mobile
// (and most desktop) browsers refuse to start an AudioContext until one of
// these fires, so this is the one deterministic place bgm playback is
// allowed to start from — everything before it can decode audio, but must
// never call startBgm().
function waitForGesture(){
  return new Promise(resolve => {
    // preventDefault on the touchstart matters here, not just style: without
    // it the browser follows up with a synthetic mousedown/click at the same
    // coordinates ~300ms later, which would land on whatever canvas listener
    // (runCredits, right after this) is attached by then and skip it unseen.
    function onGesture(e){ e.preventDefault(); detach(); resolve(); }
    function attach(){
      window.addEventListener('mousedown', onGesture, { once: true });
      window.addEventListener('touchstart', onGesture, { once: true, passive: false });
      window.addEventListener('keydown', onGesture, { once: true });
    }
    function detach(){
      window.removeEventListener('mousedown', onGesture);
      window.removeEventListener('touchstart', onGesture);
      window.removeEventListener('keydown', onGesture);
    }
    attach();
  });
}

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();
  const loadingEl = document.getElementById('loading');
  const loadingLabelEl = document.getElementById('loading-label');
  const loadingBarEl = document.getElementById('loading-bar');
  const loadingFillEl = document.getElementById('loading-fill');

  let game = null;
  bindToolbar(() => game);

  const [images] = await Promise.all([
    loadAllImages(undefined, (loaded, total) => {
      loadingFillEl.style.width = Math.round((loaded / total) * 100) + '%';
    }),
    // Music is a nice-to-have — a failed fetch/decode shouldn't block the
    // game, but silently swallowing the error also means "it's not playing"
    // is undiagnosable. Log it instead.
    loadBgm().catch(err => console.warn('Background music failed to load:', err))
  ]);

  // Loading is done, but nothing has played a sound yet — swap the loading
  // bar for a blinking prompt and wait for a real tap/click/key before doing
  // anything audio-related. This is the one gesture the whole boot sequence
  // hangs off of, so the intro bgm can start right here, guaranteed-legal.
  loadingBarEl.style.display = 'none';
  loadingLabelEl.textContent = 'TAP TO CONTINUE';
  loadingLabelEl.classList.add('blink');
  await waitForGesture();
  startBgm('intro');
  loadingEl.style.display = 'none';

  game = createGame(canvas, images);

  // Two more canvas-owning scenes before real gameplay: the credit cards,
  // then the title screen. Each owns the canvas (and its own input) until it
  // resolves — bindInput/game.start only happen after both, so nothing ever
  // fights over the same clicks.
  await runCredits(canvas, images);
  await runTitleScreen(canvas, images);

  // A hard cut from the title card to the running game read as abrupt —
  // fade to black, swap what's showing while nobody can see it, fade back in.
  await fadeScreen(true);
  document.getElementById('hud').style.display = 'flex';
  bindInput(canvas, {
    onDown: (pos) => game.handleDown(ui, pos),
    onUp: (dragDelta) => game.handleUp(ui, dragDelta)
  });
  startBgm('level'); // the first course is about to start — hand off from the intro track
  game.start(ui);
  await fadeScreen(false);
}

boot();

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

// Starts the intro bgm on the very first gesture anywhere on the page —
// deliberately not scoped to the canvas or the title screen, since neither
// exists yet if the player taps during the loading screen. { once: true }
// both caps it to firing exactly once and removes the listeners for us.
// If that gesture lands before loadBgm() has actually finished, startBgm()
// silently no-ops (nothing decoded yet) and the listener is already spent —
// boot() checks this flag once loading completes and retries in that case.
let userHasGestured = false;
function startIntroBgmOnFirstGesture(){
  const onGesture = () => {
    userHasGestured = true;
    startBgm('intro');
  };
  document.addEventListener('mousedown', onGesture, { once: true });
  document.addEventListener('touchstart', onGesture, { once: true, passive: true });
  document.addEventListener('keydown', onGesture, { once: true });
}

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();
  const loadingEl = document.getElementById('loading');
  const loadingFillEl = document.getElementById('loading-fill');

  let game = null;
  bindToolbar(() => game);
  startIntroBgmOnFirstGesture();

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
  if(userHasGestured) startBgm('intro'); // covers a gesture that landed before bgm finished loading

  game = createGame(canvas, images);

  // The title screen owns the canvas (and its own input) until the player
  // actually starts — bindInput/game.start only happen after that, so the
  // two never fight over the same clicks.
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

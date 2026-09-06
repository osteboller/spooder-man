import { loadAllImages } from './assets.js';
import { createUI } from './ui.js';
import { bindInput } from './input.js';
import { createGame } from './game.js';
import { loadBgm, startBgm } from './audio.js';
import { runTitleScreen } from './titlescreen.js';

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();
  const loadingEl = document.getElementById('loading');
  const loadingFillEl = document.getElementById('loading-fill');

  const [images] = await Promise.all([
    loadAllImages(undefined, (loaded, total) => {
      loadingFillEl.style.width = Math.round((loaded / total) * 100) + '%';
    }),
    loadBgm().catch(() => {}) // music is a nice-to-have — a failed fetch shouldn't block the game
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

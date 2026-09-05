import { loadAllImages } from './assets.js';
import { createUI } from './ui.js';
import { bindInput } from './input.js';
import { createGame } from './game.js';
import { loadBgm, startBgm } from './audio.js';

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();

  const [images] = await Promise.all([
    loadAllImages(),
    loadBgm().catch(() => {}) // music is a nice-to-have — a failed fetch shouldn't block the game
  ]);
  const game = createGame(canvas, images);

  let bgmStarted = false;
  bindInput(canvas, {
    onDown: () => {
      if(!bgmStarted){ bgmStarted = true; startBgm(); } // first tap/click/key — the only place autoplay is allowed
      game.handleDown(ui);
    },
    onUp: () => game.handleUp(ui)
  });

  game.start(ui);
}

boot();

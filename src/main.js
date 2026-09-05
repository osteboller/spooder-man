import { loadAllImages } from './assets.js';
import { createUI } from './ui.js';
import { bindInput } from './input.js';
import { createGame } from './game.js';

async function boot(){
  const canvas = document.getElementById('c');
  const ui = createUI();

  const images = await loadAllImages();
  const game = createGame(canvas, images);

  bindInput(canvas, {
    onDown: () => game.handleDown(ui),
    onUp: () => game.handleUp(ui)
  });

  game.start(ui);
}

boot();

// One button, several ways to press it. Everything funnels into onDown/onUp
// so game.js doesn't need to know or care whether it was a tap, a click, or
// the space bar.
export function bindInput(canvas, { onDown, onUp }){
  const down = (e) => { e.preventDefault(); onDown(); };
  const up = (e) => { e.preventDefault(); onUp(); };

  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchend', up, { passive: false });
  window.addEventListener('keydown', e => { if(e.code === 'Space') down(e); });
  window.addEventListener('keyup', e => { if(e.code === 'Space') up(e); });
}

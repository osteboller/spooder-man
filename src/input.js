// One button, several ways to press it. Everything funnels into onDown/onUp
// so game.js doesn't need to know or care whether it was a tap, a click, or
// the space bar. onDown reports where the press landed (canvas-internal
// pixels, not raw CSS pixels — the canvas is CSS-scaled to fit the viewport,
// so we correct for that via getBoundingClientRect; null for keyboard, which
// has no position). onUp reports how far the pointer dragged between press
// and release, in the same coordinate space — used for aiming the rope-swing anchor.
export function bindInput(canvas, { onDown, onUp }){
  let downX = 0, downY = 0;
  // Whether the gesture currently in progress actually started on the
  // canvas (or Space). up() is bound on window — necessarily, since dragging
  // to aim the rope can carry the pointer outside the canvas before release
  // — but that meant it also fired, and called preventDefault(), for EVERY
  // touchend/mouseup anywhere on the page, including a tap on an ordinary DOM
  // button (the mute toggles, the options close button). On touch devices
  // preventDefault()-ing a touchend suppresses the synthetic click that
  // would otherwise follow, so those buttons silently never received their
  // click — worked with a mouse (mouseup's preventDefault doesn't suppress
  // click the same way), broke on every mobile browser. Only treat a
  // release as ours if the matching press was.
  let active = false;

  function canvasPoint(e){
    const src = e.changedTouches ? e.changedTouches[0] : e; // touchend has nothing in e.touches
    if(src.clientX === undefined) return null; // keyboard events carry no position
    const rect = canvas.getBoundingClientRect();
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  const down = (e) => {
    e.preventDefault();
    active = true;
    const p = canvasPoint(e);
    downX = p ? p.x : 0;
    downY = p ? p.y : 0;
    onDown(p); // null for keyboard — no position to report
  };
  const up = (e) => {
    if(!active) return; // this release isn't ours — let the page (e.g. a button) handle it normally
    active = false;
    e.preventDefault();
    const p = canvasPoint(e);
    onUp(p ? { dx: p.x - downX, dy: p.y - downY } : { dx: 0, dy: 0 });
  };

  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('touchstart', down, { passive: false });
  // Bound on window, not canvas: dragging to aim the rope can carry the
  // pointer outside the canvas before release, and that release must still count.
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up, { passive: false });
  window.addEventListener('touchcancel', up, { passive: false });
  window.addEventListener('keydown', e => { if(e.code === 'Space') down(e); });
  window.addEventListener('keyup', e => { if(e.code === 'Space') up(e); });
}

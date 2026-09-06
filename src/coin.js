// A single collectible 1-up per course. Spins in place; touching it while
// airborne (flying or swinging) grants an extra life. Same self-contained
// update/draw shape as enemy.js — no reason to route this through the
// generic clip system in animator.js for one fixed animation.
export const COIN_FRAME_W = 16, COIN_FRAME_H = 16;
export const COIN_FRAME_COUNT = 4;
export const COIN_FRAME_DURATION = 100; // ms per spin frame
export const COIN_DISPLAY_SIZE = 40;    // drawn size at zoom 1
export const COIN_PICKUP_RADIUS = 40;   // world units — how close counts as touching it

export function updateCoin(coin, dt){
  coin.frameTimer += dt;
  while(coin.frameTimer >= COIN_FRAME_DURATION){
    coin.frameTimer -= COIN_FRAME_DURATION;
    coin.frameIndex = (coin.frameIndex + 1) % COIN_FRAME_COUNT;
  }
}

export function drawCoin(ctx, spriteImg, coin, screenX, screenY, zoom){
  if(!spriteImg) return;
  const dw = COIN_DISPLAY_SIZE * zoom, dh = COIN_DISPLAY_SIZE * zoom;
  ctx.drawImage(
    spriteImg,
    coin.frameIndex * COIN_FRAME_W, 0, COIN_FRAME_W, COIN_FRAME_H,
    screenX - dw / 2, screenY - dh / 2, dw, dh
  );
}

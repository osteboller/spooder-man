// Enemies bob vertically between two grab points. While flying, get close
// enough and you have a brief window to press and defeat it (see
// ENEMY_WARN_MARGIN in game.js); miss the window and you bounce off and fall.
export const ENEMY_FRAME_W = 48, ENEMY_FRAME_H = 48;
export const ENEMY_FRAME_COUNT = 4;
export const ENEMY_FRAME_DURATION = 140; // ms per idle-pulse frame
export const ENEMY_DISPLAY_SIZE = 42;    // drawn size at zoom 1
export const ENEMY_WARN_MARGIN = 190;    // extra radius that counts as "engaged" — wide on purpose,
                                          // since you fly straight through rather than hovering nearby

export function updateEnemy(enemy, dt, elapsedMs){
  enemy.y = enemy.baseY + Math.sin(elapsedMs * enemy.speed + enemy.phase) * enemy.amplitude;
  enemy.frameTimer += dt;
  while(enemy.frameTimer >= ENEMY_FRAME_DURATION){
    enemy.frameTimer -= ENEMY_FRAME_DURATION;
    enemy.frameIndex = (enemy.frameIndex + 1) % ENEMY_FRAME_COUNT;
  }
}

export function drawEnemy(ctx, spriteImg, enemy, screenX, screenY, zoom, warn){
  if(!spriteImg) return;
  const dw = ENEMY_DISPLAY_SIZE * zoom, dh = ENEMY_DISPLAY_SIZE * zoom;

  if(warn){
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 80);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, screenY, dw / 2 + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.drawImage(
    spriteImg,
    enemy.frameIndex * ENEMY_FRAME_W, 0, ENEMY_FRAME_W, ENEMY_FRAME_H,
    screenX - dw / 2, screenY - dh / 2, dw, dh
  );
}
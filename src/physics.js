export const GRAVITY = 0.5;

// Returns an array of {x,y} points tracing a projectile's path — used both
// for the dotted aim preview and could be reused for other trajectory needs.
export function simulateTrajectory(startX, startY, angle, speed, steps = 130){
  const vx = Math.cos(angle) * speed;
  let vy = -Math.sin(angle) * speed;
  const pts = [];
  let x = startX, y = startY;
  for(let i = 0; i < steps; i++){
    pts.push({ x, y });
    x += vx;
    vy += GRAVITY;
    y += vy;
  }
  return pts;
}

export function dist(ax, ay, bx, by){
  return Math.hypot(ax - bx, ay - by);
}

import { createAnimator, playClip, updateAnimator, drawAnimator, isFinished } from './animator.js';

// One clip = one strip file (assets/sprites/player_<name>.png). Tune
// frameDuration/loop to taste — frame size and count are read from each
// image automatically, so these numbers are the only thing to adjust.
export const PLAYER_DISPLAY_SIZE = 280; // on-screen size at zoom 1, independent of source resolution

export const PLAYER_CLIPS = {
  idle:   { imgKey: 'playerIdle',   frameDuration: 150, loop: true  },
  grab:   { imgKey: 'playerGrab',   frameDuration: 120,  loop: false }, // swings, settles, holds last frame
  windup: { imgKey: 'playerWindup', frameDuration: 120,  loop: false }, // just the start of the jump, not a hold-loop
  roll:   { imgKey: 'playerRoll',   frameDuration: 120,  loop: false }, // plays once, freezes on last frame for the rest of the flight
  attack: { imgKey: 'playerAttack', frameDuration: 120,  loop: false }, // plays once, then game.js resumes 'roll'
  hurt:   { imgKey: 'playerHurt',   frameDuration: 120,  loop: false }, // plays once, freezes on last frame
};

export function createPlayerAnimator(){
  const anim = createAnimator(PLAYER_CLIPS);
  anim.facingLeft = false;
  playClip(anim, 'idle');
  return anim;
}

export function resetPlayerAnimator(anim){
  anim.facingLeft = false;
  playClip(anim, 'idle');
}

export function playPlayerAnim(anim, name, opts){
  playClip(anim, name, opts);
}

export function playerAnimFinished(anim){
  return isFinished(anim);
}

export function updatePlayerAnimation(anim, images, dt){
  updateAnimator(anim, images, dt);
}

export function drawPlayer(ctx, images, anim, screenX, screenY, zoom){
  drawAnimator(ctx, anim, images, screenX, screenY, zoom, PLAYER_DISPLAY_SIZE, anim.facingLeft);
}
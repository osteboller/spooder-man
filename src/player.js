import { createAnimator, playClip, updateAnimator, drawAnimator, isFinished, setFrameByPhase } from './animator.js';

// One clip = one strip file (assets/sprites/player_<name>.png). Tune
// frameDuration/loop to taste — frame size and count are read from each
// image automatically, so these numbers are the only thing to adjust.
export const PLAYER_DISPLAY_SIZE = 400; // on-screen size at zoom 1, independent of source resolution

export const PLAYER_CLIPS = {
  idle:   { imgKey: 'playerIdle',   frameDuration: 150, loop: true  },
  grab:   { imgKey: 'playerGrab',   frameDuration: 120,  loop: false }, // swings, settles, holds last frame
  windup: { imgKey: 'playerWindup', frameDuration: 120,  loop: false }, // just the start of the jump, not a hold-loop
  roll:   { imgKey: 'playerRoll',   frameDuration: 120,  loop: false }, // plays once, freezes on last frame for the rest of the flight
  attack: { imgKey: 'playerAttack', frameDuration: 120,  loop: false }, // plays once, then game.js resumes 'roll'
  hurt:   { imgKey: 'playerHurt',   frameDuration: 120,  loop: false }, // plays once, freezes on last frame

  // Rope-swing clips. ropeSwing1/2 alternate on every rope cast (a fresh
  // grab, or swapping mid-swing), like alternating hands. swingTurn plays on
  // a direction reversal mid-swing, then game.js resumes whichever ropeSwing
  // was active. All three are driven directly by the swing's own angle
  // (game.js calls setPlayerSwingFrame each tick) rather than by a timer, so
  // they keep pace with how fast the player is actually swinging — hence
  // frameDuration: Infinity, which parks the normal time-based playback.
  // swingStop is the exception: a plain timed flourish on letting go.
  ropeSwing1: { imgKey: 'playerSwing1',    frameDuration: Infinity, loop: true },
  ropeSwing2: { imgKey: 'playerSwing2',    frameDuration: Infinity, loop: true },
  swingTurn:  { imgKey: 'playerSwingTurn',  frameDuration: Infinity, loop: false },
  swingStop:  { imgKey: 'playerSwingStop',  frameDuration: 90,  loop: false },
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

// See setFrameByPhase in animator.js — phase is 0 (hanging straight down) to
// 1 (as far out as the current clip's art goes).
export function setPlayerSwingFrame(anim, images, phase){
  setFrameByPhase(anim, images, phase);
}

export function drawPlayer(ctx, images, anim, screenX, screenY, zoom){
  drawAnimator(ctx, anim, images, screenX, screenY, zoom, PLAYER_DISPLAY_SIZE, anim.facingLeft);
}
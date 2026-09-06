// Placeholder sound effects synthesized with the Web Audio API — no sound
// files needed yet. When you have real recorded SFX, drop them in
// assets/audio/ and swap the body of playSfx() for buffer playback; every
// call site (game.js) stays the same.
let audioCtx = null;

function getCtx(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep(freq, duration, type = 'sine', gainVal = 0.15){
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain).connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(gainVal, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function pitchDrop(startFreq, endFreq, duration, type = 'square', gainVal = 0.2){
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  gain.gain.setValueAtTime(gainVal, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

let sfxMuted = false;
export function setSfxMuted(muted){ sfxMuted = muted; }
export function isSfxMuted(){ return sfxMuted; }

export function playSfx(name){
  if(sfxMuted) return;
  switch(name){
    case 'launch':
      beep(320, 0.12, 'square', 0.1);
      break;
    case 'grab':
      beep(660, 0.15, 'triangle', 0.18);
      setTimeout(() => beep(880, 0.12, 'triangle', 0.15), 60);
      break;
    case 'fail':
      beep(160, 0.35, 'sawtooth', 0.18);
      break;
    case 'win':
      [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.16), i * 90));
      break;
    case 'defeat':
      beep(1046, 0.1, 'square', 0.16);
      setTimeout(() => beep(1318, 0.08, 'square', 0.14), 50);
      break;
    case 'hit':
      pitchDrop(220, 55, 0.22, 'square', 0.22);
      break;
    case 'powerup':
      beep(520, 0.08, 'square', 0.1);
      setTimeout(() => beep(780, 0.09, 'square', 0.11), 55);
      break;
  }
}

// Background music. Decoding the file doesn't need a user gesture, so it's
// safe to kick off during boot — but actually starting playback does (every
// mobile/desktop browser blocks audio until the first tap/click/keypress),
// so startBgm() must only be called from inside a real input handler.
const BGM_TRACK = 'assets/audio/bgm/Neon Hero Run.mp3';
const BGM_VOLUME = 0.35;

let bgmBuffer = null;
let bgmSource = null;
let bgmGain = null;
let bgmMuted = false;

export async function loadBgm(){
  const ctx = getCtx();
  const res = await fetch(encodeURI(BGM_TRACK));
  const data = await res.arrayBuffer();
  bgmBuffer = await ctx.decodeAudioData(data);
}

export function setBgmMuted(muted){
  bgmMuted = muted;
  if(bgmGain) bgmGain.gain.value = muted ? 0 : BGM_VOLUME;
}
export function isBgmMuted(){ return bgmMuted; }

export function startBgm(){
  if(!bgmBuffer || bgmSource) return; // not loaded yet, or already playing
  const ctx = getCtx();
  bgmGain = ctx.createGain();
  bgmGain.gain.value = bgmMuted ? 0 : BGM_VOLUME;
  bgmSource = ctx.createBufferSource();
  bgmSource.buffer = bgmBuffer;
  bgmSource.loop = true;
  bgmSource.connect(bgmGain).connect(ctx.destination);
  bgmSource.start(0);
}
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

// Volume is one persisted 0..1 number per channel — the toolbar's mute
// button and the options slider both just read/write this same value, so
// they can't fall out of sync with each other. "Mute" isn't a separate flag:
// it remembers whatever the volume was and drops it to 0, so unmuting
// restores exactly what the slider was at, not some fixed default.
const SETTINGS_KEY = 'gribAudioSettings';
const BGM_VOLUME_DEFAULT = 0.35;
const SFX_VOLUME_DEFAULT = 1;

let bgmVolume = BGM_VOLUME_DEFAULT;
let sfxVolume = SFX_VOLUME_DEFAULT;
let bgmVolumeBeforeMute = BGM_VOLUME_DEFAULT;
let sfxVolumeBeforeMute = SFX_VOLUME_DEFAULT;

(function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return;
    const s = JSON.parse(raw);
    if(typeof s.bgmVolume === 'number') bgmVolume = s.bgmVolume;
    if(typeof s.sfxVolume === 'number') sfxVolume = s.sfxVolume;
  } catch(e){ /* localStorage unavailable (private mode, etc.) — just use defaults */ }
})();

function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bgmVolume, sfxVolume })); }
  catch(e){ /* ignore — persistence is a nicety, not a requirement */ }
}

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

export function getBgmVolume(){ return bgmVolume; }
export function getSfxVolume(){ return sfxVolume; }
export function isBgmMuted(){ return bgmVolume <= 0; }
export function isSfxMuted(){ return sfxVolume <= 0; }

export function setBgmVolume(v){
  bgmVolume = clamp01(v);
  if(bgmVolume > 0) bgmVolumeBeforeMute = bgmVolume;
  if(bgmGain) bgmGain.gain.value = bgmVolume;
  saveSettings();
}
export function setSfxVolume(v){
  sfxVolume = clamp01(v);
  if(sfxVolume > 0) sfxVolumeBeforeMute = sfxVolume;
  saveSettings();
}
export function toggleBgmMute(){ setBgmVolume(bgmVolume > 0 ? 0 : (bgmVolumeBeforeMute || BGM_VOLUME_DEFAULT)); }
export function toggleSfxMute(){ setSfxVolume(sfxVolume > 0 ? 0 : (sfxVolumeBeforeMute || SFX_VOLUME_DEFAULT)); }

function beep(freq, duration, type = 'sine', gainVal = 0.15){
  if(sfxVolume <= 0) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain).connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(gainVal * sfxVolume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function pitchDrop(startFreq, endFreq, duration, type = 'square', gainVal = 0.2){
  if(sfxVolume <= 0) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  gain.gain.setValueAtTime(gainVal * sfxVolume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

export function playSfx(name){
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

// Background music. Decoding a file doesn't need a user gesture, so it's
// safe to kick off during boot — but actually starting playback does (every
// mobile/desktop browser blocks audio until the first tap/click/keypress),
// so startBgm() must only be called from inside a real input handler.
//
// Two named tracks, switchable: 'intro' plays from the earliest gesture the
// page gets (loading screen or title screen, whichever comes first — see
// main.js), 'level' takes over the moment the first course actually starts.
const BGM_TRACKS = {
  intro: 'assets/audio/bgm/bgm_intro.mp3',
  level: 'assets/audio/bgm/bgm_1.mp3',
};

const bgmBuffers = {}; // track name -> decoded AudioBuffer
let bgmSource = null;  // the currently-playing source node, if any
let bgmGain = null;
let currentBgmName = null;

export async function loadBgm(){
  const ctx = getCtx();
  const entries = Object.entries(BGM_TRACKS);
  // allSettled, not all — one track failing to fetch/decode shouldn't cost
  // us the other, and each gets its own console warning instead of a single
  // opaque failure for "the music".
  const results = await Promise.allSettled(entries.map(async ([name, src]) => {
    const res = await fetch(encodeURI(src));
    if(!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
    const data = await res.arrayBuffer();
    bgmBuffers[name] = await ctx.decodeAudioData(data);
  }));
  results.forEach((r, i) => {
    if(r.status === 'rejected') console.warn(`Background music track "${entries[i][0]}" failed to load:`, r.reason);
  });
}

function stopBgm(){
  if(!bgmSource) return;
  try{ bgmSource.stop(); } catch(e){ /* already stopped — fine */ }
  bgmSource.disconnect();
  bgmSource = null;
}

// name: 'intro' (default) or 'level'. Switching while something is already
// playing stops it first; calling with the track that's already playing is
// a harmless no-op.
export function startBgm(name = 'intro'){
  if(currentBgmName === name && bgmSource) return;
  if(!bgmBuffers[name]) return; // not loaded (or failed) — silently do nothing rather than throw
  stopBgm();
  const ctx = getCtx();
  bgmGain = ctx.createGain();
  bgmGain.gain.value = bgmVolume;
  bgmSource = ctx.createBufferSource();
  bgmSource.buffer = bgmBuffers[name];
  bgmSource.loop = true;
  bgmSource.connect(bgmGain).connect(ctx.destination);
  bgmSource.start(0);
  currentBgmName = name;
}

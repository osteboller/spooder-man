// Point values/colors for the three collectible node tiers, the speed bonus
// for chaining jumps quickly, and the run-timer text format. Shared by
// level.js (assigning a tier when a course is generated) and game.js/ui.js
// (scoring + HUD + win text).
export const NODE_TIERS = [
  { key: 'common', color: '#ffd23f', points: 10, weight: 60, mark: null },
  { key: 'rare',   color: '#5ec8f8', points: 25, weight: 30, mark: '✦' }, // ✦
  { key: 'epic',   color: '#ff6fd8', points: 50, weight: 10, mark: '★' }, // ★
];

export function pickNodeTier(){
  const total = NODE_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for(const tier of NODE_TIERS){
    if(roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return NODE_TIERS[0];
}

// Reward chaining jumps fast: the sooner you launch off one node and land on
// the next (charging a lower power level costs less time), the bigger the
// bonus. Ordered fastest-first — the first threshold beaten wins.
const SPEED_BONUS_TIERS = [
  { underMs: 900,  points: 30, label: 'LIGHTNING FAST!' },
  { underMs: 1500, points: 15, label: 'FAST!' },
  { underMs: 2200, points: 5,  label: 'GOOD PACE' },
];

export function getSpeedBonus(hopMs){
  return SPEED_BONUS_TIERS.find(t => hopMs < t.underMs) ?? null;
}

export function formatTime(ms){
  const totalDs = Math.floor(ms / 100); // deciseconds
  const minutes = Math.floor(totalDs / 600);
  const seconds = Math.floor((totalDs % 600) / 10);
  const deci = totalDs % 10;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${deci}`;
}

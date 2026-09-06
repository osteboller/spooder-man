import { pickNodeTier } from './scoring.js';

// Generates one course: a start node, a run of checkpoints, and a goal.
// Nodes can be grabbed in any order once you're airborne — this only decides
// their layout, not the order you have to visit them in.
// Picks `count` y-values within [-bandHalf, bandHalf] that are each at
// least minGap apart, so a wave's points scatter naturally instead of
// clustering or overlapping.
function scatterYs(count, bandHalf, minGap){
  const ys = [];
  let attempts = 0;
  while(ys.length < count && attempts < count * 40){
    attempts++;
    const candidate = (Math.random() * 2 - 1) * bandHalf;
    if(ys.every(y => Math.abs(y - candidate) >= minGap)) ys.push(candidate);
  }
  while(ys.length < count) ys.push((Math.random() * 2 - 1) * bandHalf);
  return ys;
}

// Spacing is built around what the player can actually cross. A plain hop
// reaches v²/g — about 510px at power 1, 970px at power 2 — while a rope
// swing carries roughly 1100px plus whatever speed you leave the arc with.
// So the far grips sit in rope territory, and every wave also plants one or
// two deliberately close ones a plain hop can make, as a visible safe route.
const HOP_MIN_DX = 380, HOP_MAX_DX = 580;
const SWING_MIN_DX = 900, SWING_MAX_DX = 1350;
// No two grips may end up closer than this — the hop/swing ranges above are
// each computed relative to a single "from" reference, so two nodes drawn
// from overlapping ranges (most often the two same-wave hop grips, both hung
// off nearby previous-wave nodes) could land almost on top of each other.
// Measured worst case across 500 generated courses before this existed: 10px
// apart — landing radii overlapped entirely, so releasing from one grip
// immediately re-grabbed the other and back, forever.
const MIN_NODE_SEPARATION = 220;

function farEnoughFromAll(x, y, list){
  return list.every(n => Math.hypot(n.x - x, n.y - y) >= MIN_NODE_SEPARATION);
}

// Generates one course: a start node, several "waves" moving left to right,
// each scattering a few nodes across a wide vertical band, and a goal.
// Nodes can be grabbed in any order once you're airborne — this only decides
// their layout, not the order you have to visit them in.
export function generateLevel({ waves = 5, rows = 3 } = {}){
  const start = { x: 0, y: 0, r: 44, isGoal: false, grabbed: true };
  const list = [start];

  let prevWave = [start];
  let x = 0;

  for(let w = 1; w <= waves; w++){
    x += SWING_MIN_DX + Math.random() * (SWING_MAX_DX - SWING_MIN_DX) + w * 20;
    const r = Math.max(30, 44 - w * 1.2); // shrinks more gently than before — these are much longer flights to land
    const hopCount = Math.random() < 0.5 ? 2 : 1;
    const ys = scatterYs(rows, 620, 180);
    const wave = [];

    for(let i = 0; i < rows; i++){
      // Re-rolled up to 20x against every node placed so far (this wave and
      // all previous ones), not just the one it's anchored to — the retry is
      // cheap and 20 attempts practically always finds a spot MIN_NODE_SEPARATION
      // away, given the ranges below are hundreds of px wide.
      let nodeX, nodeY, tries = 0;
      do {
        if(i < hopCount){
          // A close grip, hung off a node from the previous wave so it's a real
          // hop between two specific grips. The first one anchors to that
          // wave's furthest-right node so the safe route keeps pace with the
          // course; a second one can hang off anywhere in the wave.
          const from = i === 0
            ? prevWave.reduce((a, b) => (b.x > a.x ? b : a))
            : prevWave[Math.floor(Math.random() * prevWave.length)];
          nodeX = from.x + HOP_MIN_DX + Math.random() * (HOP_MAX_DX - HOP_MIN_DX);
          // Level-ish or below, never far above — an upward hop eats range fast.
          nodeY = from.y + (Math.random() * 380 - 120);
        } else {
          nodeX = x + (Math.random() * 240 - 120);
          nodeY = ys[i] + (Math.random() * 100 - 50);
        }
        tries++;
        // The two same-wave hop grips (i=0 and i=1 when hopCount===2) draw
        // from the exact same "from" in the exact same 200x380 rectangle —
        // early on (wave 1, prevWave has only the start node) they have no
        // other choice of anchor at all. That rectangle is narrower than
        // MIN_NODE_SEPARATION, so plain resampling can exhaust its retries
        // against genuinely bad luck. Once that's close to happening, force
        // clear Y separation from the sibling instead of hoping the RNG finds it.
        if(tries === 15 && i > 0 && i < hopCount){
          nodeY = wave[i - 1].y - (MIN_NODE_SEPARATION + 40);
        }
      } while(!farEnoughFromAll(nodeX, nodeY, list) && tries < 20);

      const tier = pickNodeTier();
      const node = {
        x: nodeX, y: nodeY, r, isGoal: false, grabbed: false,
        tierColor: tier.color, points: tier.points, mark: tier.mark
      };
      wave.push(node);
      list.push(node);
    }
    prevWave = wave;
  }

  x += 800 + Math.random() * 400;
  const y = Math.random() * 400 - 200;
  list.push({ x, y, r: 46, isGoal: true, grabbed: false });

  return list;
}

export function remainingNodes(nodes){
  return nodes.filter(n => !n.grabbed);
}

export function nearestRemaining(nodes, from){
  let best = null, bestD = Infinity;
  for(const n of nodes){
    if(n.grabbed) continue;
    const d = Math.hypot(n.x - from.x, n.y - from.y);
    if(d < bestD){ bestD = d; best = n; }
  }
  return best;
}

// Places a couple of bobbing enemies in gaps between nodes (never in the
// opening gap, so the first jump is always safe). Each sits roughly midway
// between the two nodes on either side and bobs vertically around that point.
export function generateEnemies(nodes, count = 2){
  const gapCount = nodes.length - 1;
  if(gapCount <= 1) return [];

  const candidateGaps = [];
  for(let i = 1; i < gapCount; i++) candidateGaps.push(i);
  for(let i = candidateGaps.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [candidateGaps[i], candidateGaps[j]] = [candidateGaps[j], candidateGaps[i]];
  }

  return candidateGaps.slice(0, Math.min(count, candidateGaps.length)).map(idx => {
    const a = nodes[idx], b = nodes[idx + 1];
    const t = 0.45 + Math.random() * 0.1;
    const x = a.x + (b.x - a.x) * t;
    const baseY = a.y + (b.y - a.y) * t;
    return {
      x, baseY, y: baseY,
      amplitude: 45 + Math.random() * 30,
      speed: 0.0022 + Math.random() * 0.0012,
      phase: Math.random() * Math.PI * 2,
      r: 17,
      defeated: false,
      resolved: false,
      engaged: false,
      frameIndex: Math.floor(Math.random() * 4),
      frameTimer: Math.random() * 140
    };
  });
}

// One 1-up coin per course: same "never the opening gap" rule as enemies,
// clear of every node's landing radius and every enemy's full bobbing range
// (not just its rest position) so it never spawns somewhere you can't
// actually collect without also either landing or getting hit.
export function generateCoin(nodes, enemies){
  const gapCount = nodes.length - 1;
  if(gapCount <= 1) return null;

  for(let tries = 0; tries < 20; tries++){
    const idx = 1 + Math.floor(Math.random() * (gapCount - 1));
    const a = nodes[idx], b = nodes[idx + 1];
    const t = 0.3 + Math.random() * 0.4;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t + (Math.random() * 160 - 80);

    const nearEnemy = enemies.some(e => Math.hypot(e.x - x, e.baseY - y) < e.amplitude + 90);
    const nearNode = nodes.some(n => Math.hypot(n.x - x, n.y - y) < n.r + 90);
    if(!nearEnemy && !nearNode) return { x, y, frameIndex: 0, frameTimer: 0 };
  }
  return null; // rare — the course just goes without a coin rather than force a bad spot
}
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

// Generates one course: a start node, several "waves" moving left to right,
// each scattering a few nodes across a wide vertical band, and a goal.
// Nodes can be grabbed in any order once you're airborne — this only decides
// their layout, not the order you have to visit them in.
export function generateLevel({ waves = 5, rows = 3 } = {}){
  const list = [{ x: 0, y: 0, r: 44, isGoal: false, grabbed: true }];

  let x = 0;
  for(let w = 1; w <= waves; w++){
    x += 280 + Math.random() * 140 + w * 10;
    const r = Math.max(22, 40 - w * 1.6);
    const ys = scatterYs(rows, 380, 100);
    for(const baseY of ys){
      const nodeX = x + (Math.random() * 160 - 80);
      const nodeY = baseY + (Math.random() * 60 - 30);
      const tier = pickNodeTier();
      list.push({
        x: nodeX, y: nodeY, r, isGoal: false, grabbed: false,
        tierColor: tier.color, points: tier.points, mark: tier.mark
      });
    }
  }

  x += 300 + Math.random() * 110;
  const y = Math.random() * 200 - 100;
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
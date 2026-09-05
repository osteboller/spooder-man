import { createCamera, toScreen } from './camera.js';
import { GRAVITY, simulateTrajectory, dist } from './physics.js';
import { generateLevel, remainingNodes, nearestRemaining, generateEnemies } from './level.js';
import {
  createPlayerAnimator, resetPlayerAnimator,
  updatePlayerAnimation, drawPlayer, playPlayerAnim, playerAnimFinished
} from './player.js';
import { pickBackground, drawBackground } from './background.js';
import { updateEnemy, drawEnemy, ENEMY_WARN_MARGIN } from './enemy.js';
import { playSfx } from './audio.js';
import { getSpeedBonus, formatTime } from './scoring.js';

const ROT_PERIODS = [1800, 1600, 1400]; // ms per full rotation, per power level 1/2/3
const SPEEDS = [16, 22, 30];             // power level 1,2,3
const PLAYER_R = 14;
const MAX_FLIGHT_FRAMES = 420;
const ZOOM_TARGETS = { idle: 0.8, charging: 0.68, flying: 0.6, dead: 1.3, won: 0.8 };
const ROTATIONS_PER_LEVEL = 2; // full aim-rotations needed to auto-bump power up one notch
const CHARGE_HOLD_MULTIPLIER = 2; // holding the button spins the aim (and charges power) this much faster
const MAX_LIVES = 3;
const HIT_FREEZE_MS = 120;    // brief hitstop when the player takes a hit or fails a jump
const DEFEAT_FREEZE_MS = 90;  // shorter punch-through freeze for landing a hit on an enemy
const DEATH_HOLD_MS = 550;    // camera stays punched in on the frozen hurt pose this long before letting go

export function createGame(canvas, images){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cam = createCamera();
  const anim = createPlayerAnimator();

  let nodes = [];
  let currentIndex = 0;
  let state = 'idle'; // idle -> charging -> flying -> dead -> won
  let angleAccum = 0;
  let powerAccum = 0; // independent of angleAccum, so holding can speed this up without spinning the aim faster
  let spinDir = 1;
  let lastFrameTime = 0;
  let currentAngle = 0;
  let currentPowerLevel = 1;
  let currentPowerProgress = 0;
  let flight = null;
  let flightFrames = 0;
  let bgImage = null;
  let enemies = [];
  let elapsedMs = 0;
  let points = 0;
  let lastLandTime = 0;
  let prevPowerLevel = 1;
  let powerPunch = { index: -1, startTime: -Infinity }; // "juice" pop when a power pip fills up
  let lives = MAX_LIVES;
  let freezeMs = 0; // hitstop: counts down to 0 before update() does anything else
  let deathHoldMs = 0; // after that: camera still centers the frozen player until this runs out, then releases into the fall

  function currentNode(){ return nodes[currentIndex]; }

  function resetGame(ui){
    nodes = generateLevel();
    currentIndex = 0;
    state = 'idle';
    flight = null;
    cam.x = currentNode().x;
    cam.y = currentNode().y;
    cam.zoom = 1;
    angleAccum = 0;
    powerAccum = 0;
    currentPowerLevel = 1;
    currentPowerProgress = 0;
    prevPowerLevel = 1;
    powerPunch = { index: -1, startTime: -Infinity };
    spinDir = 1;
    lastFrameTime = performance.now();
    resetPlayerAnimator(anim);
    bgImage = pickBackground(images);
    enemies = generateEnemies(nodes);
    elapsedMs = 0;
    points = 0;
    lastLandTime = 0;
    lives = MAX_LIVES;
    freezeMs = 0;
    deathHoldMs = 0;

    ui.setTotal(nodes.length - 1);
    ui.setGrabs(0);
    ui.setPoints(0);
    ui.setTime(0);
    ui.setLives(lives, MAX_LIVES);
    ui.hideMessage();
  }

  // Pressing arms the shot and shows the windup pose. Power and angle keep
  // ticking whether you're pressing or not, but holding down speeds that
  // clock up (CHARGE_HOLD_MULTIPLIER) — release still fires at whatever
  // angle/power the clock happens to be at.
  function startCharge(){
    if(state !== 'idle') return;
    state = 'charging';
    playPlayerAnim(anim, 'windup');
  }

  // Releasing is the actual jump — fires using whatever angle/power the
  // background auto-charge happens to be at in this exact instant.
  function releaseCharge(){
    if(state !== 'charging') return;
    const speed = SPEEDS[currentPowerLevel - 1];
    const cn = currentNode();
    const vx = Math.cos(currentAngle) * speed;
    flight = { x: cn.x, y: cn.y, vx, vy: -Math.sin(currentAngle) * speed, originIndex: currentIndex };
    anim.facingLeft = vx < 0;
    playPlayerAnim(anim, 'roll');
    flightFrames = 0;
    state = 'flying';
    playSfx('launch');
  }

  function tryDefeatEnemies(){
    if(!flight) return;
    let defeatedAny = false;
    for(const e of enemies){
      if(e.resolved) continue;
      if(dist(flight.x, flight.y, e.x, e.y) > e.r + ENEMY_WARN_MARGIN) continue; // must be in range right now, not just at some earlier point in the flight
      e.defeated = true;
      e.resolved = true;
      defeatedAny = true;
      playSfx('defeat');
    }
    if(defeatedAny){
      playPlayerAnim(anim, 'attack');
      freezeMs = DEFEAT_FREEZE_MS; // a short punch-through freeze to sell the hit
    }
  }

  // Shared by a real landing and a post-stumble respawn: back to a standing
  // stance on solid ground, aim/power charge restarting fresh from here.
  function returnToIdleStance(){
    state = 'idle';
    flight = null;
    spinDir *= -1;
    powerAccum = 0;
    currentPowerLevel = 1;
    currentPowerProgress = 0;
    prevPowerLevel = 1;
    powerPunch = { index: -1, startTime: -Infinity };
  }

  function landSuccess(node, ui){
    const wasNew = !node.grabbed;
    node.grabbed = true;
    currentIndex = nodes.indexOf(node);
    returnToIdleStance();
    playPlayerAnim(anim, 'grab');

    const hopMs = elapsedMs - lastLandTime;
    lastLandTime = elapsedMs;
    const bonus = (wasNew && !node.isGoal) ? getSpeedBonus(hopMs) : null;

    if(wasNew){
      const grabbedCount = nodes.filter(n => n.grabbed).length - 1;
      ui.setGrabs(grabbedCount);
      if(!node.isGoal){
        points += node.points + (bonus ? bonus.points : 0);
        ui.setPoints(points);
      }
    }

    if(node.isGoal){
      state = 'won';
      playSfx('win');
      ui.showMessage(
        `FINISH! 🏁<br><small>Time: ${formatTime(elapsedMs)} · Score: ${points}</small><br><small>Press for a new course</small>`,
        { win: true }
      );
      return;
    }

    if(wasNew){
      playSfx('grab');
      const gain = bonus ? `+${node.points + bonus.points} · ${bonus.label}` : `+${node.points}`;
      ui.showMessage(`NICE GRAB!<br><small>${gain}</small>`, { brief: true, shouldHide: () => state === 'idle' });
    }
    // revisiting a node you've already grabbed: just move there, no fanfare
  }

  // A stumble that still leaves lives in the bank: hop back onto the same
  // checkpoint and keep going, instead of regenerating the whole course.
  function respawnAtCheckpoint(ui){
    returnToIdleStance();
    resetPlayerAnimator(anim);
    lastLandTime = elapsedMs; // the stumble shouldn't cost the next hop its speed bonus
    ui.hideMessage();
  }

  function triggerHurt(){
    if(anim.current !== 'hurt'){
      playPlayerAnim(anim, 'hurt');
      freezeMs = HIT_FREEZE_MS; // a beat of stillness right on impact, for weight
    }
  }

  function loseLife(ui){
    lives--;
    ui.setLives(lives, MAX_LIVES);
  }

  function landFail(ui){
    state = 'dead';
    deathHoldMs = DEATH_HOLD_MS;
    triggerHurt();
    playSfx('fail');
    if(!flight.lifeSpent) loseLife(ui); // a hit already charged this same flight a life

    if(lives > 0){
      ui.showMessage(`YOU FELL!<br><small>${lives} ${lives === 1 ? 'LIFE' : 'LIVES'} LEFT — press to continue</small>`);
    } else {
      ui.showMessage('GAME OVER<br><small>Press for a new course</small>', { gameover: true });
    }
  }

  function update(ui){
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    if(freezeMs > 0){
      freezeMs = Math.max(0, freezeMs - dt);
      return; // hold everything on the frozen frame — draw() keeps rendering it as-is
    }

    if(state !== 'won' && state !== 'dead') elapsedMs += dt; // run clock stops the moment the round ends
    ui.setTime(elapsedMs);

    for(const e of enemies){
      if(!e.resolved) updateEnemy(e, dt, elapsedMs);
    }

    if(state === 'idle' || state === 'charging'){
      // Aim always spins at its normal, level-dependent rate — holding must
      // never make it harder to aim.
      const period = ROT_PERIODS[currentPowerLevel - 1];
      const angularSpeed = ((Math.PI * 2) / period) * spinDir;
      angleAccum += angularSpeed * dt;
      currentAngle = ((angleAccum % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

      // Power charge is a separate clock that holding speeds up.
      const holdMultiplier = state === 'charging' ? CHARGE_HOLD_MULTIPLIER : 1;
      powerAccum += ((Math.PI * 2) / period) * holdMultiplier * dt;
      currentPowerProgress = (powerAccum / (Math.PI * 2)) / ROTATIONS_PER_LEVEL;
      currentPowerLevel = Math.min(3, 1 + Math.floor(currentPowerProgress));

      if(currentPowerLevel > prevPowerLevel){
        powerPunch = { index: currentPowerLevel - 1, startTime: now };
        playSfx('powerup');
        prevPowerLevel = currentPowerLevel;
      }

      anim.facingLeft = Math.cos(currentAngle) < 0;
    }

    updatePlayerAnimation(anim, images, dt);
    if(state === 'flying' && anim.current === 'attack' && playerAnimFinished(anim)){
      playPlayerAnim(anim, 'roll');
    }

    if(state === 'flying'){
      flight.vy += GRAVITY;
      flight.x += flight.vx;
      flight.y += flight.vy;
      flightFrames++;

      if(!flight.doomed){
        for(const e of enemies){
          if(e.resolved) continue;
          const d = dist(flight.x, flight.y, e.x, e.y);
          const warnR = e.r + ENEMY_WARN_MARGIN;
          const hitR = e.r + PLAYER_R * 0.6;

          if(!e.engaged && d <= warnR) e.engaged = true;

          if(d <= hitR){
            e.resolved = true;
            if(!e.defeated){
              flight.vx *= -0.6;
              flight.vy = -Math.abs(flight.vy) * 0.5 - 2;
              flight.doomed = true;
              flight.lifeSpent = true;
              playSfx('hit');
              loseLife(ui);
              // Out of lives, this hit ends the run right here — no recovery
              // chance on your last life. Otherwise, knocked around but the
              // flight continues; a lucky landing below can still save it.
              if(lives <= 0) landFail(ui); else triggerHurt();
            }
            break;
          }
        }
      }

      if(state === 'flying'){ // a fatal hit just above may have already ended this
        // Landing stays possible even after a hit (flight.doomed) — knocked
        // off course and slowed down, but still lucky enough to catch a node.
        let landed = false;
        for(let i = 0; i < nodes.length; i++){
          const n = nodes[i];
          if(i === flight.originIndex && flightFrames < 8) continue;
          if(dist(flight.x, flight.y, n.x, n.y) <= n.r + PLAYER_R * 0.6){
            landSuccess(n, ui);
            landed = true;
            break;
          }
        }
        if(!landed){
          if(flightFrames > MAX_FLIGHT_FRAMES){
            landFail(ui);
          } else {
            const floorY = Math.max(...nodes.map(n => n.y)) + 500;
            if(flight.y > floorY) landFail(ui);
          }
        }
      }
    } else if(state === 'dead' && flight){
      if(deathHoldMs > 0){
        deathHoldMs = Math.max(0, deathHoldMs - dt); // stay centered on the frozen hurt pose a beat longer
      } else {
        // Hold's over — keep falling, and the camera (below) now lets go so
        // this carries the player out of frame instead of freezing forever.
        flight.vy += GRAVITY;
        flight.x += flight.vx;
        flight.y += flight.vy;
      }
    }

    let focusX, focusY;
    if(state === 'flying'){
      focusX = flight.x; focusY = flight.y;
    } else if(state === 'dead'){
      if(deathHoldMs > 0 && flight){
        focusX = flight.x; focusY = flight.y; // still punched in on the impact
      } else {
        focusX = cam.x; focusY = cam.y; // released — let the fall carry the player out of it
      }
    } else if(state === 'idle' || state === 'charging'){
      const cn = currentNode();
      const rem = remainingNodes(nodes)
        .map(n => ({ n, d: dist(cn.x, cn.y, n.x, n.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map(o => o.n);
      let cx = cn.x, cy = cn.y;
      if(rem.length){
        cx = cn.x * 0.72 + (rem.reduce((s, n) => s + n.x, 0) / rem.length) * 0.28;
        cy = cn.y * 0.72 + (rem.reduce((s, n) => s + n.y, 0) / rem.length) * 0.28;
      }
      focusX = cx; focusY = cy;
    } else {
      focusX = currentNode().x; focusY = currentNode().y;
    }
    const lerp = state === 'flying' ? 0.18 : 0.14;
    cam.x += (focusX - cam.x) * lerp;
    cam.y += (focusY - cam.y) * lerp;

    const zoomTarget = ZOOM_TARGETS[state] ?? 1.0;
    const zoomLerp = state === 'dead' ? 0.1 : 0.06;
    cam.zoom += (zoomTarget - cam.zoom) * zoomLerp;
  }

  function drawNode(node, style){
    const { x, y } = toScreen(cam, W, H, node.x, node.y);
    const r = node.r * cam.zoom;
    ctx.save();
    ctx.lineWidth = style.lw;
    ctx.strokeStyle = '#111';
    if(style.dashed) ctx.setLineDash([6,7]);
    ctx.globalAlpha = style.alpha;
    ctx.fillStyle = style.fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if(node.isGoal){
      ctx.fillStyle = '#111';
      ctx.font = `bold ${Math.round(20*cam.zoom)}px Arial`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏁', x, y+1);
    } else if(node.mark){
      ctx.fillStyle = '#111';
      ctx.font = `bold ${Math.round(18*cam.zoom)}px Arial`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(node.mark, x, y+1);
    } else {
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(x, y, 5*cam.zoom, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawCompass(){
    if(state === 'flying' || state === 'won') return;
    const cn = currentNode();
    const near = nearestRemaining(nodes, cn);
    if(!near) return;
    const { x: px, y: py } = toScreen(cam, W, H, cn.x, cn.y);
    const ang = Math.atan2(-(near.y - cn.y), near.x - cn.x);
    const rr = (PLAYER_R + 20) * cam.zoom;
    const tx = px + Math.cos(ang)*rr, ty = py - Math.sin(ang)*rr;
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(-ang);
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(-6,6); ctx.lineTo(-6,-6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  const PIP_COLORS = ['#3ecf6e', '#ffd23f', '#ff5c3d']; // heat-gauge: green -> yellow -> hot orange-red
  const PIP_PUNCH_MS = 260;

  // Pip that just filled all the way up gets a quick squash-pop + white
  // flash — the "juice" for reaching the next power level.
  function pipPunchScale(index){
    if(powerPunch.index !== index) return 1;
    const t = (performance.now() - powerPunch.startTime) / PIP_PUNCH_MS;
    if(t < 0 || t > 1) return 1;
    return 1 + 0.45 * Math.sin(t * Math.PI);
  }

  function drawPowerPips(){
    if(state !== 'idle' && state !== 'charging') return;
    const pipW = 46, pipH = 22, gap = 10;
    const totalW = pipW*3 + gap*2;
    const startX = W/2 - totalW/2, y = 30;
    for(let i=0;i<3;i++){
      const x = startX + i*(pipW+gap);
      const fill = i === 0 ? 1 : Math.max(0, Math.min(1, currentPowerProgress - (i - 1)));
      const scale = pipPunchScale(i);
      const cx = x + pipW/2, cy = y + pipH/2;
      ctx.save();
      if(scale !== 1){
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
      }
      ctx.lineWidth = 4; ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      ctx.fillRect(x,y,pipW,pipH);
      ctx.fillStyle = PIP_COLORS[i];
      ctx.fillRect(x, y, pipW*fill, pipH);
      if(fill > 0){
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, y, pipW*fill, pipH*0.4);
      }
      ctx.strokeRect(x,y,pipW,pipH);
      if(scale > 1){
        ctx.globalAlpha = ((scale - 1) / 0.45) * 0.6;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x,y,pipW,pipH);
      }
      ctx.restore();
    }
  }

  function drawAimUI(){
    if(state !== 'idle' && state !== 'charging') return;
    const cn = currentNode();
    const speed = SPEEDS[currentPowerLevel-1];
    const pts = simulateTrajectory(cn.x, cn.y, currentAngle, speed);
    ctx.save();
    ctx.setLineDash([8,10]); ctx.strokeStyle = '#fff';
    ctx.globalAlpha = state === 'charging' ? 0.9 : 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach((pt,i) => {
      const {x,y} = toScreen(cam, W, H, pt.x, pt.y);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    drawPowerPips();
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    drawBackground(ctx, bgImage, cam, W, H);

    nodes.forEach((n,i) => {
      if(n.grabbed && i !== currentIndex){
        drawNode(n, { fill:'#b9ad98', lw:3, alpha:0.6, dashed:false });
      } else if(i === currentIndex){
        drawNode(n, { fill:'#3ecf6e', lw:4, alpha:1, dashed:false });
      } else {
        drawNode(n, { fill: n.isGoal ? '#ff4b3e' : n.tierColor, lw:4, alpha:0.9, dashed:true });
      }
    });

    enemies.forEach(e => {
      if(e.resolved) return;
      const { x, y } = toScreen(cam, W, H, e.x, e.y);
      drawEnemy(ctx, images.enemy, e, x, y, cam.zoom, e.engaged);
    });

    drawCompass();
    drawAimUI();

    if((state === 'flying' || state === 'dead') && flight){
      const { x, y } = toScreen(cam, W, H, flight.x, flight.y);
      drawPlayer(ctx, images, anim, x, y, cam.zoom);
    } else if(state !== 'won'){
      const cn = currentNode();
      const { x, y } = toScreen(cam, W, H, cn.x, cn.y);
      drawPlayer(ctx, images, anim, x, y, cam.zoom);
    }
  }

  function loop(ui){
    update(ui);
    draw();
    requestAnimationFrame(() => loop(ui));
  }

  return {
    start(ui){
      resetGame(ui);
      loop(ui);
    },
    handleDown(ui){
      if(state === 'dead'){ (lives > 0 ? respawnAtCheckpoint : resetGame)(ui); return; }
      if(state === 'won'){ resetGame(ui); return; }
      if(state === 'flying'){ tryDefeatEnemies(); return; }
      startCharge();
    },
    handleUp(){
      releaseCharge();
    }
  };
}
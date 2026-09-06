import { createCamera, toScreen } from './camera.js';
import { GRAVITY, simulateTrajectory, dist } from './physics.js';
import { generateLevel, remainingNodes, nearestRemaining, generateEnemies } from './level.js';
import {
  createPlayerAnimator, resetPlayerAnimator,
  updatePlayerAnimation, drawPlayer, playPlayerAnim, playerAnimFinished, setPlayerSwingFrame,
  PLAYER_DISPLAY_SIZE
} from './player.js';
import { pickBackground, drawBackground } from './background.js';
import { updateEnemy, drawEnemy, ENEMY_WARN_MARGIN } from './enemy.js';
import { playSfx } from './audio.js';
import { getSpeedBonus, formatTime } from './scoring.js';

const ROT_PERIODS = [1800, 1600, 1400]; // ms per full rotation, per power level 1/2/3
const SPEEDS = [16, 22, 30];             // power level 1,2,3
const PLAYER_R = 14;
const MAX_FLIGHT_FRAMES = 420;
const AIRBORNE_ZOOM = 0.6; // shared by 'flying' and 'swinging' so transitions between them never pop the zoom lerp
const ZOOM_TARGETS = { idle: 0.8, charging: 0.68, flying: AIRBORNE_ZOOM, swinging: AIRBORNE_ZOOM, dead: 1.3, won: 0.8 };
const ROTATIONS_PER_LEVEL = 2; // full aim-rotations needed to auto-bump power up one notch
const CHARGE_HOLD_MULTIPLIER = 2; // holding the button spins the aim (and charges power) this much faster
const MAX_LIVES = 3;
const HIT_FREEZE_MS = 120;    // brief hitstop when the player takes a hit or fails a jump
const DEFEAT_FREEZE_MS = 90;  // shorter punch-through freeze for landing a hit on an enemy
const DEATH_HOLD_MS = 550;    // camera stays punched in on the frozen hurt pose this long before letting go
const MIN_DRAG_PX = 24;       // shorter drags on release are treated as accidental, no rope fires
const ANCHOR_MARGIN_PX = 48;  // screen px the anchor sits above the visible top edge — guarantees it's always off-screen
const ROPE_RELEASE_HOP = 4;   // small upward kick on dismounting a rope (not on a rope-to-rope swap) — reads as a little jump off the swing
const ROPE_CATCH_SPEED_KEEP = 1; // fraction of your speed a new rope keeps when it catches you: 1 = chaining ropes costs nothing, lower = each catch bleeds some speed
const LAND_FORGIVENESS = 6;   // world units of extra landing leniency on top of the node/player radii
const SWING_CAST_ANGLE = 45 * Math.PI / 180; // fixed angle (from straight down) the rope always attaches at — only left/right depends on the drag, not distance. Also ropeSwing1/2's frame-0 pose.
const SWING_TURN_MIN_ANGLE = 15 * Math.PI / 180; // crests smaller than this skip the turn flourish entirely — a nearly settled swing just rocks through the middle frames instead
const SWING_TURN_ARC = 12 * Math.PI / 180; // fixed angular span (not a fraction of the peak) the turn plays out over — a fixed span still takes longer for a small/dying peak, since gravity's pull back through it is weaker there too
const ROPE_FADE_MS = 1400;      // how long a released rope lingers as a fading afterimage
const ROPE_DOT_SPACING_PX = 11;      // spacing between rope dots at zoom 1
// Fraction of the player's own on-screen size (PLAYER_DISPLAY_SIZE * zoom)
// hidden nearest them, on both the live rope and its afterimage — tied to
// the sprite's actual rendered size (not a flat pixel count) so the rope
// reads as coming from around their hand, not from inside their body,
// regardless of zoom. Tune this once you can see it against the real art.
const ROPE_HIDE_NEAR_PLAYER_FRACTION = 0.35;

export function createGame(canvas, images){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cam = createCamera();
  const anim = createPlayerAnimator();

  let nodes = [];
  let currentIndex = 0;
  let state = 'idle'; // idle -> charging -> flying <-> swinging -> dead -> won
  let downState = null; // state captured at press-time, so handleUp knows what gesture it's closing out
  let swingSlot = 1; // alternates 1/2 on every rope cast, so the pose alternates like hand-over-hand
  let ghostRopes = []; // fading afterimages of ropes just let go — world-space endpoints + when they were released
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
    ghostRopes = [];

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

  // Fires the rope off a press-drag-release gesture made while airborne. The
  // anchor is a purely virtual point that must NEVER be visible: its height
  // is always pinned just above the current viewport's top edge (regardless
  // of drag length), and it always sits at a fixed SWING_CAST_ANGLE from
  // straight-down — only the drag's left/right side chooses which way it
  // leans, not how far you dragged (that only has to clear MIN_DRAG_PX to
  // count as an intentional cast at all). Aiming mirrors the drag ("pull to
  // launch", like a slingshot) — dragging down-and-right sends the rope up-and-left.
  function maybeCastRope(dragDelta){
    // state can change out from under a held-down gesture — the physics loop
    // keeps running between this press and its matching release, and can
    // land, time out, or kill the player while the finger/mouse is still
    // down. Casting must check the CURRENT state, not just that a stale
    // `flight` object still exists, or a death mid-hold can be "undone" by
    // a rope cast that fires on release.
    if(state !== 'flying' || !flight) return false;
    const dragMag = Math.hypot(dragDelta.dx, dragDelta.dy);
    if(dragMag < MIN_DRAG_PX) return false;
    const pullX = -dragDelta.dx; // mirrored: the rope goes opposite the drag
    const side = Math.sign(pullX) || 1; // a straight-up drag has no side — default right
    // Anchored off the player's own position and the zoom flight/swinging
    // always settles at — NOT cam.y/cam.zoom, which lag behind via their own
    // lerp. Using the live camera state here meant a rope cast while the
    // camera hadn't caught up (e.g. right after swinging upward fast) got a
    // shorter, too-close anchor than one cast a moment later — inconsistent
    // reach that read as random braking when chaining ropes mid-swing.
    const anchorY = flight.y - (H / 2 + ANCHOR_MARGIN_PX) / AIRBORNE_ZOOM;
    const vertDist = flight.y - anchorY; // > 0, anchor is always above
    const anchorX = flight.x + side * vertDist * Math.tan(SWING_CAST_ANGLE);
    flight.anchor = { x: anchorX, y: anchorY };
    flight.ropeLength = dist(flight.x, flight.y, anchorX, anchorY);
    // The cast position IS the starting extreme of this swing (like a
    // pendulum released from rest at its peak) — so the very first motion is
    // always inward, never a "reversal." Recording the actual signed angle
    // (not just assuming exactly SWING_CAST_ANGLE) keeps this robust even if
    // side/geometry ever changes.
    flight.castAngle = Math.atan2(flight.x - anchorX, flight.y - anchorY);
    flight.swingPrevAbsAngle = Math.abs(flight.castAngle);
    flight.swingGrowing = false;

    // The rope "catches" you smoothly instead of jerking: whatever speed you
    // arrive with is redirected to run purely along the new rope's arc,
    // keeping its full magnitude. Without this, momentum you built on the old
    // rope points partly straight at the new anchor, so the rope hangs slack,
    // you drop, and it snaps tight — the lurch that made chaining ropes
    // mid-swing slower than letting go and re-casting.
    //
    // The arc direction is chosen by where you AIMED, not by where you were
    // already heading: it's a grapple gun, so firing up-and-right swings you
    // right, even if you were drifting left. That also keeps the swing always
    // starting at its outer extreme and sweeping inward, which is what the
    // ropeSwing1/2 frames depict in order.
    const speed = Math.hypot(flight.vx, flight.vy) * ROPE_CATCH_SPEED_KEEP;
    if(speed > 0 && flight.ropeLength > 0){
      const nx = (flight.x - anchorX) / flight.ropeLength; // anchor -> player
      const ny = (flight.y - anchorY) / flight.ropeLength;
      let tx = -ny, ty = nx;                               // perpendicular to the rope
      if(tx * side < 0){ tx = -tx; ty = -ty; }             // swing toward the side you fired at
      flight.vx = tx * speed;
      flight.vy = ty * speed;
    }

    state = 'swinging';
    swingSlot = swingSlot === 1 ? 2 : 1;
    playPlayerAnim(anim, 'ropeSwing' + swingSlot);
    return true;
  }

  // Letting go mid-swing: keep whatever momentum the swing built up and drop
  // back into normal projectile physics. The little upward kick is for
  // actually dismounting — a rope-to-rope handoff passes hop:false, since
  // being nudged upward mid-handoff just fights the swing you're continuing.
  function releaseRope({ hop = true } = {}){
    // The rope doesn't just vanish — its free end keeps swinging on the same
    // anchor under its own momentum (a tiny independent pendulum sim, see
    // updateGhostRopes) while it fades out, instead of freezing in place.
    ghostRopes.push({
      x: flight.x, y: flight.y, vx: flight.vx, vy: flight.vy,
      anchorX: flight.anchor.x, anchorY: flight.anchor.y, ropeLength: flight.ropeLength,
      startTime: performance.now()
    });
    flight.anchor = null;
    flight.ropeLength = null;
    if(hop) flight.vy -= ROPE_RELEASE_HOP; // a little jump off the swing, on top of whatever momentum it built up
    flightFrames = 0; // fresh timeout budget for this new free-flight segment — don't inherit stale pre-swing time
    state = 'flying';
    playPlayerAnim(anim, 'swingStop');
  }

  // The release-gesture's drag can aim a NEW rope before the old one lets
  // go — so swapping is one motion: let go of the current rope, then
  // immediately try to catch the next one with the same drag.
  function swapRope(dragDelta){
    if(state !== 'swinging') return; // may have died/landed mid-hold — nothing to swap
    releaseRope({ hop: false });
    // Drag too short to catch anything? Then it was a plain dismount after
    // all, so it earns the dismount hop the release skipped.
    if(!maybeCastRope(dragDelta)) flight.vy -= ROPE_RELEASE_HOP;
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
    lives = Math.max(0, lives - 1);
    ui.setLives(lives, MAX_LIVES);
  }

  function landFail(ui){
    if(state === 'dead') return; // already handled — never let a fail fire twice on one flight
    state = 'dead';
    flight.anchor = null;
    flight.ropeLength = null;
    deathHoldMs = DEATH_HOLD_MS;
    // Unconditional, unlike triggerHurt() — a fail always deserves its own
    // fresh pause/pose, even if the player was already mid-hurt-pose from an
    // earlier non-fatal hit this same flight (triggerHurt() would otherwise
    // silently skip both, making this fail land with zero warning).
    playPlayerAnim(anim, 'hurt');
    freezeMs = HIT_FREEZE_MS;
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

    updateGhostRopes();

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
    // swingStop is non-looping — once it finishes it just holds its last
    // frame for the rest of the free-fall, same as grab/hurt elsewhere. No
    // forced switch to 'roll' (that's the ground-hop's flight pose, and
    // popping into it right after letting go of a rope looked like a
    // mismatched second animation tacked on).

    if(state === 'flying' || state === 'swinging'){
      flight.vy += GRAVITY;
      flight.x += flight.vx;
      flight.y += flight.vy;
      // The timeout clock only runs during free flight — swinging is
      // self-limiting (you choose when to let go), so it shouldn't also be
      // racing against a clock that was tuned for an untethered arc.
      if(state === 'flying') flightFrames++;

      if(state === 'swinging'){
        // Frozen during the turn flourish (see below) — right at the peak of
        // a swing, vx is near zero and noisy, so continuously reading it
        // here would make the turn pose flicker between facings.
        if(anim.current !== 'swingTurn') anim.facingLeft = flight.vx < 0;
        // Inextensible-rope clamp: let the player move freely (rope can go
        // slack), but once they'd fly past the rope's length, pin them back
        // onto the circle and strip the outward-radial component of
        // velocity so only the tangential part survives — the rope "catches".
        const dx = flight.x - flight.anchor.x, dy = flight.y - flight.anchor.y;
        const d = Math.hypot(dx, dy);
        if(d > flight.ropeLength){
          const nx = dx / d, ny = dy / d;
          flight.x = flight.anchor.x + nx * flight.ropeLength;
          flight.y = flight.anchor.y + ny * flight.ropeLength;
          const vRad = flight.vx * nx + flight.vy * ny;
          if(vRad > 0){
            flight.vx -= vRad * nx;
            flight.vy -= vRad * ny;
          }
        }

        // Drive the swing pose from the actual rope angle, not from a timer —
        // a wide arc plays faster and reaches more extreme frames than a
        // gentle one, for free, since both are just reading the same angle.
        const angle = Math.atan2(flight.x - flight.anchor.x, flight.y - flight.anchor.y);
        const absAngle = Math.abs(angle);

        if(flight.swingGrowing && absAngle < flight.swingPrevAbsAngle){
          flight.swingGrowing = false;
          // The `anim.current` guard covers the peak's jitter: near-zero
          // angular velocity can flicker growing/shrinking a few times in a
          // row, and this keeps those from restarting the turn.
          if(flight.swingPrevAbsAngle > SWING_TURN_MIN_ANGLE && anim.current !== 'swingTurn'){
            // Face whichever side of the anchor the peak was on — freezes
            // here rather than tracking noisy near-zero velocity for the
            // duration of the pose. Flip the comparison if it looks backwards.
            anim.facingLeft = angle < 0;
            // Same hand-swap as a fresh cast — you're gripping the same rope
            // but reaching across as you reverse, so swing1/2 (rope in the
            // opposite hand) should alternate here too.
            swingSlot = swingSlot === 1 ? 2 : 1;
            flight.turnPeakAngle = flight.swingPrevAbsAngle; // the crest this turn plays back from
            // Re-anchor the phase reference to THIS leg's own crest (signed,
            // same side as the current — still-just-past-peak — angle).
            // Leaving the original cast angle in place made every other leg
            // play its frames backwards: the leg's sign flips each reversal,
            // but the un-updated reference didn't, so (ref - angle)/(2*ref)
            // counted up on odd legs and down on even ones.
            flight.castAngle = flight.swingPrevAbsAngle * (angle < 0 ? -1 : 1);
            playPlayerAnim(anim, 'swingTurn');
          }
        } else if(!flight.swingGrowing && absAngle > flight.swingPrevAbsAngle){
          flight.swingGrowing = true;
        }
        flight.swingPrevAbsAngle = absAngle;

        if(anim.current === 'swingTurn'){
          // Driven by the same live angle as ropeSwing1/2 (see below), not a
          // separate clock — so its pace matches theirs exactly at the
          // handoff, in both directions: a fast, wide swing rips through it
          // just as fast as it rips through the surrounding swing frames, and
          // a slow, dying one crawls through both alike. Capping the span at
          // the peak itself keeps a peak smaller than SWING_TURN_ARC from
          // needing to swing past vertical to ever finish.
          const span = Math.min(flight.turnPeakAngle, SWING_TURN_ARC);
          const swept = span > 0 ? (flight.turnPeakAngle - absAngle) / span : 1;
          // sqrt, because a pendulum leaves a crest from rest: angle travelled
          // grows as t², so a progress bar linear in ANGLE crawls through
          // frame 0 and then blurs 1 and 2. Since travel ∝ t², √travel ∝ t —
          // taking the root spreads the frames evenly in TIME instead, so all
          // three are actually readable, still with no clock involved.
          const progress = Math.sqrt(Math.max(0, swept));
          if(progress >= 1) playPlayerAnim(anim, 'ropeSwing' + swingSlot);
          else setPlayerSwingFrame(anim, images, progress);
        }
        if(anim.current === 'ropeSwing1' || anim.current === 'ropeSwing2'){
          // Signed, not absolute — frame 0 is the cast pose (at +/-castAngle),
          // the last frame is the mirror position on the far side, and the
          // frame moves monotonically as the rope sweeps between them. Using
          // |angle| here instead would make the frame index go down then back
          // up as you pass through vertical, looking like it plays out of order.
          const phase = (flight.castAngle - angle) / (2 * flight.castAngle);
          // Squeeze the frame range toward the middle as the swing dies down:
          // phase alone always spans the full strip across whatever this leg's
          // crest happens to be, so a barely-moving 8° wobble would otherwise
          // still strike the most extreme poses in the strip. Scaling by how
          // big this leg is against a full-amplitude one keeps a gentle swing
          // on the gentle middle frames.
          const reach = Math.min(1, Math.abs(flight.castAngle) / SWING_CAST_ANGLE);
          setPlayerSwingFrame(anim, images, 0.5 + (phase - 0.5) * reach);
        }
      }

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

      if(state === 'flying' || state === 'swinging'){ // a fatal hit just above may have already ended this
        // Landing stays possible even after a hit (flight.doomed) — knocked
        // off course and slowed down, but still lucky enough to catch a node.
        let landed = false;
        for(let i = 0; i < nodes.length; i++){
          const n = nodes[i];
          if(i === flight.originIndex && flightFrames < 8) continue;
          if(dist(flight.x, flight.y, n.x, n.y) <= n.r + PLAYER_R * 0.6 + LAND_FORGIVENESS){
            landSuccess(n, ui);
            landed = true;
            break;
          }
        }
        // Timeout/floor death only apply to free flight — while attached to
        // the rope you're always recoverable by just letting go.
        if(!landed && state === 'flying'){
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
    if(state === 'flying' || state === 'swinging'){
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
    const lerp = (state === 'flying' || state === 'swinging') ? 0.18 : 0.14;
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
    if(state === 'flying' || state === 'swinging' || state === 'won') return;
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

  // The anchor itself is never drawn — only the rope, stepped in fixed dots
  // (rather than a smooth stroke) for a pixel-art look. The dots closest to
  // the player are skipped entirely, out to a fraction of the player's own
  // rendered size, so the rope reads as coming from their hand rather than
  // piercing through the middle of the sprite. Shared by the live rope and
  // its fading afterimages.
  function drawRopeSegment(a, b, alpha){
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const step = ROPE_DOT_SPACING_PX * cam.zoom;
    const count = Math.max(1, Math.round(len / step));
    const hideNear = PLAYER_DISPLAY_SIZE * ROPE_HIDE_NEAR_PLAYER_FRACTION * cam.zoom;
    const hideCount = Math.ceil(hideNear / step);
    if(hideCount >= count) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    // i < count, not <=: i === count lands exactly on the anchor (t === 1),
    // which must never get a dot — the anchor itself is never allowed to be visible.
    for(let i = hideCount; i < count; i++){
      const t = i / count;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.restore();
  }

  // A released rope's free end keeps swinging on the same anchor under its
  // own momentum — a tiny standalone pendulum sim, same math as the live
  // rope's clamp — instead of freezing in place, right up until it fades out.
  function updateGhostRopes(){
    const now = performance.now();
    ghostRopes = ghostRopes.filter(g => now - g.startTime < ROPE_FADE_MS);
    for(const g of ghostRopes){
      g.vy += GRAVITY;
      g.x += g.vx;
      g.y += g.vy;
      const dx = g.x - g.anchorX, dy = g.y - g.anchorY;
      const d = Math.hypot(dx, dy);
      if(d > g.ropeLength){
        const nx = dx / d, ny = dy / d;
        g.x = g.anchorX + nx * g.ropeLength;
        g.y = g.anchorY + ny * g.ropeLength;
        const vRad = g.vx * nx + g.vy * ny;
        if(vRad > 0){
          g.vx -= vRad * nx;
          g.vy -= vRad * ny;
        }
      }
    }
  }

  function drawRope(){
    if(state !== 'swinging' || !flight || !flight.anchor) return;
    const a = toScreen(cam, W, H, flight.x, flight.y);
    const b = toScreen(cam, W, H, flight.anchor.x, flight.anchor.y);
    drawRopeSegment(a, b, 1);
  }

  function drawGhostRopes(){
    const now = performance.now();
    for(const g of ghostRopes){
      const a = toScreen(cam, W, H, g.x, g.y);
      const b = toScreen(cam, W, H, g.anchorX, g.anchorY);
      drawRopeSegment(a, b, 1 - (now - g.startTime) / ROPE_FADE_MS);
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
    drawGhostRopes();
    drawRope();

    if((state === 'flying' || state === 'swinging' || state === 'dead') && flight){
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
      downState = state; // handleUp needs to know what this gesture started on, in case it changes below
      if(state === 'dead'){ (lives > 0 ? respawnAtCheckpoint : resetGame)(ui); return; }
      if(state === 'won'){ resetGame(ui); return; }
      // Pressing while swinging does NOT let go — it only arms the drag, so
      // you can aim the next rope before committing. The actual swap (or a
      // plain let-go, if the drag turns out too short) happens on release.
      if(state === 'flying'){ tryDefeatEnemies(); return; }
      startCharge(); // no-ops unless state is 'idle' — including while swinging
    },
    handleUp(ui, dragDelta){
      releaseCharge(); // no-ops unless a ground charge is actually in progress
      if(downState === 'flying') maybeCastRope(dragDelta);
      else if(downState === 'swinging') swapRope(dragDelta);
    }
  };
}
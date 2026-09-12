import { createCamera, toScreen, toWorld } from './camera.js';
import { GRAVITY, simulateTrajectory, dist } from './physics.js';
import { generateLevel, remainingNodes, nearestRemaining, generateEnemies, generateCoin, floorY } from './level.js';
import {
  createPlayerAnimator, resetPlayerAnimator,
  updatePlayerAnimation, drawPlayer, playPlayerAnim, playPlayerAnimAtEnd, playerAnimFinished, setPlayerSwingFrame,
  PLAYER_DISPLAY_SIZE
} from './player.js';
import { pickBackground, drawBackground } from './background.js';
import { generateCity, drawCity, cityBottomY, pickCityTheme } from './city.js';
import { updateEnemy, drawEnemy, ENEMY_WARN_MARGIN } from './enemy.js';
import { updateCoin, drawCoin, COIN_PICKUP_RADIUS } from './coin.js';
import { playSfx } from './audio.js';
import { getSpeedBonus, formatTime } from './scoring.js';

const ROT_PERIODS = [1800, 1600, 1400]; // ms per full rotation, per power level 1/2/3
const SPEEDS = [16, 22, 30];             // power level 1,2,3
const PLAYER_R = 14;
const MAX_FLIGHT_FRAMES = 420;
// Zoom is mostly computed rather than looked up: standing on a grip it pulls
// out as your charge builds (you're about to cover more ground, so you get to
// see more of it), and airborne it pulls out with your speed. Only the two
// static states are table-driven.
const ZOOM_TARGETS = { dead: 1.3, won: 0.8 };
const ZOOM_BY_POWER = [0.78, 0.62, 0.48]; // on a grip: one distinct step out per power level, snapped to rather than eased into, so levelling up reads as a jolt
const AIRBORNE_ZOOM = 0.66;   // airborne and barely moving — deliberately tighter than a charged grip, so launching punches back in
const AIRBORNE_ZOOM_MIN = 0.5;// airborne at AIRBORNE_ZOOM_FULL_SPEED or above — also the clearance the rope anchor is placed against, so it stays off-screen at every airborne zoom
const AIRBORNE_ZOOM_FULL_SPEED = 42; // px/frame at which the airborne view is all the way out
const ROTATIONS_PER_LEVEL = 2; // full aim-rotations needed to auto-bump power up one notch
const MAX_POWER_LEVEL = SPEEDS.length;
const CHARGE_HOLD_MULTIPLIER = 2; // holding the button spins the aim (and charges power) this much faster
const MAX_LIVES = 3;
const HIT_FREEZE_MS = 120;    // brief hitstop when the player takes a hit or fails a jump
// The enemy encounter runs as a slow-motion beat, NOT a freeze. A freeze was
// tried first and read badly for a specific reason: update() returns early
// while freezeMs is counting down, which is *above* updatePlayerAnimation() —
// so the strike animation didn't advance a single frame during the hold, then
// played out at full speed afterwards, over empty air, with the enemy already
// gone. Slowing the world instead keeps every frame of it visible on top of
// the enemy it's hitting.
const QTE_WINDOW_MS = 420;    // real ms you get to react once an enemy goes from warn to engaged
const QTE_MOTION_SCALE = 0.12;// how slowly the world moves during the window and the strike — the "bullet time" beat
const QTE_ZOOM = 0.95;        // camera pushes in this close for the encounter (vs ~0.5-0.66 airborne)
const QTE_ZOOM_LERP = 0.18;   // and gets there fast, since the whole beat is under half a second
const IMPACT_FREEZE_MS = 110; // real hitstop at the moment the enemy actually pops — what freezeMs is genuinely good for
// ...and then the strike's LAST frame (the impact pose the art is drawn around)
// keeps holding for this long while time and momentum are already back to
// normal and the player is flying on. So the attack isn't something you wait
// out before play resumes — play resumes on the impact, wearing the pose.
const IMPACT_HOLD_MS = 260;
// A small lunge toward whatever you're hitting, applied over the strike. It's
// positional only — velocity is never touched, so it can't leak into the arc
// you resume on afterwards. Deliberately NOT scaled by the slow-motion factor:
// the world crawling while the player still thrusts forward is the whole read.
const STRIKE_LUNGE_PX = 90;          // world units of lunge at most
const STRIKE_LUNGE_MAX_GAP = 0.6;    // ...but never more than this share of the actual gap, so a close hit doesn't shoot past
const STRIKE_LUNGE_LERP = 0.15;      // eased in per frame, same idiom as the camera
const DEATH_HOLD_MS = 550;    // camera stays punched in on the frozen hurt pose this long before letting go
const MIN_DRAG_PX = 24;       // shorter drags on release are treated as accidental, no rope fires
const ANCHOR_MARGIN_PX = 48;  // screen px the anchor sits above the visible top edge — guarantees it's always off-screen
const ROPE_RELEASE_HOP = 4;   // small upward kick on dismounting a rope (not on a rope-to-rope swap) — reads as a little jump off the swing
const ROPE_CATCH_SPEED_KEEP = 1; // fraction of your speed a new rope keeps when it catches you: 1 = chaining ropes costs nothing, lower = each catch bleeds some speed
const LAND_FORGIVENESS = 6;   // world units of extra landing leniency on top of the node/player radii
// Enemy encounters are no longer resolved by distance alone (a tap in range,
// or a tight collision radius) — crossing into ENEMY_WARN_MARGIN opens a QTE
// window (see the enemy loop in update() and resolveQteHit/resolveQteMiss).
// A tap inside it is a hit; running out unanswered is a collision.
// Which attack clip plays is a function of the relative angle to the enemy
// being hit, not a fixed animation — steeper than 45° off horizontal counts
// as "above"/"below", otherwise it's the same-plane strike.
const ATTACK_CLIPS = ['attack', 'attackUp', 'attackDown'];
function pickAttackClip(dx, dy){
  if(Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 'attackUp' : 'attackDown';
  return 'attack';
}
const SWING_CAST_ANGLE = 45 * Math.PI / 180; // fixed angle (from straight down) the rope always attaches at — only left/right depends on the drag, not distance. Also ropeSwing1/2's frame-0 pose.
const SWING_TURN_MIN_ANGLE = 15 * Math.PI / 180; // crests smaller than this skip the turn flourish entirely — a nearly settled swing just rocks through the middle frames instead
const SWING_TURN_ARC = 12 * Math.PI / 180; // fixed angular span (not a fraction of the peak) the turn plays out over — a fixed span still takes longer for a small/dying peak, since gravity's pull back through it is weaker there too
const ROPE_FADE_MS = 1400;      // how long a released rope lingers as a fading afterimage
// A rope lost to a hit SNAPS instead: the free end recoils back up the line
// toward the anchor and it's gone in a few frames, rather than settling into
// the slow pendulum a rope you chose to let go of does. Kept longer than the
// hurt hitstop (120ms) so there's still a visible whip once time resumes.
const ROPE_SNAP_MS = 420;
const ROPE_SNAP_RECOIL = 0.25;  // fraction of the remaining distance to the anchor the free end covers per frame
const ROPE_DOT_SPACING_PX = 11;      // spacing between rope dots at zoom 1
// Fraction of the player's own on-screen size (PLAYER_DISPLAY_SIZE * zoom)
// hidden nearest them, on both the live rope and its afterimage — tied to
// the sprite's actual rendered size (not a flat pixel count) so the rope
// reads as coming from around their hand, not from inside their body,
// regardless of zoom. Tune this once you can see it against the real art.
const ROPE_HIDE_NEAR_PLAYER_FRACTION = 0.35;
const CHARGE_TEXT_DELAY_MS = 300; // how long you have to actually be charging before the "CHARGING" callout appears
const FLOAT_TEXT_MS = 900;        // lifetime of a floating callout (CHARGING / ATTACK / WEB-SWIPE)
const FLOAT_TEXT_RISE = 70;       // world units it drifts upward over that lifetime
const CHARGE_TEXT_Y_OFFSET = 110; // world units above the grip the CHARGING callout spawns, to clear the player sprite

export function createGame(canvas, images){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cam = createCamera();
  const anim = createPlayerAnimator();

  let nodes = [];
  let currentIndex = 0;
  let paused = false; // e.g. the options overlay is open — draw() keeps rendering the frozen frame, update() does nothing
  let state = 'idle'; // idle -> charging -> flying <-> swinging -> dead -> won
  let downState = null; // state captured at press-time, so handleUp knows what gesture it's closing out
  // The two halves of an enemy encounter, both of which slow the world down:
  // qte = { enemy, msLeft } is the reaction window (tap to hit, let it run out
  // and it's a collision), strike = { enemy } is a landed hit playing out. The
  // enemy deliberately stays un-resolved and on screen for the whole strike,
  // so the punch has something under it, and only pops when the clip finishes.
  let qte = null;
  let strike = null;
  let impactHoldMs = 0; // counts down after a strike connects, holding the impact pose while play has already resumed
  let swingSlot = 1; // alternates 1/2 on every rope cast, so the pose alternates like hand-over-hand
  let ghostRopes = []; // fading afterimages of ropes just let go — world-space endpoints + when they were released
  let floatingTexts = []; // {text, x, y, startTime} — CHARGING / ATTACK / WEB-SWIPE callouts
  let bgCycleIndex = 0; // advances once per resetGame() call, i.e. per course — see pickBackground
  let chargeStartMs = 0;
  let chargeTextShown = false; // one callout per charge, not one per frame past the delay
  let angleAccum = 0;
  let powerAccum = 0; // independent of angleAccum, so holding can speed this up without spinning the aim faster
  let spinDir = 1;
  let lastFrameTime = 0;
  let currentAngle = 0;
  let currentPowerLevel = 1;
  let currentPowerProgress = 0;
  let flight = null;
  let flightFrames = 0;
  let bg = null; // { img, parallax, parallaxY } — the course's skyline and its own scroll rates, see pickBackground
  let city = null;
  let enemies = [];
  let coin = null; // one 1-up per course, or null if none / already collected
  let elapsedMs = 0;
  let worldMs = 0; // like elapsedMs but slowed during an encounter beat — drives enemy bobbing, so it eases with the rest of the world
  let points = 0;
  let lastLandTime = 0;
  let prevPowerLevel = 1;
  let powerPunch = { index: -1, startTime: -Infinity }; // "juice" pop when a power pip fills up
  let lives = MAX_LIVES;
  let freezeMs = 0; // hitstop: counts down to 0 before update() does anything else
  let deathHoldMs = 0; // after that: camera still centers the frozen player until this runs out, then releases into the fall

  function currentNode(){ return nodes[currentIndex]; }

  // World-space floating callouts (CHARGING / ATTACK / WEB-SWIPE / NICE GRAB)
  // — pure juice, no gameplay effect. spawn/update/draw follow the same
  // world-coords-plus-startTime pattern as ghostRopes. Color defaults to
  // white; giving NICE GRAB its own green keeps the two readable apart at a
  // glance instead of every callout looking the same.
  function spawnFloatingText(text, wx, wy, color = '#fff'){
    floatingTexts.push({ text, x: wx, y: wy, startTime: performance.now(), color });
  }

  function updateFloatingTexts(){
    const now = performance.now();
    floatingTexts = floatingTexts.filter(t => now - t.startTime < FLOAT_TEXT_MS);
  }

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
    // One resetGame() call = one course, so this advances on level-complete
    // and game-over (both route back through here) but not on a mid-course
    // respawn — see pickBackground for the fixed-order-then-random sequence.
    //
    // The street is chosen BEFORE the skyline, so pickBackground can rule out
    // the ones that don't belong behind it. Laid out once per course too, so it
    // doesn't reshuffle under a mid-course respawn, anchored to the same floor
    // that kills you.
    const theme = pickCityTheme(bgCycleIndex);
    city = generateCity(nodes, floorY(nodes), images, theme);
    bg = pickBackground(images, bgCycleIndex, theme.key);
    bgCycleIndex++;
    enemies = generateEnemies(nodes);
    coin = generateCoin(nodes, enemies);
    elapsedMs = 0;
    worldMs = 0;
    points = 0;
    lastLandTime = 0;
    lives = MAX_LIVES;
    freezeMs = 0;
    qte = null;
    strike = null;
    impactHoldMs = 0;
    deathHoldMs = 0;
    ghostRopes = [];
    floatingTexts = [];
    chargeTextShown = false;

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
    chargeStartMs = performance.now();
    chargeTextShown = false;
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
    // Taking a hit locks you out of a rope until the hurt animation has
    // actually played through (480ms of it) — being able to fire a new rope
    // the same instant you were clipped made the hit cost nothing you could
    // feel. You keep falling and can still be saved by a landing; you just
    // can't swing out of it immediately. Same window as the invincibility —
    // see isStunned.
    if(isStunned()) return false;
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
    // Cleared against the WIDEST airborne zoom, not the resting one — the
    // view pulls out with speed, and an anchor placed for the narrow view
    // would drift into frame the moment you got moving.
    const anchorY = flight.y - (H / 2 + ANCHOR_MARGIN_PX) / AIRBORNE_ZOOM_MIN;
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
    spawnFloatingText('WEB-SWIPE', flight.x, flight.y);
    return true;
  }

  // Letting go mid-swing: keep whatever momentum the swing built up and drop
  // back into normal projectile physics. The little upward kick is for
  // actually dismounting — a rope-to-rope handoff passes hop:false, since
  // being nudged upward mid-handoff just fights the swing you're continuing.
  // `snap` is for a rope lost to an enemy hit rather than let go of: the web
  // breaks — a different afterimage (it recoils instead of swinging, see
  // updateGhostRopes) and a different sound — so it never reads as the calm
  // dismount a chosen release is.
  function releaseRope({ hop = true, snap = false } = {}){
    // The rope doesn't just vanish — its free end keeps swinging on the same
    // anchor under its own momentum (a tiny independent pendulum sim, see
    // updateGhostRopes) while it fades out, instead of freezing in place.
    ghostRopes.push({
      x: flight.x, y: flight.y, vx: flight.vx, vy: flight.vy,
      anchorX: flight.anchor.x, anchorY: flight.anchor.y, ropeLength: flight.ropeLength,
      startTime: performance.now(),
      snapped: snap,
    });
    flight.anchor = null;
    flight.ropeLength = null;
    if(hop) flight.vy -= ROPE_RELEASE_HOP; // a little jump off the swing, on top of whatever momentum it built up
    flightFrames = 0; // fresh timeout budget for this new free-flight segment — don't inherit stale pre-swing time
    state = 'flying';
    playPlayerAnim(anim, 'swingStop');
    if(snap) playSfx('snap');
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

  // A tap during an open QTE window always resolves it, taking priority over
  // whatever that tap would otherwise mean (arming a rope swap while
  // swinging, nothing in particular while flying) — see handleDown.
  function resolveQteHit(pos){
    const e = qte.enemy;
    qte = null;
    if(!flight || e.resolved) return; // shouldn't happen — defensive only
    // Deliberately does NOT resolve the enemy yet: it stays alive and on
    // screen for the whole swing of the arm, and only pops when the clip
    // finishes (resolveStrikeContact). Killing it here was what made the
    // punch look like it was landing on nothing.
    const dx = e.x - flight.x, dy = e.y - flight.y;
    // Lunge budget, captured now: a fixed distance toward the enemy, capped at
    // a share of the actual gap so a hit taken from right on top of one
    // doesn't shoot straight past it. Spent down over the strike below.
    const gap = Math.hypot(dx, dy) || 1;
    const reach = Math.min(STRIKE_LUNGE_PX, gap * STRIKE_LUNGE_MAX_GAP);
    strike = {
      enemy: e,
      lungeX: (dx / gap) * reach,
      lungeY: (dy / gap) * reach,
    };
    anim.facingLeft = dx < 0; // face the target, not wherever the flight/swing happens to be heading
    playPlayerAnim(anim, pickAttackClip(dx, dy));
    if(pos){
      const w = toWorld(cam, W, H, pos.x, pos.y);
      spawnFloatingText('ATTACK', w.x, w.y);
    }
  }

  // Called the frame the strike animation finishes — the actual moment of
  // contact. The enemy goes down here, with a real hitstop behind it, and the
  // world comes back up to full speed carrying the momentum it always had.
  function resolveStrikeContact(){
    const e = strike.enemy;
    strike = null;
    e.defeated = true;
    e.resolved = true;
    playSfx('defeat');
    freezeMs = IMPACT_FREEZE_MS;
  }

  // A QTE window that runs out unanswered resolves as a collision instead of
  // a hit. Flying: the same knockback/life-loss a plain collision always
  // used to be. Swinging: costs the rope instead of a life — you're not on
  // solid ground to bounce off of, and losing your grip is already a real
  // consequence (see releaseRope). No temporary invincibility after the
  // forced release yet — open question in grib-ideer-todo.md.
  // A QTE window that runs out unanswered is a collision — but never, on its
  // own, a lost life. One rule regardless of state: the hit knocks you around,
  // plays the hurt pose, and locks the rope (and grants invincibility) for as
  // long as that pose lasts. The life is only lost if you then fail to land —
  // see landFail. A collision puts the life at risk rather than taking it,
  // which is what makes recovering from one worth attempting.
  //
  // Swinging additionally costs the rope, which snaps (see releaseRope) rather
  // than being calmly let go of.
  function resolveQteMiss(){
    const e = qte.enemy;
    qte = null;
    if(!flight || e.resolved) return; // shouldn't happen — defensive only
    e.resolved = true;
    playSfx('hit');

    // Must run BEFORE triggerHurt(): releaseRope plays the calm 'swingStop'
    // dismount pose, and the hurt pose has to be the one that sticks. (Getting
    // that order wrong once made a missed window while swinging look like a
    // voluntary let-go that sailed calmly onward.)
    if(state === 'swinging') releaseRope({ hop: false, snap: true });

    flight.vx *= -0.6;
    flight.vy = -Math.abs(flight.vy) * 0.5 - 2;
    triggerHurt();
  }

  // Shared by a real landing and a post-stumble respawn: back to a standing
  // stance on solid ground, aim/power charge restarting fresh from here.
  function returnToIdleStance(){
    state = 'idle';
    flight = null;
    qte = null;    // landing mid-beat drops it — there's no flight left to resolve it against
    strike = null;
    impactHoldMs = 0;
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
      // Floating, not a modal overlay — this fires on every single grab, so a
      // blocking DOM message here was covering up exactly the upcoming nodes
      // and enemies you need to see mid-flight. Green ties it to the same
      // color the just-grabbed node itself flashes.
      spawnFloatingText(`NICE GRAB! ${gain}`, node.x, node.y - 90, '#3ecf6e');
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

  // The one window that means "you've just been hit": the hurt clip is still
  // playing (480ms). It is the SAME predicate for both consequences of a hit —
  // you can't fire a rope during it, and no enemy can open a new window on you
  // during it — so the two signals can never drift apart, and the hurt pose on
  // screen is exactly the span you're both locked out and safe for.
  function isStunned(){
    return anim.current === 'hurt' && !playerAnimFinished(anim);
  }

  function triggerHurt(){
    // Replays if the previous hurt pose has already FINISHED (the clip holds
    // its last frame for the rest of the fall, so anim.current stays 'hurt'
    // long after it's done). Without that, a second hit later in the same
    // flight got no pose and no hitstop at all. Skipped only while a hurt is
    // still actively playing — which isStunned() makes unreachable anyway.
    if(!isStunned()){
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
    qte = null;    // dying mid-beat cancels it outright
    strike = null;
    impactHoldMs = 0;
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
    // Falling out is the ONLY thing that costs a life — an enemy collision
    // earlier in the flight knocked you around and left you here, but didn't
    // charge anything itself (see resolveQteMiss), so there's no double-charge
    // to guard against.
    loseLife(ui);

    if(lives > 0){
      ui.showMessage(`YOU FELL!<br><small>${lives} ${lives === 1 ? 'LIFE' : 'LIVES'} LEFT — press to continue</small>`);
    } else {
      ui.showMessage('GAME OVER<br><small>Press for a new course</small>', { gameover: true });
    }
  }

  function update(ui){
    const now = performance.now();
    const realDt = now - lastFrameTime;
    lastFrameTime = now; // kept current even while paused, so dt can't spike into a huge jump on resume

    if(paused) return; // draw() still runs every frame off whatever state is already there

    // Hitstop — a hard stop, in real time, for impacts only. Note it returns
    // BEFORE updatePlayerAnimation() below, so nothing animates while it
    // holds: that's the point for an impact, and exactly why the QTE beat
    // can't be built on it.
    if(freezeMs > 0){
      freezeMs = Math.max(0, freezeMs - realDt);
      return; // hold everything on the frozen frame — draw() keeps rendering it as-is
    }

    // The reaction window counts down in REAL time — how long a person gets
    // to react shouldn't stretch just because the world is in slow motion.
    if(qte){
      qte.msLeft -= realDt;
      if(qte.msLeft <= 0){
        resolveQteMiss();
        return; // that set up a hurt pose and its own hitstop; let it land next frame
      }
    }

    // Slow motion for the encounter beat: the window itself and the strike
    // that follows it. Scales how far the world moves this frame, nothing
    // else — see the flight integration and updateEnemy below.
    const motion = (qte || strike) ? QTE_MOTION_SCALE : 1;
    const dt = realDt * motion;

    if(state !== 'won' && state !== 'dead') elapsedMs += realDt; // run clock stays real — slow motion mustn't hand back time
    ui.setTime(elapsedMs);

    worldMs += dt; // separate slowed clock, so enemies visibly slow down with everything else
    for(const e of enemies){
      if(!e.resolved) updateEnemy(e, dt, worldMs);
    }
    if(coin) updateCoin(coin, dt);

    updateGhostRopes();
    updateFloatingTexts();

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
      currentPowerLevel = Math.min(MAX_POWER_LEVEL, 1 + Math.floor(currentPowerProgress));

      if(currentPowerLevel > prevPowerLevel){
        powerPunch = { index: currentPowerLevel - 1, startTime: now };
        playSfx('powerup');
        prevPowerLevel = currentPowerLevel;
      }

      anim.facingLeft = Math.cos(currentAngle) < 0;

      if(state === 'charging' && !chargeTextShown && now - chargeStartMs >= CHARGE_TEXT_DELAY_MS){
        chargeTextShown = true;
        const cn = currentNode();
        spawnFloatingText('CHARGING', cn.x, cn.y - CHARGE_TEXT_Y_OFFSET);
      }
    }

    // The strike plays at its authored speed even while the world crawls —
    // that contrast IS the effect: a snappy punch inside a slow beat. Every
    // other pose (swing, roll) rides the slowed clock with the world.
    updatePlayerAnimation(anim, images, strike ? realDt : dt);
    if(ATTACK_CLIPS.includes(anim.current) && playerAnimFinished(anim)){
      if(strike){
        // The clip reaching its last frame IS the impact — the enemy goes
        // down here, not back when the tap registered, so it was on screen
        // for the whole swing of the arm.
        resolveStrikeContact();
        // Play resumes NOW, at full speed and full momentum, while that last
        // frame keeps holding. The attack is deliberately not something you
        // sit through before the game starts again.
        impactHoldMs = IMPACT_HOLD_MS;
      } else if(impactHoldMs > 0){
        impactHoldMs = Math.max(0, impactHoldMs - realDt);
      } else if(state === 'swinging'){
        // Back onto the rope pose, because the swing driver reads its frames
        // off the live rope angle — if it doesn't own the animator again the
        // swing hangs frozen in a punch.
        playPlayerAnim(anim, 'ropeSwing' + swingSlot);
      } else if(state === 'flying'){
        // Back to the flight pose, but parked on its LAST frame rather than
        // replayed: 'roll' opens on the launch-off-a-grip frames, so playing
        // it from the start mid-fall reads as having just jumped. Its final
        // frame is where a flight in progress already sits anyway, since roll
        // plays once at launch and then holds. (Not switching at all was
        // worse still — the impact pose then stuck for the whole descent.)
        playPlayerAnimAtEnd(anim, images, 'roll');
      }
    }
    // swingStop is non-looping — once it finishes it just holds its last
    // frame for the rest of the free-fall, same as grab/hurt elsewhere. No
    // forced switch to 'roll' (that's the ground-hop's flight pose, and
    // popping into it right after letting go of a rope looked like a
    // mismatched second animation tacked on).

    if(state === 'flying' || state === 'swinging'){
      if(coin && dist(flight.x, flight.y, coin.x, coin.y) <= COIN_PICKUP_RADIUS){
        const cx = coin.x, cy = coin.y;
        coin = null;
        lives++;
        ui.setLives(lives, MAX_LIVES);
        playSfx('powerup');
        spawnFloatingText('1-UP!', cx, cy);
      }

      // Integration is per-frame, not dt-based, so slow motion has to be
      // applied right here rather than through dt. Velocity scales by the
      // motion factor and gravity by its square, which is what keeps the arc
      // the exact same shape — just travelled more slowly. Velocities
      // themselves are never touched, so full momentum simply resumes the
      // moment the beat ends.
      flight.vy += GRAVITY * motion * motion;
      flight.x += flight.vx * motion;
      flight.y += flight.vy * motion;

      // Spend down the lunge budget toward the enemy being hit — position
      // only, so nothing here survives into the arc you resume on. Sits
      // between the integration and the rope clamp below on purpose: while
      // swinging, the clamp still gets the last word, so a lunge can go
      // slack-inward freely but can't stretch the rope past its length.
      if(strike){
        const stepX = strike.lungeX * STRIKE_LUNGE_LERP;
        const stepY = strike.lungeY * STRIKE_LUNGE_LERP;
        flight.x += stepX;
        flight.y += stepY;
        strike.lungeX -= stepX;
        strike.lungeY -= stepY;
      }

      // The timeout clock only runs during free flight — swinging is
      // self-limiting (you choose when to let go), so it shouldn't also be
      // racing against a clock that was tuned for an untethered arc.
      if(state === 'flying') flightFrames++;

      if(state === 'swinging'){
        // Frozen during the turn flourish (see below) — right at the peak of
        // a swing, vx is near zero and noisy, so continuously reading it
        // here would make the turn pose flicker between facings. Also frozen
        // through a strike and its impact hold, both of which face the enemy
        // that was hit instead.
        if(!strike && impactHoldMs <= 0 && anim.current !== 'swingTurn') anim.facingLeft = flight.vx < 0;
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
          if(flight.swingPrevAbsAngle > SWING_TURN_MIN_ANGLE && anim.current !== 'swingTurn' && !strike && impactHoldMs <= 0){
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

      // Held off by an encounter already in progress, or by the brief
      // invincibility while the hurt pose plays (isStunned) — so the enemy that
      // just clipped you can't clip you again on the way down. It is NOT held
      // off for the rest of the flight: that used to be gated on a
      // flight.doomed flag, which meant one missed window disabled enemies
      // entirely until you landed, and a second enemy in the same flight
      // couldn't be fought at all.
      if(!qte && !strike && !isStunned()){
        for(const e of enemies){
          if(e.resolved) continue;
          const d = dist(flight.x, flight.y, e.x, e.y);
          if(d <= e.r + ENEMY_WARN_MARGIN){
            // Opens the reaction window instead of resolving anything right
            // here. From this frame on the world moves at QTE_MOTION_SCALE
            // (see `motion` above) and the camera pushes in, until either the
            // window is answered (resolveQteHit) or it times out
            // (resolveQteMiss).
            e.engaged = true;
            qte = { enemy: e, msLeft: QTE_WINDOW_MS };
            break;
          }
        }
      }

      // Landing is suspended for the length of an encounter beat. Enemies sit
      // BETWEEN grips, so at slow-motion speed you still drift a few px per
      // frame straight into the nearest one — which used to cut the punch off
      // mid-swing, return you to an idle stance, and leave the enemy alive
      // even though you had answered the window correctly. The beat is under
      // ~700ms and you barely move in it, so the grip is still right there to
      // be caught the moment it ends.
      if((state === 'flying' || state === 'swinging') && !qte && !strike){ // a fatal hit just above may have already ended this
        // Landing stays possible even after taking a hit — knocked off course
        // and slowed down, but still lucky enough to catch a node.
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
          } else if(flight.y > floorY(nodes)){
            landFail(ui); // hit the street — the same line the sidewalk is drawn on
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
    // During an encounter beat, frame the two of you rather than just your own
    // sprite — you need to see what you're about to hit (or be hit by) for the
    // window to be readable at all.
    const beat = qte || strike;
    if(beat && flight){
      focusX = (flight.x + beat.enemy.x) / 2;
      focusY = (flight.y + beat.enemy.y) / 2;
    }

    const lerp = (state === 'flying' || state === 'swinging') ? 0.18 : 0.14;
    cam.x += (focusX - cam.x) * lerp;
    cam.y += (focusY - cam.y) * lerp;

    let zoomTarget;
    if(state === 'flying' || state === 'swinging'){
      // Pulls out with speed, so a fast swing shows you where you're actually
      // headed instead of a blur of nearby scenery.
      const speed = Math.hypot(flight.vx, flight.vy);
      const t = Math.min(1, speed / AIRBORNE_ZOOM_FULL_SPEED);
      zoomTarget = AIRBORNE_ZOOM + (AIRBORNE_ZOOM_MIN - AIRBORNE_ZOOM) * t;
    } else if(state === 'idle' || state === 'charging'){
      // One step per power level rather than a continuous creep — the view
      // kicks out a notch exactly when the charge levels up.
      zoomTarget = ZOOM_BY_POWER[currentPowerLevel - 1];
    } else {
      zoomTarget = ZOOM_TARGETS[state] ?? 1.0;
    }
    // The encounter overrides whatever the speed-based airborne zoom wanted:
    // push in close and get there fast, since the whole beat is under half a
    // second. Note the zoom lerp is per-frame rather than dt-based, so slow
    // motion doesn't slow the push-in down with everything else.
    if(beat) zoomTarget = QTE_ZOOM;

    // Ground zoom snaps between its steps; everything else keeps easing.
    const onGrip = state === 'idle' || state === 'charging';
    const zoomLerp = beat ? QTE_ZOOM_LERP : state === 'dead' ? 0.1 : onGrip ? 0.22 : 0.06;
    cam.zoom += (zoomTarget - cam.zoom) * zoomLerp;

    // Hard floor: the last pixel of the sidewalk is the bottom of the world, so
    // the view is never allowed past it. Has to come after the zoom lerp, since
    // how much world the canvas covers (H/2 / zoom) changes with the zoom — a
    // clamp computed before it would let the bottom edge slip through whenever
    // the camera was pulling out.
    const maxCamY = cityBottomY(city) - (H / 2) / cam.zoom;
    if(cam.y > maxCamY) cam.y = maxCamY;
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
  function ghostRopeLifeMs(g){
    return g.snapped ? ROPE_SNAP_MS : ROPE_FADE_MS;
  }

  function updateGhostRopes(){
    const now = performance.now();
    ghostRopes = ghostRopes.filter(g => now - g.startTime < ghostRopeLifeMs(g));
    for(const g of ghostRopes){
      if(g.snapped){
        // A snapped web recoils: the free end whips back up the line toward
        // the anchor and it's gone in a handful of frames. No gravity, no
        // pendulum clamp — nothing like the slow settle of a rope you chose
        // to let go of, which is the whole point of it looking different.
        g.x += (g.anchorX - g.x) * ROPE_SNAP_RECOIL;
        g.y += (g.anchorY - g.y) * ROPE_SNAP_RECOIL;
        continue;
      }
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
      drawRopeSegment(a, b, 1 - (now - g.startTime) / ghostRopeLifeMs(g));
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

  function drawFloatingTexts(){
    if(!floatingTexts.length) return;
    const now = performance.now();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px Arial';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#111';
    for(const t of floatingTexts){
      const p = (now - t.startTime) / FLOAT_TEXT_MS;
      const { x, y } = toScreen(cam, W, H, t.x, t.y - p * FLOAT_TEXT_RISE);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = t.color;
      ctx.strokeText(t.text, x, y);
      ctx.fillText(t.text, x, y);
    }
    ctx.restore();
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // The rates are passed explicitly — leaning on drawBackground's defaults is
    // what had every skyline scrolling at the same speed regardless of depth.
    if(bg) drawBackground(ctx, bg.img, cam, W, H, bg.parallax, bg.parallaxY);
    // Same plane as the grips, but drawn before them (and before the enemies,
    // the coin and the player) so it can never hide anything you have to see.
    drawCity(ctx, city, cam, W, H);

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

    if(coin){
      const { x, y } = toScreen(cam, W, H, coin.x, coin.y);
      drawCoin(ctx, images.coin, coin, x, y, cam.zoom);
    }

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

    drawFloatingTexts();
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
    handleDown(ui, pos){
      downState = state; // handleUp needs to know what this gesture started on, in case it changes below
      // An open QTE window always wins, regardless of state — it's the same
      // tap that would otherwise arm a rope swap (swinging) or do nothing in
      // particular (flying). downState is cleared so the matching handleUp
      // doesn't ALSO treat this same press+release as a drag and cast/swap
      // a rope right on top of the hit that was just thrown.
      if(qte){ resolveQteHit(pos); downState = null; return; }
      // Mid-strike the input is spent — swallow it rather than let the
      // matching release swap ropes out from under the punch.
      if(strike){ downState = null; return; }
      if(state === 'dead'){ (lives > 0 ? respawnAtCheckpoint : resetGame)(ui); return; }
      if(state === 'won'){ resetGame(ui); return; }
      // Pressing while swinging does NOT let go — it only arms the drag, so
      // you can aim the next rope before committing. The actual swap (or a
      // plain let-go, if the drag turns out too short) happens on release.
      startCharge(); // no-ops unless state is 'idle' — including while swinging
    },
    handleUp(ui, dragDelta){
      releaseCharge(); // no-ops unless a ground charge is actually in progress
      if(downState === 'flying') maybeCastRope(dragDelta);
      else if(downState === 'swinging') swapRope(dragDelta);
    },
    setPaused(p){ paused = p; }
  };
}
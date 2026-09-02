/**
 * Miguel's Cheese Run — Full Game Engine
 *
 * Architecture:
 *   - Canvas 2D for all game world rendering
 *   - HTML overlays for menus and HUD
 *   - requestAnimationFrame game loop (update → render)
 *   - Miguel moves one tile at a time with smooth lerp animation
 *   - Minesweeper-style trap counts revealed on explored tiles
 *   - Ambient lighting vignette follows Miguel (torch effect)
 */

'use strict';

// ════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════

const TS = 56;          // tile size in pixels
const MOVE_SPD = 9;     // tiles per second (movement speed)
const CAM_LERP = 0.13;  // camera smoothing factor

/** Tile type flags */
const T = { FLOOR: 0, WALL: 1 };

/** Level definitions: rows × cols grid, number of traps. */
const LEVELS = [
  { name: 'Night 1',   sub: 'First steps into the dark…',   rows: 8,  cols: 10, traps: 4  },
  { name: 'Night 2',   sub: 'Something moved. Stay calm.',   rows: 9,  cols: 12, traps: 7  },
  { name: 'Night 3',   sub: 'The kitchen feels endless.',    rows: 10, cols: 14, traps: 11 },
  { name: 'Night 4',   sub: 'More traps than stars…',        rows: 11, cols: 16, traps: 15 },
  { name: 'Night 5',   sub: 'Pure survival. Be careful.',    rows: 12, cols: 18, traps: 20 },
];

/** Number colours (Minesweeper palette). */
const NUM_COLORS = ['','#4fc3f7','#66cc77','#f06060','#a080e0','#ff8844','#44ccdd','#ff77aa','#b0b0c8'];

// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════

let canvas, ctx, W, H;

let lvlIdx = 0;   // current level index
let rows, cols;
let grid;         // 2-D array of T.FLOOR | T.WALL
let trapSet;      // Set<"r,c"> — hidden trap positions
let explored;     // Set<"r,c"> — tiles the player has visited
let decoMap;      // Map<"r,c", decoType> — decorative objects

let cheese = { gx: 0, gy: 0 };

/** Miguel's full state. */
let mig = {
  gx: 1, gy: 1,      // grid position
  px: 0, py: 0,      // pixel position (lerps toward target)
  tx: 0, ty: 0,      // movement target in pixels
  moving: false,
  dir: 'right',      // 'up'|'down'|'left'|'right'
  anim: 'idle',      // 'idle'|'walk'|'nervous'|'dead'|'win'
  idleMs: 0,
  bumpX: 0,          // bump recoil X (-1, 0, +1)
  bumpY: 0,
  bumpMs: 0,
};

let cam = { x: 0, y: 0 };   // camera offset in pixels

/** Top-level game state. */
let gState = 'playing'; // 'playing' | 'dead' | 'win'

const held = {};         // keyboard held keys
const tapQueue = [];     // queued d-pad inputs [dr, dc]

let prevTs  = 0;
let totalMs = 0;

// ════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════

/**
 * Bootstrap: get canvas, set up listeners, load first level, start loop.
 */
function init() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   e => { delete held[e.key]; });

  setupDpad();

  startLevel(lvlIdx);

  prevTs = performance.now();
  requestAnimationFrame(loop);
}

function resize() {
  const c = document.getElementById('game-container');
  W = canvas.width  = c.clientWidth;
  H = canvas.height = c.clientHeight;
}

// ════════════════════════════════════════════════
// LEVEL GENERATION
// ════════════════════════════════════════════════

/**
 * Set up a new level: build grid, place furniture/traps/decorations,
 * position Miguel and cheese, snap camera, show title.
 */
function startLevel(idx) {
  const lvl = LEVELS[Math.min(idx, LEVELS.length - 1)];
  rows = lvl.rows;
  cols = lvl.cols;

  buildGrid(lvl.traps);

  // Miguel starts top-left interior, cheese bottom-right interior.
  mig.gx = 1; mig.gy = 1;
  mig.px = mig.tx = mig.gx * TS + TS / 2;
  mig.py = mig.ty = mig.gy * TS + TS / 2;
  mig.moving = false;
  mig.dir    = 'right';
  mig.anim   = 'idle';
  mig.idleMs = 0;
  mig.bumpMs = 0;

  cheese = { gx: cols - 2, gy: rows - 2 };
  grid[cheese.gy][cheese.gx] = T.FLOOR; // always passable

  explored = new Set([pos(1, 1)]);

  cam.x = Math.max(0, mig.px - W / 2);
  cam.y = Math.max(0, mig.py - H / 2);

  gState = 'playing';
  hideOverlays();
  showLevelTitle(lvl.name, lvl.sub);
  updateHud();
}

/**
 * Generate the full grid: borders → furniture → path validation → traps → decorations.
 */
function buildGrid(numTraps) {
  // All-floor, then wall the border.
  grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) ? T.WALL : T.FLOOR
    )
  );

  placeFurniture();
  ensurePath();       // guarantee BFS route from start to cheese
  trapSet = new Set();
  placeTraps(numTraps);
  decoMap = new Map();
  placeDecorations();
}

/**
 * Place furniture clusters (table legs, chair legs) as impassable wall tiles.
 * Positions chosen to not block start (1,1) or cheese area.
 */
function placeFurniture() {
  // Table A: upper-right quadrant — 4 corner legs
  const tR = 2, tC = Math.floor(cols * 0.64);
  wallSafe(tR, tC); wallSafe(tR, tC + 2);
  wallSafe(tR + 2, tC); wallSafe(tR + 2, tC + 2);

  // Chair pair: left-middle
  if (rows >= 8) {
    const cR = Math.floor(rows * 0.55);
    wallSafe(cR, 2);
    wallSafe(cR + 1, 2);
  }

  // Table B: second table for bigger maps
  if (cols >= 14) {
    const t2R = rows - 4, t2C = Math.floor(cols * 0.35);
    wallSafe(t2R, t2C); wallSafe(t2R, t2C + 2);
    wallSafe(t2R - 2, t2C); wallSafe(t2R - 2, t2C + 2);
  }

  // Cabinet block: top-right corner
  if (cols >= 12) {
    for (let c = cols - 4; c <= cols - 2; c++) wallSafe(1, c);
  }
}

function wallSafe(r, c) {
  if (r < 1 || r > rows - 2 || c < 1 || c > cols - 2) return;
  if (r === 1 && c === 1) return;                          // protect start
  if (r === rows - 2 && c === cols - 2) return;           // protect cheese
  grid[r][c] = T.WALL;
}

/**
 * Guarantee a BFS path exists from start to cheese.
 * If blocked, carve an L-shaped corridor.
 */
function ensurePath() {
  if (bfsReach(1, 1, rows - 2, cols - 2)) return;
  // Carve right along row 1, then down the last clear column.
  for (let c = 1; c < cols - 1; c++) grid[1][c] = T.FLOOR;
  for (let r = 1; r < rows - 1; r++) grid[r][cols - 2] = T.FLOOR;
}

/**
 * BFS from (sr,sc) to (er,ec) through floor tiles, ignoring the given avoid set.
 * Returns true if a path exists.
 */
function bfsReach(sr, sc, er, ec, avoid = new Set()) {
  const vis = new Set();
  const q   = [[sr, sc]];
  while (q.length) {
    const [r, c] = q.shift();
    if (r === er && c === ec) return true;
    const k = pos(r, c);
    if (vis.has(k)) continue;
    vis.add(k);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
          && grid[nr][nc] === T.FLOOR && !avoid.has(pos(nr, nc))) {
        q.push([nr, nc]);
      }
    }
  }
  return false;
}

/**
 * Place traps on random floor tiles.
 * Each placement is validated to ensure the path to cheese still exists.
 */
function placeTraps(count) {
  // Safe buffer around start tile
  const buf = new Set([pos(1,1), pos(1,2), pos(2,1), pos(2,2)]);
  let placed = 0, tries = 0;

  while (placed < count && tries < 600) {
    tries++;
    const r = 1 + Math.floor(Math.random() * (rows - 2));
    const c = 1 + Math.floor(Math.random() * (cols - 2));
    const k = pos(r, c);
    if (grid[r][c] !== T.FLOOR) continue;
    if (buf.has(k)) continue;
    if (r === rows - 2 && c === cols - 2) continue;
    if (trapSet.has(k)) continue;

    trapSet.add(k);
    // Reject if path is now blocked
    if (!bfsReach(1, 1, rows - 2, cols - 2, trapSet)) {
      trapSet.delete(k);
    } else {
      placed++;
    }
  }
}

/**
 * Scatter decorative objects on floor tiles (purely visual, no gameplay effect).
 */
function placeDecorations() {
  const types = ['crumb','crumb','crumb','spoon','bottlecap','shadow','shadow'];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== T.FLOOR) continue;
      if (r === 1 && c === 1) continue;
      if (r === rows - 2 && c === cols - 2) continue;
      if (Math.random() < 0.22) {
        decoMap.set(pos(r, c), types[Math.floor(Math.random() * types.length)]);
      }
    }
  }
}

/** Stringify a grid coordinate. */
function pos(r, c) { return `${r},${c}`; }

// ════════════════════════════════════════════════
// GAME LOOP
// ════════════════════════════════════════════════

function loop(ts) {
  const dt = Math.min(ts - prevTs, 60); // cap delta to avoid huge jumps
  prevTs   = ts;
  totalMs  = ts;

  update(dt);
  render();
  requestAnimationFrame(loop);
}

// ════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════

function update(dt) {
  updateMiguel(dt);
  updateCamera(dt);
}

/**
 * Process movement input and advance Miguel's position toward his target.
 */
function updateMiguel(dt) {
  // Animate movement (lerp toward target pixel)
  if (mig.moving) {
    const speed = MOVE_SPD * TS * (dt / 1000);
    const dx = mig.tx - mig.px;
    const dy = mig.ty - mig.py;
    const d  = Math.hypot(dx, dy);

    if (d <= speed) {
      mig.px = mig.tx; mig.py = mig.ty;
      mig.moving = false;
      onLanded();       // check trap / cheese
    } else {
      mig.px += (dx / d) * speed;
      mig.py += (dy / d) * speed;
    }
    return; // no new input while mid-move
  }

  // Bump recoil timer
  if (mig.bumpMs > 0) mig.bumpMs = Math.max(0, mig.bumpMs - dt);

  if (gState !== 'playing') return;

  // Read direction input (keyboard takes priority, then d-pad queue)
  let dr = 0, dc = 0;
  if      (held['ArrowUp']    || held['w'] || held['W']) dr = -1;
  else if (held['ArrowDown']  || held['s'] || held['S']) dr =  1;
  else if (held['ArrowLeft']  || held['a'] || held['A']) dc = -1;
  else if (held['ArrowRight'] || held['d'] || held['D']) dc =  1;

  if (!dr && !dc && tapQueue.length) [dr, dc] = tapQueue.shift();

  if (!dr && !dc) {
    mig.idleMs += dt;
    if (mig.idleMs > 4500) mig.anim = 'nervous';
    return;
  }

  const nr = mig.gy + dr;
  const nc = mig.gx + dc;

  // Bounds + wall check
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === T.WALL) {
    // Bump into wall — short recoil
    mig.bumpX  = dc * -1;
    mig.bumpY  = dr * -1;
    mig.bumpMs = 160;
    return;
  }

  // Commit to move
  mig.gy = nr; mig.gx = nc;
  mig.tx = nc * TS + TS / 2;
  mig.ty = nr * TS + TS / 2;
  mig.moving = true;
  mig.idleMs = 0;
  mig.anim   = 'walk';

  if      (dr === -1) mig.dir = 'up';
  else if (dr ===  1) mig.dir = 'down';
  else if (dc === -1) mig.dir = 'left';
  else                mig.dir = 'right';

  explored.add(pos(nr, nc));
}

/**
 * Called once Miguel snaps to a new tile.
 * Checks for trap collision or cheese collection.
 */
function onLanded() {
  const k = pos(mig.gy, mig.gx);

  if (trapSet.has(k)) {
    mig.anim = 'dead';
    gState   = 'dead';
    setTimeout(() => showOverlay('dead'), 750);
    return;
  }

  if (mig.gx === cheese.gx && mig.gy === cheese.gy) {
    mig.anim = 'win';
    gState   = 'win';
    setTimeout(() => showOverlay('win'), 950);
    return;
  }

  mig.anim = 'idle';
}

/**
 * Smoothly pan camera to keep Miguel centered, clamped to grid bounds.
 */
function updateCamera(dt) {
  const tx = Math.max(0, Math.min(cols * TS - W, mig.px - W / 2));
  const ty = Math.max(0, Math.min(rows * TS - H, mig.py - H / 2));
  cam.x += (tx - cam.x) * CAM_LERP;
  cam.y += (ty - cam.y) * CAM_LERP;
}

// ════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════

function render() {
  const t = totalMs / 1000;

  ctx.clearRect(0, 0, W, H);

  // Night background
  ctx.fillStyle = '#06060e';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

  renderFloor();
  renderDecorations(t);
  renderWalls();
  renderNumbers();
  renderCheese(t);
  if (gState === 'dead') renderAllTraps();
  renderMiguel(t);
  renderAtmosphere(t);

  ctx.restore();
}

/** Draw kitchen floor tiles in a warm checkerboard pattern. */
function renderFloor() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== T.FLOOR) continue;
      const x = c * TS, y = r * TS;
      const alt = (r + c) % 2 === 0;

      ctx.fillStyle = alt ? '#c4a46a' : '#b49458';
      ctx.fillRect(x, y, TS, TS);

      // Grout lines
      ctx.strokeStyle = '#8c6c38';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);

      // Subtle corner highlight
      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      ctx.fillRect(x + 2, y + 2, TS / 2, TS / 2);
    }
  }
}

/** Draw decorative objects scattered on floor tiles. */
function renderDecorations(t) {
  for (const [k, type] of decoMap) {
    const [r, c] = k.split(',').map(Number);
    drawDecoration(c * TS, r * TS, type, t);
  }
}

function drawDecoration(x, y, type, t) {
  const cx = x + TS / 2, cy = y + TS / 2;

  switch (type) {
    case 'crumb': {
      // Cluster of 3 bread crumbs
      ctx.fillStyle = '#6a4018';
      const ox = (seededRand(x) - .5) * 20, oy = (seededRand(y) - .5) * 20;
      filledCircle(cx + ox,     cy + oy,     2.5);
      filledCircle(cx + ox + 6, cy + oy + 4, 1.8);
      filledCircle(cx + ox - 4, cy + oy + 6, 1.5);
      break;
    }
    case 'spoon': {
      // Silver spoon lying on floor
      ctx.strokeStyle = '#c8c8d4';
      ctx.lineWidth   = 2.2;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 8, cy);
      ctx.lineTo(x + TS - 14, cy);
      ctx.stroke();
      ctx.fillStyle = '#d8d8e4';
      ctx.beginPath();
      ctx.ellipse(x + TS - 10, cy, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bottlecap': {
      // Metallic bottle cap
      ctx.fillStyle = '#5858a0';
      filledCircle(cx, cy, 9);
      ctx.strokeStyle = '#8080c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#9898d0';
      filledCircle(cx - 2, cy - 2, 4);
      break;
    }
    case 'shadow': {
      // Shadow patch from overhead furniture
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
      break;
    }
  }
}

/** Draw all wall tiles (border walls = cabinet/baseboard; interior = furniture legs). */
function renderWalls() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== T.WALL) continue;
      drawWall(c * TS, r * TS, r, c);
    }
  }
}

function drawWall(x, y, r, c) {
  const isBorder = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;

  if (isBorder) {
    // Cabinet / baseboard
    ctx.fillStyle = '#1c1208';
    ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = '#281808';
    ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);

    // Trim rail
    if (r === rows - 1) { ctx.fillStyle = '#362010'; ctx.fillRect(x, y, TS, 6); }
    if (r === 0)        { ctx.fillStyle = '#362010'; ctx.fillRect(x, y + TS - 6, TS, 6); }

    // Cabinet door line (left/right walls)
    if (c === 0 || c === cols - 1) {
      ctx.strokeStyle = '#201008';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x + TS / 2, y); ctx.lineTo(x + TS / 2, y + TS);
      ctx.stroke();
    }
  } else {
    // Furniture leg (table / chair)
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(x, y, TS, TS);
    // Wooden leg body
    ctx.fillStyle = '#5a3418';
    ctx.fillRect(x + 10, y, TS - 20, TS);
    ctx.fillStyle = '#784828';
    ctx.fillRect(x + 14, y, TS - 28, TS);
    // Grain lines
    ctx.strokeStyle = '#442408';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 14 + i * 6, y); ctx.lineTo(x + 14 + i * 6, y + TS);
      ctx.stroke();
    }
    // Cast shadow edges
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x + TS - 7, y, 7, TS);
    ctx.fillRect(x, y + TS - 7, TS, 7);
  }
}

/**
 * Draw Minesweeper-style trap count numbers on all explored (visited) tiles.
 * Tiles with zero nearby traps show only a faint footprint mark.
 */
function renderNumbers() {
  for (const k of explored) {
    const [r, c] = k.split(',').map(Number);
    if (r === mig.gy && c === mig.gx) continue;     // skip Miguel's tile
    if (r === cheese.gy && c === cheese.gx) continue;

    const x = c * TS, y = r * TS;
    const n = countTrapsAround(r, c);

    if (n === 0) {
      // Faint footprint dot
      ctx.fillStyle = 'rgba(255,255,200,0.1)';
      filledCircle(x + TS / 2, y + TS / 2, 4);
      continue;
    }

    ctx.save();
    ctx.font         = `bold ${Math.floor(TS * 0.46)}px 'Press Start 2P', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    // Drop shadow for readability
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillText(n, x + TS / 2 + 1.5, y + TS / 2 + 1.5);
    ctx.fillStyle = NUM_COLORS[Math.min(n, 8)];
    ctx.fillText(n, x + TS / 2, y + TS / 2);
    ctx.restore();
  }
}

/** Count traps in all 8 neighbours of (r, c). */
function countTrapsAround(r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (!(dr === 0 && dc === 0) && trapSet.has(pos(r + dr, c + dc))) n++;
  return n;
}

/** Draw the cheese wedge with floating animation and golden glow. */
function renderCheese(t) {
  const cx = cheese.gx * TS + TS / 2;
  const cy = cheese.gy * TS + TS / 2 + Math.sin(t * 2.2) * 2.5;

  ctx.save();
  ctx.translate(cx, cy);
  drawCheeseShape(t);
  ctx.restore();
}

function drawCheeseShape(t) {
  // Glow aura
  const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 27);
  grd.addColorStop(0, 'rgba(255,215,50,0.4)');
  grd.addColorStop(1, 'rgba(255,215,50,0)');
  ctx.fillStyle = grd;
  filledCircle(0, 0, 27);

  // Front face (wedge)
  ctx.fillStyle = '#f0c030';
  ctx.beginPath();
  ctx.moveTo(-14, 11); ctx.lineTo(14, 11);
  ctx.lineTo(10, -5); ctx.lineTo(-10, -5);
  ctx.closePath(); ctx.fill();

  // Top face
  ctx.fillStyle = '#d8a820';
  ctx.beginPath();
  ctx.moveTo(-10, -5); ctx.lineTo(10, -5);
  ctx.lineTo(6, -17); ctx.lineTo(-6, -17);
  ctx.closePath(); ctx.fill();

  // Holes
  ctx.fillStyle = '#a87818';
  ctx.beginPath(); ctx.ellipse(-4,  3, 3.5, 3,   0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 7,  5, 3,   2.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-1, -1, 2.2, 1.8, -0.2, 0, Math.PI * 2); ctx.fill();

  // Win sparkles orbit
  if (mig.anim === 'win') {
    const sc = ['#f8d040','#ff7090','#50d8ff','#90ff90'];
    for (let i = 0; i < 4; i++) {
      const a = t * 4 + i * Math.PI / 2;
      ctx.fillStyle = sc[i];
      filledCircle(Math.cos(a) * 20, -6 + Math.sin(a) * 14, 3.5);
    }
  }
}

/** Reveal all traps after a game-over (only explored or hit ones are shown). */
function renderAllTraps() {
  for (const k of trapSet) {
    const [r, c] = k.split(',').map(Number);
    const isHit = r === mig.gy && c === mig.gx;
    // Show all traps on death for dramatic effect
    drawTrap(c * TS + TS / 2, r * TS + TS / 2, isHit);
  }
}

function drawTrap(cx, cy, isHit) {
  if (isHit) {
    ctx.fillStyle = 'rgba(232,64,64,0.3)';
    filledCircle(cx, cy, 22);
  }
  // Spring base plate
  ctx.fillStyle = isHit ? '#cc6060' : '#787878';
  ctx.fillRect(cx - 13, cy + 4, 26, 5);
  // Snap wire
  ctx.strokeStyle = isHit ? '#ffaaaa' : '#c0c0c0';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 11, cy + 4); ctx.lineTo(cx, cy - 9); ctx.lineTo(cx + 11, cy + 4);
  ctx.stroke();
  // Bait dot
  ctx.fillStyle = '#8a5030';
  filledCircle(cx, cy, 4.5);
}

/**
 * Render atmospheric lighting:
 * - Radial dark gradient centred on Miguel (torch / candlelight feel)
 * - Warm additive glow around Miguel
 * - Golden glow around cheese (visible beacon)
 */
function renderAtmosphere(t) {
  const gW = cols * TS, gH = rows * TS;
  const mx = mig.px, my = mig.py;
  const cx = cheese.gx * TS + TS / 2;
  const cy = cheese.gy * TS + TS / 2;

  // ── Darkness vignette centred on Miguel ──
  const r1 = TS * 2.2;
  const r2 = TS * 5.8;
  const dark = ctx.createRadialGradient(mx, my, r1, mx, my, r2);
  dark.addColorStop(0, 'rgba(5,3,16,0)');
  dark.addColorStop(1, 'rgba(5,3,16,0.82)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, gW, gH);

  // ── Warm candlelight glow on Miguel ──
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const torch = ctx.createRadialGradient(mx, my, 0, mx, my, r1);
  torch.addColorStop(0, 'rgba(255,185,70,0.1)');
  torch.addColorStop(1, 'rgba(255,185,70,0)');
  ctx.fillStyle = torch;
  ctx.fillRect(0, 0, gW, gH);
  ctx.restore();

  // ── Cheese beacon glow ──
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const chg = ctx.createRadialGradient(cx, cy, 0, cx, cy, TS * 2.5);
  chg.addColorStop(0, 'rgba(255,215,60,0.22)');
  chg.addColorStop(1, 'rgba(255,215,60,0)');
  ctx.fillStyle = chg;
  ctx.fillRect(0, 0, gW, gH);
  ctx.restore();
}

// ════════════════════════════════════════════════
// MIGUEL RENDERING
// ════════════════════════════════════════════════

/**
 * Draw Miguel at his current pixel position with all state-driven animations.
 */
function renderMiguel(t) {
  let ox = 0, oy = 0;

  // Wall bump recoil
  if (mig.bumpMs > 0) {
    const p = mig.bumpMs / 160;
    ox = mig.bumpX * Math.sin(p * Math.PI) * 5;
    oy = mig.bumpY * Math.sin(p * Math.PI) * 5;
  }

  ctx.save();
  ctx.translate(mig.px + ox, mig.py + oy);

  // Flip when facing left
  if (mig.dir === 'left') ctx.scale(-1, 1);

  // State-specific transform offsets
  if (mig.anim === 'dead') {
    ctx.rotate(Math.sin(t * 7) * 0.28);
  } else if (mig.anim === 'win') {
    ctx.translate(0, Math.sin(t * 8) * 4 - 2);
  }

  drawMiguelSprite(t);
  ctx.restore();
}

/**
 * Draw the complete Miguel sprite, centred at canvas origin (0, 0).
 * All values are relative to the tile's centre.
 *
 * Drawing order (back to front): tail → back legs → body → front legs → head → ears → face
 */
function drawMiguelSprite(t) {
  const anim    = mig.anim;
  const nervous = anim === 'nervous';
  const walk    = anim === 'walk';
  const dead    = anim === 'dead';
  const win     = anim === 'win';

  const walkCycle = walk ? Math.sin(t * 16) : 0;
  const breathe   = Math.sin(t * 1.6) * 1.5;
  const bodyY     = walk ? -Math.abs(walkCycle) * 1.5 : breathe;

  // ── Tail ──
  const wagAmp  = nervous ? 16 : 9;
  const wagFreq = nervous ? 8  : 3;
  const tailWag = Math.sin(t * wagFreq) * wagAmp;

  ctx.strokeStyle = '#8a8898';
  ctx.lineWidth   = 3.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(-14, 4 + bodyY);
  ctx.bezierCurveTo(-22, 12 + bodyY, -26 + tailWag * 0.4, 20, -30, 5 + tailWag);
  ctx.stroke();

  // ── Back legs ──
  const legSwing = walkCycle * 5;
  drawLeg(-9, 9 + bodyY, -9, 21 + bodyY + legSwing);
  drawLeg(-2, 9 + bodyY, -2, 21 + bodyY - legSwing);

  // ── Body ──
  ctx.fillStyle = '#9898a8';
  ctx.beginPath();
  ctx.ellipse(-2, bodyY, 16, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly
  ctx.fillStyle = '#bebece';
  ctx.beginPath();
  ctx.ellipse(-2, bodyY + 4, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Front legs ──
  drawLeg(6,  9 + bodyY, 6,  21 + bodyY - legSwing);
  drawLeg(12, 9 + bodyY, 12, 21 + bodyY + legSwing);

  // ── Head ──
  const headY   = bodyY - 20;
  const headBob = anim === 'idle' ? Math.sin(t * 0.9) * 0.8 : 0;

  ctx.fillStyle = '#a0a0b0';
  ctx.beginPath();
  ctx.arc(10, headY + headBob, 13, 0, Math.PI * 2);
  ctx.fill();

  // ── Ears ──
  const earBase = nervous ? Math.sin(t * 11) * 12 : Math.sin(t * 2.5) * 4;

  ctx.save();
  ctx.translate(4, headY + headBob - 10);
  ctx.rotate((earBase - 4) * Math.PI / 180);
  ctx.fillStyle = '#a0a0b0';
  ctx.beginPath(); ctx.ellipse(0, -7, 6.5, 9, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d09090';
  ctx.beginPath(); ctx.ellipse(0, -7, 3.8, 5.5, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(16, headY + headBob - 10);
  ctx.rotate((4 - earBase) * Math.PI / 180);
  ctx.fillStyle = '#a0a0b0';
  ctx.beginPath(); ctx.ellipse(0, -7, 6.5, 9, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d09090';
  ctx.beginPath(); ctx.ellipse(0, -7, 3.8, 5.5, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ── Eyes ──
  if (dead) {
    // X eyes for dead state
    ctx.strokeStyle = '#ff4040';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    const eyes = [[3, headY + headBob - 6, 9, headY + headBob], [11, headY + headBob - 6, 17, headY + headBob]];
    for (const [x1, y1, x2, y2] of eyes) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y1); ctx.lineTo(x1, y2); ctx.stroke();
    }
  } else {
    const blinkFreq  = nervous ? 4.5  : 0.5;
    const blink      = Math.sin(t * blinkFreq) > (nervous ? 0.85 : 0.96);
    const eyeH       = blink ? 1.5 : 5.5;
    const lookOffset = Math.sin(t * (nervous ? 5.5 : 0.85)) * (nervous ? 3.5 : 1.8);

    ctx.fillStyle = '#f0f0ff';
    ctx.beginPath(); ctx.ellipse(6  + lookOffset, headY + headBob - 2, 4.5, eyeH, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14 + lookOffset, headY + headBob - 2, 4.5, eyeH, 0, 0, Math.PI * 2); ctx.fill();

    if (!blink) {
      ctx.fillStyle = '#181828';
      filledCircle(7  + lookOffset, headY + headBob - 2, 3);
      filledCircle(15 + lookOffset, headY + headBob - 2, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      filledCircle(8  + lookOffset, headY + headBob - 4, 1.3);
      filledCircle(16 + lookOffset, headY + headBob - 4, 1.3);
    }
  }

  // ── Nose ──
  const noseTwitch = Math.sin(t * (nervous ? 10 : 3.5)) * (nervous ? 2.2 : 1);
  ctx.fillStyle = '#e89090';
  ctx.beginPath();
  ctx.ellipse(22, headY + headBob + 2 + noseTwitch, 5.5, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Nostrils
  ctx.fillStyle = '#c06868';
  filledCircle(20.5, headY + headBob + 2, 1.4);
  filledCircle(23.5, headY + headBob + 2, 1.4);

  // ── Whiskers ──
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth   = 0.9;
  ctx.lineCap     = 'round';
  const wt = noseTwitch * 0.6;
  const nx = 20, ny = headY + headBob + 2;
  for (const [x1,y1,x2,y2] of [
    [nx, ny, nx - 24, ny - 5 + wt],
    [nx, ny, nx - 24, ny + wt    ],
    [nx, ny, nx - 24, ny + 5 + wt],
    [nx + 4, ny, nx + 28, ny - 5 - wt],
    [nx + 4, ny, nx + 28, ny - wt    ],
    [nx + 4, ny, nx + 28, ny + 5 - wt],
  ]) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  // ── Nervous sweat drop ──
  if (nervous) {
    const sd = Math.max(0, Math.sin(t * 2.8)) * 5;
    ctx.fillStyle = '#80c0ff';
    ctx.beginPath();
    ctx.moveTo(22, headY + headBob - 22 - sd);
    ctx.bezierCurveTo(26, headY + headBob - 16 - sd, 26, headY + headBob - 16 - sd, 22, headY + headBob - 22 - sd);
    ctx.fill();
    filledCircle(22, headY + headBob - 17 - sd, 3.5);
  }

  // ── Win sparkles ──
  if (win) {
    const sc = ['#f8d040','#ff7090','#50d8ff','#90ff90','#ffa0f0'];
    for (let i = 0; i < 5; i++) {
      const a = t * 3.8 + i * (Math.PI * 2 / 5);
      const r = 24 + Math.sin(t * 2 + i) * 6;
      ctx.fillStyle = sc[i];
      filledCircle(Math.cos(a) * r, headY + Math.sin(a) * r * 0.7, 3.2);
    }
  }
}

/** Draw a single leg as a line + foot ellipse. */
function drawLeg(x1, y1, x2, y2) {
  ctx.strokeStyle = '#808090';
  ctx.lineWidth   = 4.5;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = '#707080';
  ctx.beginPath(); ctx.ellipse(x2, y2, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
}

// ════════════════════════════════════════════════
// INPUT
// ════════════════════════════════════════════════

function onKeyDown(e) {
  held[e.key] = true;
  // Prevent arrow keys / space from scrolling the page
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
    e.preventDefault();
  }
}

/**
 * Wire up the on-screen D-pad buttons for touch and mouse.
 * Each tap queues one directional move.
 */
function setupDpad() {
  const map = {
    'dpad-up':    [-1, 0],
    'dpad-down':  [ 1, 0],
    'dpad-left':  [ 0,-1],
    'dpad-right': [ 0, 1],
  };

  for (const [id, delta] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('touchstart', e => { e.preventDefault(); tapQueue.push(delta); }, { passive: false });
    el.addEventListener('mousedown',  () => tapQueue.push(delta));
  }
}

// ════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════

function showLevelTitle(name, sub) {
  const el = document.getElementById('level-title');
  if (!el) return;
  el.innerHTML = `${name}<br><span style="font-size:0.55em;color:#7878a8">${sub}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function showOverlay(type) {
  if (type === 'dead') {
    document.getElementById('dead-overlay').classList.add('show');
    document.getElementById('btn-continue')?.focus();
  } else {
    document.getElementById('win-overlay').classList.add('show');
    document.getElementById('win-night').textContent = `Night ${lvlIdx + 1} complete!`;
    document.getElementById('btn-next')?.focus();
  }
}

function hideOverlays() {
  document.getElementById('dead-overlay')?.classList.remove('show');
  document.getElementById('win-overlay')?.classList.remove('show');
}

function updateHud() {
  const el = document.getElementById('hud-level');
  if (el) el.textContent = `Night ${lvlIdx + 1} / ${LEVELS.length}`;
}

// ════════════════════════════════════════════════
// PUBLIC ACTIONS (called from HTML buttons)
// ════════════════════════════════════════════════

/** Retry the current level after a game over. */
function continueGame() { startLevel(lvlIdx); }

/** Go back to the home screen. */
function quitGame() { window.location.href = 'index.html'; }

/** Advance to the next level (loops after the last). */
function nextNight() {
  lvlIdx = (lvlIdx + 1) % LEVELS.length;
  startLevel(lvlIdx);
}

/** Restart the current level (HUD button). */
function restartLevel() { startLevel(lvlIdx); }

// ════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════

function filledCircle(x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/** Deterministic pseudo-random based on a seed — used for visual variety without re-randomising each frame. */
function seededRand(seed) {
  return Math.abs(Math.sin(seed * 127.1 + 43.7) * 43758.5453) % 1;
}

// ════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════

window.addEventListener('load', init);

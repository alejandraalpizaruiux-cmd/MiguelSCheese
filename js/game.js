'use strict';

// ════════════════════════════════════════════════════════
//  AUDIO ENGINE  (Web Audio API — procedural jazz)
// ════════════════════════════════════════════════════════

const Audio = (() => {
  let actx = null;
  let masterGain, musicBus, sfxBus;
  let _musicOn = true;
  let beatIdx = 0, nextBeatTime = 0, schedTimer = null;

  const BPM = 88, BEAT = 60 / BPM, LOOKAHEAD = 0.2, SCHED_MS = 70, PATTERN_LEN = 16;

  const hz = {
    C3:130.81, D3:146.83, Eb3:155.56, F3:174.61, G3:196.00, Ab3:207.65, A3:220.00, Bb3:233.08,
    C4:261.63, Eb4:311.13, F4:349.23, G4:392.00, Bb4:466.16,
    C5:523.25, Eb5:622.25, G5:783.99, Bb5:932.33,
  };

  const BASS   = [hz.C3,hz.G3,hz.Bb3,hz.G3, hz.F3,hz.Eb3,hz.G3,hz.C3, hz.C3,hz.G3,hz.Bb3,hz.A3, hz.G3,hz.F3,hz.G3,hz.C3];
  const CHORDS = [[hz.C3,hz.Eb3,hz.G3,hz.Bb3],[hz.F3,hz.Ab3,hz.C4],[hz.C3,hz.Eb3,hz.G3,hz.Bb3],[hz.G3,hz.Bb3,hz.D3]];
  const MEL    = [hz.C5,null,hz.Bb4,null, hz.G4,null,null,hz.Eb4, hz.F4,null,hz.G4,null, hz.Bb4,hz.C5,null,hz.G4];

  function osc(freq, dur, type, amp, when, dest) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(dest || masterGain);
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(dur, 0.02));
    o.start(when); o.stop(when + dur + 0.05);
  }

  function noise(dur, amp, centreHz, when, dest) {
    if (!actx) return;
    const len = Math.ceil(actx.sampleRate * (dur + 0.02));
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource(); src.buffer = buf;
    const flt = actx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = centreHz; flt.Q.value = 1.2;
    const g = actx.createGain();
    src.connect(flt); flt.connect(g); g.connect(dest || masterGain);
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.start(when); src.stop(when + dur + 0.02);
  }

  function scheduleBeat(beat, t) {
    const b = beat % PATTERN_LEN;
    osc(BASS[b], BEAT * 0.78, 'triangle', 0.17, t, musicBus);
    if (b % 4 === 0) CHORDS[Math.floor(b / 4) % CHORDS.length].forEach(f => osc(f, BEAT * 3.5, 'sine', 0.025, t, musicBus));
    if (MEL[b]) osc(MEL[b], BEAT * 0.55, 'sine', 0.065, t, musicBus);
    if (b % 2 === 1) noise(0.04, 0.018, 9000, t, musicBus);
  }

  function tick() {
    if (!actx || !_musicOn) return;
    while (nextBeatTime < actx.currentTime + LOOKAHEAD) { scheduleBeat(beatIdx, nextBeatTime); beatIdx++; nextBeatTime += BEAT; }
    schedTimer = setTimeout(tick, SCHED_MS);
  }

  function init() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain(); masterGain.gain.value = 0.82; masterGain.connect(actx.destination);
    musicBus = actx.createGain(); musicBus.gain.value = 0.48; musicBus.connect(masterGain);
    const delay = actx.createDelay(0.6), delayFB = actx.createGain(), delayWet = actx.createGain();
    delay.delayTime.value = 0.29; delayFB.gain.value = 0.24; delayWet.gain.value = 0.18;
    musicBus.connect(delay); delay.connect(delayFB); delayFB.connect(delay); delay.connect(delayWet); delayWet.connect(masterGain);
    sfxBus = actx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(masterGain);
  }

  function resume() {
    if (!actx) init();
    if (actx.state === 'suspended') actx.resume().then(() => { if (_musicOn && !schedTimer) startMusic(); });
    else if (_musicOn && !schedTimer) startMusic();
  }

  function startMusic() {
    if (!actx || !_musicOn) return;
    clearTimeout(schedTimer); schedTimer = null; beatIdx = 0; nextBeatTime = actx.currentTime + 0.1; tick();
  }

  function stopMusic() { clearTimeout(schedTimer); schedTimer = null; }

  function toggle() {
    _musicOn = !_musicOn;
    if (_musicOn) { if (actx) startMusic(); } else stopMusic();
    return _musicOn;
  }

  function musicOn() { return _musicOn; }

  let _stepFlip = 0;
  function sfxStep()     { if (!actx) return; _stepFlip ^= 1; noise(0.055, 0.14, _stepFlip ? 210 : 175, actx.currentTime, sfxBus); }
  function sfxHover()    { if (!actx) return; osc(1100, 0.035, 'sine', 0.022, actx.currentTime, sfxBus); }
  function sfxClick()    { if (!actx) return; osc(700, 0.06, 'triangle', 0.055, actx.currentTime, sfxBus); }
  function sfxFlag()     { if (!actx) return; osc(880, 0.08, 'triangle', 0.06, actx.currentTime, sfxBus); osc(1320, 0.06, 'sine', 0.04, actx.currentTime + 0.05, sfxBus); }
  function sfxUnflag()   { if (!actx) return; osc(660, 0.08, 'triangle', 0.05, actx.currentTime, sfxBus); osc(440, 0.07, 'sine', 0.04, actx.currentTime + 0.06, sfxBus); }
  function sfxFlagDeny() { if (!actx) return; noise(0.06, 0.08, 400, actx.currentTime, sfxBus); }
  function sfxCheese()   { if (!actx) return; [523.25,659.25,783.99,1046.5].forEach((f,i) => osc(f, 0.38, 'sine', 0.13, actx.currentTime + i*0.11, sfxBus)); noise(0.08, 0.06, 3500, actx.currentTime, sfxBus); }
  function sfxTrap()     {
    if (!actx) return;
    const t = actx.currentTime;
    noise(0.07, 0.55, 3200, t, sfxBus);
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sawtooth'; o.connect(g); g.connect(sfxBus);
    o.frequency.setValueAtTime(380, t+0.02); o.frequency.exponentialRampToValueAtTime(65, t+0.45);
    g.gain.setValueAtTime(0.18, t+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t+0.5);
    o.start(t+0.02); o.stop(t+0.55);
  }
  function sfxWin()      { if (!actx) return; [261.63,329.63,392,523.25,659.25,783.99].forEach((f,i) => osc(f, 0.55, 'triangle', 0.12, actx.currentTime + i*0.09, sfxBus)); }
  function sfxGameOver() { if (!actx) return; [392,349.23,261.63,196,130.81].forEach((f,i) => osc(f, 0.44, 'sawtooth', 0.09, actx.currentTime + i*0.17, sfxBus)); }
  function sfxLoseLife() { if (!actx) return; const t = actx.currentTime; osc(300, 0.15, 'sawtooth', 0.11, t, sfxBus); osc(200, 0.22, 'sawtooth', 0.09, t+0.14, sfxBus); }
  function sfxRoomTrans(){ if (!actx) return; [261.63,329.63,261.63,523.25].forEach((f,i) => osc(f, 0.6, 'triangle', 0.10, actx.currentTime + i*0.18, sfxBus)); }

  return { init, resume, startMusic, stopMusic, toggle, musicOn,
           sfxStep, sfxHover, sfxClick, sfxFlag, sfxUnflag, sfxFlagDeny,
           sfxCheese, sfxTrap, sfxWin, sfxGameOver, sfxLoseLife, sfxRoomTrans };
})();


// ════════════════════════════════════════════════════════
//  CONSTANTS & WORLD DATA
// ════════════════════════════════════════════════════════

const TS       = 56;
const MOVE_SPD = 9;
const CAM_LERP = 0.13;
const MAX_LIVES = 3;

const T = { FLOOR: 0, WALL: 1 };

// 20 nights across 4 rooms.
// Trap density (traps / interior tiles) is held to roughly 6–14% — low enough
// that number clues are always meaningful, high enough to stay challenging.
// Each new room resets density to the lower end of its range before climbing again.
const LEVELS = [
  // ── Kitchen (Nights 1–5) — 6 → 10 % density ──
  { name: 'Night 1',  sub: 'First steps into the dark…',         rows: 8,  cols: 10, traps: 3  },
  { name: 'Night 2',  sub: 'Something moved. Stay calm.',         rows: 8,  cols: 11, traps: 4  },
  { name: 'Night 3',  sub: 'The kitchen feels endless.',          rows: 9,  cols: 12, traps: 6  },
  { name: 'Night 4',  sub: 'Think before every step.',            rows: 9,  cols: 13, traps: 8  },
  { name: 'Night 5',  sub: 'Read the numbers carefully.',         rows: 10, cols: 14, traps: 10 },
  // ── Pantry (Nights 6–10) — 9 → 11 % density ──
  { name: 'Night 6',  sub: 'The pantry smells of old bread.',     rows: 9,  cols: 12, traps: 6  },
  { name: 'Night 7',  sub: 'Shelves cast long shadows.',          rows: 9,  cols: 13, traps: 8  },
  { name: 'Night 8',  sub: 'Something rustles on the shelf.',     rows: 10, cols: 13, traps: 10 },
  { name: 'Night 9',  sub: 'Eyes adjusting to the dark.',         rows: 10, cols: 14, traps: 11 },
  { name: 'Night 10', sub: 'One last shelf to pass.',             rows: 11, cols: 15, traps: 13 },
  // ── Dining Room (Nights 11–15) — 9 → 11 % density ──
  { name: 'Night 11', sub: 'The table stretches forever.',        rows: 10, cols: 13, traps: 8  },
  { name: 'Night 12', sub: 'Chair legs everywhere.',              rows: 10, cols: 14, traps: 10 },
  { name: 'Night 13', sub: 'Crumbs and quiet danger.',            rows: 11, cols: 14, traps: 12 },
  { name: 'Night 14', sub: 'Almost there, little mouse.',         rows: 11, cols: 15, traps: 14 },
  { name: 'Night 15', sub: 'The clues are your only guide.',      rows: 12, cols: 16, traps: 16 },
  // ── Laundry Room (Nights 16–20) — 10 → 14 % density ──
  { name: 'Night 16', sub: 'Cold tiles. The smell of detergent.', rows: 9,  cols: 12, traps: 7  },
  { name: 'Night 17', sub: 'The machine hums in the dark.',       rows: 10, cols: 12, traps: 9  },
  { name: 'Night 18', sub: 'Socks and shadows everywhere.',       rows: 10, cols: 13, traps: 12 },
  { name: 'Night 19', sub: 'One wrong step and it is over.',      rows: 11, cols: 14, traps: 14 },
  { name: 'Night 20', sub: 'The final night. Be legendary.',      rows: 11, cols: 15, traps: 16 },
];

// Visual + layout theme for each room (5 nights each).
const ROOMS = [
  {
    name: 'Kitchen', icon: '🍳',
    transition: null,
    floorA: '#c4a46a', floorB: '#b49458', floorLine: '#8c6c38',
    wallBg: '#1c1208', wallFill: '#281808', wallHi: '#362010',
    decoPool: ['crumb','crumb','crumb','spoon','bottlecap','shadow','shadow','napkin','food_chunk','cereal_shadow'],
    darkRGB: [5,3,16], torchRGB: [255,185,70],
  },
  {
    name: 'Pantry', icon: '🥫',
    transition: 'Miguel quietly sneaks into the pantry…\nJars and cans tower above him.',
    floorA: '#6a5040', floorB: '#5a4030', floorLine: '#3a2418',
    wallBg: '#100804', wallFill: '#18100a', wallHi: '#201408',
    decoPool: ['jar','jar','jar','shelf_shadow','crumb','dust_bunny','label','shadow','cobweb','food_chunk'],
    darkRGB: [4,2,12], torchRGB: [200,155,70],
  },
  {
    name: 'Dining Room', icon: '🍽️',
    transition: 'The dining room stretches before him…\nA grand table towers overhead.',
    floorA: '#4a3828', floorB: '#3c2c1c', floorLine: '#221408',
    wallBg: '#0c0804', wallFill: '#14100a', wallHi: '#1c1408',
    decoPool: ['fork','tablecloth_shadow','crumb','crumb','napkin','shadow','shadow','dust_bunny','chair_leg_shadow','food_chunk'],
    darkRGB: [3,2,10], torchRGB: [180,135,55],
  },
  {
    name: 'Laundry Room', icon: '🧺',
    transition: 'Miguel sneaks into the laundry room.\nCold tiles. The smell of soap.',
    floorA: '#c8ccd4', floorB: '#b8bcc4', floorLine: '#8890a0',
    wallBg: '#1a1c24', wallFill: '#222430', wallHi: '#2c3040',
    decoPool: ['soap_bottle','soap_bottle','sock','sock','cleaning_rag','laundry_shadow','shadow','dust_bunny','crumb','laundry_shadow'],
    darkRGB: [4,4,18], torchRGB: [160,180,255],
  },
];

const NUM_COLORS = ['','#4fc3f7','#66cc77','#f06060','#a080e0','#ff8844','#44ccdd','#ff77aa','#b0b0c8'];


// ════════════════════════════════════════════════════════
//  GAME STATE
// ════════════════════════════════════════════════════════

let canvas, ctx, W, H;

let lvlIdx           = 0;
let lives            = MAX_LIVES;
let cheesesCollected = 0;
let rows, cols;
let grid, trapSet, explored, decoMap;
let cheese = { gx: 0, gy: 0 };

// ── Flag system ──
let flagSet  = new Set();   // pos keys of flagged tiles
let flagMode = false;       // whether flag-placement mode is active

let mig = {
  gx: 1, gy: 1, px: 0, py: 0, tx: 0, ty: 0,
  moving: false, dir: 'right', anim: 'idle',
  idleMs: 0, bumpX: 0, bumpY: 0, bumpMs: 0,
  deathSpinMs: 0, celebMs: 0,
};

let cam = { x: 0, y: 0 };

// 'playing' | 'dying' | 'respawning' | 'celebrating' | 'dead' | 'win' | 'room-transition' | 'game-complete'
let gState = 'playing';

const held     = {};
const tapQueue = [];
let prevTs = 0, totalMs = 0;
let _audioReady = false;

function ensureAudio() {
  if (_audioReady) return;
  _audioReady = true;
  Audio.resume();
}

function getRoom() {
  return ROOMS[Math.min(Math.floor(lvlIdx / 5), ROOMS.length - 1)];
}


// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

function init() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   e => { delete held[e.key]; });
  canvas.addEventListener('click', onCanvasClick);

  setupDpad();
  setupButtonSounds();
  startLevel(lvlIdx);

  prevTs = performance.now();
  requestAnimationFrame(loop);
}

function resize() {
  const c = document.getElementById('game-container');
  W = canvas.width  = c.clientWidth;
  H = canvas.height = c.clientHeight;
}


// ════════════════════════════════════════════════════════
//  LEVEL GENERATION
// ════════════════════════════════════════════════════════

function startLevel(idx) {
  const lvl = LEVELS[Math.min(idx, LEVELS.length - 1)];
  rows = lvl.rows; cols = lvl.cols;
  buildGrid(lvl.traps);

  mig.gx = 1; mig.gy = 1;
  mig.px = mig.tx = 1 * TS + TS / 2;
  mig.py = mig.ty = 1 * TS + TS / 2;
  mig.moving = false; mig.dir = 'right'; mig.anim = 'idle';
  mig.idleMs = 0; mig.bumpMs = 0; mig.deathSpinMs = 0; mig.celebMs = 0;

  cheese = { gx: cols - 2, gy: rows - 2 };
  grid[cheese.gy][cheese.gx] = T.FLOOR;

  explored = new Set([pos(1, 1)]);
  flagSet   = new Set();
  setFlagMode(false);

  cam.x = Math.max(0, mig.px - W / 2);
  cam.y = Math.max(0, mig.py - H / 2);

  gState = 'playing';
  hideOverlays();
  showLevelTitle(lvl.name, lvl.sub);
  updateHud();
}

function buildGrid(numTraps) {
  grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) ? T.WALL : T.FLOOR
    )
  );
  placeFurniture();
  ensurePath();
  trapSet = new Set();
  placeTraps(numTraps);
  decoMap = new Map();
  placeDecorations();
}

// ── Per-room furniture ──

function placeFurniture() {
  const roomIdx = Math.min(Math.floor(lvlIdx / 5), 3);
  if      (roomIdx === 0) placeFurnitureKitchen();
  else if (roomIdx === 1) placeFurniturePantry();
  else if (roomIdx === 2) placeFurnitureDiningRoom();
  else                    placeFurnitureLaundryRoom();
}

function placeFurnitureKitchen() {
  // Table legs (upper-right quad)
  const tR = 2, tC = Math.floor(cols * 0.64);
  wallSafe(tR, tC); wallSafe(tR, tC+2);
  wallSafe(tR+2, tC); wallSafe(tR+2, tC+2);
  // Chair pair (left-middle)
  if (rows >= 8) { const cR = Math.floor(rows * 0.55); wallSafe(cR, 2); wallSafe(cR+1, 2); }
  // Second table (larger maps)
  if (cols >= 14) {
    const t2R = rows - 4, t2C = Math.floor(cols * 0.35);
    wallSafe(t2R, t2C); wallSafe(t2R, t2C+2);
    wallSafe(t2R-2, t2C); wallSafe(t2R-2, t2C+2);
  }
  // Cabinet block
  if (cols >= 12) for (let c = cols - 4; c <= cols - 2; c++) wallSafe(1, c);
}

function placeFurniturePantry() {
  // Horizontal shelf rows with 3-tile passage gaps
  const shelfDefs = [
    { r: 2,                          gapC: Math.floor(cols * 0.55) },
    { r: Math.floor(rows * 0.50),    gapC: Math.floor(cols * 0.35) },
  ];
  if (rows >= 11) shelfDefs.push({ r: rows - 3, gapC: Math.floor(cols * 0.65) });

  for (const { r, gapC } of shelfDefs) {
    for (let c = 2; c < cols - 2; c++) {
      if (Math.abs(c - gapC) > 1) wallSafe(r, c);
    }
  }
}

function placeFurnitureDiningRoom() {
  // Large dining table (4 corner legs + top/bottom rails)
  const tR = Math.floor(rows * 0.28);
  const tC = Math.floor(cols * 0.25);
  const tW = Math.floor(cols * 0.45);
  wallSafe(tR,   tC); wallSafe(tR,   tC + tW);
  wallSafe(tR+3, tC); wallSafe(tR+3, tC + tW);
  for (let c = tC + 1; c < tC + tW; c++) { wallSafe(tR, c); wallSafe(tR+3, c); }

  // Chair clusters (right side)
  if (cols >= 14) {
    const cC = cols - 4;
    const r1 = Math.floor(rows * 0.30), r2 = Math.floor(rows * 0.58);
    wallSafe(r1, cC); wallSafe(r1+1, cC);
    wallSafe(r2, cC); wallSafe(r2+1, cC);
  }
}

function placeFurnitureLaundryRoom() {
  // Washing machine — large square block in one corner
  const mR = 2, mC = Math.floor(cols * 0.60);
  for (let r = mR; r <= mR + 2; r++) for (let c = mC; c <= mC + 2; c++) wallSafe(r, c);

  // Laundry basket — smaller cluster opposite side
  const bR = rows - 4, bC = 2;
  wallSafe(bR, bC); wallSafe(bR, bC + 1);
  wallSafe(bR + 1, bC); wallSafe(bR + 1, bC + 1);

  // Dryer / cabinet along top wall
  if (cols >= 14) {
    for (let c = Math.floor(cols * 0.30); c <= Math.floor(cols * 0.45); c++) wallSafe(1, c);
  }

  // Cleaning supply shelf (lower-right)
  if (rows >= 10) {
    const sR = rows - 3, sC = Math.floor(cols * 0.55);
    wallSafe(sR, sC); wallSafe(sR, sC + 1); wallSafe(sR, sC + 2);
  }
}

function wallSafe(r, c) {
  if (r < 1 || r > rows - 2 || c < 1 || c > cols - 2) return;
  if (r === 1 && c === 1) return;
  if (r === rows - 2 && c === cols - 2) return;
  grid[r][c] = T.WALL;
}

function ensurePath() {
  if (bfsReach(1, 1, rows - 2, cols - 2)) return;
  for (let c = 1; c < cols - 1; c++) grid[1][c] = T.FLOOR;
  for (let r = 1; r < rows - 1; r++) grid[r][cols - 2] = T.FLOOR;
}

function bfsReach(sr, sc, er, ec, avoid = new Set()) {
  const vis = new Set(), q = [[sr, sc]];
  while (q.length) {
    const [r, c] = q.shift();
    if (r === er && c === ec) return true;
    const k = pos(r, c);
    if (vis.has(k)) continue;
    vis.add(k);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === T.FLOOR && !avoid.has(pos(nr,nc)))
        q.push([nr, nc]);
    }
  }
  return false;
}

function placeTraps(count) {
  const buf = new Set([pos(1,1), pos(1,2), pos(2,1), pos(2,2)]);
  let placed = 0, tries = 0;
  while (placed < count && tries < 800) {
    tries++;
    const r = 1 + Math.floor(Math.random() * (rows - 2));
    const c = 1 + Math.floor(Math.random() * (cols - 2));
    const k = pos(r, c);
    if (grid[r][c] !== T.FLOOR || buf.has(k) || trapSet.has(k)) continue;
    if (r === rows - 2 && c === cols - 2) continue;
    trapSet.add(k);
    if (!bfsReach(1, 1, rows - 2, cols - 2, trapSet)) trapSet.delete(k);
    else placed++;
  }
}

function placeDecorations() {
  const pool = getRoom().decoPool;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== T.FLOOR) continue;
      if (r === 1 && c === 1) continue;
      if (r === rows - 2 && c === cols - 2) continue;
      if (Math.random() < 0.23) {
        decoMap.set(pos(r, c), pool[Math.floor(Math.random() * pool.length)]);
      }
    }
  }
}

function pos(r, c) { return `${r},${c}`; }


// ════════════════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════════════════

function loop(ts) {
  const dt = Math.min(ts - prevTs, 60);
  prevTs = ts; totalMs = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}


// ════════════════════════════════════════════════════════
//  UPDATE
// ════════════════════════════════════════════════════════

function update(dt) { updateMiguel(dt); updateCamera(dt); }

function updateMiguel(dt) {
  if (gState === 'dying') {
    mig.deathSpinMs += dt;
    if (mig.deathSpinMs >= 850) { mig.deathSpinMs = 0; onDeathAnimEnd(); }
    return;
  }
  if (gState === 'celebrating') {
    mig.celebMs += dt;
    if (mig.celebMs >= 1250) { mig.celebMs = 0; onCelebrationEnd(); }
    return;
  }
  if (gState === 'respawning' || gState !== 'playing') return;

  if (mig.moving) {
    const speed = MOVE_SPD * TS * (dt / 1000);
    const dx = mig.tx - mig.px, dy = mig.ty - mig.py;
    const d  = Math.hypot(dx, dy);
    if (d <= speed) { mig.px = mig.tx; mig.py = mig.ty; mig.moving = false; onLanded(); }
    else { mig.px += (dx / d) * speed; mig.py += (dy / d) * speed; }
    return;
  }

  if (mig.bumpMs > 0) mig.bumpMs = Math.max(0, mig.bumpMs - dt);

  let dr = 0, dc = 0;
  if      (held['ArrowUp']    || held['w'] || held['W']) dr = -1;
  else if (held['ArrowDown']  || held['s'] || held['S']) dr =  1;
  else if (held['ArrowLeft']  || held['a'] || held['A']) dc = -1;
  else if (held['ArrowRight'] || held['d'] || held['D']) dc =  1;
  if (!dr && !dc && tapQueue.length) [dr, dc] = tapQueue.shift();

  if (!dr && !dc) { mig.idleMs += dt; if (mig.idleMs > 4500) mig.anim = 'nervous'; return; }

  const nr = mig.gy + dr, nc = mig.gx + dc;

  // Wall collision
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === T.WALL) {
    mig.bumpX = -dc; mig.bumpY = -dr; mig.bumpMs = 160; return;
  }

  // Flag collision — blocked unless flag is removed
  if (flagSet.has(pos(nr, nc))) {
    mig.bumpX = -dc; mig.bumpY = -dr; mig.bumpMs = 160;
    Audio.sfxFlagDeny();
    return;
  }

  mig.gy = nr; mig.gx = nc;
  mig.tx = nc * TS + TS / 2; mig.ty = nr * TS + TS / 2;
  mig.moving = true; mig.idleMs = 0; mig.anim = 'walk';
  if      (dr === -1) mig.dir = 'up';
  else if (dr ===  1) mig.dir = 'down';
  else if (dc === -1) mig.dir = 'left';
  else                mig.dir = 'right';

  explored.add(pos(nr, nc));
  Audio.sfxStep();
}

function onLanded() {
  const k = pos(mig.gy, mig.gx);
  if (trapSet.has(k)) {
    Audio.sfxTrap();
    mig.anim = 'dead'; gState = 'dying'; mig.deathSpinMs = 0; return;
  }
  if (mig.gx === cheese.gx && mig.gy === cheese.gy) {
    Audio.sfxCheese();
    mig.anim = 'win'; gState = 'celebrating'; mig.celebMs = 0; return;
  }
  mig.anim = mig.idleMs > 4500 ? 'nervous' : 'idle';
}

function onDeathAnimEnd() {
  lives--;
  updateHud();
  if (lives <= 0) {
    Audio.sfxGameOver();
    gState = 'dead';
    showOverlay('dead');
  } else {
    Audio.sfxLoseLife();
    showLifeLostFlash();
    gState = 'respawning';
    setTimeout(() => {
      mig.gx = 1; mig.gy = 1;
      mig.px = mig.tx = 1 * TS + TS / 2;
      mig.py = mig.ty = 1 * TS + TS / 2;
      mig.moving = false; mig.anim = 'idle'; mig.idleMs = 0;
      explored = new Set([pos(1, 1)]);
      gState = 'playing';
    }, 700);
  }
}

function onCelebrationEnd() {
  cheesesCollected++;
  Audio.sfxWin();
  updateHud();

  const nextIdx = lvlIdx + 1;

  if (nextIdx >= LEVELS.length) {
    // All 15 nights complete
    gState = 'game-complete';
    showGameComplete();
  } else if (nextIdx % 5 === 0) {
    // Entering a new room (nights 5→6, 10→11)
    lvlIdx = nextIdx;
    lives  = MAX_LIVES;
    gState = 'room-transition';
    showRoomTransition();
  } else {
    gState = 'win';
    showOverlay('win');
  }
}

function updateCamera(dt) {
  const tx = Math.max(0, Math.min(cols * TS - W, mig.px - W / 2));
  const ty = Math.max(0, Math.min(rows * TS - H, mig.py - H / 2));
  cam.x += (tx - cam.x) * CAM_LERP;
  cam.y += (ty - cam.y) * CAM_LERP;
}


// ════════════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════════════

function onKeyDown(e) {
  ensureAudio();
  if (e.key === 'f' || e.key === 'F') {
    if (gState === 'playing') { e.preventDefault(); toggleFlagMode(); return; }
  }
  held[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
}

function onCanvasClick(e) {
  if (!flagMode || gState !== 'playing') return;
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const wx = (e.clientX - rect.left) * scaleX + cam.x;
  const wy = (e.clientY - rect.top)  * scaleY + cam.y;
  const tc = Math.floor(wx / TS);
  const tr = Math.floor(wy / TS);
  if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) return;
  if (grid[tr][tc] !== T.FLOOR) return;
  if (tr === mig.gy && tc === mig.gx) return;   // can't flag current tile
  const k = pos(tr, tc);
  if (flagSet.has(k)) { flagSet.delete(k); Audio.sfxUnflag(); }
  else                { flagSet.add(k);    Audio.sfxFlag();   }
}

function toggleFlagMode() {
  setFlagMode(!flagMode);
}

function setFlagMode(on) {
  flagMode = on;
  canvas.style.cursor = on ? 'crosshair' : 'default';
  const el = document.getElementById('hud-flag');
  if (el) el.style.display = on ? 'inline-flex' : 'none';
}

function setupDpad() {
  const map = { 'dpad-up':[-1,0], 'dpad-down':[1,0], 'dpad-left':[0,-1], 'dpad-right':[0,1] };
  for (const [id, delta] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('touchstart', e => { e.preventDefault(); ensureAudio(); tapQueue.push(delta); }, { passive: false });
    el.addEventListener('mousedown',  ()  => { ensureAudio(); tapQueue.push(delta); });
  }
  // Flag toggle button (mobile)
  const flagBtn = document.getElementById('dpad-flag');
  if (flagBtn) {
    flagBtn.addEventListener('touchstart', e => { e.preventDefault(); ensureAudio(); if (gState === 'playing') toggleFlagMode(); }, { passive: false });
    flagBtn.addEventListener('mousedown',  ()  => { ensureAudio(); if (gState === 'playing') toggleFlagMode(); });
  }
}

function setupButtonSounds() {
  document.querySelectorAll('button, .btn, [role="button"]').forEach(el => {
    el.addEventListener('mouseenter', () => { ensureAudio(); Audio.sfxHover(); });
    el.addEventListener('click',      () => Audio.sfxClick());
  });
}


// ════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════

function render() {
  const t = totalMs / 1000;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#06060e'; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

  renderFloor();
  renderDecorations(t);
  renderWalls();
  renderFlags(t);
  renderNumbers();
  renderCheese(t);
  if (gState === 'dying') renderTriggeredTrap(t);
  renderMiguel(t);
  renderAtmosphere();

  ctx.restore();

  // Flag-mode crosshair hint on canvas (UI layer, not world-space)
  if (flagMode && gState === 'playing') renderFlagModeCrosshair(t);
}

/** Warm checkerboard floor using room theme colours. */
function renderFloor() {
  const room = getRoom();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== T.FLOOR) continue;
      const x = c * TS, y = r * TS;
      ctx.fillStyle = (r + c) % 2 === 0 ? room.floorA : room.floorB;
      ctx.fillRect(x, y, TS, TS);
      ctx.strokeStyle = room.floorLine; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + 2, y + 2, TS / 2, TS / 2);
    }
  }
}

function renderDecorations(t) {
  for (const [k, type] of decoMap) {
    const [r, c] = k.split(',').map(Number);
    drawDecoration(c * TS, r * TS, type, t);
  }
}

function drawDecoration(x, y, type) {
  const cx = x + TS / 2, cy = y + TS / 2;
  switch (type) {
    case 'crumb': {
      ctx.fillStyle = '#6a4018';
      const ox = (sd(x)-.5)*20, oy = (sd(y)-.5)*20;
      fc(cx+ox, cy+oy, 2.5); fc(cx+ox+6, cy+oy+4, 1.8); fc(cx+ox-4, cy+oy+6, 1.4); break;
    }
    case 'spoon': {
      ctx.strokeStyle = '#c8c8d4'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x+8, cy); ctx.lineTo(x+TS-14, cy); ctx.stroke();
      ctx.fillStyle = '#d8d8e4';
      ctx.beginPath(); ctx.ellipse(x+TS-10, cy, 7, 5, 0, 0, Math.PI*2); ctx.fill(); break;
    }
    case 'bottlecap': {
      ctx.fillStyle = '#5858a0'; fc(cx, cy, 9);
      ctx.strokeStyle = '#8080c0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#9898d0'; fc(cx-2, cy-2, 4); break;
    }
    case 'shadow': {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x+2, y+2, TS-4, TS-4); break;
    }
    case 'napkin': {
      ctx.fillStyle = 'rgba(240,240,230,0.55)';
      ctx.beginPath();
      ctx.moveTo(cx-10, cy-6); ctx.lineTo(cx+12, cy-8); ctx.lineTo(cx+14, cy+7); ctx.lineTo(cx-8, cy+9);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,190,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx-2, cy-7); ctx.lineTo(cx+4, cy+8); ctx.stroke(); break;
    }
    case 'food_chunk': {
      ctx.fillStyle = sd(x) > 0.5 ? '#d46020' : '#c09050';
      ctx.beginPath();
      ctx.ellipse(cx+(sd(x)-.5)*14, cy+(sd(y)-.5)*14, 5, 3.5, sd(x)*Math.PI, 0, Math.PI*2);
      ctx.fill(); break;
    }
    case 'cereal_shadow': {
      ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(x+2, y, TS-4, TS);
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x, y, 3, TS); break;
    }
    // ── Pantry ──
    case 'jar': {
      ctx.fillStyle = '#8a6040';
      ctx.beginPath(); ctx.roundRect(cx-7, cy-8, 14, 16, 2); ctx.fill();
      ctx.fillStyle = '#c4a060';
      ctx.beginPath(); ctx.ellipse(cx, cy-8, 7, 3, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(80,160,80,0.7)';
      ctx.beginPath(); ctx.ellipse(cx, cy, 4, 8, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(cx-2, cy-2, 1.5, 5, -0.3, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; break;
    }
    case 'shelf_shadow': {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, cy-2, TS, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(x, cy+2, TS, 8); break;
    }
    case 'dust_bunny': {
      const ox2 = (sd(x)-.5)*18, oy2 = (sd(y)-.5)*18;
      ctx.fillStyle = 'rgba(160,155,170,0.45)';
      for (let i = 0; i < 5; i++) fc(cx+ox2+Math.sin(i*1.26)*5, cy+oy2+Math.cos(i*1.26)*3, 3.5);
      break;
    }
    case 'label': {
      ctx.fillStyle = 'rgba(240,230,200,0.52)'; ctx.fillRect(cx-9, cy-4, 18, 8);
      ctx.strokeStyle = 'rgba(180,160,120,0.4)'; ctx.lineWidth = 0.8; ctx.strokeRect(cx-9, cy-4, 18, 8);
      ctx.fillStyle = 'rgba(120,100,80,0.3)'; ctx.fillRect(cx-6, cy-2, 12, 1.5); ctx.fillRect(cx-5, cy+1, 8, 1.5); break;
    }
    case 'cobweb': {
      ctx.strokeStyle = 'rgba(200,200,210,0.32)'; ctx.lineWidth = 0.8;
      const wx2 = x+4, wy2 = y+4;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 6;
        ctx.beginPath(); ctx.moveTo(wx2, wy2); ctx.lineTo(wx2+Math.cos(a)*20, wy2+Math.sin(a)*20); ctx.stroke();
      }
      for (let rad = 6; rad <= 18; rad += 6) {
        ctx.beginPath(); ctx.arc(wx2, wy2, rad, 0, Math.PI/2); ctx.stroke();
      }
      break;
    }
    // ── Dining Room ──
    case 'fork': {
      ctx.strokeStyle = '#c8c8d0'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx-12, cy+2); ctx.lineTo(cx+6, cy+2); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(cx-2+i*2.5, cy+2); ctx.lineTo(cx-2+i*2.5, cy-8); ctx.stroke();
      }
      break;
    }
    case 'tablecloth_shadow': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.moveTo(x, cy-4);
      for (let i = 0; i <= 8; i++) ctx.lineTo(x+i*(TS/8), cy-4+(i%2===0?0:8));
      ctx.lineTo(x+TS, cy-4); ctx.lineTo(x+TS, cy+12); ctx.lineTo(x, cy+12); ctx.closePath(); ctx.fill(); break;
    }
    case 'chair_leg_shadow': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(cx-4, y, 8, TS); break;
    }
    // ── Laundry Room ──
    case 'soap_bottle': {
      // Tall rounded rectangle, blue/white
      const bx = cx + (sd(x) - .5) * 16, by = cy + (sd(y) - .5) * 10;
      ctx.fillStyle = '#3060c0';
      ctx.beginPath(); ctx.roundRect(bx - 4, by - 10, 8, 16, 2); ctx.fill();
      ctx.fillStyle = '#80a8ff';
      ctx.beginPath(); ctx.roundRect(bx - 3, by - 9, 6, 5, 1); ctx.fill();
      ctx.fillStyle = '#e0e8ff';
      ctx.beginPath(); ctx.roundRect(bx - 4, by - 12, 8, 3, 1); ctx.fill();
      break;
    }
    case 'sock': {
      // Small U-shaped sock outline
      const sx = cx + (sd(x) - .5) * 18, sy = cy + (sd(y) - .5) * 14;
      ctx.strokeStyle = sd(y) > 0.5 ? '#c05050' : '#d0d0e0';
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 6);
      ctx.lineTo(sx - 6, sy + 4);
      ctx.quadraticCurveTo(sx - 6, sy + 9, sx - 1, sy + 9);
      ctx.lineTo(sx + 5, sy + 9);
      ctx.stroke();
      break;
    }
    case 'cleaning_rag': {
      // Crumpled rag — irregular quadrilateral
      const rx = cx + (sd(x) - .5) * 14, ry = cy + (sd(y) - .5) * 10;
      ctx.fillStyle = sd(x + y) > 0.5 ? 'rgba(200,220,200,0.55)' : 'rgba(220,200,180,0.50)';
      ctx.beginPath();
      ctx.moveTo(rx - 9, ry - 4);
      ctx.lineTo(rx + 10, ry - 6);
      ctx.lineTo(rx + 8,  ry + 5);
      ctx.lineTo(rx - 10, ry + 6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,180,160,0.3)'; ctx.lineWidth = 0.8; ctx.stroke();
      break;
    }
    case 'laundry_shadow': {
      // Cool blue-tinted machine shadow on floor
      ctx.fillStyle = 'rgba(20,30,60,0.22)'; ctx.fillRect(x, y, TS, TS);
      ctx.fillStyle = 'rgba(20,30,60,0.10)'; ctx.fillRect(x, y + TS - 8, TS, 8);
      break;
    }
  }
}

function renderWalls() {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    if (grid[r][c] === T.WALL) drawWall(c * TS, r * TS, r, c);
}

function drawWall(x, y, r, c) {
  const room     = getRoom();
  const isBorder = r === 0 || r === rows-1 || c === 0 || c === cols-1;
  if (isBorder) {
    ctx.fillStyle = room.wallBg;   ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = room.wallFill; ctx.fillRect(x+2, y+2, TS-4, TS-4);
    if (r === rows-1) { ctx.fillStyle = room.wallHi; ctx.fillRect(x, y, TS, 6); }
    if (r === 0)      { ctx.fillStyle = room.wallHi; ctx.fillRect(x, y+TS-6, TS, 6); }
    if (c === 0 || c === cols-1) {
      ctx.strokeStyle = room.wallBg; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x+TS/2, y); ctx.lineTo(x+TS/2, y+TS); ctx.stroke();
    }
  } else {
    // Interior furniture (table/shelf leg)
    ctx.fillStyle = '#0a0604'; ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = '#5a3418'; ctx.fillRect(x+10, y, TS-20, TS);
    ctx.fillStyle = '#784828'; ctx.fillRect(x+14, y, TS-28, TS);
    ctx.strokeStyle = '#442408'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x+14+i*6, y); ctx.lineTo(x+14+i*6, y+TS); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x+TS-7, y, 7, TS); ctx.fillRect(x, y+TS-7, TS, 7);
  }
}

/** Draw red flag markers on all flagged tiles. */
function renderFlags(t) {
  for (const k of flagSet) {
    const [r, c] = k.split(',').map(Number);
    drawFlag(c * TS + TS/2, r * TS + TS/2, t);
  }
}

function drawFlag(cx, cy, t) {
  // Subtle pulse
  const pulse = 1 + Math.sin((t || 0) * 3.5) * 0.07;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(pulse, pulse);

  // Tile highlight
  ctx.fillStyle = 'rgba(220,50,50,0.14)';
  ctx.fillRect(-TS/2, -TS/2, TS, TS);

  // Pole
  ctx.strokeStyle = '#b0b0c0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3, 12); ctx.lineTo(-3, -16); ctx.stroke();

  // Flag triangle
  ctx.fillStyle = '#e03030';
  ctx.beginPath(); ctx.moveTo(-3,-16); ctx.lineTo(12,-9); ctx.lineTo(-3,-2); ctx.closePath(); ctx.fill();

  // Flag sheen
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.moveTo(-3,-16); ctx.lineTo(12,-9); ctx.lineTo(4,-12); ctx.closePath(); ctx.fill();

  // Base
  ctx.fillStyle = '#888'; fc(-3, 12, 3);
  ctx.restore();
}

/** Canvas-space crosshair hint when flag mode is active. */
function renderFlagModeCrosshair(t) {
  const pulse = 0.6 + Math.abs(Math.sin(t * 4)) * 0.4;
  ctx.save();
  ctx.strokeStyle = `rgba(220,60,60,${pulse})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.setLineDash([]);
  ctx.restore();
}

function renderNumbers() {
  for (const k of explored) {
    const [r, c] = k.split(',').map(Number);
    if (r === mig.gy && c === mig.gx) continue;
    if (r === cheese.gy && c === cheese.gx) continue;
    const x = c * TS, y = r * TS, n = countTrapsAround(r, c);
    if (n === 0) { ctx.fillStyle = 'rgba(255,255,200,0.1)'; fc(x+TS/2, y+TS/2, 4); continue; }
    ctx.save();
    ctx.font = `bold ${Math.floor(TS*0.46)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillText(n, x+TS/2+1.5, y+TS/2+1.5);
    ctx.fillStyle = NUM_COLORS[Math.min(n, 8)]; ctx.fillText(n, x+TS/2, y+TS/2);
    ctx.restore();
  }
}

function countTrapsAround(r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
    if (!(dr===0&&dc===0) && trapSet.has(pos(r+dr, c+dc))) n++;
  return n;
}

function renderCheese(t) {
  const cx = cheese.gx * TS + TS/2, cy = cheese.gy * TS + TS/2 + Math.sin(t*2.2)*2.5;
  ctx.save(); ctx.translate(cx, cy); drawCheeseShape(t); ctx.restore();
}

function drawCheeseShape(t) {
  const g = ctx.createRadialGradient(0,0,2,0,0,27);
  g.addColorStop(0,'rgba(255,215,50,0.42)'); g.addColorStop(1,'rgba(255,215,50,0)');
  ctx.fillStyle = g; fc(0,0,27);
  ctx.fillStyle = '#f0c030';
  ctx.beginPath(); ctx.moveTo(-14,11); ctx.lineTo(14,11); ctx.lineTo(10,-5); ctx.lineTo(-10,-5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d8a820';
  ctx.beginPath(); ctx.moveTo(-10,-5); ctx.lineTo(10,-5); ctx.lineTo(6,-17); ctx.lineTo(-6,-17); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a87818';
  ctx.beginPath(); ctx.ellipse(-4,3,3.5,3,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(7,5,3,2.5,0.3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-1,-1,2.2,1.8,-0.2,0,Math.PI*2); ctx.fill();
  if (gState === 'celebrating' && mig.anim === 'win') {
    const sc = ['#f8d040','#ff7090','#50d8ff','#90ff90'];
    for (let i = 0; i < 4; i++) {
      const a = t*5 + i*Math.PI/2;
      ctx.fillStyle = sc[i]; fc(Math.cos(a)*22, -5+Math.sin(a)*15, 3.8);
    }
  }
}

function renderTriggeredTrap(t) {
  // Only the tile Miguel stepped on — all other traps stay hidden.
  // A fresh random layout is generated on every retry, so there is
  // nothing useful the player could memorise even if they saw more.
  drawTrap(mig.gx * TS + TS/2, mig.gy * TS + TS/2, true, t);
}

function drawTrap(cx, cy, isHit, t) {
  if (isHit) { const f = Math.max(0,1-(mig.deathSpinMs/200)); ctx.fillStyle=`rgba(232,64,64,${0.3*f})`; fc(cx,cy,24); }
  ctx.fillStyle = isHit ? '#cc6060' : '#787878'; ctx.fillRect(cx-13, cy+4, 26, 5);
  ctx.strokeStyle = isHit ? '#ffaaaa' : '#c0c0c0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx-11,cy+4); ctx.lineTo(cx,cy-9); ctx.lineTo(cx+11,cy+4); ctx.stroke();
  ctx.fillStyle = '#8a5030'; fc(cx, cy, 4.5);
}

function renderAtmosphere() {
  const room = getRoom();
  const [dr, dg, db] = room.darkRGB;
  const [tr2, tg2, tb2] = room.torchRGB;
  const gW = cols*TS, gH = rows*TS;
  const mx = mig.px, my = mig.py;
  const cx = cheese.gx*TS+TS/2, cy2 = cheese.gy*TS+TS/2;
  const r1 = TS*2.2, r2 = TS*5.8;

  const dark = ctx.createRadialGradient(mx,my,r1,mx,my,r2);
  dark.addColorStop(0,`rgba(${dr},${dg},${db},0)`);
  dark.addColorStop(1,`rgba(${dr},${dg},${db},0.83)`);
  ctx.fillStyle = dark; ctx.fillRect(0,0,gW,gH);

  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const torch = ctx.createRadialGradient(mx,my,0,mx,my,r1);
  torch.addColorStop(0,`rgba(${tr2},${tg2},${tb2},0.1)`);
  torch.addColorStop(1,`rgba(${tr2},${tg2},${tb2},0)`);
  ctx.fillStyle = torch; ctx.fillRect(0,0,gW,gH);
  const chg = ctx.createRadialGradient(cx,cy2,0,cx,cy2,TS*2.5);
  chg.addColorStop(0,'rgba(255,215,60,0.22)'); chg.addColorStop(1,'rgba(255,215,60,0)');
  ctx.fillStyle = chg; ctx.fillRect(0,0,gW,gH);
  ctx.restore();
}


// ════════════════════════════════════════════════════════
//  MIGUEL RENDERING
// ════════════════════════════════════════════════════════

function renderMiguel(t) {
  let ox = 0, oy = 0;
  if (mig.bumpMs > 0) { const p = mig.bumpMs/160; ox = mig.bumpX*Math.sin(p*Math.PI)*5; oy = mig.bumpY*Math.sin(p*Math.PI)*5; }
  ctx.save(); ctx.translate(mig.px+ox, mig.py+oy);
  if (mig.dir === 'left') ctx.scale(-1,1);
  if (mig.anim === 'dead') {
    const p = mig.deathSpinMs/850;
    ctx.rotate(Math.sin(p*Math.PI*8)*0.35*(1-p*0.4));
  } else if (mig.anim === 'win') {
    ctx.translate(0, -Math.abs(Math.sin((mig.celebMs/1250)*Math.PI*3)*5));
  }
  drawMiguelSprite(t);
  ctx.restore();
}

function drawMiguelSprite(t) {
  const anim    = mig.anim;
  const nervous = anim === 'nervous', walk = anim === 'walk', dead = anim === 'dead', win = anim === 'win';
  const walkCycle = walk ? Math.sin(t*16) : 0;
  const breathe   = Math.sin(t*1.65)*1.5;
  const bodyY     = walk ? -Math.abs(walkCycle)*1.5 : breathe;

  // Tail
  const wagA = nervous?17:win?14:9, wagF = nervous?8:win?5:3;
  const tailWag = Math.sin(t*wagF)*wagA;
  ctx.strokeStyle = '#8a8898'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-14,4+bodyY);
  ctx.bezierCurveTo(-22,12+bodyY,-26+tailWag*0.4,20,-30,5+tailWag); ctx.stroke();

  // Back legs
  const legSwing = walkCycle*5;
  drawLeg(-9,9+bodyY,-9,21+bodyY+legSwing); drawLeg(-2,9+bodyY,-2,21+bodyY-legSwing);

  // Body
  ctx.fillStyle='#9898a8'; ctx.beginPath(); ctx.ellipse(-2,bodyY,16,11,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#bebece'; ctx.beginPath(); ctx.ellipse(-2,bodyY+4,10,7,0,0,Math.PI*2); ctx.fill();

  // Front legs
  drawLeg(6,9+bodyY,6,21+bodyY-legSwing); drawLeg(12,9+bodyY,12,21+bodyY+legSwing);

  // Head
  const hy = bodyY - 20 + (anim==='idle'?Math.sin(t*0.9)*0.8:0);
  ctx.fillStyle='#a0a0b0'; ctx.beginPath(); ctx.arc(10,hy,13,0,Math.PI*2); ctx.fill();

  // Ears
  const earBase = nervous?Math.sin(t*11)*14:Math.sin(t*2.5)*4, earDown = nervous?4:0;
  ctx.save(); ctx.translate(4,hy-10+earDown); ctx.rotate((earBase-4)*Math.PI/180);
  ctx.fillStyle='#a0a0b0'; ctx.beginPath(); ctx.ellipse(0,-7,6.5,9,-0.15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#d09090'; ctx.beginPath(); ctx.ellipse(0,-7,3.8,5.5,-0.15,0,Math.PI*2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(16,hy-10+earDown); ctx.rotate((4-earBase)*Math.PI/180);
  ctx.fillStyle='#a0a0b0'; ctx.beginPath(); ctx.ellipse(0,-7,6.5,9,0.15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#d09090'; ctx.beginPath(); ctx.ellipse(0,-7,3.8,5.5,0.15,0,Math.PI*2); ctx.fill(); ctx.restore();

  // Eyes
  if (dead) {
    ctx.strokeStyle='#ff4040'; ctx.lineWidth=2.5; ctx.lineCap='round';
    for (const [x1,y1,x2,y2] of [[3,hy-6,9,hy],[11,hy-6,17,hy]]) {
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2,y1); ctx.lineTo(x1,y2); ctx.stroke();
    }
  } else {
    const blink = Math.sin(t*(nervous?4.5:0.52)) > (nervous?0.84:0.96);
    const eyeH  = blink ? 1.5 : 5.5;
    const lookX = Math.sin(t*(nervous?5.5:0.85))*(nervous?3.5:1.8);
    ctx.fillStyle='#f0f0ff';
    ctx.beginPath(); ctx.ellipse(6+lookX,hy-2,4.5,eyeH,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14+lookX,hy-2,4.5,eyeH,0,0,Math.PI*2); ctx.fill();
    if (!blink) {
      ctx.fillStyle='#181828'; fc(7+lookX,hy-2,3); fc(15+lookX,hy-2,3);
      ctx.fillStyle='rgba(255,255,255,0.9)'; fc(8+lookX,hy-4,1.3); fc(16+lookX,hy-4,1.3);
      if (win) {
        ctx.strokeStyle='#181828'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(6+lookX,hy-4,4,Math.PI*0.2,Math.PI*0.8); ctx.stroke();
        ctx.beginPath(); ctx.arc(14+lookX,hy-4,4,Math.PI*0.2,Math.PI*0.8); ctx.stroke();
      }
    }
  }

  // Nose
  const noseTwitch = Math.sin(t*(nervous?10:3.5))*(nervous?2.2:1);
  ctx.fillStyle='#e89090'; ctx.beginPath(); ctx.ellipse(22,hy+2+noseTwitch,5.5,4,0.3,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#c06868'; fc(20.5,hy+2,1.4); fc(23.5,hy+2,1.4);

  // Whiskers
  ctx.strokeStyle='rgba(255,255,255,0.62)'; ctx.lineWidth=0.9; ctx.lineCap='round';
  const wt=noseTwitch*0.6, nx=20, ny=hy+2;
  for (const [x1,y1,x2,y2] of [
    [nx,ny,nx-24,ny-5+wt],[nx,ny,nx-24,ny+wt],[nx,ny,nx-24,ny+5+wt],
    [nx+4,ny,nx+28,ny-5-wt],[nx+4,ny,nx+28,ny-wt],[nx+4,ny,nx+28,ny+5-wt],
  ]) { ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }

  // Nervous sweat drop
  if (nervous) {
    const sd2 = Math.max(0,Math.sin(t*2.8))*5;
    ctx.fillStyle='#80c0ff'; ctx.beginPath();
    ctx.moveTo(22,hy-22-sd2); ctx.bezierCurveTo(26,hy-16-sd2,26,hy-16-sd2,22,hy-22-sd2); ctx.fill();
    fc(22,hy-17-sd2,3.5);
  }

  // Death: spinning dizzy stars
  if (dead) {
    const starColors=['#ffe040','#ff8080','#80c8ff'];
    const spinRate = mig.deathSpinMs/1000*Math.PI*6;
    for (let i=0; i<5; i++) {
      const a=spinRate+i*(Math.PI*2/5), rr=26;
      ctx.fillStyle=starColors[i%3]; drawStar(ctx, Math.cos(a)*rr, hy-8+Math.sin(a)*rr*0.5, 4.5);
    }
  }

  // Win: sparkle orbit
  if (win) {
    const sc=['#f8d040','#ff7090','#50d8ff','#90ff90','#ffa0f0'];
    for (let i=0; i<5; i++) {
      const a=t*4+i*(Math.PI*2/5), rr=25+Math.sin(t*2+i)*5;
      ctx.fillStyle=sc[i]; fc(Math.cos(a)*rr, hy+Math.sin(a)*rr*0.65, 3.2);
    }
  }
}

function drawLeg(x1,y1,x2,y2) {
  ctx.strokeStyle='#808090'; ctx.lineWidth=4.5; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.fillStyle='#707080'; ctx.beginPath(); ctx.ellipse(x2,y2,4,2.5,0,0,Math.PI*2); ctx.fill();
}

function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i=0; i<5; i++) {
    const oa=(i*2*Math.PI/5)-Math.PI/2, ia=oa+Math.PI/5;
    const ox=cx+Math.cos(oa)*r, oy=cy+Math.sin(oa)*r;
    const ix=cx+Math.cos(ia)*r*0.42, iy=cy+Math.sin(ia)*r*0.42;
    i===0?ctx.moveTo(ox,oy):ctx.lineTo(ox,oy); ctx.lineTo(ix,iy);
  }
  ctx.closePath(); ctx.fill();
}


// ════════════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════════════

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
    setTimeout(() => document.getElementById('btn-continue')?.focus(), 50);
  } else {
    const nightEl = document.getElementById('win-night');
    if (nightEl) nightEl.textContent = `🌙 Night ${lvlIdx + 1} complete!`;
    document.getElementById('win-overlay').classList.add('show');
    setTimeout(() => document.getElementById('btn-next')?.focus(), 50);
  }
}

function hideOverlays() {
  ['dead-overlay','win-overlay','room-transition-overlay'].forEach(id =>
    document.getElementById(id)?.classList.remove('show')
  );
}

function showLifeLostFlash() {
  const el = document.getElementById('life-lost-msg');
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 750);
}

function showRoomTransition() {
  const room = getRoom();
  const icons = { 0:'🍳', 1:'🥫', 2:'🍽️', 3:'🧺' };
  const roomIdx = Math.min(Math.floor(lvlIdx / 5), 2);
  const el = document.getElementById('room-transition-overlay');
  if (!el) { startLevel(lvlIdx); return; }
  document.getElementById('rt-icon').textContent  = icons[roomIdx] || '🏠';
  document.getElementById('rt-room').textContent  = room.name;
  document.getElementById('rt-night').textContent = `🌙 Night ${lvlIdx + 1}`;
  document.getElementById('rt-flavor').innerHTML  = room.transition.replace(/\n/g,'<br>');
  el.classList.add('show');
  Audio.sfxRoomTrans();
  setTimeout(() => document.getElementById('btn-room-continue')?.focus(), 50);
}

function showGameComplete() {
  document.querySelector('#win-title').innerHTML  = 'All Nights<br>Conquered!';
  document.querySelector('#win-sub').innerHTML    = 'Miguel has explored the whole house.<br>A true kitchen hero!';
  document.getElementById('win-night').textContent = `🧀 Total cheese: ${cheesesCollected}`;
  const btnNext = document.getElementById('btn-next');
  btnNext.textContent = '▶ Play Again';
  btnNext.onclick = () => { lvlIdx = 0; lives = MAX_LIVES; cheesesCollected = 0; startLevel(0); };
  document.getElementById('win-overlay').classList.add('show');
}

function updateHud() {
  const lvl = LEVELS[Math.min(lvlIdx, LEVELS.length-1)];
  const nightEl  = document.getElementById('hud-level');
  const livesEl  = document.getElementById('hud-lives');
  const cheeseEl = document.getElementById('hud-cheese');
  if (nightEl)  nightEl.textContent = `🌙 ${lvl.name}`;
  if (livesEl)  livesEl.innerHTML   = '❤️'.repeat(lives) + '<span style="opacity:.3">🤍</span>'.repeat(MAX_LIVES-lives);
  if (cheeseEl) cheeseEl.textContent = `🧀 ×${cheesesCollected}`;
}

function toggleMusic() {
  ensureAudio();
  const on  = Audio.toggle();
  const btn = document.getElementById('btn-music');
  if (btn) { btn.textContent = on?'🎵':'🔇'; btn.setAttribute('aria-pressed', String(on)); }
}


// ════════════════════════════════════════════════════════
//  PUBLIC ACTIONS  (called from HTML)
// ════════════════════════════════════════════════════════

function continueGame()        { lives = MAX_LIVES; startLevel(lvlIdx); }
function quitGame()            { window.location.href = 'index.html'; }
function nextNight()           { lvlIdx++; lives = MAX_LIVES; startLevel(lvlIdx); }
function restartLevel()        { lives = MAX_LIVES; startLevel(lvlIdx); }
function confirmRoomTransition() {
  document.getElementById('room-transition-overlay')?.classList.remove('show');
  startLevel(lvlIdx);
}


// ════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════

function fc(x,y,r)  { ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function sd(n)      { return Math.abs(Math.sin(n*127.1+43.7)*43758.5453)%1; }


// ════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════

window.addEventListener('load', init);

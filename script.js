// ─── Audio Engine (Web Audio API) ─────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function playTone(freq, type, startTime, duration, volume = 0.3, destination = null) {
    const ac = getAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(destination || ac.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
}

// Background music: arpeggio loop
let musicNodes = [];
let musicScheduler = null;
let musicBeat = 0;

const MUSIC_NOTES = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63]; // C4 major arp
const MUSIC_BASS = [65.41, 65.41, 87.31, 87.31];

function startMusic() {
    stopMusic();
    const ac = getAudio();
    musicBeat = 0;

    // Compressor for polish
    const comp = ac.createDynamicsCompressor();
    comp.connect(ac.destination);

    function scheduleBeat() {
        if (!isPlaying) return;
        const bps = 0.18 + Math.min(level * 0.015, 0.12); // speed up each level
        const now = ac.currentTime;

        const note = MUSIC_NOTES[musicBeat % MUSIC_NOTES.length];
        const bass = MUSIC_BASS[Math.floor(musicBeat / 2) % MUSIC_BASS.length];

        playTone(note, 'square', now, bps * 0.8, 0.07, comp);
        if (musicBeat % 2 === 0) {
            playTone(bass, 'sawtooth', now, bps * 1.6, 0.06, comp);
        }
        // Hi-hat: white noise approximation via high-freq sawtooth
        if (musicBeat % 4 === 0) {
            playTone(4000, 'sawtooth', now, 0.04, 0.03, comp);
        }

        musicBeat++;
        musicScheduler = setTimeout(scheduleBeat, bps * 1000);
    }

    scheduleBeat();
}

function stopMusic() {
    if (musicScheduler) { clearTimeout(musicScheduler); musicScheduler = null; }
}

function playSoundLose() {
    const ac = getAudio();
    const now = ac.currentTime;
    const notes = [523.25, 392.00, 261.63, 196.00, 130.81];
    notes.forEach((f, i) => playTone(f, 'sawtooth', now + i * 0.12, 0.18, 0.25));
    // low impact boom
    playTone(55, 'sine', now, 0.5, 0.35);
}

function playSoundLevelUp() {
    const ac = getAudio();
    const now = ac.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => playTone(f, 'square', now + i * 0.09, 0.15, 0.15));
}

// ─── DOM References ────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const timerEl = document.getElementById('timer');
const levelNumEl = document.getElementById('level-num');
const levelDisplayEl = document.getElementById('level-display');
const levelUpAnnounce = document.getElementById('level-up-announce');
const colorIndicatorEl = document.getElementById('color-indicator');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const finalTimeEl = document.getElementById('final-time');

// ─── Canvas Size ───────────────────────────────────────────────────────────────
const CANVAS_SIZE = 600;
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

// ─── Color Palette ─────────────────────────────────────────────────────────────
const COLORS = [
    '#f43f5e', // Rose
    '#3b82f6', // Blue
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#8b5cf6', // Violet
    '#06b6d4'  // Cyan
];

// ─── Level Configuration ────────────────────────────────────────────────────────
// Each level: { duration (seconds to pass before next), baseSpeed, spawnInterval, colorInterval }
// Values scale additively per level above 5
const LEVEL_PRESETS = [
    null, // index 0 unused
    { tileSpeed: 90, spawnMs: 900, colorMs: 5500 }, // Level 1
    { tileSpeed: 115, spawnMs: 750, colorMs: 4500 }, // Level 2
    { tileSpeed: 145, spawnMs: 600, colorMs: 3500 }, // Level 3
    { tileSpeed: 180, spawnMs: 470, colorMs: 2700 }, // Level 4
    { tileSpeed: 220, spawnMs: 360, colorMs: 2000 }, // Level 5
    { tileSpeed: 270, spawnMs: 280, colorMs: 1500 }, // Level 6
    { tileSpeed: 330, spawnMs: 210, colorMs: 1200 }, // Level 7
    { tileSpeed: 400, spawnMs: 160, colorMs: 900 }, // Level 8
    { tileSpeed: 480, spawnMs: 120, colorMs: 700 }, // Level 9
    { tileSpeed: 580, spawnMs: 90, colorMs: 500 }, // Level 10
];

const LEVEL_DURATION = 10; // seconds per level
const MAX_LEVELS = 10;

function getLevelConfig(lvl) {
    if (lvl <= MAX_LEVELS) return LEVEL_PRESETS[lvl];
    // Beyond level 10: exponential madness
    const base = LEVEL_PRESETS[MAX_LEVELS];
    const extra = lvl - MAX_LEVELS;
    return {
        tileSpeed: base.tileSpeed + extra * 80,
        spawnMs: Math.max(50, base.spawnMs - extra * 10),
        colorMs: Math.max(300, base.colorMs - extra * 40)
    };
}

// ─── State ─────────────────────────────────────────────────────────────────────
let isPlaying = false;
let survivalTime = 0;
let lastTime = 0;
let animationId;
let level = 1;
let colorChangeTimer = 0;
let tileSpawnTimer = 0;
let currentForbiddenColor = '';
let levelAnnounceTimeout = null;

const player = {
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    size: 20,
    speed: 350,
    color: '#ffffff'
};

const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };

window.addEventListener('keydown', (e) => {
    if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
    if (e.key in keys) keys[e.key] = false;
});

// ─── Tile ───────────────────────────────────────────────────────────────────────
let tiles = [];

class Tile {
    constructor(speed) {
        this.size = Math.random() * 24 + 14;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const edge = Math.floor(Math.random() * 4);
        const pad = 60;

        const angle = Math.random() * Math.PI * 2;
        const s = speed * (0.85 + Math.random() * 0.3);

        if (edge === 0) { this.x = Math.random() * CANVAS_SIZE; this.y = -pad; }
        else if (edge === 1) { this.x = CANVAS_SIZE + pad; this.y = Math.random() * CANVAS_SIZE; }
        else if (edge === 2) { this.x = Math.random() * CANVAS_SIZE; this.y = CANVAS_SIZE + pad; }
        else { this.x = -pad; this.y = Math.random() * CANVAS_SIZE; }

        // Aim loosely toward canvas center
        const toCenter = {
            x: (CANVAS_SIZE / 2 - this.x),
            y: (CANVAS_SIZE / 2 - this.y)
        };
        const len = Math.sqrt(toCenter.x ** 2 + toCenter.y ** 2);
        this.dx = (toCenter.x / len + (Math.random() - 0.5) * 0.8) * s;
        this.dy = (toCenter.y / len + (Math.random() - 0.5) * 0.8) * s;

        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 3;
    }

    update(dt) {
        this.x += this.dx * dt;
        this.y += this.dy * dt;
        this.rotation += this.rotSpeed * dt;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
        ctx.rotate(this.rotation);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 14;
        const h = this.size / 2;
        if (ctx.roundRect) {
            ctx.beginPath(); ctx.roundRect(-h, -h, this.size, this.size, 4); ctx.fill();
        } else {
            ctx.fillRect(-h, -h, this.size, this.size);
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(-h + 2, -h + 2, this.size - 4, this.size - 4);
        ctx.restore();
    }

    isOffScreen() {
        return this.x < -120 || this.x > CANVAS_SIZE + 120 || this.y < -120 || this.y > CANVAS_SIZE + 120;
    }
}

function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    const s = 3;
    return x2 + s < x1 + w1 - s && x2 + w2 - s > x1 + s &&
        y2 + s < y1 + h1 - s && y2 + h2 - s > y1 + s;
}

// ─── Forbidden Color ────────────────────────────────────────────────────────────
function changeForbiddenColor() {
    let c;
    do { c = COLORS[Math.floor(Math.random() * COLORS.length)]; }
    while (c === currentForbiddenColor && COLORS.length > 1);
    currentForbiddenColor = c;

    colorIndicatorEl.style.backgroundColor = c;
    colorIndicatorEl.style.boxShadow = `0 0 25px ${c}`;
    colorIndicatorEl.style.transform = 'scale(1.4)';
    setTimeout(() => { colorIndicatorEl.style.transform = 'scale(1)'; }, 300);
}

// ─── Level Up ──────────────────────────────────────────────────────────────────
function doLevelUp(newLevel) {
    level = newLevel;
    levelNumEl.textContent = level;
    levelDisplayEl.style.transform = 'scale(1.4)';
    setTimeout(() => { levelDisplayEl.style.transform = 'scale(1)'; }, 300);

    playSoundLevelUp();

    // Show "Level X!" flash
    clearTimeout(levelAnnounceTimeout);
    levelUpAnnounce.textContent = level > MAX_LEVELS ? `Level ${level}! 🔥` : `Level ${level}!`;
    levelUpAnnounce.style.animation = 'none';
    levelUpAnnounce.offsetHeight; // reflow
    levelUpAnnounce.style.animation = 'levelUpPop 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards';

    // Reset color timer on level up for fresh start
    changeForbiddenColor();
    colorChangeTimer = 0;
}

// ─── Game Reset ────────────────────────────────────────────────────────────────
function resetGame() {
    if (animationId) cancelAnimationFrame(animationId);

    player.x = CANVAS_SIZE / 2;
    player.y = CANVAS_SIZE / 2;
    tiles = [];
    survivalTime = 0;
    colorChangeTimer = 0;
    tileSpawnTimer = 0;
    level = 1;
    currentForbiddenColor = '';

    levelNumEl.textContent = '1';
    levelDisplayEl.style.transform = 'scale(1)';

    changeForbiddenColor();

    startScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');

    isPlaying = true;
    lastTime = performance.now();

    startMusic();
    animationId = requestAnimationFrame(gameLoop);
}

// ─── Game Over ─────────────────────────────────────────────────────────────────
function gameOver() {
    isPlaying = false;
    stopMusic();
    playSoundLose();

    finalTimeEl.innerText = `${survivalTime.toFixed(1)}s (Level ${level})`;
    gameOverScreen.classList.add('active');
}

// ─── Update ────────────────────────────────────────────────────────────────────
function update(dt) {
    survivalTime += dt;
    timerEl.innerText = `Time: ${survivalTime.toFixed(1)}s`;

    // Check for level up
    const newLevel = Math.floor(survivalTime / LEVEL_DURATION) + 1;
    if (newLevel > level) doLevelUp(newLevel);

    const cfg = getLevelConfig(level);

    // Player movement
    let mx = 0, my = 0;
    if (keys.w || keys.ArrowUp) my -= 1;
    if (keys.s || keys.ArrowDown) my += 1;
    if (keys.a || keys.ArrowLeft) mx -= 1;
    if (keys.d || keys.ArrowRight) mx += 1;

    if (mx !== 0 && my !== 0) { const l = Math.SQRT2; mx /= l; my /= l; }

    player.x = Math.max(0, Math.min(CANVAS_SIZE - player.size, player.x + mx * player.speed * dt));
    player.y = Math.max(0, Math.min(CANVAS_SIZE - player.size, player.y + my * player.speed * dt));

    // Spawn tiles
    tileSpawnTimer += dt * 1000;
    if (tileSpawnTimer >= cfg.spawnMs) {
        tiles.push(new Tile(cfg.tileSpeed));
        // At high levels spawn extra tiles per tick
        if (level >= 7 && Math.random() < 0.5) tiles.push(new Tile(cfg.tileSpeed));
        if (level >= 10 && Math.random() < 0.4) tiles.push(new Tile(cfg.tileSpeed));
        tileSpawnTimer = 0;
    }

    // Color cycle
    colorChangeTimer += dt * 1000;
    if (colorChangeTimer >= cfg.colorMs) {
        changeForbiddenColor();
        colorChangeTimer = 0;
    }

    // Update tiles, check collisions
    for (let i = tiles.length - 1; i >= 0; i--) {
        const t = tiles[i];
        t.update(dt);
        if (t.isOffScreen()) { tiles.splice(i, 1); continue; }

        if (rectIntersect(player.x, player.y, player.size, player.size, t.x, t.y, t.size, t.size)) {
            if (t.color === currentForbiddenColor) { gameOver(); return; }
        }
    }
}

// ─── Draw ──────────────────────────────────────────────────────────────────────
function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const sp = 40;
    for (let i = 0; i < CANVAS_SIZE; i += sp) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CANVAS_SIZE, i); ctx.stroke();
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    drawGrid();
    tiles.forEach(t => t.draw());

    // Player
    ctx.save();
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = player.color;
    const h = player.size / 2;
    ctx.translate(player.x + h, player.y + h);
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(-h, -h, player.size, player.size, 4); ctx.fill();
    } else {
        ctx.fillRect(-h, -h, player.size, player.size);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-h + 3, -h + 3, player.size - 6, player.size - 6);
    ctx.restore();
}

// ─── Game Loop ─────────────────────────────────────────────────────────────────
function gameLoop(timestamp) {
    if (!isPlaying) return;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.1) dt = 0.1;
    update(dt);
    draw();
    if (isPlaying) animationId = requestAnimationFrame(gameLoop);
}

// ─── Buttons ───────────────────────────────────────────────────────────────────
startBtn.addEventListener('click', resetGame);
restartBtn.addEventListener('click', resetGame);

// Initial draw
draw();

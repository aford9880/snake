/*
 * Game Core — вся игровая логика.
 *
 * Модуль не знает, на какой площадке запущен: он импортирует только
 * абстракции платформенного слоя (константы событий) и получает готовый набор
 * сервисов извне, через startGame(). Прямых обращений к SDK здесь нет и быть
 * не должно.
 */

import { I18n } from './i18n.js';
import { PlatformEvent } from '../platform/core/events.js';

/* Сервисы площадки. Заполняется один раз в startGame(). */
let platform = null;

/*
 * Конфигурация сборки (js/platform.config.js): она приходит из composition
 * root вместе с платформой. Игре отсюда нужен только контакт поддержки —
 * у площадок разные требования к тому, что можно показывать игроку.
 */
let buildConfig = {};

/* ==== DOM ==== */
const canvas = document.getElementById('game');
const gameSurface = canvas.closest('.canvas-container');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const coinsEl = document.getElementById('coins');
const statusEl = document.getElementById('status');
const modeLabel = document.getElementById('modeLabel');
const modeChipsEl = document.getElementById('modeChips');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlaySub = document.getElementById('overlaySub');
const reviveBtn = document.getElementById('reviveBtn');
const x2Btn = document.getElementById('x2Btn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const overlayRestart = document.getElementById('overlayRestart');
const shopModal = document.getElementById('shopModal');
const helpModal = document.getElementById('helpModal');
const helpSupport = document.getElementById('helpSupport');
const shopCoinsEl = document.getElementById('shopCoins');
const skinListEl = document.getElementById('skinList');
const muteBtn = document.getElementById('muteBtn');
const pauseBtn = document.getElementById('pauseBtn');
const loadingScreen = document.getElementById('loadingScreen');
const tr = (key, params) => I18n.t(key, params);

/* Input stays closed while platform data and the initial frame are prepared. */
let gameReadyForInput = false;

/* TV remote arrows steer only during a live round; elsewhere they navigate UI. */
function isElementVisible(element) {
  return !element.disabled
    && !element.closest('.hidden')
    && element.getClientRects().length > 0;
}

function isUiFocusMode() {
  return paused
    || !overlayEl.classList.contains('hidden')
    || !shopModal.classList.contains('hidden')
    || !helpModal.classList.contains('hidden')
    || isUiControl(document.activeElement);
}

function isUiControl(element) {
  return element instanceof HTMLElement
    && element.matches('button, input')
    && isElementVisible(element);
}

function focusGameSurface() {
  canvas.focus({ preventScroll: true });
}

function visibleButtons() {
  const scope = !helpModal.classList.contains('hidden')
    ? helpModal
    : !shopModal.classList.contains('hidden')
      ? shopModal
      : !overlayEl.classList.contains('hidden')
        ? overlayEl
        : document;
  return [...scope.querySelectorAll('button')].filter(isElementVisible);
}

function focusButton(button) {
  if (isElementVisible(button)) button.focus({ preventScroll: true });
}

function moveUiFocus(step) {
  const buttons = visibleButtons();
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement);
  const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
  focusButton(buttons[next]);
}

function setGameInputEnabled(enabled) {
  gameReadyForInput = enabled;
  document.querySelectorAll('button, input').forEach((element) => {
    element.disabled = !enabled;
  });
}

function openGame() {
  gameReadyForInput = true;
  setGameInputEnabled(true);
  loadingScreen.classList.add('is-hidden');
  platform.lifecycle.notifyReady();
  platform.lifecycle.gameplayStart();
}

setGameInputEnabled(false);

/* ==== CONSTANTS ==== */
const W = 500, H = 500;
const COLS = 20, ROWS = 20;
const CELL = W / COLS;
const OBSTACLE_COUNT = 14;

const SKINS = [
  { id: 'classic', nameKey: 'skinClassic', cost: 0,    head: [130, 230, 90],  tail: [80, 190, 255] },
  { id: 'neon',    nameKey: 'skinNeon',    cost: 150,  head: [255, 107, 255], tail: [77, 150, 255] },
  { id: 'fire',    nameKey: 'skinFire',    cost: 300,  head: [255, 217, 61],  tail: [255, 80, 80] },
  { id: 'ghost',   nameKey: 'skinGhost',   cost: 0, ad: true, head: [245, 245, 255], tail: [110, 120, 150] },
  { id: 'gold',    nameKey: 'skinGold',    cost: 600,  head: [255, 245, 170], tail: [214, 158, 32] },
  { id: 'rainbow', nameKey: 'skinRainbow', cost: 1000, rainbow: true },
];

const MODES = [
  { id: 'classic',   nameKey: 'modeClassic' },
  { id: 'wrap',      nameKey: 'modeWrap' },
  { id: 'obstacles', nameKey: 'modeObstacles' },
];

/* ==== SAVE (монеты, рекорд, скины — уходит в StorageService платформы) ==== */
let save = {
  coins: 0,
  highScore: 0,
  skins: ['classic'],
  selectedSkin: 'classic',
  muted: false,
  mode: 'classic',
  tutorialSeen: false,
};

function persist() {
  /* Запись не блокирует игру и никогда не бросает наружу ошибку платформы. */
  platform.storage.save(save).catch(e => console.warn('Save failed', e));
}

/* ==== SOUND (WebAudio, без внешних файлов) ==== */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type, vol, delay) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol || 0.12, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sound(name) {
  if (save.muted || !audioCtx) return;
  switch (name) {
    case 'eat':     tone(660, 0.08, 'square', 0.1); tone(880, 0.08, 'square', 0.08, 0.05); break;
    case 'special': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.09, 'triangle', 0.12, i * 0.07)); break;
    case 'die':     [330, 262, 196, 131].forEach((f, i) => tone(f, 0.15, 'sawtooth', 0.1, i * 0.11)); break;
    case 'click':   tone(440, 0.05, 'square', 0.06); break;
    case 'coin':    tone(988, 0.07, 'square', 0.08); tone(1319, 0.12, 'square', 0.08, 0.07); break;
    case 'revive':  [262, 330, 392, 523].forEach((f, i) => tone(f, 0.1, 'triangle', 0.12, i * 0.08)); break;
  }
}

document.addEventListener('keydown', ensureAudio);
document.addEventListener('pointerdown', ensureAudio);

/*
 * The whole board, including an end-of-round overlay, is a game surface.
 * Capture-phase listeners are intentional: a canvas or a browser-specific
 * gesture handler must never get a chance to open a context menu or start a
 * text selection before the event bubbles to a child element.
 */
for (const eventName of ['contextmenu', 'selectstart', 'dragstart']) {
  gameSurface.addEventListener(eventName, (event) => event.preventDefault(), true);
}

/* Safari can show a callout on a long press before pointer handlers run. */
gameSurface.addEventListener('touchstart', (event) => {
  if (event.target.closest('canvas')) event.preventDefault();
}, { capture: true, passive: false });

gameSurface.addEventListener('pointerdown', (event) => {
  if (event.target.closest('canvas')) event.preventDefault();
}, { capture: true, passive: false });

function pauseAudio() {
  if (audioCtx?.state === 'running') audioCtx.suspend();
}

function resumeAudio() {
  if (!platformPaused && !save.muted && audioCtx?.state === 'suspended') audioCtx.resume();
}

let platformPaused = false;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseAudio();
  else resumeAudio();
});
window.addEventListener('blur', pauseAudio);
window.addEventListener('focus', resumeAudio);

/*
 * События площадки приходят уже в собственных терминах проекта: показ рекламы
 * и просьба хоста приостановить игру. Какой именно SDK их породил, игра не знает.
 */
function subscribePlatformEvents() {
  platform.on(PlatformEvent.AD_OPEN, pauseAudio);
  platform.on(PlatformEvent.AD_CLOSE, resumeAudio);
  platform.on(PlatformEvent.PAUSE, () => {
    platformPaused = true;
    pauseAudio();
  });
  platform.on(PlatformEvent.RESUME, () => {
    platformPaused = false;
    lastMove = performance.now();
    if (!paused && !gameOver && !win) resumeAudio();
  });
}

/* ==== GAME STATE ==== */
let snake, prevSnake, food, specialFood, direction, pendingDir, score, gameOver, win;
let speed, baseSpeed, particles, lastMove, movesSinceLastEat;
let obstacles = [];
let obstacleSet = new Set();
let paused = false;
let reviveUsed = false;
let x2Used = false;
let coinsThisRun = 0;

/*
 * Шаг из клетки (x, y) в направлении (dx, dy) с учётом режима:
 * в «Без стен» координаты заворачиваются, иначе ok=false за границей.
 */
function stepPos(x, y, dx, dy) {
  let nx = x + dx, ny = y + dy;
  if (save.mode === 'wrap') {
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
    return { nx, ny, ok: true };
  }
  return { nx, ny, ok: nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS };
}

/* Препятствия не должны отрезать куски поля — проверяем связность и перекидываем. */
function generateObstacles() {
  const midY = Math.floor(ROWS / 2);
  for (let attempt = 0; attempt < 60; attempt++) {
    const set = new Set();
    while (set.size < OBSTACLE_COUNT) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (Math.abs(y - midY) <= 1) continue; // зона старта/возрождения всегда свободна
      set.add(`${x},${y}`);
    }
    const totalFree = COLS * ROWS - set.size;
    if (countReachable(Math.floor(COLS / 2), midY, set) === totalFree) {
      return [...set].map(k => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      });
    }
  }
  return [];
}

function init() {
  const mid = Math.floor(COLS / 2);
  snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
  prevSnake = snake.map(p => ({ ...p }));
  direction = { x: 1, y: 0 };
  pendingDir = null;
  score = 0;
  coinsThisRun = 0;
  gameOver = false;
  win = false;
  paused = false;
  reviveUsed = false;
  x2Used = false;
  speed = baseSpeed;
  particles = [];
  lastMove = 0;
  movesSinceLastEat = 0;
  obstacles = save.mode === 'obstacles' ? generateObstacles() : [];
  obstacleSet = new Set(obstacles.map(p => `${p.x},${p.y}`));
  scoreEl.textContent = '0';
  statusEl.textContent = tr('gameStarted');
  hideOverlay();
  updatePauseBtn();
  placeFood();
  specialFood = null;
  if (gameReadyForInput) platform.lifecycle.gameplayStart();
}

async function newGame(withAd) {
  if (!gameReadyForInput) return;
  sound('click');
  /* Реклама между раундами: показана она или пропущена площадкой — игра
   * продолжается в обоих случаях. */
  if (withAd) await platform.ads.showInterstitial();
  init();
  focusGameSurface();
}

function placeFood() {
  const occupied = new Set(snake.map(p => `${p.x},${p.y}`));
  for (const k of obstacleSet) occupied.add(k);
  const free = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) { win = true; food = null; return; }
  food = free[Math.floor(Math.random() * free.length)];

  if (score > 0 && score % 50 === 0 && free.length > 1) {
    const nope = new Set(free.map(p => `${p.x},${p.y}`));
    nope.delete(`${food.x},${food.y}`);
    const arr = [...nope].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
    specialFood = arr[Math.floor(Math.random() * arr.length)];
  } else {
    specialFood = null;
  }
}

function spawnParticles(x, y, color, count) {
  count = count || 14;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const spd = 1 + Math.random() * 3;
    particles.push({
      x: x * CELL + CELL / 2,
      y: y * CELL + CELL / 2,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1,
      decay: 0.018 + Math.random() * 0.025,
      size: 2 + Math.random() * 4,
      color
    });
  }
}

function addCoins(n) {
  save.coins += n;
  coinsThisRun += n;
  coinsEl.textContent = save.coins;
}

function die(msg) {
  gameOver = true;
  statusEl.textContent = msg;
  sound('die');
  spawnParticles(snake[0].x, snake[0].y, '#ff6b6b', 20);
  platform.lifecycle.gameplayStop();
  platform.leaderboard.submitScore(score);
  persist();
  showGameOverOverlay();
}

function update() {
  if (gameOver || win || paused || platformPaused) return false;

  if (pendingDir) {
    const nd = pendingDir;
    if (!(nd.x + direction.x === 0 && nd.y + direction.y === 0)) {
      direction = nd;
    }
    pendingDir = null;
  }

  const hd = snake[0];
  const st = stepPos(hd.x, hd.y, direction.x, direction.y);
  if (!st.ok) {
    die(tr('hitWall'));
    return true;
  }
  const head = { x: st.nx, y: st.ny };

  if (obstacleSet.has(`${head.x},${head.y}`)) {
    die(tr('hitObstacle'));
    return true;
  }

  const willEat = food && head.x === food.x && head.y === food.y;
  const bodyCheck = willEat ? snake : snake.slice(0, -1);
  if (bodyCheck.some(p => p.x === head.x && p.y === head.y)) {
    die(tr('hitSelf'));
    return true;
  }

  prevSnake = snake.map(p => ({ ...p }));
  snake.unshift(head);

  if (willEat) {
    movesSinceLastEat = 0;
    score += 10;
    scoreEl.textContent = score;
    addCoins(1);
    sound('eat');
    spawnParticles(food.x, food.y, '#ffd93d');
    placeFood();
    if (win) {
      statusEl.textContent = tr('fieldFilled');
      addCoins(100);
      platform.lifecycle.gameplayStop();
      platform.leaderboard.submitScore(score);
      persist();
      showWinOverlay();
      return true;
    }
    if (score % 50 === 0 && speed > 60) {
      speed = Math.max(60, speed - 8);
      statusEl.textContent = tr('speedIncreased');
    } else {
      statusEl.textContent = score % 50 === 0 ? '' : '+10';
    }
  } else {
    movesSinceLastEat++;
    snake.pop();
  }

  if (specialFood && head.x === specialFood.x && head.y === specialFood.y) {
    score += 30;
    scoreEl.textContent = score;
    addCoins(5);
    sound('special');
    spawnParticles(specialFood.x, specialFood.y, '#ff6bff', 26);
    specialFood = null;
    statusEl.textContent = tr('bonus');
  }

  if (score > save.highScore) {
    save.highScore = score;
    highScoreEl.textContent = save.highScore;
  }

  return true;
}

/* ==== OVERLAY (поражение / победа) ==== */
const COIN_ICO = '<span class="coin-ico"></span>';

function overlaySubHTML() {
  return tr('runSummary', { score, coin: COIN_ICO, coins: coinsThisRun });
}

/* Кнопки за рекламу показываем, только если площадка вообще умеет rewarded.
 * Проверяем возможность, а не название платформы. */
function rewardedAvailable() {
  return platform.capabilities.rewarded;
}

/* Кнопку таблицы результатов показываем там, где у площадки есть своё окно. */
function updateLeaderboardBtn() {
  leaderboardBtn.classList.toggle('hidden', !platform.capabilities.leaderboardUi || score === 0);
}

function showGameOverOverlay() {
  overlayTitle.textContent = tr('gameOver');
  overlayTitle.style.color = '#ff6b6b';
  overlaySub.innerHTML = overlaySubHTML();
  reviveBtn.classList.toggle('hidden', reviveUsed || !rewardedAvailable());
  x2Btn.classList.toggle('hidden', x2Used || score === 0 || !rewardedAvailable());
  updateLeaderboardBtn();
  overlayEl.classList.remove('hidden');
  focusButton(overlayRestart);
}

function showWinOverlay() {
  overlayTitle.textContent = tr('victory');
  overlayTitle.style.color = '#6bcb77';
  overlaySub.innerHTML = tr('victoryDetails', { coin: COIN_ICO, summary: overlaySubHTML() });
  reviveBtn.classList.add('hidden');
  x2Btn.classList.toggle('hidden', x2Used || score === 0 || !rewardedAvailable());
  updateLeaderboardBtn();
  overlayEl.classList.remove('hidden');
  focusButton(overlayRestart);
}

/* Окно площадки, а не наш экран: игра только передаёт результат раунда. */
leaderboardBtn.addEventListener('click', async () => {
  sound('click');
  await platform.leaderboard.showUi(score);
});

function hideOverlay() {
  overlayEl.classList.add('hidden');
}

/* Возрождение за rewarded: счёт и монеты сохраняются, змейка стартует заново. */
reviveBtn.addEventListener('click', async () => {
  const result = await platform.ads.showRewarded();
  if (result.rewarded) {
    reviveUsed = true;
    gameOver = false;
    const mid = Math.floor(COLS / 2);
    snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    prevSnake = snake.map(p => ({ ...p }));
    direction = { x: 1, y: 0 };
    pendingDir = null;
    movesSinceLastEat = 0;
    lastMove = 0;
    hideOverlay();
    focusGameSurface();
    placeFood();
    statusEl.textContent = tr('secondChance');
    sound('revive');
    platform.lifecycle.gameplayStart();
  } else {
    statusEl.textContent = tr('adNotCompleted');
  }
});

/* Удвоение финального счёта за rewarded. */
x2Btn.addEventListener('click', async () => {
  const result = await platform.ads.showRewarded();
  if (result.rewarded) {
    x2Used = true;
    score *= 2;
    scoreEl.textContent = score;
    if (score > save.highScore) {
      save.highScore = score;
      highScoreEl.textContent = save.highScore;
    }
    platform.leaderboard.submitScore(score);
    persist();
    sound('coin');
    overlaySub.innerHTML = overlaySubHTML() + ' &nbsp;·&nbsp; <b style="color:#ffd93d">x2!</b>';
    x2Btn.classList.add('hidden');
  } else {
    statusEl.textContent = tr('adNotCompleted');
  }
});

overlayRestart.addEventListener('click', () => newGame(true));

/* ==== ПАУЗА ==== */
function updatePauseBtn() {
  pauseBtn.textContent = paused ? '▶️' : '⏸️';
}

function togglePause() {
  if (!gameReadyForInput) return;
  if (gameOver || win) return;
  paused = !paused;
  updatePauseBtn();
  statusEl.textContent = paused ? tr('paused') : tr('letsGo');
  if (paused) {
    platform.lifecycle.gameplayStop();
    focusButton(pauseBtn);
  } else {
    lastMove = performance.now();
    platform.lifecycle.gameplayStart();
    focusGameSurface();
  }
  sound('click');
}

pauseBtn.addEventListener('click', togglePause);

/* ==== РЕЖИМЫ ==== */
function renderModes() {
  modeChipsEl.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (save.mode === m.id ? ' active' : '');
    b.textContent = tr(m.nameKey);
    b.setAttribute('aria-pressed', String(save.mode === m.id));
    b.disabled = !gameReadyForInput;
    b.addEventListener('click', () => {
      if (save.mode === m.id) return;
      save.mode = m.id;
      persist();
      renderModes();
      sound('click');
      newGame(false); // смена режима — новый раунд без рекламы
    });
    modeChipsEl.appendChild(b);
  }
}

/* ==== МАГАЗИН СКИНОВ ==== */
function skinGradientCSS(s) {
  if (s.rainbow) return 'linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#9b59b6)';
  const [hr, hg, hb] = s.head;
  const [tr, tg, tb] = s.tail;
  return `linear-gradient(90deg, rgb(${tr},${tg},${tb}), rgb(${hr},${hg},${hb}))`;
}

function renderShop() {
  shopCoinsEl.textContent = save.coins;
  skinListEl.innerHTML = '';
  for (const s of SKINS) {
    const owned = save.skins.includes(s.id);
    const selected = save.selectedSkin === s.id;

    const card = document.createElement('div');
    card.className = 'skin-card' + (selected ? ' selected' : '');

    const preview = document.createElement('div');
    preview.className = 'skin-preview';
    preview.style.background = skinGradientCSS(s);

    const name = document.createElement('div');
    name.className = 'skin-name';
    name.textContent = tr(s.nameKey);

    const btn = document.createElement('button');
    btn.type = 'button';
    if (selected) {
      btn.textContent = tr('selected');
      btn.disabled = true;
    } else if (owned) {
      btn.textContent = tr('select');
      btn.addEventListener('click', () => {
        save.selectedSkin = s.id;
        persist();
        sound('click');
        renderShop();
      });
    } else if (s.ad) {
      btn.textContent = tr('watchAd');
      btn.className = 'ad-btn';
      btn.addEventListener('click', async () => {
        const result = await platform.ads.showRewarded();
        if (!result.rewarded) return;
        save.skins.push(s.id);
        save.selectedSkin = s.id;
        persist();
        sound('coin');
        renderShop();
      });
    } else {
      btn.innerHTML = tr('buy', { coin: COIN_ICO, cost: s.cost });
      btn.disabled = save.coins < s.cost;
      btn.addEventListener('click', () => {
        if (save.coins < s.cost) return;
        save.coins -= s.cost;
        save.skins.push(s.id);
        save.selectedSkin = s.id;
        coinsEl.textContent = save.coins;
        persist();
        sound('coin');
        renderShop();
      });
    }

    card.appendChild(preview);
    card.appendChild(name);
    card.appendChild(btn);
    skinListEl.appendChild(card);
  }
}

function openShop() {
  renderShop();
  shopModal.classList.remove('hidden');
  if (!paused && !gameOver && !win) togglePause();
  focusButton(document.getElementById('shopClose'));
}

function closeShop() {
  shopModal.classList.add('hidden');
  focusButton(document.getElementById('shopBtn'));
}

document.getElementById('shopBtn').addEventListener('click', openShop);

document.getElementById('shopClose').addEventListener('click', () => {
  closeShop();
  sound('click');
});

shopModal.addEventListener('click', (e) => {
  if (e.target === shopModal) closeShop();
});

/* ==== ОБУЧЕНИЕ И ПОДДЕРЖКА ==== */

/*
 * Правила и подсказки для новичка. Открывается сама при первом запуске
 * (требование каталогов игр) и по кнопке «❓» в любой момент.
 */
function openHelp() {
  helpModal.classList.remove('hidden');
  if (!paused && !gameOver && !win) togglePause();
  focusButton(document.getElementById('helpStart'));
}

function closeHelp() {
  helpModal.classList.add('hidden');
  if (!save.tutorialSeen) {
    save.tutorialSeen = true;
    persist();
  }
  focusButton(document.getElementById('helpBtn'));
}

/* Контакт поддержки задаётся сборкой: где его показывать нельзя — его нет. */
function renderSupport() {
  const contact = buildConfig.support;
  helpSupport.classList.toggle('hidden', !contact);
  if (contact) helpSupport.textContent = tr('helpSupport', { contact });
}

document.getElementById('helpBtn').addEventListener('click', () => {
  sound('click');
  openHelp();
});

document.getElementById('helpClose').addEventListener('click', () => {
  closeHelp();
  sound('click');
});

document.getElementById('helpStart').addEventListener('click', () => {
  closeHelp();
  sound('click');
});

helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) closeHelp();
});

/* ==== ЗВУК ON/OFF ==== */
muteBtn.addEventListener('click', () => {
  save.muted = !save.muted;
  muteBtn.textContent = save.muted ? '🔇' : '🔊';
  persist();
});

/* ==== AI ==== */
let autoPlay = false;

function bfs(sx, sy, tx, ty, occupied, freeTail) {
  const q = [{ x: sx, y: sy, d: 0 }];
  const vis = new Set();
  vis.add(`${sx},${sy}`);
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (q.length) {
    const { x, y, d } = q.shift();
    if (x === tx && y === ty) return d;
    for (const [dx, dy] of dirs) {
      const st = stepPos(x, y, dx, dy);
      if (!st.ok) continue;
      const k = `${st.nx},${st.ny}`;
      if (vis.has(k)) continue;
      if (occupied.has(k) && !(freeTail && k === `${tx},${ty}`)) continue;
      vis.add(k);
      q.push({ x: st.nx, y: st.ny, d: d + 1 });
    }
  }
  return -1;
}

function countReachable(sx, sy, occupied) {
  const q = [{ x: sx, y: sy }];
  const vis = new Set();
  vis.add(`${sx},${sy}`);
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of dirs) {
      const st = stepPos(x, y, dx, dy);
      if (!st.ok) continue;
      const k = `${st.nx},${st.ny}`;
      if (vis.has(k)) continue;
      if (occupied.has(k)) continue;
      vis.add(k);
      q.push({ x: st.nx, y: st.ny });
    }
  }
  return vis.size;
}

function computeAIMove() {
  if (!food) return null;
  const head = snake[0];
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const candidates = [];

  for (const [dx, dy] of dirs) {
    if (dx + direction.x === 0 && dy + direction.y === 0) continue;
    const st = stepPos(head.x, head.y, dx, dy);
    if (!st.ok) continue;
    const nx = st.nx, ny = st.ny;
    if (obstacleSet.has(`${nx},${ny}`)) continue;

    const willEat = nx === food.x && ny === food.y;

    const newSnake = [{ x: nx, y: ny }, ...snake];
    if (!willEat) newSnake.pop();

    if (newSnake.slice(1).some(p => p.x === nx && p.y === ny)) continue;

    const newSet = new Set(newSnake.map(p => `${p.x},${p.y}`));
    for (const k of obstacleSet) newSet.add(k);
    const newTail = newSnake[newSnake.length - 1];

    const toFood = bfs(nx, ny, food.x, food.y, newSet, false);
    const toTail = bfs(nx, ny, newTail.x, newTail.y, newSet, true);
    const space = countReachable(nx, ny, newSet);

    let eatSafe = true;
    if (willEat) {
      const postSet = new Set(newSnake.map(p => `${p.x},${p.y}`));
      for (const k of obstacleSet) postSet.add(k);
      const postTail = newSnake[newSnake.length - 1];
      eatSafe = bfs(nx, ny, postTail.x, postTail.y, postSet, true) >= 0;
    }

    const survived = simulateLookahead(newSnake, food, direction, 8);

    let sc = 0;

    if (toFood >= 0) {
      sc += 500000 - toFood * 5000;
      if (willEat) sc += 300000;
      if (willEat && eatSafe) sc += 200000;
      if (willEat && !eatSafe) sc -= 1000000;
    }

    if (toTail >= 0) {
      sc += 80000 - toTail * 500;
    } else {
      sc -= 1000000;
    }

    if (!survived) sc -= 800000;

    sc += space * 5;

    candidates.push({ dx, dy, score: sc });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  // Чем дольше без еды — тем больше шума, чтобы разорвать цикл
  if (movesSinceLastEat > 50) {
    const noise = (movesSinceLastEat - 50) * 800;
    for (const c of candidates) {
      c.score += (Math.random() - 0.5) * noise;
    }
    candidates.sort((a, b) => b.score - a.score);
  }

  return candidates[0];
}

function simulateLookahead(snakeArr, foodPos, curDir, steps) {
  let sim = snakeArr.map(p => ({ ...p }));
  let f = foodPos ? { ...foodPos } : null;
  let dir = { ...curDir };
  const dd = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  for (let s = 0; s < steps; s++) {
    const head = sim[0];
    const set = new Set(sim.map(p => `${p.x},${p.y}`));
    for (const k of obstacleSet) set.add(k);
    const tail = sim[sim.length - 1];
    const second = sim.length > 1 ? sim[sim.length - 2] : null;

    let best = null;

    for (const [dx, dy] of dd) {
      if (dx + dir.x === 0 && dy + dir.y === 0) continue;
      const st = stepPos(head.x, head.y, dx, dy);
      if (!st.ok) continue;
      const nx = st.nx, ny = st.ny;
      const k = `${nx},${ny}`;
      if (set.has(k) && !(nx === tail.x && ny === tail.y)) continue;

      const eat = f && nx === f.x && ny === f.y;
      const ns = new Set(set);
      ns.add(k);
      if (!eat) ns.delete(`${tail.x},${tail.y}`);

      let sc = 0;
      if (f) {
        const d = bfs(nx, ny, f.x, f.y, ns, false);
        if (d >= 0) sc += 10000 - d * 200;
      }
      const nt = eat ? tail : second;
      if (nt) {
        const d = bfs(nx, ny, nt.x, nt.y, ns, true);
        if (d >= 0) sc += 8000 - d * 100;
        else sc -= 5000;
      }
      if (!best || sc > best.sc) best = { dx, dy, nx, ny, eat, sc };
    }

    if (!best) return false;

    sim.unshift({ x: best.nx, y: best.ny });
    if (!best.eat) sim.pop();
    if (best.eat && f) f = null;
    dir = { x: best.dx, y: best.dy };
  }
  return true;
}

function toggleAutoPlay() {
  autoPlay = !autoPlay;
  const btn = document.getElementById('autoBtn');
  if (autoPlay) {
    btn.textContent = tr('autoOn');
    btn.style.background = 'linear-gradient(135deg,#ff6b6b,#ffa94d)';
    modeLabel.textContent = tr('aiControl');
    statusEl.textContent = tr('aiMode');
  } else {
    btn.textContent = tr('auto');
    btn.style.background = '';
    modeLabel.textContent = tr('manualControl');
    statusEl.textContent = tr('manualMode');
  }
}

/* ==== DRAW ==== */
function lerp(a, b, t) { return a + (b - a) * t; }

function roundRectPath(x, y, size, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + size - rad, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + rad);
  ctx.lineTo(x + size, y + size - rad);
  ctx.quadraticCurveTo(x + size, y + size, x + size - rad, y + size);
  ctx.lineTo(x + rad, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function snakeColor(i, now) {
  const skin = SKINS.find(s => s.id === save.selectedSkin) || SKINS[0];
  if (skin.rainbow) {
    const hue = ((i * 22 - now / 8) % 360 + 360) % 360;
    return `hsl(${hue}, 85%, 60%)`;
  }
  const t = (snake.length - i) / snake.length;
  const r = Math.round(lerp(skin.tail[0], skin.head[0], t));
  const g = Math.round(lerp(skin.tail[1], skin.head[1], t));
  const b = Math.round(lerp(skin.tail[2], skin.head[2], t));
  return `rgb(${r},${g},${b})`;
}

function draw(now) {
  ctx.clearRect(0, 0, W, H);

  const elapsed = Math.min((now - lastMove) / speed, 1);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= COLS; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
  }
  for (let i = 0; i <= ROWS; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
  }

  // obstacles
  for (const o of obstacles) {
    const pad = 2;
    roundRectPath(o.x * CELL + pad, o.y * CELL + pad, CELL - pad * 2, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // food glow + draw
  if (food) {
    const fx = food.x * CELL + CELL / 2;
    const fy = food.y * CELL + CELL / 2;
    const grd = ctx.createRadialGradient(fx, fy, 0, fx, fy, CELL * 1.8);
    grd.addColorStop(0, 'rgba(255,217,61,0.35)');
    grd.addColorStop(0.5, 'rgba(255,217,61,0.1)');
    grd.addColorStop(1, 'rgba(255,217,61,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(fx, fy, CELL * 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd93d';
    ctx.shadowColor = '#ffd93d';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(fx, fy, CELL / 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // special food
  if (specialFood) {
    const sx = specialFood.x * CELL + CELL / 2;
    const sy = specialFood.y * CELL + CELL / 2;
    const pulse = 0.7 + 0.3 * Math.sin(now / 180);

    const sgrd = ctx.createRadialGradient(sx, sy, 0, sx, sy, CELL * 1.6);
    sgrd.addColorStop(0, 'rgba(255,107,255,0.3)');
    sgrd.addColorStop(1, 'rgba(255,107,255,0)');
    ctx.fillStyle = sgrd;
    ctx.beginPath();
    ctx.arc(sx, sy, CELL * 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff6bff';
    ctx.shadowColor = '#ff6bff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(sx, sy, CELL / 2.3 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', sx, sy);
  }

  // snake segments — interpolated
  const sLen = Math.min(prevSnake.length, snake.length);
  for (let i = 0; i < snake.length; i++) {
    let px, py;
    if (i < sLen) {
      // при проходе сквозь стену (wrap) сегмент телепортируется без интерполяции
      if (Math.abs(prevSnake[i].x - snake[i].x) > 1 || Math.abs(prevSnake[i].y - snake[i].y) > 1) {
        px = snake[i].x;
        py = snake[i].y;
      } else {
        px = lerp(prevSnake[i].x, snake[i].x, elapsed);
        py = lerp(prevSnake[i].y, snake[i].y, elapsed);
      }
    } else {
      px = snake[i].x;
      py = snake[i].y;
    }

    const color = snakeColor(i, now);

    const pad = 1.5;
    const size = CELL - pad * 2;
    const drawX = px * CELL + pad;
    const drawY = py * CELL + pad;

    ctx.fillStyle = color;

    if (i === 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    } else {
      ctx.shadowBlur = 0;
    }

    roundRectPath(drawX, drawY, size, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // eyes on head
    if (i === 0) {
      ctx.fillStyle = '#fff';
      const eyeR = 2.8;
      let ex1, ey1, ex2, ey2;
      if (direction.x === 1) {
        ex1 = drawX + size - 6; ey1 = drawY + 6;
        ex2 = drawX + size - 6; ey2 = drawY + size - 6;
      } else if (direction.x === -1) {
        ex1 = drawX + 6; ey1 = drawY + 6;
        ex2 = drawX + 6; ey2 = drawY + size - 6;
      } else if (direction.y === -1) {
        ex1 = drawX + 6; ey1 = drawY + 6;
        ex2 = drawX + size - 6; ey2 = drawY + 6;
      } else {
        ex1 = drawX + 6; ey1 = drawY + size - 6;
        ex2 = drawX + size - 6; ey2 = drawY + size - 6;
      }
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      const ddx = direction.x || 0;
      const ddy = direction.y || 0;
      ctx.beginPath(); ctx.arc(ex1 + ddx * 1.2, ey1 + ddy * 1.2, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2 + ddx * 1.2, ey2 + ddy * 1.2, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // pause dim
  if (paused && !gameOver && !win) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tr('pauseCanvas'), W / 2, H / 2 - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '15px sans-serif';
    ctx.fillText(tr('resumeCanvas'), W / 2, H / 2 + 26);
  }
}

/* ==== GAME LOOP ==== */
function frame(now) {
  if (!gameOver && !win && !paused && now - lastMove >= speed) {
    if (autoPlay && !pendingDir) {
      const move = computeAIMove();
      if (move) {
        pendingDir = { x: move.dx, y: move.dy };
      }
    }
    update();
    lastMove = now;
  }
  draw(now);
  requestAnimationFrame(frame);
}

/* ==== INPUT ==== */
function directionalInput(event) {
  const code = event.code || '';
  const key = event.key || '';
  const keyCode = event.keyCode || event.which;
  if (key === 'ArrowUp' || code === 'ArrowUp' || keyCode === 38 || keyCode === 19) return { x: 0, y: -1 };
  if (key === 'ArrowDown' || code === 'ArrowDown' || keyCode === 40 || keyCode === 20) return { x: 0, y: 1 };
  if (key === 'ArrowLeft' || code === 'ArrowLeft' || keyCode === 37 || keyCode === 21) return { x: -1, y: 0 };
  if (key === 'ArrowRight' || code === 'ArrowRight' || keyCode === 39 || keyCode === 22) return { x: 1, y: 0 };
  return null;
}

function remoteDirection(event) {
  const direction = directionalInput(event);
  return direction ? (direction.x || direction.y) : 0;
}

function isBackKey(event) {
  return event.key === 'Escape'
    || event.code === 'Escape'
    || event.key === 'BrowserBack'
    || event.code === 'BrowserBack'
    || event.keyCode === 27 || event.keyCode === 10009;
}

function isRemoteConfirmKey(event) {
  return event.key === 'OK' || event.key === 'Select' || event.keyCode === 23;
}

document.addEventListener('keydown', e => {
  if (!gameReadyForInput) return;

  if (isUiFocusMode()) {
    // Range inputs retain their native keyboard behaviour (including arrows).
    if (isUiControl(document.activeElement) && document.activeElement.matches('input')) return;
    if (isUiControl(document.activeElement) && isRemoteConfirmKey(e)) {
      e.preventDefault();
      document.activeElement.click();
      return;
    }
    const uiDirection = remoteDirection(e);
    if (uiDirection) {
      e.preventDefault();
      moveUiFocus(uiDirection);
      return;
    }
    if (isBackKey(e)) {
      e.preventDefault();
      if (!helpModal.classList.contains('hidden')) {
        closeHelp();
      } else if (!shopModal.classList.contains('hidden')) {
        closeShop();
      } else if (paused) {
        togglePause();
      } else {
        focusGameSurface();
      }
      return;
    }
    return;
  }

  if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || isBackKey(e)) {
    e.preventDefault();
    togglePause();
    return;
  }

  const map = {
    w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
    s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
    a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
    d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
  };
  let nd = directionalInput(e) || map[e.key];
  if (!nd && e.code) {
    const cmap = { KeyW: { x: 0, y: -1 }, KeyS: { x: 0, y: 1 }, KeyA: { x: -1, y: 0 }, KeyD: { x: 1, y: 0 } };
    nd = cmap[e.code];
  }
  if (!nd) return;
  e.preventDefault();

  if (gameOver || win || paused) return;
  const current = pendingDir || direction;
  if (nd.x + current.x === 0 && nd.y + current.y === 0) return;
  pendingDir = nd;
});

let touchStart = null;

function applySwipe(startX, startY, endX, endY) {
  if (!gameReadyForInput) return;
  if (gameOver || win || paused) return;
  const dx = endX - startX;
  const dy = endY - startY;

  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

  let nd;
  if (Math.abs(dx) > Math.abs(dy)) {
    nd = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  } else {
    nd = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  }

  const current = pendingDir || direction;
  if (nd.x + current.x === 0 && nd.y + current.y === 0) return;
  pendingDir = nd;
}

if ('PointerEvent' in window) {
  let activePointerId = null;

  canvas.addEventListener('pointerdown', (event) => {
    activePointerId = event.pointerId;
    touchStart = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointerId) event.preventDefault();
  }, { passive: false });

  const finishPointer = (event) => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    if (touchStart) applySwipe(touchStart.x, touchStart.y, event.clientX, event.clientY);
    touchStart = null;
    activePointerId = null;
  };
  canvas.addEventListener('pointerup', finishPointer, { passive: false });
  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    touchStart = null;
    activePointerId = null;
  }, { passive: false });
} else {
  canvas.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });

  canvas.addEventListener('touchend', (event) => {
    event.preventDefault();
    const touch = event.changedTouches[0];
    if (touchStart) applySwipe(touchStart.x, touchStart.y, touch.clientX, touch.clientY);
    touchStart = null;
  }, { passive: false });
}

document.getElementById('restartBtn').addEventListener('click', () => newGame(true));
document.getElementById('autoBtn').addEventListener('click', toggleAutoPlay);

const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');
baseSpeed = +speedSlider.value;

speedSlider.addEventListener('input', () => {
  baseSpeed = +speedSlider.value;
  speed = baseSpeed;
  speedValue.textContent = baseSpeed;
});

/* ==== BOOT ==== */
function applySave() {
  coinsEl.textContent = save.coins;
  highScoreEl.textContent = save.highScore;
  muteBtn.textContent = save.muted ? '🔇' : '🔊';
  renderModes();
}

/*
 * Точка входа игры. Платформа приходит извне уже готовой — игра её не создаёт
 * и не выбирает, поэтому этот же вызов работает и с mock, и с любым будущим
 * адаптером.
 */
export async function startGame(platformServices, config = {}) {
  platform = platformServices;
  buildConfig = config;
  subscribePlatformEvents();

  I18n.setLanguage(platform.language);
  I18n.applyStatic();

  const loaded = await platform.storage.load();
  if (loaded && typeof loaded === 'object') {
    save = Object.assign(save, loaded);
  }

  // миграция рекорда из старой версии игры
  const legacyHS = +(localStorage.getItem('snakeHighScore') || 0);
  if (legacyHS > save.highScore) save.highScore = legacyHS;

  // защита от битых сохранений
  if (!Array.isArray(save.skins)) save.skins = ['classic'];
  if (!save.skins.includes('classic')) save.skins.unshift('classic');
  if (!SKINS.some(s => s.id === save.selectedSkin)) save.selectedSkin = 'classic';
  if (!MODES.some(m => m.id === save.mode)) save.mode = 'classic';
  save.coins = Math.max(0, +save.coins || 0);
  save.highScore = Math.max(0, +save.highScore || 0);

  applySave();
  renderSupport();
  init();
  // Paint the fully initialized board before reporting LoadingAPI readiness.
  draw(performance.now());
  openGame();
  /* Новичок сначала читает правила, раунд ждёт на паузе. */
  if (!save.tutorialSeen) openHelp();
  requestAnimationFrame(frame);
}

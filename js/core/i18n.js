/*
 * Локализация. Часть Game Core: язык приходит извне (из окружения платформы),
 * сам модуль ни о каких SDK не знает.
 */

export const I18n = (() => {
  const dictionaries = {
    ru: {
      title: 'Змейка: Автопилот',
      loading: 'Загрузка…',
      gameField: 'Игровое поле',
      gameOver: 'ИГРА ОКОНЧЕНА',
      speed: 'Скорость',
      score: 'Счёт',
      highScore: 'Рекорд:',
      shopTitle: 'Магазин скинов',
      closeShop: 'Закрыть магазин',
      helpTitle: 'Как играть',
      closeHelp: 'Закрыть подсказку',
      helpGoal: '<b>Цель.</b> Веди змейку и собирай еду: 🍎 даёт +10 очков, ⭐ — +30. Столкновение с собой, стеной или препятствием заканчивает раунд.',
      helpControls: '<b>Управление.</b> Стрелки или WASD на клавиатуре, свайпы на телефоне, кнопки пульта на ТВ. Пауза — «P» или «Esc».',
      helpModes: '<b>Режимы.</b> «Классика» — стены убивают, «Без стен» — можно проходить сквозь края поля, «Препятствия» — на поле появляются блоки.',
      helpCoins: '<b>Монеты.</b> +1 за 🍎, +5 за ⭐, +100 за полностью заполненное поле. Трать их в магазине 🛍️ на скины змейки.',
      helpAuto: '<b>Автопилот.</b> Кнопка «✨ Авто» включает ИИ: он сам ведёт змейку и показывает, как проходить сложные ситуации.',
      helpSupport: 'Вопросы, ошибки и предложения: {contact}',
      helpGotIt: 'Понятно',
      leaderboard: '🏆 Таблица результатов',
      soundTitle: 'Звук',
      pauseTitle: 'Пауза (P)',
      revive: '📺 Возродиться',
      doubleScore: '📺 Удвоить очки',
      newGame: 'Новая игра',
      controlsHint: '← ↑ → ↓ / WASD · P — пауза',
      auto: '✨ Авто',
      manualControl: '🎮 Управление: ручное',
      shopHint: 'Монеты начисляются за еду: +1 за обычную, +5 за бонусную ⭐, +100 за победу',
      skinClassic: 'Классика',
      skinNeon: 'Неон',
      skinFire: 'Огонь',
      skinGhost: 'Призрак',
      skinGold: 'Золото',
      skinRainbow: 'Радуга',
      modeClassic: 'Классика',
      modeWrap: 'Без стен',
      modeObstacles: 'Препятствия',
      gameStarted: 'Игра началась',
      hitWall: 'Столкновение со стеной!',
      hitObstacle: 'Врезался в препятствие!',
      hitSelf: 'Самоедство!',
      fieldFilled: 'Победа! Поле заполнено!',
      speedIncreased: 'Скорость увеличена!',
      bonus: 'Бонус! +30',
      runSummary: 'Счёт: <b>{score}</b> &nbsp;·&nbsp; Монеты за игру: {coin} {coins}',
      victory: 'ПОБЕДА!',
      victoryDetails: 'Ты заполнил всё поле! +100 {coin}<br>{summary}',
      secondChance: 'Второй шанс!',
      adNotCompleted: 'Реклама не досмотрена',
      paused: 'Пауза',
      letsGo: 'Поехали!',
      selected: 'Выбран',
      select: 'Выбрать',
      watchAd: '📺 За рекламу',
      buy: 'Купить · {coin} {cost}',
      autoOn: '✨ Авто ON',
      aiControl: '✨ Управление: ИИ',
      aiMode: 'Режим ИИ',
      manualMode: 'Ручной режим',
      pauseCanvas: 'ПАУЗА',
      resumeCanvas: 'P — продолжить',
    },
    en: {
      title: 'Snake: Autopilot',
      loading: 'Loading…',
      gameField: 'Game board',
      gameOver: 'GAME OVER',
      speed: 'Speed',
      score: 'Score',
      highScore: 'Best:',
      shopTitle: 'Skin Shop',
      closeShop: 'Close skin shop',
      helpTitle: 'How to play',
      closeHelp: 'Close help',
      helpGoal: '<b>Goal.</b> Steer the snake and collect food: 🍎 gives +10 points, ⭐ gives +30. Hitting yourself, a wall or an obstacle ends the round.',
      helpControls: '<b>Controls.</b> Arrow keys or WASD, swipes on a phone, remote buttons on TV. Pause — “P” or “Esc”.',
      helpModes: '<b>Modes.</b> “Classic” — walls are deadly, “No walls” — pass through the edges, “Obstacles” — blocks appear on the board.',
      helpCoins: '<b>Coins.</b> +1 for 🍎, +5 for ⭐, +100 for filling the whole board. Spend them in the shop 🛍️ on snake skins.',
      helpAuto: '<b>Autopilot.</b> The “✨ Auto” button turns on the AI: it drives the snake itself and shows how to handle tricky spots.',
      helpSupport: 'Questions, bugs and ideas: {contact}',
      helpGotIt: 'Got it',
      leaderboard: '🏆 Leaderboard',
      soundTitle: 'Sound',
      pauseTitle: 'Pause (P)',
      revive: '📺 Revive',
      doubleScore: '📺 Double score',
      newGame: 'New game',
      controlsHint: '← ↑ → ↓ / WASD · P — pause',
      auto: '✨ Auto',
      manualControl: '🎮 Control: manual',
      shopHint: 'Earn coins for food: +1 for regular, +5 for bonus ⭐, +100 for a win',
      skinClassic: 'Classic',
      skinNeon: 'Neon',
      skinFire: 'Fire',
      skinGhost: 'Ghost',
      skinGold: 'Gold',
      skinRainbow: 'Rainbow',
      modeClassic: 'Classic',
      modeWrap: 'No walls',
      modeObstacles: 'Obstacles',
      gameStarted: 'Game started',
      hitWall: 'You hit a wall!',
      hitObstacle: 'You hit an obstacle!',
      hitSelf: 'You hit yourself!',
      fieldFilled: 'Victory! The board is full!',
      speedIncreased: 'Speed increased!',
      bonus: 'Bonus! +30',
      runSummary: 'Score: <b>{score}</b> &nbsp;·&nbsp; Coins this run: {coin} {coins}',
      victory: 'VICTORY!',
      victoryDetails: 'You filled the entire board! +100 {coin}<br>{summary}',
      secondChance: 'Second chance!',
      adNotCompleted: 'Advertisement not completed',
      paused: 'Paused',
      letsGo: 'Go!',
      selected: 'Selected',
      select: 'Select',
      watchAd: '📺 Watch ad',
      buy: 'Buy · {coin} {cost}',
      autoOn: '✨ Auto ON',
      aiControl: '✨ Control: AI',
      aiMode: 'AI mode',
      manualMode: 'Manual mode',
      pauseCanvas: 'PAUSED',
      resumeCanvas: 'P — resume',
    },
  };

  let language = 'ru';

  function normalizeLanguage(value) {
    return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  function setLanguage(value) {
    language = normalizeLanguage(value);
    document.documentElement.lang = language;
  }

  function t(key, params = {}) {
    const template = dictionaries[language][key] ?? dictionaries.ru[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
  }

  function applyStatic() {
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach((element) => {
      element.innerHTML = t(element.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.title = t(element.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    });
  }

  return { setLanguage, getLanguage: () => language, t, applyStatic };
})();

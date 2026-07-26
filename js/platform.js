'use strict';

/*
 * Platform — единая обёртка над Yandex Games SDK.
 *
 * Игра общается ТОЛЬКО с этим объектом и не знает, где она запущена.
 * На Яндекс Играх используется настоящий SDK (реклама, лидерборды, сохранения
 * в облаке игрока). При локальной разработке SDK недоступен — тогда включается
 * заглушка: реклама «симулируется» модалкой, сохранения идут в localStorage.
 *
 * Такой слой позволит на этапе 2 добавить платформу Telegram Mini Apps,
 * не трогая код игры: достаточно написать вторую реализацию этих же методов.
 */
const Platform = (() => {
  const SDK_URL = 'https://yandex.ru/games/sdk/v2';
  const LEADERBOARD_NAME = 'snakeScore';      // техническое имя, создаётся в консоли Яндекс Игр
  const INTERSTITIAL_COOLDOWN = 65000;        // не чаще раза в ~минуту (требование площадки)
  const LOCAL_SAVE_KEY = 'snakeSave';

  let ysdk = null;
  let player = null;
  let leaderboards = null;
  let lastInterstitial = 0;
  let gamesPlayed = 0;

  function loadScript(src, timeout) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('SDK script timeout')), timeout);
      s.src = src;
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('SDK script load error')); };
      document.head.appendChild(s);
    });
  }

  async function init() {
    // Вне iframe Яндекс Игр SDK работать не может (нет родительского окна
    // для postMessage) — сразу включаем локальный режим разработки.
    if (window.self === window.top) {
      console.warn('YSDK: запуск вне Яндекс Игр — локальный режим разработки');
      return;
    }
    try {
      await loadScript(SDK_URL, 5000);
      ysdk = await YaGames.init();
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (e) {
        console.warn('YSDK: игрок недоступен, сохранения только в localStorage', e);
      }
      try {
        // новый API — ysdk.leaderboards; getLeaderboards() оставлен как фолбэк
        leaderboards = ysdk.leaderboards || await ysdk.getLeaderboards();
      } catch (e) {
        console.warn('YSDK: лидерборды недоступны', e);
      }
      console.log('YSDK: инициализирован');
    } catch (e) {
      console.warn('YSDK недоступен — локальный режим разработки (это нормально вне Яндекс Игр)');
    }
  }

  /* Сообщить площадке, что игра загрузилась (обязательное требование модерации). */
  function ready() {
    try { ysdk?.features?.LoadingAPI?.ready(); } catch (e) {}
  }

  function gameplayStart() {
    try { ysdk?.features?.GameplayAPI?.start(); } catch (e) {}
  }

  function gameplayStop() {
    try { ysdk?.features?.GameplayAPI?.stop(); } catch (e) {}
  }

  /* Локальная имитация рекламного ролика, чтобы тестировать UX без площадки. */
  function simulateAd(done) {
    const modal = document.getElementById('adSim');
    const bar = document.getElementById('adProgressBar');
    modal.classList.remove('hidden');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    requestAnimationFrame(() => {
      bar.style.transition = 'width 1.6s linear';
      bar.style.width = '100%';
    });
    setTimeout(() => {
      modal.classList.add('hidden');
      done();
    }, 1700);
  }

  /*
   * Interstitial — полноэкранная реклама между раундами.
   * Первый раунд никогда не прерываем, дальше — не чаще кулдауна.
   * onDone вызывается всегда: и после показа, и если показ пропущен.
   */
  function showInterstitial(onDone) {
    gamesPlayed++;
    const now = Date.now();
    if (gamesPlayed < 2 || now - lastInterstitial < INTERSTITIAL_COOLDOWN) {
      onDone();
      return;
    }
    lastInterstitial = now;
    if (!ysdk) {
      simulateAd(onDone);
      return;
    }
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onClose: () => onDone(),
        onError: (e) => { console.warn('Interstitial error', e); onDone(); },
      },
    });
  }

  /*
   * Rewarded — реклама за награду (возрождение, x2 очков, скин).
   * onReward вызывается только если игрок досмотрел ролик.
   */
  function showRewarded(onReward, onFail) {
    if (!ysdk) {
      simulateAd(onReward);
      return;
    }
    let rewarded = false;
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => { rewarded = true; },
        onClose: () => { if (rewarded) onReward(); else onFail?.(); },
        onError: (e) => { console.warn('Rewarded error', e); onFail?.(); },
      },
    });
  }

  /* Сохранения: облако игрока Яндекса + localStorage как резерв. */
  async function loadData() {
    if (player) {
      try {
        const data = await player.getData();
        if (data && Object.keys(data).length > 0) return data;
      } catch (e) {
        console.warn('YSDK getData', e);
      }
    }
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function saveData(data) {
    try { localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(data)); } catch (e) {}
    if (player) {
      player.setData(data).catch(e => console.warn('YSDK setData', e));
    }
  }

  function submitScore(score) {
    if (!leaderboards || score <= 0) return;
    try {
      const p = leaderboards.setScore
        ? leaderboards.setScore(LEADERBOARD_NAME, score)      // новый API
        : leaderboards.setLeaderboardScore(LEADERBOARD_NAME, score);
      p?.catch?.(e => console.warn('YSDK leaderboard', e));
    } catch (e) {
      console.warn('YSDK leaderboard', e);
    }
  }

  return {
    init, ready,
    gameplayStart, gameplayStop,
    showInterstitial, showRewarded,
    loadData, saveData, submitScore,
  };
})();

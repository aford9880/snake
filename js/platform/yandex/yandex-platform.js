/*
 * Адаптер Яндекс Игр.
 *
 * Единственный файл проекта, который знает про YaGames/ysdk. Всё, что приходит
 * из SDK — колбэки рекламы, объект игрока, ответы лидербордов, ошибки —
 * преобразуется здесь в модели из platform/core, и наружу отдаётся уже без
 * типов SDK.
 *
 * SDK загружается тегом <script src="/sdk.js"> в <head> собранной страницы
 * (см. tools/build.mjs): Яндекс требует, чтобы YaGames.init() вызывался как
 * можно раньше, поэтому промис создаётся в разметке, а адаптер его забирает.
 */

import { PlatformServices } from '../core/platform-services.js';
import {
  AdsService,
  StorageService,
  LeaderboardService,
  LifecycleService,
  PlayerService,
} from '../core/services.js';
import { LocalStorageService } from '../core/local-storage.js';
import { InterstitialPolicy } from '../core/interstitial-policy.js';
import { EventBus, PlatformEvent } from '../core/events.js';
import { AdResult, createEnvironment, createLeaderboardEntry, createPlayerData } from '../core/models.js';
import { PlatformError, PlatformErrorCode } from '../core/errors.js';

const PLATFORM_ID = 'yandex';
const LEADERBOARD_NAME = 'snakeScore';   // техническое имя, создаётся в консоли Яндекс Игр
const INTERSTITIAL_COOLDOWN = 65000;     // не чаще раза в ~минуту (требование площадки)

class YandexAdsService extends AdsService {
  constructor(ysdk, events) {
    super();
    this.ysdk = ysdk;
    this.events = events;
    this.policy = new InterstitialPolicy({
      minIntervalMs: INTERSTITIAL_COOLDOWN,
      skipFirstRounds: 1,   // первый раунд никогда не прерываем
    });
  }

  get capabilities() {
    return { interstitial: true, rewarded: true };
  }

  async showInterstitial() {
    if (!this.policy.requestShow()) return AdResult.skipped();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this.events.emit(PlatformEvent.AD_CLOSE, { kind: 'interstitial' });
        resolve(result);
      };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => this.events.emit(PlatformEvent.AD_OPEN, { kind: 'interstitial' }),
            onClose: () => finish(AdResult.shown()),
            onError: (e) => {
              console.warn('Interstitial error', e);
              finish(AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK, 'interstitial failed')));
            },
          },
        });
      } catch (e) {
        finish(AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK, 'interstitial failed')));
      }
    });
  }

  async showRewarded() {
    return new Promise((resolve) => {
      let rewarded = false;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this.events.emit(PlatformEvent.AD_CLOSE, { kind: 'rewarded' });
        resolve(result);
      };
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => this.events.emit(PlatformEvent.AD_OPEN, { kind: 'rewarded' }),
            onRewarded: () => { rewarded = true; },
            onClose: () => finish(AdResult.shown(rewarded)),
            onError: (e) => {
              console.warn('Rewarded error', e);
              finish(AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK, 'rewarded failed')));
            },
          },
        });
      } catch (e) {
        finish(AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK, 'rewarded failed')));
      }
    });
  }
}

/* Облако игрока Яндекса с локальным резервом. */
class YandexStorageService extends StorageService {
  constructor(player, fallback) {
    super();
    this.player = player;
    this.fallback = fallback;
  }

  async load() {
    if (this.player) {
      try {
        const data = await this.player.getData();
        if (data && Object.keys(data).length > 0) return data;
      } catch (e) {
        console.warn('YSDK getData', e);
      }
    }
    return this.fallback.load();
  }

  async save(data) {
    const localSaved = await this.fallback.save(data);
    if (this.player) {
      try {
        await this.player.setData(data);
        return true;
      } catch (e) {
        console.warn('YSDK setData', e);
      }
    }
    return localSaved;
  }
}

class YandexLeaderboardService extends LeaderboardService {
  constructor(leaderboards) {
    super();
    this.leaderboards = leaderboards;
  }

  get available() {
    return !!this.leaderboards;
  }

  async submitScore(score) {
    if (!this.leaderboards || score <= 0) return false;
    try {
      // новый API — ysdk.leaderboards; setLeaderboardScore оставлен как фолбэк
      await (this.leaderboards.setScore
        ? this.leaderboards.setScore(LEADERBOARD_NAME, score)
        : this.leaderboards.setLeaderboardScore(LEADERBOARD_NAME, score));
      return true;
    } catch (e) {
      console.warn('YSDK leaderboard', e);
      return false;
    }
  }

  async getTop(limit = 10) {
    if (!this.leaderboards?.getEntries) return [];
    try {
      const response = await this.leaderboards.getEntries(LEADERBOARD_NAME, { quantityTop: limit });
      return (response?.entries ?? []).map(entry => createLeaderboardEntry({
        rank: entry.rank,
        score: entry.score,
        name: entry.player?.publicName ?? '',
      }));
    } catch (e) {
      console.warn('YSDK leaderboard entries', e);
      return [];
    }
  }
}

class YandexLifecycleService extends LifecycleService {
  #readySent = false;

  constructor(ysdk) {
    super();
    this.ysdk = ysdk;
  }

  /* Сообщить площадке, что игра загрузилась (обязательное требование модерации). */
  notifyReady() {
    if (this.#readySent) return;
    this.#readySent = true;
    try { this.ysdk.features?.LoadingAPI?.ready(); } catch (e) {}
  }

  gameplayStart() {
    try { this.ysdk.features?.GameplayAPI?.start(); } catch (e) {}
  }

  gameplayStop() {
    try { this.ysdk.features?.GameplayAPI?.stop(); } catch (e) {}
  }
}

class YandexPlayerService extends PlayerService {
  constructor(player) {
    super();
    this.player = player;
  }

  get available() {
    return !!this.player;
  }

  /* Объект игрока SDK наружу не отдаём — только собственная модель. */
  async getPlayer() {
    if (!this.player) return createPlayerData();
    return createPlayerData({
      id: this.player.getUniqueID?.() ?? '',
      name: this.player.getName?.() ?? '',
      avatarUrl: this.player.getPhoto?.('medium') ?? '',
      isAuthorized: this.player.getMode?.() !== 'lite',
    });
  }
}

/*
 * Возможность, которой нет у других площадок (п.6 требований): sticky-баннер
 * Яндекса. Живёт в extensions — Game Core про неё не знает, ей может
 * пользоваться необязательный платформенный код.
 */
function createStickyBannerExtension(ysdk) {
  return {
    async show() {
      try {
        await ysdk.adv.showBannerAdv();
        return true;
      } catch (e) {
        return false;
      }
    },
    async hide() {
      try {
        await ysdk.adv.hideBannerAdv();
        return true;
      } catch (e) {
        return false;
      }
    },
  };
}

export async function createPlatform(config = {}) {
  if (typeof window.YaGames === 'undefined') {
    throw new PlatformError(PlatformErrorCode.NOT_READY, 'Yandex Games SDK is not loaded');
  }

  let ysdk;
  try {
    // Промис создаётся в <head> сразу после /sdk.js, чтобы панель отладки
    // Яндекс Игр увидела init до окончания загрузки остальной игры.
    ysdk = await (window.__yandexSdkPromise || window.YaGames.init());
  } catch (e) {
    throw PlatformError.wrap(e, PlatformErrorCode.NOT_READY, 'YaGames.init failed');
  }

  const events = new EventBus();
  // Хост может приостановить игру на время рекламы, смены вкладки и т.п.
  ysdk.on?.('game_api_pause', () => events.emit(PlatformEvent.PAUSE));
  ysdk.on?.('game_api_resume', () => events.emit(PlatformEvent.RESUME));

  let player = null;
  try {
    player = await ysdk.getPlayer({ scopes: false });
  } catch (e) {
    console.warn('YSDK: игрок недоступен, сохранения только в localStorage', e);
  }

  let leaderboards = null;
  try {
    leaderboards = ysdk.leaderboards || await ysdk.getLeaderboards();
  } catch (e) {
    console.warn('YSDK: лидерборды недоступны', e);
  }

  const sdkLanguage = ysdk.environment?.i18n?.lang || 'ru';

  console.log('YSDK: инициализирован');

  return new PlatformServices({
    id: PLATFORM_ID,
    environment: createEnvironment({
      platformId: PLATFORM_ID,
      language: String(sdkLanguage).toLowerCase().startsWith('en') ? 'en' : 'ru',
      deviceType: ysdk.deviceInfo?.type ?? 'desktop',
    }),
    events,
    ads: new YandexAdsService(ysdk, events),
    storage: new YandexStorageService(player, new LocalStorageService(config.saveKey)),
    leaderboard: new YandexLeaderboardService(leaderboards),
    lifecycle: new YandexLifecycleService(ysdk),
    player: new YandexPlayerService(player),
    /*
     * Платежи площадка поддерживает, но игре они пока не нужны: сервис не
     * реализован намеренно, capabilities.payments === false.
     */
    extensions: { stickyBanner: createStickyBannerExtension(ysdk) },
  });
}

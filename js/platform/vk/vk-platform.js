/*
 * Адаптер VK Игр (VK Mini Apps).
 *
 * Единственный файл проекта, который знает про vkBridge. Всё, что приходит из
 * библиотеки — ответы на bridge.send, события клиента, ошибки — превращается
 * здесь в модели platform/core, и наружу отдаётся уже без типов VK.
 *
 * Библиотека подключается тегом <script src="js/vendor/vk-bridge.min.js"> в
 * <head> собранной страницы (см. tools/build.mjs) и там же отправляет
 * VKWebAppInit: платформа требует инициализации до загрузки основных ресурсов.
 * Адаптер забирает готовый промис.
 */

import { PlatformServices } from '../core/platform-services.js';
import {
  AdsService,
  StorageService,
  LeaderboardService,
  PlayerService,
} from '../core/services.js';
import { LocalStorageService } from '../core/local-storage.js';
import { InterstitialPolicy } from '../core/interstitial-policy.js';
import { EventBus, PlatformEvent } from '../core/events.js';
import { AdResult, createEnvironment, createPlayerData } from '../core/models.js';
import { PlatformError, PlatformErrorCode } from '../core/errors.js';

const PLATFORM_ID = 'vk';

/*
 * Правила VK: рекламу между экранами нельзя показывать чаще раза в 30 секунд
 * и нельзя показывать при запуске. Берём запас по обоим требованиям.
 */
const INTERSTITIAL_COOLDOWN = 65000;

/* Как часто перепроверять наличие рекламных материалов у пользователя. */
const ADS_RECHECK_MS = 60000;

/* VK Storage: значение обрезается до 4096 символов, сериализованная строка — до 2236. */
const STORAGE_VALUE_LIMIT = 2236;

/* Не чаще одной записи в облако за этот интервал: у VK лимит 1000 вызовов в час. */
const STORAGE_WRITE_INTERVAL = 5000;

/* Таблица результатов VK принимает очки в диапазоне 1…10 000 000. */
const LEADERBOARD_MAX_SCORE = 10000000;

/*
 * Реклама. Формат reward показывается только по инициативе игрока (кнопки
 * «Возродиться» и «Удвоить очки»), interstitial — между раундами.
 *
 * VK просит не показывать кнопку просмотра, если рекламных материалов у
 * пользователя нет: VKWebAppCheckNativeAds заодно просит их подгрузить,
 * поэтому проверку повторяем по таймеру и после каждого показа.
 */
class VkAdsService extends AdsService {
  #rewardedReady = false;
  #interstitialReady = false;

  constructor(bridge, events) {
    super();
    this.bridge = bridge;
    this.events = events;
    this.policy = new InterstitialPolicy({
      minIntervalMs: INTERSTITIAL_COOLDOWN,
      skipFirstRounds: 1,   // первый раунд не прерываем
    });
    this.#refresh();
    setInterval(() => this.#refresh(), ADS_RECHECK_MS);
  }

  get capabilities() {
    return { interstitial: this.#interstitialReady, rewarded: this.#rewardedReady };
  }

  async showInterstitial() {
    if (!this.policy.requestShow()) return AdResult.skipped();
    return this.#show('interstitial');
  }

  async showRewarded() {
    return this.#show('reward');
  }

  async #show(adFormat) {
    const kind = adFormat === 'reward' ? 'rewarded' : 'interstitial';
    this.events.emit(PlatformEvent.AD_OPEN, { kind });
    try {
      const data = await this.bridge.send('VKWebAppShowNativeAds', { ad_format: adFormat });
      /* result === true означает «ролик показан», для reward это и есть награда. */
      return data?.result ? AdResult.shown(adFormat === 'reward') : AdResult.skipped();
    } catch (e) {
      console.warn('VK ads', e);
      return AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK, kind + ' failed'));
    } finally {
      this.events.emit(PlatformEvent.AD_CLOSE, { kind });
      this.#refresh();
    }
  }

  #refresh() {
    this.#check('reward').then(ready => { this.#rewardedReady = ready; });
    this.#check('interstitial').then(ready => { this.#interstitialReady = ready; });
  }

  async #check(adFormat) {
    try {
      const data = await this.bridge.send('VKWebAppCheckNativeAds', { ad_format: adFormat });
      return !!data?.result;
    } catch (e) {
      return false;
    }
  }
}

/*
 * Сохранения в VK Storage с локальным резервом.
 *
 * Почему облако обязательно: на хостинге VK адрес игры меняется после каждой
 * выкладки, а localStorage привязан к домену — без VK Storage прогресс игрока
 * пропадёт при первом же обновлении билда.
 *
 * Записи склеиваются по времени: у площадки лимит 1000 обращений в час, а игра
 * сохраняется после каждой съеденной еды.
 */
class VkStorageService extends StorageService {
  #pending = null;
  #timer = null;
  #lastWriteAt = 0;

  constructor(bridge, key, fallback) {
    super();
    this.bridge = bridge;
    /* Допустимые символы имени переменной VK Storage: [a-zA-Z_-0-9]. */
    this.key = String(key || 'snakeSave').replace(/[^a-zA-Z_\-0-9]/g, '') || 'snakeSave';
    this.fallback = fallback;
    /* Незаписанное состояние не должно потеряться при сворачивании клиента. */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.#flush();
    });
    window.addEventListener('pagehide', () => this.#flush());
  }

  async load() {
    try {
      const data = await this.bridge.send('VKWebAppStorageGet', { keys: [this.key] });
      const raw = data?.keys?.find(entry => entry.key === this.key)?.value;
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('VK storage get', e);
    }
    return this.fallback.load();
  }

  async save(data) {
    const localSaved = await this.fallback.save(data);
    this.#pending = data;
    this.#schedule();
    return localSaved;
  }

  #schedule() {
    if (this.#timer) return;
    const wait = Math.max(0, STORAGE_WRITE_INTERVAL - (Date.now() - this.#lastWriteAt));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flush();
    }, wait);
  }

  #flush() {
    if (!this.#pending) return;
    const value = JSON.stringify(this.#pending);
    this.#pending = null;
    this.#lastWriteAt = Date.now();
    if (value.length > STORAGE_VALUE_LIMIT) {
      console.warn('VK storage: сохранение больше лимита площадки, остаётся только localStorage');
      return;
    }
    this.bridge.send('VKWebAppStorageSet', { key: this.key, value })
      .catch(e => console.warn('VK storage set', e));
  }
}

/*
 * Таблица результатов VK.
 *
 * Тихой отправки счёта у площадки нет: сохранить результат можно только
 * серверным вызовом secure.addAppEvent, а клиентский VKWebAppShowLeaderBoardBox
 * открывает диалог с результатами игрока и его друзей. Поэтому available
 * (фоновая отправка) — false, а показ таблицы игра предлагает кнопкой.
 */
class VkLeaderboardService extends LeaderboardService {
  #canShowUi = false;

  constructor(bridge) {
    super();
    this.bridge = bridge;
    Promise.resolve(this.bridge.supportsAsync?.('VKWebAppShowLeaderBoardBox') ?? false)
      .then(supported => { this.#canShowUi = !!supported; })
      .catch(() => { this.#canShowUi = false; });
  }

  get available() {
    return false;
  }

  get canShowUi() {
    return this.#canShowUi;
  }

  async showUi(score) {
    const userResult = Math.min(LEADERBOARD_MAX_SCORE, Math.max(1, Math.round(score || 0)));
    try {
      const data = await this.bridge.send('VKWebAppShowLeaderBoardBox', {
        user_result: userResult,
        global: 1,
      });
      return !!data?.success;
    } catch (e) {
      console.warn('VK leaderboard', e);
      return false;
    }
  }
}

class VkPlayerService extends PlayerService {
  constructor(bridge) {
    super();
    this.bridge = bridge;
  }

  get available() {
    return true;
  }

  /* Объект VK наружу не отдаём — только собственная модель. */
  async getPlayer() {
    try {
      const user = await this.bridge.send('VKWebAppGetUserInfo', {});
      if (!user?.id) return createPlayerData();
      return createPlayerData({
        id: String(user.id),
        name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        avatarUrl: user.photo_100 || user.photo_200 || '',
        isAuthorized: true,
      });
    } catch (e) {
      console.warn('VK user info', e);
      return createPlayerData();
    }
  }
}

/*
 * Возможность только этой площадки (как sticky-баннер у Яндекса): рекламный
 * баннер VK. Живёт в extensions, Game Core про неё не знает.
 */
function createBannerExtension(bridge) {
  return {
    async show(location = 'bottom') {
      try {
        const data = await bridge.send('VKWebAppShowBannerAd', { banner_location: location });
        return !!data?.result;
      } catch (e) {
        return false;
      }
    },
    async hide() {
      try {
        const data = await bridge.send('VKWebAppHideBannerAd', {});
        return !!data?.result;
      } catch (e) {
        return false;
      }
    },
  };
}

/* Параметры запуска приходят в query-строке адреса игры. */
function launchParams() {
  return new URLSearchParams(window.location.search);
}

function detectLanguage(params) {
  const value = String(params.get('vk_language') || 'ru').toLowerCase();
  return value.startsWith('en') ? 'en' : 'ru';
}

function detectDeviceType(params) {
  const vkPlatform = String(params.get('vk_platform') || '');
  if (vkPlatform.includes('ipad')) return 'tablet';
  if (vkPlatform.startsWith('mobile')) return 'mobile';
  return 'desktop';
}

export async function createPlatform(config = {}) {
  const bridge = window.vkBridge;
  if (!bridge) {
    throw new PlatformError(PlatformErrorCode.NOT_READY, 'VK Bridge is not loaded');
  }
  /*
   * Вне клиента ВКонтакте (например, при локальном открытии сборки) события
   * моста никто не обрабатывает — честнее сразу вернуть управление фабрике,
   * она подставит mock.
   */
  if (bridge.isEmbedded && !bridge.isEmbedded()) {
    throw new PlatformError(PlatformErrorCode.NOT_READY, 'Game is not running inside a VK client');
  }

  try {
    /* Промис создаётся в <head>: VKWebAppInit должен уйти как можно раньше. */
    await (window.__vkBridgeInit || bridge.send('VKWebAppInit', {}));
  } catch (e) {
    throw PlatformError.wrap(e, PlatformErrorCode.NOT_READY, 'VKWebAppInit failed');
  }

  const events = new EventBus();
  /*
   * В мобильных клиентах игра живёт в WebView и о сворачивании сообщает мост;
   * в вебе достаточно visibilitychange, который игра слушает сама.
   */
  bridge.subscribe(event => {
    const type = event?.detail?.type;
    if (type === 'VKWebAppViewHide') events.emit(PlatformEvent.PAUSE);
    if (type === 'VKWebAppViewRestore') events.emit(PlatformEvent.RESUME);
  });

  const params = launchParams();

  console.log('VK Bridge: инициализирован');

  return new PlatformServices({
    id: PLATFORM_ID,
    environment: createEnvironment({
      platformId: PLATFORM_ID,
      language: detectLanguage(params),
      deviceType: detectDeviceType(params),
    }),
    events,
    ads: new VkAdsService(bridge, events),
    storage: new VkStorageService(bridge, config.saveKey, new LocalStorageService(config.saveKey)),
    leaderboard: new VkLeaderboardService(bridge),
    /*
     * Аналога LoadingAPI/GameplayAPI у VK нет: сообщать о готовности и о
     * границах раунда некому, поэтому LifecycleService остаётся базовым —
     * его пустые методы игра зовёт как обычно.
     */
    player: new VkPlayerService(bridge),
    extensions: { banner: createBannerExtension(bridge) },
  });
}

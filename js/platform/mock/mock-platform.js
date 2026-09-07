/*
 * Mock-платформа — реализация всех сервисов без какого-либо SDK.
 *
 * Нужна для локальной разработки, ручного и автоматического тестирования и как
 * страховка: если SDK площадки не отвечает, фабрика подставляет mock, и игра
 * всё равно запускается.
 *
 * Поведение:
 *   реклама   — мгновенно «показывается», rewarded всегда засчитывается;
 *   сохранения — localStorage;
 *   лидерборд  — хранится в памяти вкладки и печатается в консоль;
 *   платежи    — всегда успешная тестовая покупка;
 *   язык       — из ?lang=en, иначе ru.
 */

import { PlatformServices } from '../core/platform-services.js';
import {
  AdsService,
  LeaderboardService,
  LifecycleService,
  PlayerService,
  PaymentsService,
} from '../core/services.js';
import { LocalStorageService } from '../core/local-storage.js';
import { InterstitialPolicy } from '../core/interstitial-policy.js';
import { EventBus, PlatformEvent } from '../core/events.js';
import { AdResult, createEnvironment, createPlayerData, createProduct, createPurchaseResult } from '../core/models.js';

const PLATFORM_ID = 'mock';

class MockAdsService extends AdsService {
  constructor(events, { adDelayMs = 0, interstitial } = {}) {
    super();
    this.events = events;
    this.adDelayMs = adDelayMs;
    this.policy = new InterstitialPolicy(interstitial);
  }

  get capabilities() {
    return { interstitial: true, rewarded: true };
  }

  async showInterstitial() {
    if (!this.policy.requestShow()) return AdResult.skipped();
    await this.#simulateAd('interstitial');
    return AdResult.shown();
  }

  async showRewarded() {
    await this.#simulateAd('rewarded');
    return AdResult.shown(true);
  }

  async #simulateAd(kind) {
    console.log(`[mock] ${kind} ad`);
    this.events.emit(PlatformEvent.AD_OPEN, { kind });
    if (this.adDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.adDelayMs));
    }
    this.events.emit(PlatformEvent.AD_CLOSE, { kind });
  }
}

class MockLeaderboardService extends LeaderboardService {
  #scores = [];

  get available() {
    return true;
  }

  async submitScore(score) {
    if (score <= 0) return false;
    this.#scores.push(score);
    this.#scores.sort((a, b) => b - a);
    console.log('[mock] leaderboard score', score);
    return true;
  }

  async getTop(limit = 10) {
    return this.#scores.slice(0, limit)
      .map((score, index) => ({ rank: index + 1, score, name: 'you', isCurrentPlayer: true }));
  }

  get canShowUi() {
    return true;
  }

  async showUi(score) {
    console.log('[mock] leaderboard box', score);
    return true;
  }
}

class MockLifecycleService extends LifecycleService {
  notifyReady() {
    console.log('[mock] game ready');
  }

  gameplayStart() {}

  gameplayStop() {}
}

class MockPlayerService extends PlayerService {
  get available() {
    return true;
  }

  async getPlayer() {
    return createPlayerData({ id: 'mock-player', name: 'Local player', isAuthorized: false });
  }

  async authorize() {
    return createPlayerData({ id: 'mock-player', name: 'Local player', isAuthorized: true });
  }
}

class MockPaymentsService extends PaymentsService {
  get available() {
    return true;
  }

  async getProducts() {
    return [createProduct({ id: 'mock-product', title: 'Test product', price: '0' })];
  }

  async purchase(productId) {
    console.log('[mock] purchase', productId);
    return createPurchaseResult({ productId, purchased: true });
  }
}

function detectLanguage() {
  const query = new URLSearchParams(window.location.search).get('lang');
  return String(query || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
}

export async function createPlatform(config = {}) {
  const events = new EventBus();
  return new PlatformServices({
    id: PLATFORM_ID,
    environment: createEnvironment({
      platformId: PLATFORM_ID,
      language: config.language || detectLanguage(),
      deviceType: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
    }),
    events,
    ads: new MockAdsService(events, config.mock),
    storage: new LocalStorageService(config.saveKey),
    leaderboard: new MockLeaderboardService(),
    lifecycle: new MockLifecycleService(),
    player: new MockPlayerService(),
    payments: new MockPaymentsService(),
  });
}

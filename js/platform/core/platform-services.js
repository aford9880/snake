/*
 * Фасад платформы: единственный объект, который игра получает извне.
 *
 * Внутри — независимые сервисы (реклама, сохранения, лидерборд, жизненный
 * цикл, игрок, платежи), шина событий и описание окружения. Любой сервис,
 * который адаптер не передал, заменяется базовой заглушкой, поэтому игровой
 * код может звать метод, не проверяя его наличие.
 */

import {
  AdsService,
  StorageService,
  LeaderboardService,
  LifecycleService,
  PlayerService,
  PaymentsService,
} from './services.js';
import { EventBus } from './events.js';
import { createEnvironment } from './models.js';

export class PlatformServices {
  constructor({
    id = 'unknown',
    environment = createEnvironment({ platformId: id }),
    ads = new AdsService(),
    storage = new StorageService(),
    leaderboard = new LeaderboardService(),
    lifecycle = new LifecycleService(),
    player = new PlayerService(),
    payments = new PaymentsService(),
    events = new EventBus(),
    extensions = {},
  } = {}) {
    this.id = id;
    this.environment = environment;
    this.ads = ads;
    this.storage = storage;
    this.leaderboard = leaderboard;
    this.lifecycle = lifecycle;
    this.player = player;
    this.payments = payments;
    this.events = events;
    /*
     * Специфические возможности конкретной площадки (п.6 требований): адаптер
     * кладёт их сюда, а пользуется ими необязательный код вне Game Core.
     * Игровая логика обращается к сервисам и capabilities, но не к extensions.
     */
    this.extensions = extensions;
  }

  /*
   * Что умеет площадка. Игра ветвится по возможностям, а не по названию
   * платформы: «if (capabilities.rewarded)» — можно, «if (id === 'yandex')» — нет.
   */
  get capabilities() {
    const ads = this.ads.capabilities;
    return Object.freeze({
      interstitial: !!ads.interstitial,
      rewarded: !!ads.rewarded,
      leaderboard: this.leaderboard.available,
      auth: this.player.available,
      payments: this.payments.available,
    });
  }

  getExtension(name) {
    return this.extensions[name] ?? null;
  }

  get language() {
    return this.environment.language;
  }

  on(event, handler) {
    return this.events.on(event, handler);
  }
}

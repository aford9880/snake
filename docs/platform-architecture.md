# Платформенная архитектура

Игра не знает, где она запущена. Вся работа с площадкой (реклама, сохранения,
лидерборды, авторизация, платежи, жизненный цикл) идёт через набор абстрактных
сервисов; конкретные SDK живут в адаптерах и в игровой код не попадают.

```
Game Core (js/core)
      ↓  импортирует только абстракции
Platform Services (js/platform/core)  ← интерфейсы, модели, события, ошибки
      ↑  реализуют
Platform Adapters (js/platform/<id>)
      ↓
Mock (без SDK)          Yandex (YaGames)          <новая площадка>
```

Направление зависимостей одностороннее: `js/core` → `js/platform/core`.
Обратной стрелки нет, `js/core` не ссылается ни на один адаптер.

## Структура

```
index.html                       разметка + маркер <!--PLATFORM_HEAD-->
js/
├── boot.js                      composition root: собирает платформу и запускает игру
├── platform.config.js           какая площадка у этой сборки (перезаписывается сборкой)
├── core/                        ← GAME CORE, о SDK не знает
│   ├── game.js                  вся игровая логика
│   └── i18n.js                  локализация
└── platform/
    ├── core/                    ← АБСТРАКЦИИ
    │   ├── services.js          AdsService, StorageService, LeaderboardService,
    │   │                        LifecycleService, PlayerService, PaymentsService
    │   ├── platform-services.js фасад PlatformServices + capabilities + extensions
    │   ├── models.js            AdResult, PlayerData, LeaderboardEntry, Environment, …
    │   ├── events.js            EventBus и PlatformEvent (ad:open/ad:close/game:pause/game:resume)
    │   ├── errors.js            PlatformError, PlatformErrorCode
    │   ├── interstitial-policy.js  частотное ограничение межстраничной рекламы
    │   ├── local-storage.js     StorageService поверх localStorage
    │   └── factory.js           реестр адаптеров + createPlatform()
    ├── mock/mock-platform.js    ← АДАПТЕР: локальная заглушка, без SDK
    └── yandex/yandex-platform.js← АДАПТЕР: Яндекс Игры (единственный файл с YaGames)
tools/build.mjs                  сборка билда под площадку + zip
```

## Интерфейсы

Разделены по назначению: игре, которой нужна только реклама, незачем знать о
платежах. Базовая реализация каждого сервиса — «ничего не умею», адаптер
переопределяет то, что поддерживает площадка.

| Интерфейс | Методы | Что означает |
|---|---|---|
| `AdsService` | `capabilities`, `showInterstitial()`, `showRewarded()` | Реклама. Оба метода всегда резолвятся `AdResult` и никогда не бросают. |
| `StorageService` | `load()`, `save(data)` | Сохранения. Возвращает обычный объект проекта. |
| `LeaderboardService` | `available`, `submitScore(score)`, `getTop(limit)` | Таблица рекордов. |
| `LifecycleService` | `notifyReady()`, `gameplayStart()`, `gameplayStop()` | Сообщения хосту: игра загрузилась, раунд начался/закончился. |
| `PlayerService` | `available`, `getPlayer()`, `authorize()` | Профиль игрока в виде `PlayerData`. |
| `PaymentsService` | `available`, `getProducts()`, `purchase(id)` | Внутриигровые покупки. |

Фасад `PlatformServices` собирает их вместе и добавляет:

* `environment` — `{ platformId, language, deviceType }`;
* `capabilities` — `{ interstitial, rewarded, leaderboard, auth, payments }`;
* `events` / `on(event, handler)` — платформенно-независимые события;
* `extensions` — уникальные возможности конкретной площадки.

### Модели и ошибки

Объекты SDK наружу не отдаются. Адаптер преобразует их в модели из
`models.js`: `AdResult`, `PlayerData`, `LeaderboardEntry`, `Environment`,
`Product`, `PurchaseResult`. Исключения SDK превращаются в `PlatformError` с
кодом из `PlatformErrorCode`; текст оригинальной ошибки сохраняется строкой в
`details`, сам объект SDK — нет.

### События

Асинхронные события SDK переводятся в константы `PlatformEvent`:

| Событие | Смысл | Источник у Яндекса |
|---|---|---|
| `ad:open` | начался показ рекламы | `callbacks.onOpen` |
| `ad:close` | реклама закрыта | `callbacks.onClose` / `onError` |
| `game:pause` | хост просит приостановить игру | `game_api_pause` |
| `game:resume` | можно продолжать | `game_api_resume` |

## Как игровой код обращается к платформе

`startGame(platform)` получает готовый фасад извне — игра платформу не ищет и
не создаёт:

```js
platform.lifecycle.notifyReady();
platform.lifecycle.gameplayStart();
await platform.ads.showInterstitial();
const result = await platform.ads.showRewarded();
if (result.rewarded) { /* выдать награду */ }
await platform.storage.save(save);
platform.leaderboard.submitScore(score);
platform.on(PlatformEvent.PAUSE, () => { /* … */ });
```

Ветвиться можно по возможностям, но не по названию площадки:

```js
if (platform.capabilities.rewarded) { /* показать кнопку «за рекламу» */ }   // так можно
if (platform.id === 'yandex') { /* … */ }                                    // так нельзя
```

## Специфические возможности площадки

Не всё сводится к общему API. Уникальные функции адаптер кладёт в
`extensions`, и пользуется ими необязательный код вне Game Core:

```js
// у Яндекса есть sticky-баннер, которого нет у других площадок
platform.getExtension('stickyBanner')?.show();
```

Game Core в `extensions` не заглядывает: там нет ничего, без чего игра не
сможет работать на другой площадке.

## Запуск на mock

Mock — полноценная реализация всех сервисов без единого SDK: реклама
«показывается» мгновенно, rewarded всегда засчитывается, сохранения идут в
`localStorage`, лидерборд живёт в памяти вкладки, покупки успешны.

```bash
python -m http.server 8000
```

Затем <http://localhost:8000>. Полезные параметры адреса:

* `?platform=mock` — принудительно mock даже там, где есть SDK;
* `?lang=en` — английская локализация.

Mock используется ещё в двух случаях: когда `platform.config.js` содержит
`'auto'` и SDK площадки не найден, и когда адаптер площадки не смог
инициализироваться — тогда фабрика логирует предупреждение и подставляет mock,
чтобы игра всё равно запустилась.

## Сборка под площадку

```bash
node tools/build.mjs yandex     # build/yandex/ + build/yandex.zip
node tools/build.mjs mock       # build/mock/   + build/mock.zip
node tools/build.mjs --all
```

Сборка делает четыре вещи и **не трогает игровой код**:

1. подставляет в `<!--PLATFORM_HEAD-->` загрузчик SDK площадки (площадки требуют
   инициализировать SDK как можно раньше, ещё в `<head>`);
2. пишет `js/platform.config.js` с идентификатором площадки;
3. кладёт только нужные адаптеры: `core`, `mock` (как фолбэк) и выбранный;
4. пакует результат в zip с путями через `/` — архив от старых версий
   `Compress-Archive` хостинг Яндекс Игр не принимает.

Адаптеры подключаются динамическим `import()`, поэтому в загруженную страницу
попадает код только выбранной площадки.

## Как добавить платформу X, не меняя игровой код

Пример: добавляем условную площадку `X` с её `XSdk`.

1. **Адаптер** — `js/platform/x/x-platform.js`:

   ```js
   import { PlatformServices } from '../core/platform-services.js';
   import { AdsService, LifecycleService } from '../core/services.js';
   import { LocalStorageService } from '../core/local-storage.js';
   import { EventBus, PlatformEvent } from '../core/events.js';
   import { AdResult, createEnvironment } from '../core/models.js';
   import { PlatformError, PlatformErrorCode } from '../core/errors.js';

   class XAdsService extends AdsService {
     constructor(sdk, events) { super(); this.sdk = sdk; this.events = events; }
     get capabilities() { return { interstitial: true, rewarded: true }; }
     async showRewarded() {
       this.events.emit(PlatformEvent.AD_OPEN, { kind: 'rewarded' });
       try {
         const rewarded = await this.sdk.ads.rewarded();      // API площадки
         return AdResult.shown(rewarded);
       } catch (e) {
         return AdResult.failed(PlatformError.wrap(e, PlatformErrorCode.SDK));
       } finally {
         this.events.emit(PlatformEvent.AD_CLOSE, { kind: 'rewarded' });
       }
     }
   }

   export async function createPlatform(config = {}) {
     if (typeof window.XSdk === 'undefined') {
       throw new PlatformError(PlatformErrorCode.NOT_READY, 'X SDK is not loaded');
     }
     const sdk = await window.XSdk.init();
     const events = new EventBus();
     return new PlatformServices({
       id: 'x',
       environment: createEnvironment({ platformId: 'x', language: sdk.lang }),
       events,
       ads: new XAdsService(sdk, events),
       storage: new LocalStorageService(config.saveKey),
       // остальные сервисы можно не передавать: заглушки скажут «не поддерживаю»,
       // а игра сама скроет то, чего площадка не умеет
     });
   }
   ```

2. **Реестр** — одна строка в `js/platform/core/factory.js`:

   ```js
   const ADAPTERS = {
     mock: () => import('../mock/mock-platform.js'),
     yandex: () => import('../yandex/yandex-platform.js'),
     x: () => import('../x/x-platform.js'),
   };
   ```

3. **Сборка** — одна запись в `PLATFORMS` в `tools/build.mjs`: идентификатор,
   описание и `head` со `<script>` загрузчика SDK площадки.

4. `node tools/build.mjs x` — готово. Ни одна строка в `js/core/` не менялась.

Удаление площадки — обратная операция: убрать адаптер, строку в реестре и
запись в сборке.

## Что уже реализовано

| Возможность | Mock | Яндекс Игры |
|---|---|---|
| Interstitial | да, с той же политикой частоты | `adv.showFullscreenAdv`, не чаще 1 / 65 с и не в первом раунде |
| Rewarded | да, награда всегда | `adv.showRewardedVideo`, награда только после `onRewarded` |
| Сохранения | `localStorage` | облако игрока + `localStorage` как резерв |
| Лидерборд | в памяти вкладки | `snakeScore` (создаётся в консоли разработчика) |
| Жизненный цикл | лог в консоль | `LoadingAPI.ready`, `GameplayAPI.start/stop` |
| Игрок | тестовый профиль | `getPlayer({ scopes: false })` → `PlayerData` |
| Платежи | тестовая покупка | не реализованы намеренно: игре не нужны, `capabilities.payments === false` |
| Пауза от хоста | — | `game_api_pause` / `game_api_resume` |
| Extensions | — | `stickyBanner` |

## Прямые упоминания SDK в проекте

| SDK | Файл | Почему здесь |
|---|---|---|
| `YaGames`, `ysdk.*` | `js/platform/yandex/yandex-platform.js` | адаптер площадки — единственное допустимое место |
| `/sdk.js`, `YaGames.init()` | `tools/build.mjs` (строка `PLATFORMS.yandex.head`) | Яндекс требует инициализировать SDK в `<head>`; сборка подставляет это в разметку |
| `'yandex'` (строка-идентификатор) | `js/platform/core/factory.js`, `js/platform.config.js` | реестр и конфигурация сборки — единственные места, где площадка называется по имени |

В `js/core/` упоминаний SDK нет.

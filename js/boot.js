/*
 * Composition root: точка входа страницы.
 *
 * Здесь и только здесь собираются зависимости — платформа создаётся фабрикой
 * и передаётся в игру. Сама игра платформу не ищет и не создаёт, поэтому её
 * можно запустить с любой реализацией, включая mock.
 */

import { createPlatform } from './platform/core/factory.js';
import { platformConfig } from './platform.config.js';
import { startGame } from './core/game.js';

createPlatform(platformConfig)
  .then(platform => startGame(platform, platformConfig))
  .catch(error => console.error('Boot failed', error));

/*
 * Сохранение в localStorage.
 *
 * Это не SDK площадки, а обычный браузерный API, поэтому реализация живёт в
 * core: её используют и mock-платформа (как основное хранилище), и адаптеры
 * реальных площадок (как резерв, когда облако игрока недоступно).
 */

import { StorageService } from './services.js';

export class LocalStorageService extends StorageService {
  constructor(key = 'snakeSave') {
    super();
    this.key = key;
  }

  async load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async save(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }
}

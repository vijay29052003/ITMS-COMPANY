/* ==========================================================================
   HIGH-CAPACITY INDEXEDDB FONT STORAGE & BINARY ENGINE (ZERO-QUOTA-OVERFLOW)
   Handles TrueType (.TTF), OpenType (.OTF), WOFF, and WOFF2 Binary Fonts
   ========================================================================== */

/**
 * @typedef {import('./types.d.ts').CustomFontRecord} CustomFontRecord
 */

/**
 * Manages persistent IndexedDB storage of binary font files (ArrayBuffer) without Base64 inflation.
 */
class FontStorageDB {
  constructor() {
    const cfg = (typeof window !== 'undefined' && window.ITMS_CONFIG && window.ITMS_CONFIG.DATABASE) || {};
    /** @type {string} */
    this.dbName = cfg.FONT_DB_NAME || 'ITMS_FontStore_DB_v1';
    /** @type {number} */
    this.dbVersion = 1;
    /** @type {string} */
    this.storeName = cfg.FONT_STORE_NAME || 'custom_fonts';
    /** @type {IDBDatabase|null} */
    this.db = null;
    /** @type {CustomFontRecord[]} */
    this.memoryCache = [];
    /** @type {boolean} */
    this.isReady = false;
    /** @type {Promise<boolean>} */
    this.readyPromise = this.initDB();
  }

  /**
   * Initializes the IndexedDB database for font binary storage.
   * @returns {Promise<boolean>}
   */
  async initDB() {
    // 1. Clean up any legacy storage font keys to prevent storage quota crashes
    try {
      if (typeof window !== 'undefined' && window.ITMSStorage) {
        window.ITMSStorage.removeItem('itms_custom_fonts_v1');
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('itms_custom_fonts_v1');
      }
      if (typeof window !== 'undefined' && window.SecureStorage) {
        window.SecureStorage.removeItem('itms_custom_fonts_v1');
      }
    } catch (e) {
      console.warn('Storage Notice: Legacy font storage cleanup skipped:', e);
    }

    // 2. Initialize IndexedDB
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('Storage Notice: IndexedDB not available. Operating in-memory session mode.');
      this.isReady = true;
      return true;
    }

    return new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (e) => {
          const db = /** @type {IDBOpenDBRequest} */ (e.target).result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('family', 'family', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = (e) => {
          this.db = /** @type {IDBOpenDBRequest} */ (e.target).result;
          this.isReady = true;
          resolve(true);
        };

        request.onerror = (e) => {
          console.warn('Storage Notice: IndexedDB open failed. Operating in-memory mode:', e);
          this.isReady = true;
          resolve(false);
        };
      } catch (err) {
        console.warn('Storage Notice: IndexedDB initialization exception:', err);
        this.isReady = true;
        resolve(false);
      }
    });
  }

  /**
   * Exponential backoff retry mechanism for resilient font storage transactions
   * @param {() => Promise<*>} operationFn 
   * @param {number} maxRetries 
   * @returns {Promise<*>}
   */
  async withIndexedDBRetry(operationFn, maxRetries = 3) {
    if (typeof window !== 'undefined' && window.ITMSUtils && typeof window.ITMSUtils.withIndexedDBRetry === 'function') {
      return window.ITMSUtils.withIndexedDBRetry(operationFn, maxRetries);
    }
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await operationFn();
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) throw err;
        await new Promise(r => setTimeout(r, 60 * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Retrieves all custom font records from persistent storage.
   * @returns {Promise<CustomFontRecord[]>}
   */
  async getAllFonts() {
    await this.readyPromise;

    if (!this.db) {
      return [...this.memoryCache];
    }

    return this.withIndexedDBRetry(() => {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.getAll();

          req.onsuccess = () => {
            const fonts = req.result || [];
            this.memoryCache = fonts;
            resolve(fonts);
          };

          req.onerror = (e) => reject(e.target.error || new Error('getAll fonts failed'));
        } catch (e) {
          reject(e);
        }
      });
    }).catch(() => [...this.memoryCache]);
  }

  /**
   * Saves or updates a custom font record in IndexedDB.
   * @param {Partial<CustomFontRecord>} fontRecord
   * @returns {Promise<CustomFontRecord>}
   */
  async saveFont(fontRecord) {
    await this.readyPromise;

    // Record structure: { id, name, family, format, buffer, size, timestamp }
    /** @type {CustomFontRecord} */
    const record = {
      id: fontRecord.id || `font_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: fontRecord.name || 'Custom Font',
      family: fontRecord.family || 'custom_family',
      format: fontRecord.format || 'truetype',
      buffer: fontRecord.buffer || new ArrayBuffer(0), // Binary ArrayBuffer (No Base64 Inflation!)
      size: fontRecord.size || (fontRecord.buffer ? fontRecord.buffer.byteLength : 0),
      timestamp: fontRecord.timestamp || Date.now()
    };

    // Update in-memory cache
    const existingIdx = this.memoryCache.findIndex(f => f.id === record.id);
    if (existingIdx >= 0) {
      this.memoryCache[existingIdx] = record;
    } else {
      this.memoryCache.push(record);
    }

    if (!this.db) return record;

    return this.withIndexedDBRetry(() => {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.put(record);

          req.onsuccess = () => resolve(record);
          req.onerror = (e) => reject(e.target.error || new Error('saveFont failed'));
        } catch (err) {
          reject(err);
        }
      });
    }).catch((err) => {
      console.warn('Storage Notice: Exception saving font to IndexedDB:', err);
      return record; // Return memory cache fallback
    });
  }

  /**
   * Deletes a custom font by ID from storage and cache.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteFont(id) {
    await this.readyPromise;

    this.memoryCache = this.memoryCache.filter(f => f.id !== id);

    if (!this.db) return true;

    return this.withIndexedDBRetry(() => {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.delete(id);

          req.onsuccess = () => resolve(true);
          req.onerror = (e) => reject(e.target.error || new Error('deleteFont failed'));
        } catch (err) {
          reject(err);
        }
      });
    }).catch(() => false);
  }

  /**
   * Clears all stored fonts.
   * @returns {Promise<boolean>}
   */
  async clearAll() {
    await this.readyPromise;
    this.memoryCache = [];

    if (!this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([this.storeName], 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.clear();

        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.FontStorageDB = FontStorageDB;
  window.ITMS.FontStorage = new FontStorageDB();
  window.FontStorageDB = FontStorageDB;
  window.FontStorage = window.ITMS.FontStorage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FontStorageDB };
}



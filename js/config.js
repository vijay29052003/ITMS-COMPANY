/**
 * Centralized Configuration & Shared Security Utilities for ITMS LED Suite
 * Defines single source of truth for branding, database schemas, matrix hardware defaults,
 * and unified security sanitizers (XSS prevention, CSV injection protection, string clamping).
 */
const ITMS_CONFIG = {
  APP: {
    NAME: "ITMS LED Bitmap & Route Manager",
    VERSION: "2.1.0",
    COMPANY: "Containe Technologies Limited",
    LOGO_PATH: "ctpl-logo.png"
  },
  DATABASE: {
    ROUTE_DB_NAME: "ITMS_Route_DB_v4",
    ROUTE_STORE_NAME: "routes",
    BACKUP_STORE_NAME: "backups",
    STORAGE_KEY: "itms_routes_database_v2",
    DB_VERSION: 2,
    FONT_DB_NAME: "ITMS_FontDB",
    FONT_STORE_NAME: "custom_fonts",
    GLYPH_DB_NAME: "ITMS_Glyph_DB_v2",
    GLYPH_STORE_NAME: "saved_glyphs",
    GLYPH_STORAGE_KEY: "itms_glyph_library_v2"
  },
  HARDWARE_DEFAULTS: {
    MATRIX_HEIGHT: 64,
    MATRIX_WIDTH: 256,
    LED_COLOR: "#ff2a2a",
    OFF_COLOR: "#101726",
    PIXEL_STYLE: "circle",
    SUPPORTED_HEIGHTS: [16, 24, 32, 48, 64],
    SUPPORTED_WIDTHS: [32, 64, 128, 256, 384, 512]
  },
  EXPORT: {
    PACKAGE_VERSION: "2.0.0",
    DEFAULT_LANGUAGES: ["en", "te"],
    INCLUDE_PREVIEWS: true,
    COMPRESSION_LEVEL: 1
  },
  TIMING: {
    TOAST_DURATION_MS: 3000,
    DEBOUNCE_WAIT_MS: 120,
    SCROLL_SPEED_DEFAULT: 28
  }
};

/**
 * Unified Shared Security & Sanitization Utilities
 */
const ITMSUtils = {
  /**
   * Encodes HTML special characters to prevent DOM XSS vulnerabilities.
   * @param {*} str 
   * @returns {string}
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Encodes HTML attribute special characters.
   * @param {*} str 
   * @returns {string}
   */
  escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  /**
   * Sanitizes string inputs (removes ASCII control chars, clamps length).
   * @param {*} val 
   * @param {number} maxLen 
   * @param {string} defaultVal 
   * @returns {string}
   */
  sanitizeString(val, maxLen = 250, defaultVal = '') {
    if (val === undefined || val === null) return defaultVal;
    let str = String(val).replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (str.length > maxLen) {
      str = str.substring(0, maxLen);
    }
    return str || defaultVal;
  },

  /**
   * Clamps numeric inputs to strict min/max integer bounds.
   * @param {*} val 
   * @param {number} minVal 
   * @param {number} maxVal 
   * @param {number} defaultVal 
   * @returns {number}
   */
  clampNumber(val, minVal, maxVal, defaultVal) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return defaultVal;
    return Math.max(minVal, Math.min(maxVal, num));
  },

  /**
   * Sanitizes and escapes CSV cell values according to RFC 4180 and OWASP CSV Injection Guidelines.
   * Neutralizes formula characters (=, +, -, @, \t, \r, %) by prefixing a single quote.
   * @param {*} val 
   * @returns {string}
   */
  sanitizeCsvCell(val) {
    let str = (val !== undefined && val !== null) ? String(val) : '';

    // Formula / DDE Injection Neutralization
    if (/^[=+\-@\t\r%]/.test(str)) {
      str = "'" + str;
    }

    // Strict RFC 4180 CSV Escaping
    const needsQuotes = /[",\n\r]/.test(str) || /^[=+\-@\t\r%]/.test(str);
    const escapedStr = str.replace(/"/g, '""');
    return needsQuotes ? `"${escapedStr}"` : escapedStr;
  },

  /**
   * Executes an IndexedDB operation with exponential backoff retry.
   * Protects against transient database lockouts and concurrent transaction collisions.
   * @param {() => Promise<*>} operationFn 
   * @param {number} maxRetries 
   * @param {number} initialDelay 
   * @returns {Promise<*>}
   */
  async withIndexedDBRetry(operationFn, maxRetries = 3, initialDelay = 60) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await operationFn();
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          throw err;
        }
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
};

/**
 * Defensive Storage Accessor
 * Guarantees zero runtime exceptions when Web Storage (localStorage / sessionStorage)
 * is blocked, disabled in private browsing, or throws SecurityError / QuotaExceededError.
 * Automatically falls back to an in-memory storage Map with identical Storage interface.
 */
class DefensiveStorageAccessor {
  constructor() {
    /** @type {Map<string, string>} In-memory fallback dictionary */
    this._memoryStore = new Map();
    this._isLocalStorageAvailable = this._checkLocalStorage();
  }

  /**
   * Probes Web Storage availability by attempting a test write/delete.
   * @returns {boolean}
   */
  _checkLocalStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      const testKey = '__itms_storage_probe__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Returns true if physical Web Storage is accessible.
   * @returns {boolean}
   */
  get isAvailable() {
    return this._isLocalStorageAvailable;
  }

  /**
   * Safely retrieves an item by key. Never throws.
   * @param {string} key 
   * @returns {string|null}
   */
  getItem(key) {
    if (!key) return null;
    if (this._isLocalStorageAvailable) {
      try {
        const val = window.localStorage.getItem(key);
        if (val !== null) return val;
      } catch (_) {
        // Fallback to memory store if access is dynamically revoked
      }
    }
    return this._memoryStore.has(key) ? this._memoryStore.get(key) : null;
  }

  /**
   * Safely stores a key-value pair. Never throws.
   * @param {string} key 
   * @param {*} value 
   */
  setItem(key, value) {
    if (!key) return;
    const strVal = (value !== null && value !== undefined) ? String(value) : '';
    // Always keep in-memory cache synchronized as immediate zero-latency fallback
    this._memoryStore.set(key, strVal);
    if (this._isLocalStorageAvailable) {
      try {
        window.localStorage.setItem(key, strVal);
      } catch (err) {
        // Silently retain in-memory copy on quota/security exceptions
      }
    }
  }

  /**
   * Safely removes an item by key. Never throws.
   * @param {string} key 
   */
  removeItem(key) {
    if (!key) return;
    this._memoryStore.delete(key);
    if (this._isLocalStorageAvailable) {
      try {
        window.localStorage.removeItem(key);
      } catch (_) { }
    }
  }

  /**
   * Safely clears all stored items. Never throws.
   */
  clear() {
    this._memoryStore.clear();
    if (this._isLocalStorageAvailable) {
      try {
        window.localStorage.clear();
      } catch (_) { }
    }
  }

  /**
   * Returns the name of the nth key in the storage. Never throws.
   * @param {number} index 
   * @returns {string|null}
   */
  key(index) {
    if (this._isLocalStorageAvailable) {
      try {
        const k = window.localStorage.key(index);
        if (k !== null) return k;
      } catch (_) { }
    }
    const keys = Array.from(this._memoryStore.keys());
    return keys[index] || null;
  }

  /**
   * Returns the total count of keys stored. Never throws.
   * @returns {number}
   */
  get length() {
    if (this._isLocalStorageAvailable) {
      try {
        return window.localStorage.length;
      } catch (_) { }
    }
    return this._memoryStore.size;
  }
}

const ITMSStorage = new DefensiveStorageAccessor();

// Expose globally to window and master ITMS namespace
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.CONFIG = ITMS_CONFIG;
  window.ITMS.Utils = ITMSUtils;
  window.ITMS.Storage = ITMSStorage;
  window.ITMS_CONFIG = ITMS_CONFIG;
  window.ITMSUtils = ITMSUtils;
  window.ITMSStorage = ITMSStorage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ITMS_CONFIG, ITMSUtils, ITMSStorage, DefensiveStorageAccessor };
}



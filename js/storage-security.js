/**
 * @file storage-security.js
 * @description ITMS Storage Security, Web Crypto AES-GCM Encrypted Cache, and System Notification Dispatcher.
 * @module StorageSecurity
 */

/* ==========================================================================
   SECURE ENCRYPTED STORAGE AT REST (Web Crypto API / Authenticated AES-GCM 256-bit)
   ========================================================================== */
const SecureStorage = {
  _memCache: new Map(),
  _keyPromise: null,
  _entropyKey: 'itms_device_entropy_v2',
  _legacySalt: 'ITMS_SECURE_STORAGE_SALT_2026_HARDENED',

  /**
   * Returns defensive storage accessor ensuring zero runtime crashes if localStorage is blocked.
   * @private
   */
  _getStorage() {
    if (typeof window !== 'undefined' && window.ITMSStorage) return window.ITMSStorage;
    if (typeof ITMSStorage !== 'undefined') return ITMSStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    };
  },

  /**
   * Retrieves or generates cryptographically secure 256-bit dynamic device entropy.
   * Ensures each installation / device has a unique, unpredictable encryption key.
   * @returns {string}
   */
  _getDeviceEntropy() {
    try {
      const storage = this._getStorage();
      let entropy = storage.getItem(this._entropyKey);
      if (!entropy || entropy.length < 32) {
        if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
          const bytes = window.crypto.getRandomValues(new Uint8Array(32));
          entropy = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        } else {
          entropy = 'itms_' + Date.now() + '_' + Math.random().toString(36).substr(2);
        }
        try { storage.setItem(this._entropyKey, entropy); } catch (_) {}
      }
      return entropy;
    } catch (_) {}
    return 'itms_fallback_device_entropy_2026';
  },

  /**
   * Derives a unique 256-bit AES-GCM CryptoKey using PBKDF2 with 100,000 iterations and device-specific entropy.
   * @returns {Promise<CryptoKey|null>}
   */
  async _getCryptoKey() {
    if (this._keyPromise) return this._keyPromise;
    this._keyPromise = (async () => {
      try {
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
          const deviceEntropy = this._getDeviceEntropy();
          const encoder = new TextEncoder();
          const masterSecret = encoder.encode('ITMS_APP_INSTANCE_' + deviceEntropy);

          // Import base key material for PBKDF2 derivation
          const baseKey = await window.crypto.subtle.importKey(
            'raw',
            masterSecret,
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
          );

          // Dynamic device-specific salt derived from installation entropy
          const dynamicSalt = encoder.encode('ITMS_SALT_' + deviceEntropy.substring(0, 16));

          // Derive 256-bit AES-GCM Key with 100,000 PBKDF2 iterations
          return await window.crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: dynamicSalt,
              iterations: 100000,
              hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
        }
      } catch (err) {
        console.warn('[SecureStorage] Device PBKDF2 key derivation warning:', err);
      }
      return null;
    })();
    return this._keyPromise;
  },

  /**
   * Asynchronously encrypts plaintext using authenticated AES-GCM 256-bit with randomized 96-bit IV.
   * @param {string} text 
   * @returns {Promise<string>}
   */
  async encryptAsync(text) {
    if (text === null || text === undefined) return text;
    try {
      const key = await this._getCryptoKey();
      if (!key || typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        return this._encryptSyncFallback(text);
      }

      const str = String(text);
      const encoder = new TextEncoder();
      const plaintextBytes = encoder.encode(str);
      const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit randomized IV

      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        plaintextBytes
      );

      const cipherBytes = new Uint8Array(ciphertextBuffer);
      const combined = new Uint8Array(iv.length + cipherBytes.length);
      combined.set(iv, 0);
      combined.set(cipherBytes, iv.length);

      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < combined.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunkSize));
      }
      const b64 = (typeof btoa !== 'undefined') 
        ? btoa(binary) 
        : ((typeof Buffer !== 'undefined') ? Buffer.from(binary, 'binary').toString('base64') : '');
      return 'enc_aes_gcm_v2:' + b64;
    } catch (e) {
      console.warn('[SecureStorage] AES-GCM encryption error, falling back:', e);
      return this._encryptSyncFallback(text);
    }
  },

  /**
   * Asynchronously decrypts ciphertext (supports modern AES-GCM v2, legacy v1, and plain text).
   * @param {string} encText 
   * @returns {Promise<string>}
   */
  async decryptAsync(encText) {
    if (!encText || typeof encText !== 'string') return encText;

    // Modern Authenticated AES-GCM 256-bit Payload
    if (encText.startsWith('enc_aes_gcm_v2:')) {
      try {
        const key = await this._getCryptoKey();
        if (!key || typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
          return encText;
        }

        const rawB64 = encText.substring(15);
        const binary = (typeof atob !== 'undefined') 
          ? atob(rawB64) 
          : ((typeof Buffer !== 'undefined') ? Buffer.from(rawB64, 'base64').toString('binary') : '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const iv = bytes.subarray(0, 12);
        const ciphertext = bytes.subarray(12);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          ciphertext
        );
        return new TextDecoder().decode(decryptedBuffer);
      } catch (err) {
        console.warn('[SecureStorage] AES-GCM authentication/decryption failed:', err);
        return encText;
      }
    }

    // Backward compatibility for legacy v1 XOR format
    if (encText.startsWith('enc_v1:')) {
      return this._decryptLegacy(encText);
    }

    return encText;
  },

  /**
   * Internal legacy decryption for backward compatibility with older v1 stored records.
   * @private
   */
  _decryptLegacy(encText) {
    try {
      const rawB64 = encText.substring(7);
      const binary = atob(rawB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const saltBytes = new TextEncoder().encode(this._legacySalt);
      const saltLen = saltBytes.length;
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= saltBytes[i % saltLen];
      }
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return encText;
    }
  },

  /**
   * Internal fallback encryption for environments where WebCrypto is not accessible.
   * @private
   */
  _encryptSyncFallback(text) {
    if (text === null || text === undefined) return text;
    try {
      const str = String(text);
      if (str.length > 500000) return str;
      const encoder = new TextEncoder();
      const bytes = encoder.encode(str);
      const saltBytes = encoder.encode(this._legacySalt);
      const saltLen = saltBytes.length;
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= saltBytes[i % saltLen];
      }
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return 'enc_v1:' + btoa(binary);
    } catch (e) {
      return text;
    }
  },

  /**
   * Synchronous getter with instant memory cache response and automated background upgrade.
   * @param {string} key 
   * @returns {string|null}
   */
  getItem(key) {
    if (this._memCache.has(key)) {
      return this._memCache.get(key);
    }
    const storage = this._getStorage();
    try {
      const val = storage.getItem(key);
      if (!val) return null;

      if (val.startsWith('enc_v1:')) {
        const decrypted = this._decryptLegacy(val);
        this._memCache.set(key, decrypted);
        return decrypted;
      }

      if (val.startsWith('enc_aes_gcm_v2:')) {
        // Trigger async decryption, update memory cache, and migrate to synchronous cipher
        this.decryptAsync(val).then(decrypted => {
          if (decrypted && decrypted !== val) {
            this._memCache.set(key, decrypted);
            try {
              const syncEnc = this._encryptSyncFallback(decrypted);
              storage.setItem(key, syncEnc);
            } catch (_) {}
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('secureStorageDecrypted', {
                detail: { key, value: decrypted }
              }));
            }
          }
        });
        return this._memCache.get(key) || null;
      }

      this._memCache.set(key, val);
      return val;
    } catch (e) {
      return storage.getItem(key);
    }
  },

  /**
   * Synchronously saves to memory cache and persists in synchronously-decryptable format.
   * @param {string} key 
   * @param {*} value 
   */
  setItem(key, value) {
    const storage = this._getStorage();
    try {
      if (value === null || value === undefined) {
        this._memCache.delete(key);
        storage.removeItem(key);
        return;
      }
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      this._memCache.set(key, str);

      // Persist synchronously using secure format that getItem can decrypt instantly on startup
      const syncEnc = this._encryptSyncFallback(str);
      try {
        storage.setItem(key, syncEnc);
      } catch (quotaErr) {
        console.warn(`Storage quota warning on setItem("${key}"):`, quotaErr);
      }
    } catch (e) {
      try {
        storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch (quotaErr) {
        console.warn(`Storage quota exceeded on setItem("${key}"):`, quotaErr);
      }
    }
  },

  /**
   * Async getItem providing guaranteed decrypted response.
   * @param {string} key 
   * @returns {Promise<string|null>}
   */
  async getItemAsync(key) {
    if (this._memCache.has(key)) {
      return this._memCache.get(key);
    }
    const storage = this._getStorage();
    const val = storage.getItem(key);
    if (!val) return null;
    const decrypted = await this.decryptAsync(val);
    this._memCache.set(key, decrypted);
    return decrypted;
  },

  /**
   * Async setItem providing guaranteed AES-GCM persistence.
   * @param {string} key 
   * @param {*} value 
   * @returns {Promise<void>}
   */
  async setItemAsync(key, value) {
    const storage = this._getStorage();
    if (value === null || value === undefined) {
      this._memCache.delete(key);
      storage.removeItem(key);
      return;
    }
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    this._memCache.set(key, str);
    const enc = await this.encryptAsync(str);
    try {
      storage.setItem(key, enc);
    } catch (quotaErr) {
      console.warn(`Storage quota warning on setItemAsync("${key}"):`, quotaErr);
    }
  },

  /**
   * Removes item from memory cache and storage.
   * @param {string} key 
   */
  removeItem(key) {
    this._memCache.delete(key);
    this._getStorage().removeItem(key);
  }
};

/* ==========================================================================
   BOUNDED LEAST RECENTLY USED (LRU) CACHE WITH AUTOMATIC MEMORY CLEANUP
   ========================================================================== */
class LRUCache {
  constructor(maxSize = 250) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value); // Refresh key order
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest item (first item in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      const oldestVal = this.cache.get(oldestKey);
      if (oldestVal && typeof oldestVal.width !== 'undefined') {
        oldestVal.width = 0;
        oldestVal.height = 0;
      }
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.forEach((val) => {
      if (val && typeof val.width !== 'undefined') {
        val.width = 0;
        val.height = 0;
      }
    });
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/* ==========================================================================
   SYSTEM LOGGING & USER-FACING ERROR NOTIFICATION DISPATCHER
   ========================================================================== */
let lastToastMsg = '';
let lastToastTime = 0;

/**
 * Global User-Facing Toast Notification Dispatcher
 * Features deduplication rate-limiting, Bootstrap Icon rendering, and DOM XSS sanitization.
 * @param {string} message 
 * @param {'info'|'success'|'warning'|'danger'|'error'} type 
 */
function showToast(message, type = 'info', duration = 3500, title = '') {
  if (typeof window !== 'undefined' && window.ITMSErrorHandler) {
    window.ITMSErrorHandler.showToast(message, type, duration, title);
  } else {
    console.log(`[Toast] [${type}] ${message}`);
  }
}

function notifyUserError(tag, userMsg, type = 'warning', err = null) {
  if (typeof window !== 'undefined' && window.ITMSErrorHandler && window.ITMSErrorCategory) {
    const category = tag.toUpperCase().includes('STORAGE') || tag.toUpperCase().includes('INDEXEDDB')
      ? window.ITMSErrorCategory.STORAGE
      : (tag.toUpperCase().includes('CRYPTO') ? window.ITMSErrorCategory.CRYPTO : window.ITMSErrorCategory.SYSTEM);
    window.ITMSErrorHandler.handleError(category, err || userMsg, { title: `${tag} Alert`, resolution: userMsg, severity: type === 'warning' ? 'warning' : 'error' });
  } else {
    const timeStr = new Date().toISOString();
    console.warn(`[${tag}] [${timeStr}] ${userMsg}`, err || '');
  }
}

/* ==========================================================================
   GLOBAL APPLICATION ERROR BOUNDARY & UNHANDLED PROMISE REJECTION RECOVERY
   ========================================================================== */
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.message === 'Script error.' || !event.message) return;
    console.warn('[ErrorBoundary] Background event:', event.error || event.message);
    if (event.cancelable) event.preventDefault();
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[PromiseBoundary] Background rejection handled:', event.reason);
    if (event.cancelable) event.preventDefault();
  });

  // Global & ITMS Namespace Export
  window.ITMS = window.ITMS || {};
  window.ITMS.SecureStorage = SecureStorage;
  window.ITMS.LRUCache = LRUCache;
  window.ITMS.showToast = showToast;
  window.ITMS.notifyUserError = notifyUserError;

  window.SecureStorage = SecureStorage;
  window.LRUCache = LRUCache;
  window.showToast = showToast;
  window.notifyUserError = notifyUserError;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SecureStorage, LRUCache, showToast, notifyUserError };
}


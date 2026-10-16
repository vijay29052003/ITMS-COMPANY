/* ==========================================================================
   MODULE 3: PIXEL-PERFECT LED GLYPH MAPPER & INTERACTIVE DOT EDITOR
   Super-Sampled Area-Coverage 1-Bit Bitmapping Engine for Indic & Latin
   ========================================================================== */

/**
 * Fallback / Global LanguagePresets reference
 */
var LanguagePresets = (typeof window !== 'undefined' && (window.LanguagePresets || (window.ITMS && window.ITMS.LanguagePresets)))
  || (typeof LanguagePresets !== 'undefined' ? LanguagePresets : {})
  || ((typeof require !== 'undefined') ? (() => { try { return require('./data/language-presets.js').LanguagePresets; } catch (_) { return {}; } })() : {})
  || {};



/**
 * Manages persistent storage and retrieval of custom tuned glyph matrices.
 */
class GlyphStore {
  constructor() {
    const cfg = (typeof window !== 'undefined' && window.ITMS_CONFIG && window.ITMS_CONFIG.DATABASE) || {};
    /** @type {string} */
    this.storageKey = cfg.GLYPH_STORAGE_KEY || 'itms_glyph_library_v2';
    /** @type {string} */
    this.dbName = cfg.GLYPH_DB_NAME || 'ITMS_Glyph_DB_v2';
    /** @type {number} */
    this.dbVersion = 2;
    /** @type {string} */
    this.storeName = cfg.GLYPH_STORE_NAME || 'saved_glyphs';
    /** @type {IDBDatabase|null} */
    this.db = null;
    /** @type {(() => void)|null} Callback fired when async storage finishes loading */
    this.onDataLoaded = null;

    /** @type {SavedGlyph[]} Initial synchronous data from localStorage or fallback */
    this.glyphs = this.loadSync();

    // Initialize High-Capacity IndexedDB Database (Unlimited Storage & Auto-Backup)
    this.initIndexedDB();

    // Listen for async storage recovery events
    if (typeof window !== 'undefined') {
      window.addEventListener('secureStorageDecrypted', (e) => {
        if (e && e.detail && e.detail.key === this.storageKey) {
          try {
            const parsed = JSON.parse(e.detail.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const sanitized = this.sanitizeGlyphsArray(parsed);
              if (sanitized.length >= this.glyphs.length) {
                this.glyphs = sanitized;
                this.saveToIndexedDB(this.glyphs);
                if (typeof this.onDataLoaded === 'function') {
                  this.onDataLoaded();
                }
              }
            }
          } catch (_) {}
        }
      });
    }
  }

  // Helper: Sanitize glyphs array ensuring matrix and schema validity
  sanitizeGlyphsArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(g => g && typeof g === 'object' && g.text && Array.isArray(g.matrix))
      .map(g => ({
        id: (typeof g.id === 'string' && g.id.length <= 100) ? g.id : `glyph_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        text: String(g.text || '').substring(0, 200),
        language: String(g.language || 'telugu').substring(0, 50),
        fontName: String(g.fontName || 'Noto Sans Telugu').substring(0, 100),
        gridWidth: parseInt(g.gridWidth, 10) || 256,
        gridHeight: parseInt(g.gridHeight, 10) || 64,
        threshold: parseInt(g.threshold, 10) || 128,
        contrast: typeof g.contrast === 'number' ? g.contrast : 1.0,
        ledColor: String(g.ledColor || '#ff2a2a'),
        matrix: Array.isArray(g.matrix) ? g.matrix : [],
        timestamp: typeof g.timestamp === 'number' ? g.timestamp : Date.now(),
        dateStr: g.dateStr || new Date().toLocaleDateString()
      }));
  }

  loadSync() {
    try {
      const storage = (typeof window !== 'undefined' && window.SecureStorage) 
        ? window.SecureStorage 
        : ((typeof window !== 'undefined' && window.ITMSStorage) ? window.ITMSStorage : (typeof window !== 'undefined' ? window.localStorage : null));
      const data = storage ? storage.getItem(this.storageKey) : null;
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          const sanitized = this.sanitizeGlyphsArray(parsed);
          if (sanitized.length > 0) return sanitized;
        }
      }
    } catch (e) {
      if (typeof window !== 'undefined' && typeof window.notifyUserError === 'function') {
        window.notifyUserError('GlyphStore', 'Notice: Synchronous local storage read notice.', 'warning', e);
      }
    }
    return [];
  }

  // Initialize IndexedDB with auto-migration
  initIndexedDB() {
    if (typeof window === 'undefined' || !window.indexedDB) return;

    try {
      const req = window.indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };

      req.onsuccess = (e) => {
        this.db = e.target.result;
        this.loadFromIndexedDB().then(dbGlyphs => {
          if (dbGlyphs && Array.isArray(dbGlyphs) && dbGlyphs.length > 0) {
            const sanitized = this.sanitizeGlyphsArray(dbGlyphs);
            if (sanitized.length > 0) {
              this.glyphs = sanitized;
              this.saveAllSync(); // Sync back to localStorage
              if (typeof this.onDataLoaded === 'function') {
                this.onDataLoaded();
              }
            }
          } else if (this.glyphs.length > 0) {
            // Seed IndexedDB with initial glyphs from synchronous storage
            this.saveToIndexedDB(this.glyphs);
          }
        }).catch(err => {
          console.warn('GlyphStore IndexedDB load warning:', err);
        });
      };

      req.onerror = (e) => {
        console.warn('GlyphStore IndexedDB open warning:', e);
      };
    } catch (e) {
      console.warn('GlyphStore IndexedDB initialization exception:', e);
    }
  }

  loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error || new Error('IndexedDB getAll failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  saveToIndexedDB(glyphs = this.glyphs) {
    if (!this.db || !Array.isArray(glyphs)) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.clear().onsuccess = () => {
          for (const item of glyphs) {
            store.put(item);
          }
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  deleteFromIndexedDB(id) {
    if (!this.db || !id) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  saveAll() {
    this.saveAllSync();
    this.saveToIndexedDB(this.glyphs);
  }

  saveAllSync() {
    try {
      const dataStr = JSON.stringify(this.glyphs);
      if (typeof window !== 'undefined' && window.SecureStorage) {
        window.SecureStorage.setItem(this.storageKey, dataStr);
      } else if (typeof window !== 'undefined' && window.ITMSStorage) {
        window.ITMSStorage.setItem(this.storageKey, dataStr);
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, dataStr);
      }
    } catch (e) {
      if (typeof window !== 'undefined' && typeof window.notifyUserError === 'function') {
        window.notifyUserError('GlyphStore', 'Storage Notice: Synchronous local storage quota reached. Data is safely persisted in IndexedDB.', 'info', e);
      }
    }
  }

  /**
   * Saves a new glyph object to the store.
   * @param {Partial<SavedGlyph>} glyphObj
   * @returns {SavedGlyph}
   */
  save(glyphObj) {
    /** @type {SavedGlyph} */
    const entry = {
      id: `glyph_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      text: glyphObj.text || '',
      language: glyphObj.language || 'telugu',
      fontName: glyphObj.fontName || 'Noto Sans Telugu',
      gridWidth: glyphObj.gridWidth || 256,
      gridHeight: glyphObj.gridHeight || 64,
      threshold: glyphObj.threshold || 128,
      contrast: glyphObj.contrast || 1.0,
      ledColor: glyphObj.ledColor || '#ff2a2a',
      matrix: Array.isArray(glyphObj.matrix) ? glyphObj.matrix.map(r => Array.isArray(r) ? r.slice() : r) : [],
      timestamp: Date.now(),
      dateStr: new Date().toLocaleDateString()
    };
    this.glyphs.unshift(entry);
    this.saveAll();
    return entry;
  }

  /**
   * Deletes a glyph by ID.
   * @param {string} id
   */
  delete(id) {
    this.glyphs = this.glyphs.filter(g => g.id !== id);
    this.saveAllSync();
    this.deleteFromIndexedDB(id);
    this.saveToIndexedDB(this.glyphs);
  }

  /**
   * Returns all stored glyphs
   * @returns {SavedGlyph[]}
   */
  getAllGlyphs() {
    return Array.isArray(this.glyphs) ? this.glyphs : [];
  }

  /**
   * Imports an array of glyph objects safely with schema validation
   * @param {any[]} glyphsArray
   * @param {boolean} append
   * @returns {number}
   */
  importGlyphs(glyphsArray, append = true) {
    if (!Array.isArray(glyphsArray)) return 0;
    const sanitized = this.sanitizeGlyphsArray(glyphsArray);
    if (sanitized.length === 0) return 0;

    if (append) {
      const existingIds = new Set(this.glyphs.map(g => g.id));
      sanitized.forEach(sg => {
        if (existingIds.has(sg.id)) {
          sg.id = `glyph_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        }
        this.glyphs.push(sg);
        existingIds.add(sg.id);
      });
    } else {
      this.glyphs = sanitized;
    }

    this.saveAll();
    return sanitized.length;
  }
}


class GlyphManager {
  constructor() {
    /** @type {GlyphStore} */
    this.store = new GlyphStore();
    /** @type {(() => void)|null} */
    this.onDataLoaded = null;

    // Connect GlyphStore async onDataLoaded callback
    this.store.onDataLoaded = () => {
      if (typeof this.updateBadges === 'function') {
        this.updateBadges();
      }
      if (typeof this.renderSavedLibraryGrid === 'function' && this.activeSubTab === 'library') {
        this.renderSavedLibraryGrid(this.activeLibraryLangFilter);
      }
      if (typeof this.onDataLoaded === 'function') {
        this.onDataLoaded();
      }
    };
    /** @type {any} */
    this.routeMgr = null;
    /** @type {string} */
    this.selectedLanguage = 'telugu';
    /** @type {string} */
    this.selectedChar = 'క';
    /** @type {string} */
    this.activeCategory = 'all'; // Category filter for palette ('all', 'cat_0', 'cat_1', ...)
    /** @type {'studio'|'library'} */
    this.activeSubTab = 'studio'; // 'studio', 'library'
    /** @type {string} */
    this.activeLibraryLangFilter = 'all';
    /** @type {boolean} */
    this.isInitialized = false;

    // Animation & Display Mode State
    /** @type {any} */
    this.animInterval = null;
    /** @type {number} */
    this.scrollOffset = 0;
    /** @type {boolean} */
    this.blinkVisible = true;
    /** @type {BinaryMatrix} */
    this.fullMatrix = [];

    // Full Hardware Config
    /** @type {GlyphManagerConfig} */
    this.config = {
      fontFamily: LanguagePresets.telugu.fontFamily,
      customFontName: '',
      matrixHeight: 64, // 16, 24, 32, 48, 64 (Default 64 Dots)
      matrixWidthMode: '256', // Fixed 256 Dots Default (64, 96, 128, 192, 256, 384, 512)
      matrixWidth: 256,
      scrollMode: 'static', // 'static', 'scroll-left', 'scroll-right', 'blink'
      pixelStyle: 'circle', // 'circle', 'square', 'glow'
      ledColor: '#ff2a2a', // LED Red (Bitmap Creation Colors Only: #ff2a2a, #ffd700, #ff8c00, #00e676)
      offsetX: 0,
      offsetY: 0,
      threshold: 128,
      useSuperSampling: true,
      exportFormat: 'C-ARRAY'
    };

    // Matrix State & Bounded Fast Bitmap LRU Cache (Memory-Leak Free)
    /** @type {BinaryMatrix} */
    this.matrix = [];
    /** @type {boolean} */
    this.isMouseDown = false;
    /** @type {number} */
    this.dragDrawMode = 1; // 1 = light up dot, 0 = turn off dot
    /** @type {any} */
    this.lastEditedCell = null;
    /** @type {BinaryMatrix[]} 50-step undo history for pixel editing */
    this.undoStack = [];
    /** @type {BinaryMatrix[]} */
    this.redoStack = [];
    /** @type {number} Keyboard active pixel cursor row */
    this.cursorRow = 0;
    /** @type {number} Keyboard active pixel cursor col */
    this.cursorCol = 0;
    /** @type {boolean} Whether the pixel cursor highlight is currently visible */
    this.cursorVisible = false;
    /** @type {boolean} */
    this.hasKeyListeners = false;
    /** @type {Map<string, any>} */
    this.bitmapCache = window.LRUCache ? new window.LRUCache(200) : new Map();

    // Custom Font Storage
    this.customFonts = [];
    this.loadCustomFontsFromStorage();
    this.injectCustomSliderStyles();

    // High Performance Web Worker Offscreen Binarization Pipeline
    this.initBinarizerWorker();
  }

  initBinarizerWorker() {
    this.workerPendingCallbacks = new Map();
    this.workerJobId = 0;
    try {
      if (typeof Worker !== 'undefined' && location.protocol.startsWith('http')) {
        this.binarizerWorker = new Worker('js/binarizer-worker.js');
        this.binarizerWorker.onmessage = (e) => {
          const data = e.data;
          if (data && data.type === 'BINARIZATION_COMPLETE') {
            const cb = this.workerPendingCallbacks.get(data.id);
            if (cb) {
              this.workerPendingCallbacks.delete(data.id);
              cb(data.matrix);
            }
          }
        };
        this.binarizerWorker.onerror = () => {
          // If worker fails, gracefully flush pending callbacks using fallback
          this.workerPendingCallbacks.forEach((cb) => {
            try { cb(null); } catch (_) { }
          });
          this.workerPendingCallbacks.clear();
        };
      }
    } catch (e) {
      this.binarizerWorker = null;
    }
  }

  processBinarizationAsync(pixelsBuffer, renderWidth, renderHeight, rows, cols, oversample, minCoverageRatio, fallbackSyncFn) {
    if (this.binarizerWorker) {
      return new Promise((resolve) => {
        const jobId = ++this.workerJobId;
        let isResolved = false;

        const timer = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.workerPendingCallbacks.delete(jobId);
            resolve(fallbackSyncFn());
          }
        }, 600);

        this.workerPendingCallbacks.set(jobId, (matrix) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            if (matrix && Array.isArray(matrix) && matrix.length > 0) {
              resolve(matrix);
            } else {
              resolve(fallbackSyncFn());
            }
          }
        });

        try {
          this.binarizerWorker.postMessage({
            type: 'PROCESS_BINARIZATION',
            id: jobId,
            pixelsBuffer: pixelsBuffer,
            renderWidth,
            renderHeight,
            rows,
            cols,
            oversample,
            minCoverageRatio
          }, [pixelsBuffer]);
        } catch (postErr) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            this.workerPendingCallbacks.delete(jobId);
            resolve(fallbackSyncFn());
          }
        }
      });
    }
    return Promise.resolve(fallbackSyncFn());
  }

  injectCustomSliderStyles() {
    if (document.getElementById('matrix-edge-slider-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'matrix-edge-slider-styles';
    styleEl.textContent = `
      /* Custom Edge Range Sliders Inside LED Display Frame */
      .matrix-edge-slider-x {
        -webkit-appearance: none;
        appearance: none;
        background: rgba(255, 255, 255, 0.14) !important;
        border-radius: 4px;
        height: 5px !important;
        outline: none;
        cursor: ew-resize;
        transition: background 0.2s ease;
      }
      .matrix-edge-slider-x::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary, #00ABEF);
        border: 2px solid #ffffff;
        box-shadow: 0 0 6px rgba(0, 171, 239, 0.7);
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .matrix-edge-slider-x::-webkit-slider-thumb:hover {
        transform: scale(1.25);
        box-shadow: 0 0 10px rgba(0, 171, 239, 0.95);
      }

      .matrix-edge-slider-y {
        -webkit-appearance: none;
        appearance: none;
        writing-mode: vertical-lr;
        direction: rtl;
        background: rgba(255, 255, 255, 0.14) !important;
        border-radius: 4px;
        width: 5px !important;
        outline: none;
        cursor: ns-resize;
        transition: background 0.2s ease;
      }
      .matrix-edge-slider-y::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary, #00ABEF);
        border: 2px solid #ffffff;
        box-shadow: 0 0 6px rgba(0, 171, 239, 0.7);
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .matrix-edge-slider-y::-webkit-slider-thumb:hover {
        transform: scale(1.25);
        box-shadow: 0 0 10px rgba(0, 171, 239, 0.95);
      }
    `;
    document.head.appendChild(styleEl);
  }

  setRouteManager(routeMgr) {
    this.routeMgr = routeMgr;
  }

  async loadCustomFontsFromStorage() {
    try {
      if (window.FontStorage) {
        const storedFonts = await window.FontStorage.getAllFonts();
        this.customFonts = [];
        for (const font of storedFonts) {
          if (font.buffer) {
            const success = await this.registerFontFace(font.family, font.buffer);
            if (success) {
              this.customFonts.push(font);
            }
          }
        }
        this.updateFontSelectOptions();
        if (typeof CustomEvent !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('customFontsChanged', { detail: this.customFonts }));
        }
      }
    } catch (e) {
      console.warn('Storage Notice: Could not restore custom fonts from IndexedDB:', e);
    }
  }

  async registerFontFace(family, buffer) {
    if (!family || !buffer) return false;
    try {
      if (typeof FontFace !== 'undefined') {
        const fontFace = new FontFace(family, buffer);
        const loadedFace = await fontFace.load();
        document.fonts.add(loadedFace);
        return true;
      } else {
        const blob = new Blob([buffer], { type: 'font/ttf' });
        const url = URL.createObjectURL(blob);
        const styleId = `font_face_${family.replace(/[^a-zA-Z0-9]/g, '_')}`;
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = `@font-face { font-family: '${family}'; src: url('${url}'); }`;
        return true;
      }
    } catch (err) {
      console.warn(`FontFace registration rejected for ${family}:`, err);
      return false;
    }
  }

  // Enhanced & Strict Magic Byte & Signature Verification
  validateFontMagicBytes(buffer) {
    if (!buffer || buffer.byteLength < 4) return false;
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // 1. Blacklist: Executable, Shell, Archive, Document, Script signatures
    // DOS / Windows Executable / DLL (0x4D 0x5A -> "MZ")
    if (bytes.length >= 2 && bytes[0] === 0x4D && bytes[1] === 0x5A) return false;
    // Linux ELF Binary (0x7F 0x45 0x4C 0x46 -> "\x7FELF")
    if (bytes.length >= 4 && bytes[0] === 0x7F && bytes[1] === 0x45 && bytes[2] === 0x4C && bytes[3] === 0x46) return false;
    // ZIP / Office / Jar / APK (0x50 0x4B 0x03 0x04)
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return false;
    // 7-Zip (0x37 0x7A 0xBC 0xAF)
    if (bytes.length >= 2 && bytes[0] === 0x37 && bytes[1] === 0x7A) return false;
    // RAR (0x52 0x61 0x72 0x21)
    if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return false;
    // PDF Document (0x25 0x50 0x44 0x46 -> "%PDF")
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return false;
    // Java bytecode / Mach-O Fat Binary (0xCA 0xFE 0xBA 0xBE)
    if (bytes.length >= 4 && bytes[0] === 0xCA && bytes[1] === 0xFE && bytes[2] === 0xBA && bytes[3] === 0xBE) return false;
    // PHP / Script / HTML / SVG (0x3C 0x3F "<?", 0x23 0x21 "#!", 0x3C 0x21 "<!", 0x3C 0x73 "<s", 0x3C 0x68 "<h")
    if (bytes.length >= 2 && bytes[0] === 0x3C && (bytes[1] === 0x3F || bytes[1] === 0x21 || bytes[1] === 0x73 || bytes[1] === 0x53 || bytes[1] === 0x68 || bytes[1] === 0x48)) return false;
    if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) return false;

    // 2. Whitelist: Valid Font Magic Signatures
    const magic32 = view.getUint32(0);
    const isStandardFont = (
      magic32 === 0x00010000 || // TrueType 1.0 (Windows/Standard)
      magic32 === 0x74727565 || // 'true' (TrueType Apple/macOS)
      magic32 === 0x4F54544F || // 'OTTO' (OpenType with CFF outlines)
      magic32 === 0x74746366 || // 'ttcf' (TrueType / OpenType Collection)
      magic32 === 0x774F4646 || // 'wOFF' (WOFF 1.0)
      magic32 === 0x774F4632 || // 'wOF2' (WOFF 2.0)
      magic32 === 0x74797031    // 'typ1' (PostScript Type 1)
    );

    if (isStandardFont) return true;

    // BDF ASCII Font check ("STARTFONT")
    if (bytes.length >= 9) {
      const headerStr = String.fromCharCode(...bytes.slice(0, 9));
      if (headerStr.startsWith('STARTFONT')) return true;
    }

    return false;
  }

  // Deep Structural Font Parsing via opentype.js & Metadata Extraction
  parseFontMetadata(buffer, fileName) {
    const rawClean = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, ' ').trim();
    let cleanName = rawClean || 'CustomFont';
    let glyphCount = 0;
    let format = 'truetype';
    let familyName = cleanName;

    if (typeof window.opentype !== 'undefined' && window.opentype.parse) {
      try {
        const font = window.opentype.parse(buffer);
        if (font && font.names) {
          const extracted = (font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) ||
            (font.names.fullName && (font.names.fullName.en || Object.values(font.names.fullName)[0])) ||
            (font.names.postScriptName && (font.names.postScriptName.en || Object.values(font.names.postScriptName)[0]));
          if (extracted && typeof extracted === 'string') {
            const cleanExtracted = extracted.replace(/[^a-zA-Z0-9 _-]/g, ' ').trim();
            if (cleanExtracted) familyName = cleanExtracted;
          }
        }
        if (font && font.glyphs) {
          glyphCount = font.glyphs.length || 0;
        }
        if (font && font.outlinesFormat) {
          format = font.outlinesFormat;
        }
      } catch (otErr) {
        console.warn('OpenType structural parsing note (using native loader):', otErr);
      }
    }
    return { familyName, glyphCount, format };
  }

  updateFontSelectOptions() {
    const fontSelect = document.getElementById('glyph-font-select');
    if (!fontSelect) return;
    const preset = LanguagePresets[this.selectedLanguage] || LanguagePresets.telugu;
    const currentVal = this.config.fontFamily;

    let html = `<option value="${preset.fontFamily}">System Preset (${preset.fontFamily.split(',')[0].replace(/'/g, '')})</option>`;
    this.customFonts.forEach(f => {
      const isSel = currentVal.includes(f.family);
      html += `<option value="${f.family}, sans-serif" ${isSel ? 'selected' : ''}>Uploaded: ${f.name}</option>`;
    });
    html += `<option value="Courier New, monospace" ${currentVal.includes('Courier New') ? 'selected' : ''}>Monospace Pixel Standard</option>`;
    html += `<option value="Arial Black, sans-serif" ${currentVal.includes('Arial Black') ? 'selected' : ''}>Bold Block Latin</option>`;
    fontSelect.innerHTML = html;
  }

  async deleteCustomFont(id) {
    const font = this.customFonts.find(f => f.id === id);
    if (!font) return;
    if (confirm(`Remove custom font "${font.name}"?`)) {
      if (window.FontStorage) {
        await window.FontStorage.deleteFont(id);
      }
      this.customFonts = this.customFonts.filter(f => f.id !== id);
      const preset = LanguagePresets[this.selectedLanguage] || LanguagePresets.telugu;
      if (this.config.fontFamily.includes(font.family)) {
        this.config.fontFamily = preset.fontFamily;
      }
      this.updateFontSelectOptions();
      window.dispatchEvent(new CustomEvent('customFontsChanged', { detail: this.customFonts }));
      this.renderUI();
      if (typeof window.showToast === 'function') {
        window.showToast(`Custom font "${font.name}" removed.`, 'info');
      }
    }
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    window.addEventListener('customFontsChanged', (e) => {
      if (e.detail) {
        this.customFonts = e.detail;
        this.updateFontSelectOptions();
      }
    });
    this.renderUI();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this.updateBinarizedMatrix();
      });
    }
  }

  renderUI() {
    const container = document.getElementById('view-languages');
    if (!container) return;

    container.style.padding = '16px';
    container.style.background = 'var(--bg-dark, #f7f8fb)';
    container.style.minHeight = '80vh';
    container.style.borderRadius = '12px';

    const preset = LanguagePresets[this.selectedLanguage] || LanguagePresets.telugu;

    container.innerHTML = `
      <!-- TOP SUB-TAB NAVIGATION BAR -->
      <div class="glyph-subtabs-nav" style="display:flex; gap:20px; border-bottom:2px solid var(--border-color, #e7e9f0); margin-bottom:16px; padding:0 4px;">
        <button type="button" class="glyph-subnav-btn ${this.activeSubTab === 'studio' ? 'active' : ''}" data-subtab="studio">
          <i class="bi bi-display" style="width:16px; height:16px; font-size:16px;"></i> Pixel Studio
        </button>
        <button type="button" class="glyph-subnav-btn ${this.activeSubTab === 'library' ? 'active' : ''}" data-subtab="library">
          <i class="bi bi-bookmark-check" style="width:16px; height:16px; font-size:16px;"></i> Saved Glyphs
          <span id="top-tab-glyph-count-badge" style="background:rgba(0,171,239,0.12); color:var(--primary, #00ABEF); padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700;">${this.store.glyphs.length}</span>
        </button>
      </div>

      <!-- SUB-TAB 1: STUDIO VIEW (PIXEL & FONT BINARIZATION STUDIO) -->
      <div id="glyph-subtab-studio" class="${this.activeSubTab === 'studio' ? '' : 'glyph-sec-hidden'}">
        
        <!-- 1. TOP FULL-WIDTH CONTAINER: VIRTUAL LED BOARD -->
        <div class="glass-card bitmap-board-card" style="background:#ffffff; border:1px solid var(--border-color, #e7e9f0); border-radius:10px; padding:16px; margin-bottom:14px; box-shadow:0 2px 6px rgba(0,0,0,0.02); width:100%;">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
            <h3 class="card-title" style="margin:0; font-size:15px; font-weight:700; color:var(--text-main, #14151f); display:flex; align-items:center; gap:8px;">
              <i class="bi bi-display" style="color:var(--primary, #00ABEF); width:18px; height:18px; font-size:18px;"></i> Virtual LED Board
            </h3>
            
            <div style="display:flex; gap:10px; align-items:center;">
              <!-- Pixel Undo / Redo History Controls -->
              <div style="display:flex; gap:3px; align-items:center; background:#f1f5f9; padding:2px 4px; border-radius:6px; border:1px solid #e2e8f0;">
                <button type="button" id="glyph-btn-undo" class="btn-icon" style="background:none; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; color:#64748b; display:flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; opacity:${this.undoStack.length > 0 ? '1' : '0.4'}; pointer-events:${this.undoStack.length > 0 ? 'auto' : 'none'};" title="Undo Pixel Edit (Ctrl + Z)">
                  <i class="bi bi-arrow-counterclockwise" style="width:13px; height:13px; font-size:13px;"></i>
                  <span>Undo</span>
                </button>
                <button type="button" id="glyph-btn-redo" class="btn-icon" style="background:none; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; color:#64748b; display:flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; opacity:${this.redoStack.length > 0 ? '1' : '0.4'}; pointer-events:${this.redoStack.length > 0 ? 'auto' : 'none'};" title="Redo Pixel Edit (Ctrl + Y)">
                  <i class="bi bi-arrow-clockwise" style="width:13px; height:13px; font-size:13px;"></i>
                  <span>Redo</span>
                </button>
              </div>

              <!-- Reset Matrix Position (0,0) Button -->
              <button type="button" id="glyph-btn-reset-offsets" class="btn-font-upload-pill" style="border-radius:6px; padding:3px 8px; font-size:11.5px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px; height:28px;" title="Reset Matrix Position Offsets to (0,0)">
                <i class="bi bi-arrow-counterclockwise" style="width:12px; height:12px; font-size:12px;"></i>
                <span>Reset (0,0)</span>
              </button>

              <!-- Dedicated Hardware LED Color Palette Buttons (Red, Yellow, Orange, Green) -->
              <div class="color-picker-group" style="display:flex; gap:8px; align-items:center;">
                <button type="button" class="color-dot-btn ${this.config.ledColor === '#ff2a2a' ? 'active' : ''}" data-color="#ff2a2a" style="background:#ff2a2a; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; cursor:pointer; box-shadow:0 0 4px rgba(0,0,0,0.2);" title="LED Red"></button>
                <button type="button" class="color-dot-btn ${this.config.ledColor === '#ffd700' ? 'active' : ''}" data-color="#ffd700" style="background:#ffd700; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; cursor:pointer; box-shadow:0 0 4px rgba(0,0,0,0.2);" title="LED Yellow"></button>
                <button type="button" class="color-dot-btn ${this.config.ledColor === '#ff8c00' ? 'active' : ''}" data-color="#ff8c00" style="background:#ff8c00; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; cursor:pointer; box-shadow:0 0 4px rgba(0,0,0,0.2);" title="LED Orange"></button>
                <button type="button" class="color-dot-btn ${this.config.ledColor === '#00e676' ? 'active' : ''}" data-color="#00e676" style="background:#00e676; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; cursor:pointer; box-shadow:0 0 4px rgba(0,0,0,0.2);" title="LED Green"></button>
              </div>

              <span id="glyph-matrix-dims-badge" style="font-size:12px; background:rgba(0,171,239,0.12); color:var(--primary, #00ABEF); padding:4px 10px; border-radius:10px; font-weight:700;">${this.config.matrixWidth} x ${this.config.matrixHeight}</span>
            </div>
          </div>

          <!-- LED Board Hardware Frame: Clean Solid Black Display Box with Integrated Edge Sliders -->
          <div class="led-board-frame" style="width:100%; background:#000000; border-radius:10px; border:2px solid #1e293b; padding:14px; box-sizing:border-box;">
            
            <div style="display:grid; grid-template-columns: 1fr 24px; grid-template-rows: 1fr 24px; gap:6px; width:100%; min-height:180px; align-items:center;">
              
              <!-- Centered LED Matrix Canvas Viewport (Top-Left Cell) -->
              <div style="grid-column:1; grid-row:1; display:flex; justify-content:center; align-items:center; width:100%; height:100%; overflow:auto;">
                <canvas id="glyph-dot-canvas" style="max-width:100%; cursor:crosshair; background:#000000; border-radius:6px; box-shadow:0 4px 16px rgba(0,0,0,0.6); display:block; margin:0 auto;"></canvas>
              </div>

              <!-- Vertical Slider Along Right Edge inside Black Frame (Top-Right Cell) -->
              <div style="grid-column:2; grid-row:1; display:flex; align-items:center; justify-content:center; height:100%;" title="Vertical Position Offset Y">
                <input type="range" id="glyph-offset-y-slider" class="matrix-edge-slider-y" min="-64" max="64" value="${this.config.offsetY}" title="Vertical Position Offset Y (${this.config.offsetY}px)">
              </div>

              <!-- Horizontal Slider Along Bottom Edge inside Black Frame (Bottom-Left Cell) -->
              <div style="grid-column:1; grid-row:2; display:flex; align-items:center; justify-content:center; width:100%; padding:0 4px;" title="Horizontal Position Offset X">
                <input type="range" id="glyph-offset-x-slider" class="matrix-edge-slider-x" min="-128" max="128" value="${this.config.offsetX}" title="Horizontal Position Offset X (${this.config.offsetX}px)">
              </div>

              <!-- Corner Offset Badge (Bottom-Right Cell) -->
              <div style="grid-column:2; grid-row:2; display:flex; align-items:center; justify-content:center;">
                <span id="glyph-offset-pos-badge" style="font-size:9.5px; font-weight:700; font-family:'JetBrains Mono', monospace; color:#38bdf8; background:rgba(0,171,239,0.18); border:1px solid rgba(0,171,239,0.3); padding:2px 5px; border-radius:4px;" title="Offset X, Offset Y (${this.config.offsetX}px, ${this.config.offsetY}px)">${this.config.offsetX},${this.config.offsetY}</span>
              </div>

            </div>

          </div>
        </div>

        <!-- 2. MIDDLE SIDE-BY-SIDE CONTAINER: CONTROLS (LEFT) & SCRIPT PALETTE (RIGHT) -->
        <div class="glyph-middle-section-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px; align-items:stretch;">
          
          <!-- LEFT SIDE: LED MATRIX CONTROLS & CONFIGURATION -->
          <div class="glass-card glyph-controls-card" style="background:#ffffff; border:1px solid var(--border-color, #e7e9f0); border-radius:8px; padding:12px 16px; box-shadow:0 2px 6px rgba(0,0,0,0.02); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div class="card-header" style="margin-bottom:10px; border-bottom:1px solid var(--border-color, #e7e9f0); padding-bottom:8px;">
                <h4 style="margin:0; font-size:15px; font-weight:700; color:var(--text-main, #14151f); display:flex; align-items:center; gap:8px;">
                  <i class="bi bi-sliders" style="width:17px; height:17px; color:var(--primary, #00ABEF); font-size:17px;"></i> LED Matrix Controls & Configuration
                </h4>
              </div>

              <!-- Section 1: Active Text Input (Placed First) -->
              <div class="ctrl-group-section" style="padding:10px 14px; margin-bottom:10px; background:rgba(0,171,239,0.03); border:1px solid rgba(0,171,239,0.18); border-radius:8px;">
                <div class="ctrl-section-title" style="margin-bottom:6px; font-size:13.5px; display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:700; color:var(--text-main, #14151f);"><i class="bi bi-pencil-square" style="width:15px; height:15px; color:var(--primary, #00ABEF); vertical-align:-2px; font-size:15px;"></i> Input Text (Multi-Lingual)</span>
                  <span style="font-size:12px; color:var(--text-muted, #64748b); font-weight:600;">Type stop name or character</span>
                </div>
                <div style="position:relative;">
                  <input type="text" id="glyph-text-input" class="form-control glyph-main-input" value="${(this.selectedChar || '').replace(/"/g, '&quot;')}" placeholder="Type English, Telugu, Hindi text..." style="font-size:16px; font-weight:700; height:40px; background:#ffffff; color:var(--text-main, #14151f); border:1px solid var(--border-color, #cbd5e1); font-family:${preset.fontFamily}; border-radius:6px; padding:8px 12px; width:100%; box-sizing:border-box; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                </div>
              </div>

              <!-- Section 2: Target Script & Typography -->
              <div class="ctrl-group-section" style="padding:10px 14px; margin-bottom:10px; border-radius:8px;">
                <div class="ctrl-section-title" style="margin-bottom:8px; font-size:13.5px; display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:700; color:var(--text-main, #14151f);"><i class="bi bi-fonts" style="width:15px; height:15px; color:var(--primary, #00ABEF); vertical-align:-2px; font-size:15px;"></i> Script & Typography</span>
                  <label for="glyph-font-file-input" class="btn-font-upload-pill" style="padding:4px 10px; font-size:12px; cursor:pointer;" title="Upload custom TrueType (.TTF) or OpenType (.OTF) font file">
                    <i class="bi bi-upload" style="width:13px; height:13px; font-size:13px;"></i> Upload (.TTF)
                  </label>
                  <input type="file" id="glyph-font-file-input" accept=".ttf,.otf,.woff,.woff2,.bdf" style="display:none;">
                </div>

                <div class="form-row-2col" style="gap:12px;">
                  <!-- Target Script Language -->
                  <div class="form-group" style="margin:0;">
                    <label for="glyph-lang-select" style="font-weight:600; font-size:12.5px; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Script Language</label>
                    <select id="glyph-lang-select" class="form-control" style="width:100%; height:36px; padding:4px 10px; font-size:13px; border-radius:6px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); font-weight:600;">
                      ${Object.keys(LanguagePresets).map(k => `<option value="${k}" ${k === this.selectedLanguage ? 'selected' : ''}>${LanguagePresets[k].name}</option>`).join('')}
                    </select>
                  </div>

                  <!-- Font Family / Pixel Font -->
                  <div class="form-group" style="margin:0;">
                    <label for="glyph-font-select" style="font-weight:600; font-size:12.5px; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Font Family / Pixel Font</label>
                    <select id="glyph-font-select" class="form-control" style="width:100%; height:36px; padding:4px 10px; font-size:13px; border-radius:6px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f);">
                      <option value="${preset.fontFamily}">System Preset (${preset.fontFamily.split(',')[0].replace(/'/g, '')})</option>
                      ${this.customFonts.map(f => `<option value="${f.family}, sans-serif" ${this.config.fontFamily.includes(f.family) ? 'selected' : ''}>Uploaded: ${f.name}</option>`).join('')}
                      <option value="Courier New, monospace">Monospace Pixel Standard</option>
                      <option value="Arial Black, sans-serif">Bold Block Latin</option>
                    </select>
                  </div>
                </div>

                ${this.customFonts.length > 0 ? `
                  <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #e2e8f0; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                    <span style="font-size:11.5px; font-weight:600; color:var(--text-muted, #64748b);">Uploaded:</span>
                    ${this.customFonts.map(f => `
                      <span class="custom-font-chip" style="display:inline-flex; align-items:center; gap:4px; background:rgba(0,171,239,0.08); border:1px solid rgba(0,171,239,0.25); border-radius:10px; padding:3px 8px; font-size:11.5px; font-weight:600; color:#0284c7;">
                        <span>${f.name}</span>
                        <button type="button" class="btn-del-custom-font" data-font-id="${f.id}" title="Remove font" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:0; line-height:1; font-size:13px; font-weight:700;">&times;</button>
                      </span>
                    `).join('')}
                  </div>
                ` : ''}
              </div>

              <!-- Section 3: Hardware Matrix Specs & Rendering Effects -->
              <div class="ctrl-group-section" style="padding:10px 14px; margin-bottom:10px; border-radius:8px;">
                <div class="ctrl-section-title" style="margin-bottom:8px; font-size:13.5px;">
                  <span style="font-weight:700; color:var(--text-main, #14151f);"><i class="bi bi-cpu" style="width:15px; height:15px; color:var(--primary, #00ABEF); vertical-align:-2px; font-size:15px;"></i> Hardware Configuration & Display Rendering</span>
                </div>
                <div class="form-row-4col" style="gap:10px;">
                  <div>
                    <label for="glyph-height-select" style="font-size:12px; font-weight:600; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Height</label>
                    <select id="glyph-height-select" class="form-control" style="width:100%; height:34px; padding:4px 8px; font-size:12.5px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px; font-weight:600;">
                      <option value="16" ${this.config.matrixHeight == 16 ? 'selected' : ''}>16 Dots</option>
                      <option value="24" ${this.config.matrixHeight == 24 ? 'selected' : ''}>24 Dots</option>
                      <option value="32" ${this.config.matrixHeight == 32 ? 'selected' : ''}>32 Dots</option>
                      <option value="48" ${this.config.matrixHeight == 48 ? 'selected' : ''}>48 Dots</option>
                      <option value="64" ${this.config.matrixHeight == 64 ? 'selected' : ''}>64 Dots</option>
                    </select>
                  </div>

                  <div>
                    <label for="glyph-width-select" style="font-size:12px; font-weight:600; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Width</label>
                    <select id="glyph-width-select" class="form-control" style="width:100%; height:34px; padding:4px 8px; font-size:12.5px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px; font-weight:600;">
                      <option value="32" ${this.config.matrixWidthMode == '32' ? 'selected' : ''}>32 Dots</option>
                      <option value="64" ${this.config.matrixWidthMode == '64' ? 'selected' : ''}>64 Dots</option>
                      <option value="96" ${this.config.matrixWidthMode == '96' ? 'selected' : ''}>96 Dots</option>
                      <option value="128" ${this.config.matrixWidthMode == '128' ? 'selected' : ''}>128 Dots</option>
                      <option value="192" ${this.config.matrixWidthMode == '192' ? 'selected' : ''}>192 Dots</option>
                      <option value="256" ${this.config.matrixWidthMode == '256' ? 'selected' : ''}>256 Dots</option>
                      <option value="384" ${this.config.matrixWidthMode == '384' ? 'selected' : ''}>384 Dots</option>
                      <option value="512" ${this.config.matrixWidthMode == '512' ? 'selected' : ''}>512 Dots</option>
                    </select>
                  </div>

                  <div>
                    <label for="glyph-scroll-mode" style="font-size:12px; font-weight:600; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Display Mode</label>
                    <select id="glyph-scroll-mode" class="form-control" style="width:100%; height:34px; padding:4px 8px; font-size:12.5px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px;">
                      <option value="static" ${this.config.scrollMode === 'static' ? 'selected' : ''}>Static</option>
                      <option value="scroll-left" ${this.config.scrollMode === 'scroll-left' ? 'selected' : ''}>L-Scroll</option>
                      <option value="scroll-right" ${this.config.scrollMode === 'scroll-right' ? 'selected' : ''}>R-Scroll</option>
                      <option value="blink" ${this.config.scrollMode === 'blink' ? 'selected' : ''}>Blink</option>
                    </select>
                  </div>

                  <div>
                    <label for="glyph-style-select" style="font-size:12px; font-weight:600; color:var(--text-muted, #6b7086); display:block; margin-bottom:4px;">Pixel Style</label>
                    <select id="glyph-style-select" class="form-control" style="width:100%; height:34px; padding:4px 8px; font-size:12.5px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px;">
                      <option value="circle" ${this.config.pixelStyle === 'circle' ? 'selected' : ''}>Circle</option>
                      <option value="glow" ${this.config.pixelStyle === 'glow' ? 'selected' : ''}>Glow</option>
                      <option value="square" ${this.config.pixelStyle === 'square' ? 'selected' : ''}>Square</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section 4 & Action Buttons: Side-by-Side 2-Column Grid -->
              <div style="display:grid; grid-template-columns: 1.15fr 1fr; gap:12px; align-items:stretch; margin-top:10px;">
                
                <!-- Left Column: Fine Tuning & Alignment -->
                <div class="ctrl-group-section" style="padding:10px 12px; margin-bottom:0; border-radius:8px; display:flex; flex-direction:column; justify-content:space-between;">
                  <div class="ctrl-section-title" style="margin-bottom:6px; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:700; color:var(--text-main, #14151f);"><i class="bi bi-sliders" style="width:14px; height:14px; color:var(--primary, #00ABEF); vertical-align:-2px; font-size:14px;"></i> Fine Tuning</span>
                    <button type="button" id="glyph-btn-reset-threshold" class="btn-font-upload-pill" style="border-radius:6px; padding:2px 7px; font-size:11px; cursor:pointer;" title="Reset Threshold to default 128">
                      <i class="bi bi-arrow-counterclockwise" style="width:11px; height:11px; font-size:11px;"></i> Reset (128)
                    </button>
                  </div>

                  <div style="margin-top:2px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                      <label for="glyph-threshold-slider" style="font-size:11.5px; font-weight:600; color:var(--text-muted, #6b7086);">Threshold</label>
                      <span id="glyph-threshold-val" class="glyph-threshold-badge" style="background:var(--primary, #00ABEF); color:#ffffff; font-size:11px; font-weight:700; padding:1px 6px; border-radius:8px;">${this.config.threshold}</span>
                    </div>
                    <input type="range" id="glyph-threshold-slider" min="10" max="245" value="${this.config.threshold}" style="width:100%; accent-color:var(--primary, #00ABEF); cursor:pointer;">
                  </div>
                </div>

                <!-- Right Column: Action Buttons (Invert + Clear on top, Save Tuned Glyph on bottom) -->
                <div style="display:flex; flex-direction:column; gap:8px; height:100%;">
                  <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
                    <button type="button" id="glyph-btn-invert" class="btn-ctrl-action btn-ctrl-purple" style="height:34px; font-size:13px; font-weight:600; padding:0 8px; justify-content:center;" title="Invert pixel matrix state (ON/OFF)">
                      <i class="bi bi-circle-half" style="width:14px; height:14px; font-size:14px;"></i> Invert
                    </button>
                    <button type="button" id="glyph-btn-clear" class="btn-ctrl-action btn-ctrl-warning" style="height:34px; font-size:13px; font-weight:600; padding:0 8px; justify-content:center;" title="Clear matrix completely">
                      <i class="bi bi-trash3" style="width:14px; height:14px; font-size:14px;"></i> Clear
                    </button>
                  </div>
                  <button type="button" id="glyph-btn-save" class="btn-hero-save" style="flex:1; min-height:44px; font-size:15px; font-weight:700; letter-spacing:0.3px; gap:8px; padding:0 14px; width:100%; justify-content:center; border-radius:8px;" title="Save this tuned glyph to your hardware library">
                    <i class="bi bi-bookmark-plus" style="width:16px; height:16px; font-size:16px;"></i> Save Tuned Glyph
                  </button>
                </div>

              </div>
            </div>
          </div>

          <!-- RIGHT SIDE: SCRIPT CHARACTER PALETTE (Matches Left Controls Height Exactly) -->
          <div class="glass-card glyph-palette-card" style="background:#ffffff; border:1px solid var(--border-color, #e7e9f0); border-radius:10px; padding:16px 20px; box-shadow:0 2px 6px rgba(0,0,0,0.02); display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; box-sizing:border-box;">
            <div class="card-header" style="margin-bottom:10px; border-bottom:1px solid var(--border-color, #e7e9f0); padding-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
              <h4 style="margin:0; font-size:14.5px; font-weight:700; color:var(--text-main, #14151f); display:flex; align-items:center; gap:6px;">
                <i class="bi bi-grid-3x3" style="width:16px; height:16px; color:var(--primary, #00ABEF); font-size:16px;"></i> Script Character Palette
              </h4>
              <span id="glyph-palette-lang-tag" style="font-size:11.5px; font-weight:700; color:var(--primary, #00ABEF); background:rgba(0,171,239,0.1); padding:2px 8px; border-radius:10px;">${preset.name.split(' ')[0]}</span>
            </div>

            <!-- Palette Category Filter Sub-Tabs Bar -->
            <div id="glyph-palette-cat-tabs">
              ${this.renderCategoryTabsHTML()}
            </div>

            <!-- Quick Search Bar for Palette -->
            <div style="position:relative; margin-bottom:10px;">
              <input type="text" id="glyph-palette-search-input" class="form-control" placeholder="Search characters or stop names..." style="width:100%; padding:6px 28px 6px 30px; font-size:12px; border-radius:6px; border:1px solid var(--border-color, #cbd5e1); box-sizing:border-box;">
              <i class="bi bi-search" style="position:absolute; left:9px; top:50%; transform:translateY(-50%); width:14px; height:14px; color:var(--text-muted, #6b7086); pointer-events:none; font-size:14px;"></i>
              <button type="button" id="glyph-palette-search-clear" class="search-clear-btn" style="display:none;" title="Clear search">&times;</button>
            </div>

            <!-- Palette Content Container (Matches controls height exactly & provides smooth inner scrolling) -->
            <div id="glyph-palette-container" class="glyph-palette-drawer" style="flex:1 1 0px; min-height:0; overflow-y:auto; padding-right:6px; background:#f8fafc; border:1px solid var(--border-color, #e7e9f0); border-radius:8px; padding:12px 14px; box-sizing:border-box;">
              ${this.renderPaletteGroupsHTML()}
            </div>
          </div>

        </div>

        <!-- 3. GENERATED HARDWARE BITMAP DATA OUTPUT PANEL -->
        <div class="glass-card bitmap-output-card" style="background:#ffffff; border:1px solid var(--border-color, #e7e9f0); border-radius:10px; padding:16px; width:100%;">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
            <h4 class="card-title" style="margin:0; font-size:14px; font-weight:700; color:var(--text-main, #14151f); display:flex; align-items:center; gap:6px;">
              <i class="bi bi-code-slash" style="color:var(--primary, #00ABEF); width:16px; height:16px; font-size:16px;"></i> Generated Hardware Bitmap Data
            </h4>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="glyph-bmp-format-select" class="form-control" style="width:auto; padding:5px 10px; font-size:12px; background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px; font-weight:600;">
                <option value="C-ARRAY" ${this.config.exportFormat === 'C-ARRAY' ? 'selected' : ''}>C Header (.h) / C-Array</option>
                <option value="CSHARP" ${this.config.exportFormat === 'CSHARP' ? 'selected' : ''}>C# Byte Array</option>
                <option value="HEX-PLAIN" ${this.config.exportFormat === 'HEX-PLAIN' ? 'selected' : ''}>Comma Hex List</option>
                <option value="RAW-HEX" ${this.config.exportFormat === 'RAW-HEX' ? 'selected' : ''}>Raw Bitstream Hex</option>
                <option value="BINARY" ${this.config.exportFormat === 'BINARY' ? 'selected' : ''}>Binary 1/0 Grid</option>
                <option value="BIN-ARRAY" ${this.config.exportFormat === 'BIN-ARRAY' ? 'selected' : ''}>Binary Array (0b...)</option>
                <option value="JSON" ${this.config.exportFormat === 'JSON' ? 'selected' : ''}>JSON Package</option>
                <option value="BASE64" ${this.config.exportFormat === 'BASE64' ? 'selected' : ''}>Base64 String</option>
                <option value="PYTHON" ${this.config.exportFormat === 'PYTHON' ? 'selected' : ''}>Python List</option>
              </select>
              <button type="button" id="glyph-bmp-btn-copy" class="btn btn-primary btn-sm" style="font-size:11.5px; padding:5px 10px; font-weight:600; display:inline-flex; align-items:center; gap:4px; background:var(--primary, #00ABEF); color:#ffffff; border:none; border-radius:6px; cursor:pointer;">
                <i class="bi bi-clipboard" style="width:12px; height:12px; font-size:12px;"></i> Copy Data
              </button>
              <button type="button" id="glyph-bmp-btn-download" class="btn btn-secondary btn-sm" style="font-size:11.5px; padding:5px 10px; font-weight:600; display:inline-flex; align-items:center; gap:4px; background:#ffffff; color:var(--text-main, #14151f); border:1px solid var(--border-color, #cbd5e1); border-radius:6px; cursor:pointer;">
                <i class="bi bi-download" style="width:12px; height:12px; font-size:12px;"></i> Save (.h)
              </button>
            </div>
          </div>
          
          <div id="glyph-bmp-code-output" class="code-output-box" style="width:100%; min-height:130px; max-height:200px; background:#090d16; color:#38bdf8; font-family:'JetBrains Mono', monospace; font-size:12px; border:1px solid #1e293b; border-radius:8px; padding:12px; overflow-y:auto; overflow-x:auto; white-space:pre-wrap; word-break:break-all; box-sizing:border-box;"></div>
        </div>

      </div>

      <!-- SUB-TAB 2: SAVED HARDWARE GLYPH LIBRARY -->
      <div id="glyph-subtab-library" class="${this.activeSubTab === 'library' ? '' : 'glyph-sec-hidden'}">
        <div class="glass-card" style="padding:20px; border:1px solid var(--border-color, #e7e9f0); border-radius:10px; background:var(--bg-card, #ffffff); box-shadow:0 2px 6px rgba(0,0,0,0.02);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px; padding-bottom:12px; border-bottom:1px solid #f1f5f9;">
            <div>
              <h4 style="margin:0; font-size:15.5px; font-weight:700; color:var(--text-main, #14151f); display:flex; align-items:center; gap:8px;">
                <i class="bi bi-bookmark-check" style="color:var(--primary, #00ABEF); width:18px; height:18px; font-size:18px;"></i> Saved Hardware LED Glyph Library
              </h4>
            </div>

            <div style="display:flex; gap:12px; align-items:center; flex-wrap:nowrap;">
              <div class="glyph-lib-badge-pill" style="display:inline-flex; align-items:center; gap:8px; background:#f8fafc; border:1px solid #cbd5e1; padding:0 12px; height:36px; border-radius:6px; flex-shrink:0;">
                <span style="font-size:12px; color:var(--text-muted, #64748b); font-weight:600; white-space:nowrap;">Saved Glyphs: <strong id="glyph-saved-count-badge" style="color:var(--primary, #00ABEF); font-size:13.5px; font-weight:800;">${this.store.glyphs.length}</strong></span>
                <div class="glyph-storage-progress" style="width:65px; height:5px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
                  <div id="glyph-storage-bar-inner" class="glyph-storage-bar-inner" style="height:100%; width:${Math.min(100, (this.store.glyphs.length / 50) * 100)}%; background:linear-gradient(90deg, var(--primary, #00ABEF), var(--success, #0da96f));"></div>
                </div>
              </div>

              <select id="glyph-lib-lang-filter" class="form-control" style="background:#ffffff; border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, #14151f); border-radius:6px; font-size:12px; padding:0 12px; height:36px; font-weight:600; cursor:pointer; width:auto; margin:0;">
                <option value="all" ${this.activeLibraryLangFilter === 'all' ? 'selected' : ''}>All Script Languages</option>
                <option value="telugu" ${this.activeLibraryLangFilter === 'telugu' ? 'selected' : ''}>Telugu (తెలుగు)</option>
                <option value="hindi" ${this.activeLibraryLangFilter === 'hindi' ? 'selected' : ''}>Hindi (हिन्दी)</option>
                <option value="english" ${this.activeLibraryLangFilter === 'english' ? 'selected' : ''}>English (Latin)</option>
                <option value="tamil" ${this.activeLibraryLangFilter === 'tamil' ? 'selected' : ''}>Tamil (தமிழ்)</option>
                <option value="kannada" ${this.activeLibraryLangFilter === 'kannada' ? 'selected' : ''}>Kannada (ಕನ್ನಡ)</option>
                <option value="malayalam" ${this.activeLibraryLangFilter === 'malayalam' ? 'selected' : ''}>Malayalam (മലയാളം)</option>
              </select>
            </div>
          </div>

          <div id="glyph-saved-grid-wrapper" style="max-height: 500px; overflow-y: auto; padding-right: 6px; scrollbar-width: thin;">
            <div id="glyph-saved-grid" class="glyph-cards-grid-wide" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:14px;">
              ${this.store.glyphs.length === 0 ? `<div style="grid-column:1/-1; color:var(--text-muted, #6b7086); font-size:13px; text-align:center; padding:24px 0;">No custom tuned glyphs stored yet. Fine-tune any character in the Studio tab and click "Save Tuned Glyph".</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateBinarizedMatrix();
  }

  switchSubTab(tabName) {
    this.activeSubTab = tabName;

    // Sync subtab state to ITMS.State
    if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
      window.ITMS.State.set('glyph.activeSubTab', tabName, { silent: true });
    }

    // Synchronize left sidebar and top sub-navigation items
    document.querySelectorAll('.nav-sub-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === tabName);
    });
    document.querySelectorAll('.glyph-subnav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === tabName);
    });

    const sidebarBadge = document.getElementById('sidebar-glyph-count-badge');
    if (sidebarBadge) {
      sidebarBadge.textContent = this.store.glyphs.length;
    }
    const topTabBadge = document.getElementById('top-tab-glyph-count-badge');
    if (topTabBadge) {
      topTabBadge.textContent = this.store.glyphs.length;
    }

    const studioView = document.getElementById('glyph-subtab-studio');
    const libraryView = document.getElementById('glyph-subtab-library');

    if (studioView) studioView.classList.toggle('glyph-sec-hidden', tabName !== 'studio');
    if (libraryView) libraryView.classList.toggle('glyph-sec-hidden', tabName !== 'library');

    if (tabName === 'studio') {
      this.updateBinarizedMatrix();
    } else if (tabName === 'library') {
      this.stopAnimation();
      this.renderSavedLibraryGrid(this.activeLibraryLangFilter);
    }
  }

  renderCategoryTabsHTML() {
    const preset = LanguagePresets[this.selectedLanguage] || LanguagePresets.telugu;
    const allCharsCount = preset.paletteGroups.reduce((acc, g) => acc + g.chars.length, 0);
    let html = `<div class="glyph-cat-tabs-wrap">`;
    html += `<button type="button" class="glyph-cat-tab ${this.activeCategory === 'all' ? 'active' : ''}" data-category="all">
      <i class="bi bi-layers" style="width:12px; height:12px; font-size:12px;"></i> All <span class="glyph-cat-tab-badge">${allCharsCount}</span>
    </button>`;
    preset.paletteGroups.forEach((grp, idx) => {
      const catKey = `cat_${idx}`;
      const isAct = this.activeCategory === catKey;
      const cleanName = grp.name.split(' (')[0];
      html += `<button type="button" class="glyph-cat-tab ${isAct ? 'active' : ''}" data-category="${catKey}">
        ${cleanName} <span class="glyph-cat-tab-badge">${grp.chars.length}</span>
      </button>`;
    });
    html += `</div>`;
    return html;
  }

  renderPaletteGroupsHTML() {
    const preset = LanguagePresets[this.selectedLanguage] || LanguagePresets.telugu;
    let filteredGroups = preset.paletteGroups;
    if (this.activeCategory && this.activeCategory !== 'all') {
      const idx = parseInt(this.activeCategory.replace('cat_', ''), 10);
      if (!isNaN(idx) && preset.paletteGroups[idx]) {
        filteredGroups = [preset.paletteGroups[idx]];
      }
    }

    if (filteredGroups.length === 0) {
      return `<div style="padding:16px; text-align:center; color:var(--text-muted, #6b7086); font-size:12px;">No characters found in this category.</div>`;
    }

    return filteredGroups.map(grp => `
      <div class="glyph-palette-group" style="margin-bottom:10px;">
        <div style="font-size:11.5px; font-weight:700; color:var(--text-main, #14151f); margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
          <span>${grp.name}</span>
          <span style="font-size:10.5px; font-weight:600; color:var(--text-muted, #6b7086);">${grp.chars.length} items</span>
        </div>
        <div class="glyph-palette-grid" style="display:flex; flex-wrap:wrap; gap:6px;">
          ${grp.chars.map(c => `
            <button type="button" class="palette-chip ${c === this.selectedChar ? 'active' : ''}" data-char="${c}" style="font-family:${preset.fontFamily}; padding:5px 10px; font-size:13px;" title="${c}">
              ${c}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  bindCategoryTabs() {
    document.querySelectorAll('.glyph-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeCategory = tab.dataset.category || 'all';
        const catContainer = document.getElementById('glyph-palette-cat-tabs');
        if (catContainer) catContainer.innerHTML = this.renderCategoryTabsHTML();
        const paletteContainer = document.getElementById('glyph-palette-container');
        if (paletteContainer) paletteContainer.innerHTML = this.renderPaletteGroupsHTML();

        const paletteSearch = document.getElementById('glyph-palette-search-input');
        if (paletteSearch) paletteSearch.value = '';
        const searchClear = document.getElementById('glyph-palette-search-clear');
        if (searchClear) searchClear.style.display = 'none';

        this.bindCategoryTabs();
        this.bindPaletteChips();
        // Bootstrap Icons render natively via CSS
      });
    });
  }

  bindPaletteChips() {
    document.querySelectorAll('.palette-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const char = chip.dataset.char;
        if (!char) return;
        this.selectedChar = char;
        const textInput = document.getElementById('glyph-text-input');
        if (textInput) {
          textInput.value = char;
        }
        document.querySelectorAll('.palette-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.updateBinarizedMatrix();
      });
    });
  }

  bindEvents() {
    // Initialize dedicated LEDEngine instance for Language Library Virtual LED Board
    const canvas = document.getElementById('glyph-dot-canvas');
    if (canvas) {
      if (this.ledEng && typeof this.ledEng.destroy === 'function') {
        this.ledEng.destroy();
      } else if (this.ledEng && typeof this.ledEng.stopAnimation === 'function') {
        this.ledEng.stopAnimation();
      }
      this.ledEng = new LEDEngine('glyph-dot-canvas');
      this.ledEng.onMatrixChange = () => {
        this.matrix = this.ledEng.matrix;
        this.updateCodeOutputBox();
      };
      this.ledEng.onUndoRedoChange = () => {
        this.updateUndoRedoButtons();
      };
    }
    this.updateUndoRedoButtons();

    // Sub-nav tab switching
    document.querySelectorAll('.glyph-subnav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchSubTab(btn.dataset.subtab);
      });
    });

    // Saved Library Language Filter Dropdown
    const libLangFilter = document.getElementById('glyph-lib-lang-filter');
    if (libLangFilter) {
      libLangFilter.addEventListener('change', (e) => {
        this.activeLibraryLangFilter = e.target.value;
        this.renderSavedLibraryGrid(this.activeLibraryLangFilter);
      });
    }

    // Language selector
    const langSelect = document.getElementById('glyph-lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', (e) => {
        this.selectedLanguage = e.target.value;
        const preset = LanguagePresets[this.selectedLanguage];
        if (preset) {
          this.config.fontFamily = preset.fontFamily;
          if (preset.paletteGroups[0] && preset.paletteGroups[0].chars[0]) {
            this.selectedChar = preset.paletteGroups[0].chars[0];
          }
        }
        const paletteContainer = document.getElementById('glyph-palette-container');
        if (paletteContainer) paletteContainer.innerHTML = this.renderPaletteGroupsHTML();

        const langTag = document.getElementById('glyph-palette-lang-tag');
        if (langTag && preset) langTag.textContent = preset.name.split(' ')[0];

        const textInput = document.getElementById('glyph-text-input');
        if (textInput) {
          textInput.style.fontFamily = this.config.fontFamily;
          textInput.value = this.selectedChar;
        }

        const paletteSearch = document.getElementById('glyph-palette-search-input');
        if (paletteSearch) paletteSearch.value = '';

        this.bindPaletteChips();
        this.updateBinarizedMatrix();
      });
    }

    // Reset Offsets (0,0) Button
    const resetOffsetsBtn = document.getElementById('glyph-btn-reset-offsets');
    if (resetOffsetsBtn) {
      resetOffsetsBtn.addEventListener('click', () => {
        this.config.offsetX = 0;
        this.config.offsetY = 0;
        const sliderX = document.getElementById('glyph-offset-x-slider');
        const sliderY = document.getElementById('glyph-offset-y-slider');
        if (sliderX) sliderX.value = 0;
        if (sliderY) sliderY.value = 0;
        const posBadge = document.getElementById('glyph-offset-pos-badge');
        if (posBadge) posBadge.textContent = '0,0';
        this.updateBinarizedMatrix();
      });
    }

    // Palette Search / Filter input with clear button
    const paletteSearchInput = document.getElementById('glyph-palette-search-input');
    const searchClearBtn = document.getElementById('glyph-palette-search-clear');

    if (paletteSearchInput) {
      paletteSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (searchClearBtn) searchClearBtn.style.display = query ? 'block' : 'none';
        document.querySelectorAll('.palette-chip').forEach(chip => {
          const char = (chip.dataset.char || '').toLowerCase();
          chip.style.display = (!query || char.includes(query)) ? 'inline-flex' : 'none';
        });
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        if (paletteSearchInput) paletteSearchInput.value = '';
        searchClearBtn.style.display = 'none';
        document.querySelectorAll('.palette-chip').forEach(chip => {
          chip.style.display = 'inline-flex';
        });
      });
    }

    this.bindCategoryTabs();

    // Font family selector
    const fontSelect = document.getElementById('glyph-font-select');
    if (fontSelect) {
      fontSelect.addEventListener('change', (e) => {
        this.config.fontFamily = e.target.value;
        const textInput = document.getElementById('glyph-text-input');
        if (textInput) textInput.style.fontFamily = this.config.fontFamily;
        this.updateBinarizedMatrix();
      });
    }

    // Font upload handler (.ttf / .otf / .woff / .woff2) with strict security & crash prevention
    const fontFileInput = document.getElementById('glyph-font-file-input');
    if (fontFileInput) {
      fontFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const notify = (msg, type = 'danger') => {
          if (typeof window.notifyUserError === 'function' && type === 'danger') {
            const cat = (window.ITMS && window.ITMS.ErrorCategory) ? window.ITMS.ErrorCategory.FONT : 'FONT';
            window.notifyUserError(cat, msg, {
              title: 'Font Validation Alert',
              resolution: 'Please ensure you upload a standard, valid TrueType (.ttf), OpenType (.otf), or WOFF font file.'
            });
          } else if (typeof window.notifyUserWarning === 'function' && type === 'warning') {
            window.notifyUserWarning(msg, 'Font Notice');
          } else if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
          } else {
            alert(msg);
          }
        };

        // 1. Extension Check & Suspicious Executable Rejection
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const ALLOWED_EXT = ['.ttf', '.otf', '.woff', '.woff2', '.bdf'];
        const REJECT_EXT = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.js', '.scr', '.msi', '.php', '.py', '.ps1', '.html', '.htm'];

        if (REJECT_EXT.includes(ext) || !ALLOWED_EXT.includes(ext)) {
          notify(`Security Alert: Rejected unapproved or executable file extension (${file.name}). Allowed: .TTF, .OTF, .WOFF, .WOFF2`, 'danger');
          fontFileInput.value = '';
          return;
        }

        // 2. Size limit check (15MB max)
        if (file.size > 15 * 1024 * 1024) {
          notify(`Security Alert: Font file "${file.name}" exceeds 15MB size limit.`, 'danger');
          fontFileInput.value = '';
          return;
        }

        try {
          // 3. Read Binary ArrayBuffer
          const arrayBuffer = await file.arrayBuffer();

          // 4. Magic Byte & Executable Signature Verification
          if (!this.validateFontMagicBytes(arrayBuffer)) {
            notify(`Security Alert: Executable or invalid file signature detected in "${file.name}". Font upload rejected.`, 'danger');
            fontFileInput.value = '';
            return;
          }

          // 5. Deep Structural Parsing & Metadata Extraction
          const { familyName, glyphCount, format } = this.parseFontMetadata(arrayBuffer, file.name);
          const fontId = `font_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          const safeFamily = `CustomFont_${fontId}`;

          // 6. Safe Native FontFace Registration
          const registered = await this.registerFontFace(safeFamily, arrayBuffer);
          if (!registered) {
            notify(`Format Alert: Font file "${file.name}" contains corrupted or unsupported font outlines.`, 'danger');
            fontFileInput.value = '';
            return;
          }

          // 7. Persist to High-Capacity IndexedDB (Zero Base64 / LocalStorage Quota Consumption)
          const fontRecord = {
            id: fontId,
            name: familyName || file.name.replace(/\.[^/.]+$/, ''),
            family: safeFamily,
            format: format,
            buffer: arrayBuffer,
            size: file.size,
            glyphCount: glyphCount,
            timestamp: Date.now()
          };

          if (window.FontStorage) {
            await window.FontStorage.saveFont(fontRecord);
          }

          // Update in-memory state
          this.customFonts.push(fontRecord);
          this.config.fontFamily = `${safeFamily}, sans-serif`;

          // Synchronize UI and refresh matrix
          this.renderUI();
          this.updateBinarizedMatrix();

          // Broadcast to other components (Bitmap Creator, etc.)
          window.dispatchEvent(new CustomEvent('customFontsChanged', { detail: this.customFonts }));

          const sizeKb = (file.size / 1024).toFixed(1);
          const glyphInfo = glyphCount > 0 ? ` (${glyphCount} glyphs, ${sizeKb} KB)` : ` (${sizeKb} KB)`;
          notify(`Custom pixel font "${fontRecord.name}"${glyphInfo} verified and loaded successfully!`, 'success');

        } catch (err) {
          console.error('Font upload error:', err);
          notify(`Error processing font "${file.name}": ${err.message || 'Invalid font data'}`, 'danger');
        } finally {
          fontFileInput.value = '';
        }
      });
    }

    // Delete custom font chip buttons
    document.querySelectorAll('.btn-del-custom-font').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fontId = btn.dataset.fontId;
        if (fontId) {
          this.deleteCustomFont(fontId);
        }
      });
    });

    // Main input text
    let debounceTimer = null;
    const triggerDebouncedBinarize = (delay = 70) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.updateBinarizedMatrix();
      }, delay);
    };

    // Main input text (debounced for smooth typing)
    const textInput = document.getElementById('glyph-text-input');
    if (textInput) {
      textInput.addEventListener('input', (e) => {
        this.selectedChar = e.target.value || ' ';
        triggerDebouncedBinarize(60);
      });
    }

    // Matrix Height selector
    const heightSelect = document.getElementById('glyph-height-select');
    if (heightSelect) {
      heightSelect.addEventListener('change', (e) => {
        this.config.matrixHeight = parseInt(e.target.value, 10);
        this.updateBinarizedMatrix();
      });
    }

    // Matrix Width Sizing selector (Fixed Widths: 64, 96, 128, 192, 256, 384, 512)
    const widthSelect = document.getElementById('glyph-width-select');
    if (widthSelect) {
      widthSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.config.matrixWidthMode = val;
        this.config.matrixWidth = parseInt(val, 10);
        this.updateBinarizedMatrix();
      });
    }

    // Display Mode selector (Static, Scroll Left, Scroll Right, Blink)
    const scrollSelect = document.getElementById('glyph-scroll-mode');
    if (scrollSelect) {
      scrollSelect.addEventListener('change', (e) => {
        this.config.scrollMode = e.target.value;
        if (this.ledEng) {
          this.ledEng.config.scrollMode = e.target.value;
          this.ledEng.renderTextToMatrix(this.selectedChar || ' ');
          this.ledEng.startAnimation();
        }
      });
    }

    // Dot Style selector (Circle, Glow, Square)
    const styleSelect = document.getElementById('glyph-style-select');
    if (styleSelect) {
      styleSelect.addEventListener('change', (e) => {
        this.config.pixelStyle = e.target.value;
        if (this.ledEng) {
          this.ledEng.config.pixelStyle = e.target.value;
          this.ledEng.drawUIBoard();
        }
      });
    }

    // Position Sliders attached DIRECTLY to LED Canvas bounds inside solid black frame (Debounced)
    const offsetXSlider = document.getElementById('glyph-offset-x-slider');
    if (offsetXSlider) {
      offsetXSlider.addEventListener('input', (e) => {
        this.config.offsetX = parseInt(e.target.value, 10) || 0;
        const posBadge = document.getElementById('glyph-offset-pos-badge');
        if (posBadge) posBadge.textContent = `${this.config.offsetX},${this.config.offsetY}`;
        offsetXSlider.title = `Horizontal Position Offset X (${this.config.offsetX}px)`;
        triggerDebouncedBinarize(50);
      });
    }

    const offsetYSlider = document.getElementById('glyph-offset-y-slider');
    if (offsetYSlider) {
      offsetYSlider.addEventListener('input', (e) => {
        this.config.offsetY = parseInt(e.target.value, 10) || 0;
        const posBadge = document.getElementById('glyph-offset-pos-badge');
        if (posBadge) posBadge.textContent = `${this.config.offsetX},${this.config.offsetY}`;
        offsetYSlider.title = `Vertical Position Offset Y (${this.config.offsetY}px)`;
        triggerDebouncedBinarize(50);
      });
    }

    // Threshold slider (Debounced)
    const thresholdSlider = document.getElementById('glyph-threshold-slider');
    if (thresholdSlider) {
      thresholdSlider.addEventListener('input', (e) => {
        this.config.threshold = parseInt(e.target.value, 10);
        const valBadge = document.getElementById('glyph-threshold-val');
        if (valBadge) valBadge.textContent = this.config.threshold;
        triggerDebouncedBinarize(50);
      });
    }

    // Reset Threshold Button (Restores default 128)
    const resetThresholdBtn = document.getElementById('glyph-btn-reset-threshold');
    if (resetThresholdBtn) {
      resetThresholdBtn.addEventListener('click', () => {
        this.config.threshold = 128;
        const slider = document.getElementById('glyph-threshold-slider');
        if (slider) slider.value = 128;
        const valBadge = document.getElementById('glyph-threshold-val');
        if (valBadge) valBadge.textContent = 128;
        this.updateBinarizedMatrix();
      });
    }

    // LED Color Dot Buttons Palette (4 Colors matching Bitmap Creation Tab)
    document.querySelectorAll('.color-dot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-dot-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.config.ledColor = btn.dataset.color;
        if (this.ledEng) {
          this.ledEng.config.ledColor = btn.dataset.color;
          this.ledEng.drawUIBoard();
        }
        this.updateCodeOutputBox();
      });
    });

    // Invert Pixels Button
    const invertBtn = document.getElementById('glyph-btn-invert');
    if (invertBtn) {
      invertBtn.addEventListener('click', () => {
        this.invertMatrix();
      });
    }

    // Clear Matrix Button
    const clearBtn = document.getElementById('glyph-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearMatrix();
      });
    }

    this.bindPaletteChips();

    // Save button
    const saveBtn = document.getElementById('glyph-btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const saved = this.store.save({
          text: this.selectedChar,
          language: this.selectedLanguage,
          fontName: this.config.fontFamily,
          gridWidth: this.config.matrixWidth,
          gridHeight: this.config.matrixHeight,
          threshold: this.config.threshold,
          ledColor: this.config.ledColor,
          matrix: this.matrix
        });

        const countBadge = document.getElementById('glyph-saved-count-badge');
        const sidebarBadge = document.getElementById('sidebar-glyph-count-badge');
        const progressInner = document.getElementById('glyph-storage-bar-inner');
        if (countBadge) countBadge.textContent = this.store.glyphs.length;
        if (sidebarBadge) sidebarBadge.textContent = this.store.glyphs.length;
        if (progressInner) progressInner.style.width = `${Math.min(100, (this.store.glyphs.length / 50) * 100)}%`;

        this.renderSavedLibraryGrid();
        if (typeof window.showToast === 'function') {
          window.showToast(`Saved tuned glyph "${saved.text}" to ${saved.language.toUpperCase()} library!`, 'success');
        } else {
          alert(`Saved tuned glyph "${saved.text}" to ${saved.language.toUpperCase()} library!`);
        }
      });
    }

    // Multi-Format Data Output Select Dropdown (Unique Glyph-BMP ID)
    const formatSelect = document.getElementById('glyph-bmp-format-select');
    if (formatSelect) {
      formatSelect.addEventListener('change', (e) => {
        this.config.exportFormat = e.target.value;
        this.updateCodeOutputBox();
      });
    }

    // Copy Data Output Button (Unique Glyph-BMP ID)
    const copyOutputBtn = document.getElementById('glyph-bmp-btn-copy');
    if (copyOutputBtn) {
      copyOutputBtn.addEventListener('click', () => {
        const codeText = this.generateMultiFormatData(this.config.exportFormat);
        navigator.clipboard.writeText(codeText);
        if (typeof window.showToast === 'function') {
          window.showToast(`Hardware bitmap data (${this.config.exportFormat}) copied to clipboard!`, 'success');
        } else {
          alert('Hardware bitmap data copied to clipboard!');
        }
      });
    }

    // Save Header (.h) Download Button (Unique Glyph-BMP ID)
    const downloadHexBtn = document.getElementById('glyph-bmp-btn-download');
    if (downloadHexBtn) {
      downloadHexBtn.addEventListener('click', () => {
        const fmt = this.config.exportFormat || 'C-ARRAY';
        const codeText = this.generateMultiFormatData(fmt);
        const text = (this.selectedChar || 'glyph').replace(/[^a-zA-Z0-9]/g, '_') || 'glyph';
        const extMap = {
          'C-ARRAY': '.h',
          'CSHARP': '.cs',
          'JSON': '.json',
          'PYTHON': '.py',
          'RAW-HEX': '.hex',
          'HEX-PLAIN': '.txt',
          'BINARY': '.txt',
          'BIN-ARRAY': '.txt',
          'BASE64': '.txt'
        };
        const ext = extMap[fmt] || '.txt';
        const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `glyph_${text}_${this.config.matrixWidth}x${this.config.matrixHeight}${ext}`;
        a.click();
        if (typeof window.showToast === 'function') {
          window.showToast(`Bitmap data file (${fmt}) downloaded!`, 'success');
        }
      });
    }

    // Undo / Redo Toolbar Buttons
    const undoBtn = document.getElementById('glyph-btn-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undo());
    }

    const redoBtn = document.getElementById('glyph-btn-redo');
    if (redoBtn) {
      redoBtn.addEventListener('click', () => this.redo());
    }

    // Keyboard Shortcuts (Arrows to Move, Space to Toggle, Shift+Arrows to Pan, I to Invert, Ctrl+Z/Y for Undo/Redo)
    if (!this.hasKeyListeners) {
      this.hasKeyListeners = true;
      window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        const tag = (activeEl && activeEl.tagName) || '';
        // Skip if user is actively typing in text input or textarea
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return;
        }

        // Check if languages view is currently active or visible
        const langView = document.getElementById('view-languages');
        if (langView && !langView.classList.contains('active')) {
          return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;
        if (isCtrl && !e.altKey) {
          if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
          } else if ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
            e.preventDefault();
            this.redo();
            return;
          }
        }

        // Shift + Arrow Keys: Pan / Shift Entire Glyph Matrix by 1px
        if (e.shiftKey && !isCtrl && !e.altKey) {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.shiftMatrix(-1, 0);
            return;
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.shiftMatrix(1, 0);
            return;
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.shiftMatrix(0, -1);
            return;
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.shiftMatrix(0, 1);
            return;
          }
        }

        // Regular Arrow Keys: Move Active Pixel Cursor
        if (!e.shiftKey && !isCtrl && !e.altKey) {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.movePixelCursor(-1, 0);
            return;
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.movePixelCursor(1, 0);
            return;
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.movePixelCursor(0, -1);
            return;
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.movePixelCursor(0, 1);
            return;
          } else if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            this.toggleCurrentCursorDot();
            return;
          } else if (e.key === 'i' || e.key === 'I') {
            e.preventDefault();
            this.invertMatrix();
            return;
          }
        }
      });
    }
  }

  updateBinarizedMatrix() {
    const text = (this.selectedChar || '').trim() || ' ';
    const h = parseInt(this.config.matrixHeight || 64, 10);
    const w = parseInt(this.config.matrixWidthMode || this.config.matrixWidth || 256, 10);
    this.config.matrixHeight = h;
    this.config.matrixWidth = w;

    if (!this.ledEng && document.getElementById('glyph-dot-canvas')) {
      this.ledEng = new LEDEngine('glyph-dot-canvas');
      this.ledEng.onMatrixChange = () => {
        this.matrix = this.ledEng.matrix;
        this.updateCodeOutputBox();
      };
      this.ledEng.onUndoRedoChange = () => {
        this.updateUndoRedoButtons();
      };
    }

    if (this.ledEng) {
      this.ledEng.config.text = text;
      this.ledEng.config.fontFamily = this.config.fontFamily || 'auto';
      this.ledEng.config.matrixHeight = h;
      this.ledEng.config.matrixWidth = w;
      this.ledEng.config.scrollMode = this.config.scrollMode || 'static';
      this.ledEng.config.pixelStyle = this.config.pixelStyle || 'circle';
      this.ledEng.config.threshold = this.config.threshold || 128;
      this.ledEng.config.offsetX = this.config.offsetX || 0;
      this.ledEng.config.offsetY = this.config.offsetY || 0;
      this.ledEng.config.ledColor = this.config.ledColor || '#ff2a2a';
      this.ledEng.config.bold = true;
      this.ledEng.config.fontSize = Math.floor(h * 0.85);
      this.ledEng.config.isInteractive = true;

      this.ledEng.renderTextToMatrix(text);
      this.matrix = this.ledEng.matrix;
      this.fullMatrix = this.ledEng.fullMatrix;
      this.ledEng.startAnimation();
    }

    const dimsBadge = document.getElementById('glyph-matrix-dims-badge');
    if (dimsBadge) {
      dimsBadge.textContent = `${w} x ${h}`;
    }

    this.updateCodeOutputBox();
    this.updateUndoRedoButtons();
  }

  invertMatrix() {
    if (this.ledEng) {
      this.ledEng.invertMatrix();
      this.matrix = this.ledEng.matrix;
      this.updateCodeOutputBox();
      if (typeof window.showToast === 'function') {
        window.showToast('Pixel matrix inverted', 'info');
      }
    }
  }

  clearMatrix() {
    if (this.ledEng) {
      this.ledEng.clearMatrix();
      this.matrix = this.ledEng.matrix;
      this.updateCodeOutputBox();
      if (typeof window.showToast === 'function') {
        window.showToast('Canvas cleared', 'info');
      }
    }
  }

  undo() {
    if (this.ledEng) {
      this.ledEng.undo();
      this.matrix = this.ledEng.matrix;
      this.updateCodeOutputBox();
      this.updateUndoRedoButtons();
    }
  }

  redo() {
    if (this.ledEng) {
      this.ledEng.redo();
      this.matrix = this.ledEng.matrix;
      this.updateCodeOutputBox();
      this.updateUndoRedoButtons();
    }
  }

  updateUndoRedoButtons() {
    const undoBtn = document.getElementById('glyph-btn-undo');
    const redoBtn = document.getElementById('glyph-btn-redo');
    const canUndo = this.ledEng && this.ledEng.undoStack && this.ledEng.undoStack.length > 0;
    const canRedo = this.ledEng && this.ledEng.redoStack && this.ledEng.redoStack.length > 0;
    if (undoBtn) {
      undoBtn.style.opacity = canUndo ? '1' : '0.4';
      undoBtn.style.pointerEvents = canUndo ? 'auto' : 'none';
      undoBtn.title = canUndo ? `Undo Pixel Edit (Ctrl+Z) - ${this.ledEng.undoStack.length} step(s)` : 'Undo Pixel Edit (Ctrl+Z)';
    }
    if (redoBtn) {
      redoBtn.style.opacity = canRedo ? '1' : '0.4';
      redoBtn.style.pointerEvents = canRedo ? 'auto' : 'none';
      redoBtn.title = canRedo ? `Redo Pixel Edit (Ctrl+Y) - ${this.ledEng.redoStack.length} step(s)` : 'Redo Pixel Edit (Ctrl+Y)';
    }
  }

  startAnimation() {
    if (this.ledEng) {
      this.ledEng.startAnimation();
    }
  }

  stopAnimation() {
    if (this.ledEng) {
      this.ledEng.stopAnimation();
    }
  }

  drawInteractiveDotCanvas() {
    if (this.ledEng) {
      this.ledEng.drawUIBoard();
    }
  }

  downloadPNG(filename = 'LED_glyph_preview.png') {
    if (this.ledEng) {
      this.ledEng.downloadPNG(filename);
    }
  }

  updateCodeOutputBox() {
    const outputBox = document.getElementById('glyph-bmp-code-output');
    if (!outputBox) return;
    const fmt = this.config.exportFormat || 'C-ARRAY';
    const codeText = this.generateMultiFormatData(fmt);
    outputBox.textContent = codeText;
    if (outputBox.tagName === 'TEXTAREA' || outputBox.tagName === 'INPUT') {
      outputBox.value = codeText;
    }
  }

  generateMultiFormatData(format = 'C-ARRAY') {
    if (this.ledEng) {
      return this.ledEng.getHexString(format);
    }
    return '';
  }

  renderSavedLibraryGrid(langFilter = this.activeLibraryLangFilter || 'all') {
    this.activeLibraryLangFilter = langFilter;
    const filter = (langFilter || 'all').trim().toLowerCase();

    const libFilterSelect = document.getElementById('glyph-lib-lang-filter');
    if (libFilterSelect && libFilterSelect.value !== filter) {
      libFilterSelect.value = filter;
    }

    const allGlyphs = this.store.glyphs || [];
    const countBadge = document.getElementById('glyph-saved-count-badge');
    const sidebarBadge = document.getElementById('sidebar-glyph-count-badge');
    const topTabBadge = document.getElementById('top-tab-glyph-count-badge');
    const barInner = document.getElementById('glyph-storage-bar-inner');
    if (countBadge) countBadge.textContent = allGlyphs.length;
    if (sidebarBadge) sidebarBadge.textContent = allGlyphs.length;
    if (topTabBadge) topTabBadge.textContent = allGlyphs.length;
    if (barInner) barInner.style.width = `${Math.min(100, (allGlyphs.length / 50) * 100)}%`;

    const savedGrid = document.getElementById('glyph-saved-grid');
    if (!savedGrid) return;

    let items = allGlyphs;
    if (filter !== 'all') {
      items = items.filter(g => (g.language || '').trim().toLowerCase() === filter);
    }

    if (items.length === 0) {
      const filterLabel = filter.charAt(0).toUpperCase() + filter.slice(1);
      savedGrid.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted, #6b7086); font-size:13px; text-align:center; padding:32px 0;">No custom tuned glyphs stored for <strong>${filterLabel}</strong> language.</div>`;
      return;
    }

    savedGrid.innerHTML = items.map((item, idx) => {
      const preset = LanguagePresets[item.language] || LanguagePresets.english;
      const fontFamily = item.fontName || preset.fontFamily;
      const fontDisplayName = fontFamily.split(',')[0].replace(/'/g, '').trim();

      return `
      <div class="glyph-card" style="background:#ffffff; border:1px solid var(--border-color, #e7e9f0); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:10px; box-shadow:0 2px 6px rgba(0,0,0,0.03);">
        <div class="glyph-card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <span class="glyph-lang-badge badge-${item.language}" style="font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; text-transform:uppercase;">${item.language}</span>
          <span class="glyph-size-badge" style="font-size:11px; color:var(--text-muted, #6b7086); font-weight:600;">${item.gridWidth || 256}×${item.gridHeight || 64}</span>
        </div>
        <div class="glyph-card-preview" style="background:#000000; border-radius:6px; padding:6px; display:flex; justify-content:center; align-items:center; min-height:60px; border:1px solid #1e293b; box-shadow:inset 0 1px 4px rgba(0,0,0,0.6);">
          <canvas id="saved-glyph-canvas-${idx}" style="max-width:100%; height:auto; display:block; border-radius:3px; image-rendering:pixelated;"></canvas>
        </div>
        <div class="glyph-card-body" style="text-align:center;">
          <p class="glyph-card-text" style="margin:0; font-size:16px; font-weight:700; color:var(--text-main, #14151f); font-family: ${fontFamily};">${item.text}</p>
          <span class="glyph-card-font" style="font-size:11px; color:var(--text-muted, #6b7086); display:block; margin-top:2px;" title="Font: ${fontDisplayName}">${fontDisplayName} • ${item.dateStr || 'Saved'}</span>
        </div>
        <div class="glyph-card-actions" style="display:flex; gap:6px; margin-top:4px;">
          <button type="button" class="btn btn-sm btn-primary glyph-load-saved-btn" data-id="${item.id}" data-text="${(item.text || '').replace(/"/g, '&quot;')}" data-lang="${item.language}" data-font="${fontFamily}" style="flex:1; font-size:11px; padding:5px 8px; font-weight:600;">Load Bitmap</button>
          <button type="button" class="btn btn-sm btn-danger glyph-del-btn" data-id="${item.id}" style="font-size:11px; padding:5px 8px; font-weight:600;">Delete</button>
        </div>
      </div>
    `;
    }).join('');

    let cardIdx = 0;
    const processCardBatch = () => {
      const limit = Math.min(cardIdx + 4, items.length);
      for (; cardIdx < limit; cardIdx++) {
        const item = items[cardIdx];
        const cardCanvas = document.getElementById(`saved-glyph-canvas-${cardIdx}`);
        if (cardCanvas) {
          this.renderSavedGlyphCard(cardCanvas, item);
        }
      }
      if (cardIdx < items.length) {
        requestAnimationFrame(processCardBatch);
      }
    };
    requestAnimationFrame(processCardBatch);

    savedGrid.querySelectorAll('.glyph-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.store.delete(btn.dataset.id);
        this.renderSavedLibraryGrid(langFilter);
      });
    });

    savedGrid.querySelectorAll('.glyph-load-saved-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(g => String(g.id) === String(btn.dataset.id)) || items.find(g => g.text === btn.dataset.text);
        this.selectedChar = btn.dataset.text || '';
        if (btn.dataset.lang && LanguagePresets[btn.dataset.lang]) {
          this.selectedLanguage = btn.dataset.lang;
        }
        if (btn.dataset.font) {
          this.config.fontFamily = btn.dataset.font;
        } else if (this.selectedLanguage && LanguagePresets[this.selectedLanguage]) {
          this.config.fontFamily = LanguagePresets[this.selectedLanguage].fontFamily;
        }

        const inputEl = document.getElementById('glyph-text-input');
        if (inputEl) {
          inputEl.value = this.selectedChar;
          inputEl.style.fontFamily = this.config.fontFamily;
        }
        const langSel = document.getElementById('glyph-lang-select');
        if (langSel) langSel.value = this.selectedLanguage;

        const fontSel = document.getElementById('glyph-font-select');
        if (fontSel) fontSel.value = this.config.fontFamily;

        this.switchSubTab('studio');
        if (item && item.matrix && Array.isArray(item.matrix) && item.matrix.length > 0) {
          this.matrix = JSON.parse(JSON.stringify(item.matrix));
          this.config.matrixHeight = item.matrix.length;
          this.config.matrixWidth = item.matrix[0].length;
          const dimsBadge = document.getElementById('glyph-matrix-dims-badge');
          if (dimsBadge) dimsBadge.textContent = `${this.config.matrixWidth} x ${this.config.matrixHeight}`;
          this.drawInteractiveDotCanvas();
          this.updateCodeOutputBox();
        } else {
          this.updateBinarizedMatrix();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  renderSavedGlyphCard(canvas, item) {
    if (!canvas || !item) return;

    let matrix = item.matrix;
    const targetH = parseInt(item.gridHeight, 10) || 64;
    const targetW = parseInt(item.gridWidth, 10) || 256;
    const ledColor = item.ledColor || '#ff2a2a';

    // If matrix is missing, generate fallback matrix from text
    if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
      const preset = LanguagePresets[item.language] || LanguagePresets.english;
      const fontFamily = item.fontName || preset.fontFamily;
      matrix = this.generateFallbackMatrixForCard(item.text, fontFamily, targetH, targetW);
    }

    if (!matrix || matrix.length === 0) return;

    const rows = matrix.length;
    const cols = matrix[0]?.length || targetW;
    if (cols === 0) return;

    // Pitch: 2px per LED dot provides exact 1:1 hardware matrix rendering
    const pitch = 2;
    const radius = 0.75;
    const offRadius = 0.50;

    canvas.width = cols * pitch;
    canvas.height = rows * pitch;
    const ctx = canvas.getContext('2d');

    // Fill dark bezel background
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Pass 1: Inactive Background Wells (All dots in the matrix)
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    const pi2 = Math.PI * 2;
    for (let r = 0; r < rows; r++) {
      const cy = r * pitch + pitch / 2;
      for (let c = 0; c < cols; c++) {
        const cx = c * pitch + pitch / 2;
        ctx.moveTo(cx + offRadius, cy);
        ctx.arc(cx, cy, offRadius, 0, pi2);
      }
    }
    ctx.fill();

    // Pass 2: Illuminated Active LED Dots
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = 2.5;
    ctx.beginPath();
    let hasLit = false;
    for (let r = 0; r < rows; r++) {
      if (!matrix[r]) continue;
      const cy = r * pitch + pitch / 2;
      for (let c = 0; c < cols; c++) {
        if (matrix[r][c] === 1) {
          hasLit = true;
          const cx = c * pitch + pitch / 2;
          ctx.moveTo(cx + radius, cy);
          ctx.arc(cx, cy, radius, 0, pi2);
        }
      }
    }
    if (hasLit) {
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  generateFallbackMatrixForCard(text, fontFamily, targetH = 64, targetW = 256) {
    if (!text) return [];
    const oversample = 2;
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');
    const cleanFont = (fontFamily || 'sans-serif').replace(/'/g, '').trim();
    const isIndic = /[\u0900-\u0DFF]/.test(text);
    let fontSize = isIndic ? Math.round(targetH * oversample * 0.74) : Math.round(targetH * oversample * 0.70);
    offCtx.font = `bold ${fontSize}px ${cleanFont}`;

    const renderW = targetW * oversample;
    const renderH = targetH * oversample;
    offCanvas.width = renderW;
    offCanvas.height = renderH;

    // Optical measurement and auto-fit scaling for both width and height bounds
    let metrics = offCtx.measureText(text);
    let textW = Math.ceil(metrics.width);
    let ascent = metrics.actualBoundingBoxAscent || (fontSize * 0.75);
    let descent = metrics.actualBoundingBoxDescent || (fontSize * 0.25);
    let visualHeight = ascent + descent;

    const maxAllowedWidth = renderW - (16 * oversample);
    const maxAllowedHeight = renderH - (8 * oversample);

    let scaleW = textW > maxAllowedWidth && textW > 0 ? (maxAllowedWidth / textW) : 1;
    let scaleH = visualHeight > maxAllowedHeight && visualHeight > 0 ? (maxAllowedHeight / visualHeight) : 1;
    let scaleFactor = Math.min(scaleW, scaleH);

    if (scaleFactor < 1) {
      fontSize = Math.max(Math.round(targetH * oversample * 0.30), Math.floor(fontSize * scaleFactor));
      offCtx.font = `bold ${fontSize}px ${cleanFont}`;
      metrics = offCtx.measureText(text);
      ascent = metrics.actualBoundingBoxAscent || (fontSize * 0.75);
      descent = metrics.actualBoundingBoxDescent || (fontSize * 0.25);
    }

    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, renderW, renderH);
    offCtx.fillStyle = '#000000';
    offCtx.font = `bold ${fontSize}px ${cleanFont}`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'alphabetic';

    const opticalCenterY = (renderH / 2) + ((ascent - descent) / 2);
    offCtx.fillText(text, renderW / 2, opticalCenterY);
    const imgData = offCtx.getImageData(0, 0, renderW, renderH);
    const pixels = imgData.data;
    const cols = targetW;
    const rows = targetH;
    const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let blackPixels = 0;
        let totalPixels = 0;
        for (let subR = 0; subR < oversample; subR++) {
          for (let subC = 0; subC < oversample; subC++) {
            const pxY = (r * oversample) + subR;
            const pxX = (c * oversample) + subC;
            if (pxX < renderW && pxY < renderH) {
              const idx = (pxY * renderW + pxX) * 4;
              const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
              if (lum < 170) blackPixels++;
              totalPixels++;
            }
          }
        }
        if (totalPixels > 0 && (blackPixels / totalPixels) >= 0.15) {
          matrix[r][c] = 1;
        }
      }
    }
    return this.centerMatrixContent(matrix, rows, cols, 0, 0);
  }

  /**
   * Exports all saved glyphs for unified database backup
   * @returns {SavedGlyph[]}
   */
  exportGlyphsData() {
    return this.store ? this.store.getAllGlyphs() : [];
  }

  /**
   * Imports saved glyphs array from backup payload
   * @param {any[]} glyphsArray
   * @param {boolean} append
   * @returns {number}
   */
  importGlyphsData(glyphsArray, append = true) {
    if (!this.store) return 0;
    const count = this.store.importGlyphs(glyphsArray, append);
    this.updateBadges();
    if (this.activeSubTab === 'library') {
      this.renderSavedLibraryGrid(this.activeLibraryLangFilter);
    }
    return count;
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.LanguagePresets = LanguagePresets;
  window.ITMS.GlyphStore = GlyphStore;
  window.ITMS.GlyphManager = GlyphManager;
  window.LanguagePresets = LanguagePresets;
  window.GlyphStore = GlyphStore;
  window.GlyphManager = GlyphManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LanguagePresets, GlyphStore, GlyphManager };
}


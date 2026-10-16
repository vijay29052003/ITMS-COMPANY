/**
 * @file state-manager.js
 * @description Centralized Reactive State Management Store & Engine Registry for ITMS LED Suite.
 * @module StateManager
 */

(function () {
  'use strict';

  const PREF_STORAGE_KEY = 'itms_user_preferences_v2';

  class ITMSStateManager {
    constructor() {
      // Default Initial Application State Tree
      this._state = {
        app: {
          activeView: 'dashboard',
          activeSubTab: 'studio',
          theme: 'light',
          sidebarCollapsed: false,
          mobileSidebarOpen: false,
          isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
          pwaRegistered: false,
          systemStatus: 'ONLINE'
        },
        route: {
          activeRouteId: 'ALL',
          activeRegionalLang: 'te', // 'te' (Telugu) | 'hi' (Hindi)
          searchQuery: '',
          currentPage: 1,
          pageSize: 15,
          selectedRouteIds: [],
          drawerRouteId: null,
          bulkSelectMode: false
        },
        led: {
          text: '',
          fontFamily: 'auto',
          matrixWidth: 128,
          matrixHeight: 16,
          ledColor: '#ff2a2a',
          offColor: '#101726',
          pixelStyle: 'circle',
          fontSize: 14,
          scrollMode: 'static',
          scrollSpeed: 28,
          bold: true,
          threshold: 128,
          offsetX: 0,
          offsetY: 0,
          isInteractive: true,
          lineSplitRatio: 0.60,
          displayMode: 'auto-cycle'
        },
        glyph: {
          activeSubTab: 'studio',
          selectedLanguage: 'telugu',
          selectedChar: 'ఆ',
          fontFamily: 'Noto Sans Telugu',
          matrixWidthMode: '256',
          matrixWidth: 256,
          matrixHeight: 64,
          threshold: 128,
          contrast: 1.0,
          offsetX: 0,
          offsetY: 0,
          activeGlyphId: null,
          drawMode: 'pen', // 'pen' | 'eraser'
          searchQuery: '',
          libraryFilterLang: 'ALL'
        },
        export: {
          selectedRouteId: 'ALL',
          selectedLanguages: ['en', 'te'],
          packageVersion: '2.0.0',
          matrixHeight: 64,
          matrixWidth: 256,
          includePreviews: true,
          compressionLevel: 1,
          isExporting: false,
          exportProgress: { percent: 0, message: '', processed: 0, total: 0 }
        },
        hardware: {
          serialConnected: false,
          portName: '',
          baudRate: 115200,
          isFlashing: false,
          flashProgress: 0
        }
      };

      /** @type {Map<string, Set<Function>>} Subscribers map keyed by state path */
      this._subscribers = new Map();

      /** @type {Object<string, any>} Central Registry for Engine Singletons */
      this.engines = {
        routeManager: null,
        ledEngine: null,
        dashMarqueeEngine: null,
        glyphManager: null,
        exporter: null,
        translitEngine: null,
        serialFlasher: null,
        fontDB: null
      };

      // Load saved preferences from storage
      this._loadSavedPreferences();

      // Listen for browser online/offline changes
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          this.set('app.isOffline', false);
          this.set('app.systemStatus', 'ONLINE');
          if (typeof window.notifyUserSuccess === 'function') {
            window.notifyUserSuccess('Internet connection restored. Fleet cloud sync ready.', 'Network Online');
          }
        });
        window.addEventListener('offline', () => {
          this.set('app.isOffline', true);
          this.set('app.systemStatus', 'OFFLINE');
          if (typeof window.notifyUserWarning === 'function') {
            window.notifyUserWarning('Offline mode active. All route data and glyph tools are operating locally.', 'Offline Mode');
          }
        });
      }
    }

    /**
     * Safely reads a value from the state tree given a dot-separated path (e.g. "led.ledColor").
     * @param {string} [path] 
     * @param {*} [defaultValue=undefined] 
     * @returns {*}
     */
    get(path, defaultValue = undefined) {
      if (!path) return JSON.parse(JSON.stringify(this._state));
      const parts = path.split('.');
      let curr = this._state;
      for (let i = 0; i < parts.length; i++) {
        if (curr === null || curr === undefined || typeof curr !== 'object') {
          return defaultValue;
        }
        curr = curr[parts[i]];
      }
      return curr !== undefined ? curr : defaultValue;
    }

    /**
     * Updates a specific value in the state tree and triggers registered listeners.
     * @param {string} path Dot-separated state path (e.g., "led.ledColor")
     * @param {*} value New value to set
     * @param {Object} [options={}] Options flag ({ silent: false, persist: true })
     * @returns {boolean} True if value changed
     */
    set(path, value, options = {}) {
      if (!path) return false;
      const parts = path.split('.');
      let curr = this._state;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!(key in curr) || typeof curr[key] !== 'object' || curr[key] === null) {
          curr[key] = {};
        }
        curr = curr[key];
      }

      const finalKey = parts[parts.length - 1];
      const oldValue = curr[finalKey];

      // Check strict equality to prevent redundant re-renders
      if (oldValue === value && (typeof value !== 'object' || value === null)) {
        return false;
      }

      curr[finalKey] = value;

      // Auto-persist user preference settings
      if (options.persist !== false) {
        this._autoPersistPreference(path, value);
      }

      if (!options.silent) {
        this._notifySubscribers(path, value, oldValue);
      }

      return true;
    }

    /**
     * Updates multiple properties inside a specific state domain (e.g. "led", { ledColor: '#00ff00', matrixWidth: 512 }).
     * @param {string} domain Domain key ('app'|'route'|'led'|'glyph'|'export'|'hardware')
     * @param {Object} updates Key-value updates
     * @param {Object} [options={}]
     */
    update(domain, updates, options = {}) {
      if (!domain || !updates || typeof updates !== 'object') return;
      Object.keys(updates).forEach(key => {
        this.set(`${domain}.${key}`, updates[key], options);
      });
    }

    /**
     * Subscribes a listener callback to changes on a specific state path or '*' for all changes.
     * @param {string} path Path to listen to (e.g. "led.ledColor" or "*")
     * @param {Function} callback Function(newValue, oldValue, path)
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
      if (typeof callback !== 'function') return () => {};
      if (!this._subscribers.has(path)) {
        this._subscribers.set(path, new Set());
      }
      this._subscribers.get(path).add(callback);

      return () => this.unsubscribe(path, callback);
    }

    /**
     * Unsubscribes a listener callback.
     * @param {string} path 
     * @param {Function} callback 
     */
    unsubscribe(path, callback) {
      if (this._subscribers.has(path)) {
        this._subscribers.get(path).delete(callback);
      }
    }

    /**
     * Registers an engine singleton instance into the central registry.
     * @param {string} name Engine name ('routeManager'|'ledEngine'|'glyphManager'|etc.)
     * @param {any} instance Engine instance reference
     */
    registerEngine(name, instance) {
      if (!name) return;
      this.engines[name] = instance;
      if (typeof window !== 'undefined') {
        window.ITMS = window.ITMS || {};
        window.ITMS.engines = this.engines;
      }
    }

    /**
     * Retrieves a registered engine instance.
     * @param {string} name 
     * @returns {any}
     */
    getEngine(name) {
      return this.engines[name] || null;
    }

    /**
     * Returns a snapshot clone of the complete state tree.
     * @returns {Object}
     */
    getState() {
      return JSON.parse(JSON.stringify(this._state));
    }

    // =========================================================================
    // HIGH-LEVEL ACTION HELPERS
    // =========================================================================

    /**
     * Switches the active application view (e.g., 'dashboard', 'routes', 'bitmap', 'languages', 'export')
     * @param {string} view 
     * @param {string} [subtab]
     */
    switchView(view, subtab = null) {
      const validViews = ['dashboard', 'routes', 'bitmap', 'languages', 'export'];
      if (!validViews.includes(view)) return;
      
      this.set('app.activeView', view);
      if (subtab) {
        this.set('app.activeSubTab', subtab);
        if (view === 'languages') {
          this.set('glyph.activeSubTab', subtab);
        }
      }
    }

    /**
     * Sets the active selected bus route ID and syncs across engines.
     * @param {string|null} routeId 
     */
    setActiveRoute(routeId) {
      this.set('route.activeRouteId', routeId);
    }

    /**
     * Sets the active regional language ('te' | 'hi')
     * @param {'te'|'hi'} lang 
     */
    setRegionalLanguage(lang) {
      if (lang === 'te' || lang === 'hi') {
        this.set('route.activeRegionalLang', lang);
      }
    }

    /**
     * Updates LED engine settings in central state and synchronizes.
     * @param {Object} partialLedConfig 
     */
    setLedConfig(partialLedConfig) {
      this.update('led', partialLedConfig);
    }

    /**
     * Updates Export settings in central state.
     * @param {Object} partialExportConfig 
     */
    setExportConfig(partialExportConfig) {
      this.update('export', partialExportConfig);
    }

    /**
     * Two-way binds a DOM element (input, select, checkbox) to a state path.
     * @param {string|HTMLElement} el 
     * @param {string} statePath 
     * @param {string} [eventName='change'] 
     * @param {Function} [transform=null] 
     * @returns {Function} Unbind function
     */
    bindElement(el, statePath, eventName = 'change', transform = null) {
      if (typeof document === 'undefined') return () => {};
      const targetEl = typeof el === 'string' ? document.getElementById(el) : el;
      if (!targetEl) return () => {};

      // 1. Initial State -> Element sync
      const initVal = this.get(statePath);
      if (initVal !== undefined) {
        if (targetEl.type === 'checkbox') {
          targetEl.checked = !!initVal;
        } else {
          targetEl.value = initVal;
        }
      }

      // 2. Element -> State sync
      const handleInput = () => {
        let val = targetEl.type === 'checkbox' ? targetEl.checked : targetEl.value;
        if (typeof transform === 'function') val = transform(val);
        this.set(statePath, val);
      };
      targetEl.addEventListener(eventName, handleInput);

      // 3. State -> Element subscription
      const unsub = this.subscribe(statePath, (newVal) => {
        if (targetEl.type === 'checkbox') {
          targetEl.checked = !!newVal;
        } else if (targetEl.value !== String(newVal)) {
          targetEl.value = newVal !== null && newVal !== undefined ? newVal : '';
        }
      });

      return () => {
        targetEl.removeEventListener(eventName, handleInput);
        unsub();
      };
    }

    /**
     * Notifies all path-specific and wildcard subscribers.
     * @private
     */
    _notifySubscribers(path, newValue, oldValue) {
      // 1. Notify exact path subscribers
      if (this._subscribers.has(path)) {
        this._subscribers.get(path).forEach(cb => {
          try { cb(newValue, oldValue, path); } catch (e) { console.error(`[StateManager] Callback error on ${path}:`, e); }
        });
      }

      // 2. Notify domain parent subscribers (e.g., subscribing to "led" receives updates for "led.ledColor")
      const parts = path.split('.');
      if (parts.length > 1) {
        const domain = parts[0];
        if (this._subscribers.has(domain)) {
          const domainVal = this.get(domain);
          this._subscribers.get(domain).forEach(cb => {
            try { cb(domainVal, oldValue, path); } catch (e) { console.error(`[StateManager] Domain callback error on ${domain}:`, e); }
          });
        }
      }

      // 3. Notify wildcard '*' subscribers
      if (this._subscribers.has('*')) {
        this._subscribers.get('*').forEach(cb => {
          try { cb(newValue, oldValue, path); } catch (e) { console.error(`[StateManager] Wildcard callback error:`, e); }
        });
      }
    }

    /**
     * Loads persisted user settings from ITMSStorage / localStorage.
     * @private
     */
    _loadSavedPreferences() {
      try {
        const storage = (typeof window !== 'undefined' && window.ITMSStorage)
          ? window.ITMSStorage
          : (typeof window !== 'undefined' ? window.localStorage : null);

        if (!storage) return;
        const raw = storage.getItem(PREF_STORAGE_KEY);
        if (raw) {
          const prefs = JSON.parse(raw);
          if (prefs && typeof prefs === 'object') {
            if (prefs.led) Object.assign(this._state.led, prefs.led);
            if (prefs.export) Object.assign(this._state.export, prefs.export);
            if (prefs.route && prefs.route.activeRegionalLang) {
              this._state.route.activeRegionalLang = prefs.route.activeRegionalLang;
            }
          }
        }
      } catch (e) {
        console.warn('[StateManager] Preference load notice:', e);
      }
    }

    /**
     * Auto-saves key preferences to persistent storage when updated.
     * @private
     */
    _autoPersistPreference(path, value) {
      const persistantPaths = [
        'led.ledColor', 'led.matrixWidth', 'led.matrixHeight',
        'led.displayMode', 'led.lineSplitRatio', 'led.pixelStyle',
        'export.selectedLanguages', 'export.includePreviews', 'export.matrixWidth', 'export.matrixHeight',
        'route.activeRegionalLang'
      ];

      if (persistantPaths.includes(path)) {
        try {
          const storage = (typeof window !== 'undefined' && window.ITMSStorage)
            ? window.ITMSStorage
            : (typeof window !== 'undefined' ? window.localStorage : null);

          if (!storage) return;
          const prefs = {
            led: {
              ledColor: this._state.led.ledColor,
              matrixWidth: this._state.led.matrixWidth,
              matrixHeight: this._state.led.matrixHeight,
              displayMode: this._state.led.displayMode,
              lineSplitRatio: this._state.led.lineSplitRatio,
              pixelStyle: this._state.led.pixelStyle
            },
            export: {
              selectedLanguages: this._state.export.selectedLanguages,
              includePreviews: this._state.export.includePreviews,
              matrixWidth: this._state.export.matrixWidth,
              matrixHeight: this._state.export.matrixHeight
            },
            route: {
              activeRegionalLang: this._state.route.activeRegionalLang
            }
          };
          storage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
        } catch (_) {}
      }
    }
  }

  // Create Singleton Instance
  const StateInstance = new ITMSStateManager();

  // Export to Global & ITMS Namespace
  if (typeof window !== 'undefined') {
    window.ITMS = window.ITMS || {};
    window.ITMS.State = StateInstance;
    window.ITMS.Store = StateInstance;
    window.ITMSStateManager = ITMSStateManager;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ITMSStateManager, StateInstance };
  }
})();

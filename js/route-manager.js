/**
 * @typedef {import('./types.d.ts').BusRoute} BusRoute
 * @typedef {import('./types.d.ts').RouteStop} RouteStop
 */

/**
 * Manages bus route data, stop sequences, and high-capacity IndexedDB persistence.
 */
class RouteManager {
  constructor() {
    const cfg = (typeof window !== 'undefined' && window.ITMS_CONFIG && window.ITMS_CONFIG.DATABASE) || {};
    /** @type {string} */
    this.storageKey = cfg.STORAGE_KEY || 'itms_routes_database_v2';
    /** @type {string} */
    this.dbName = cfg.ROUTE_DB_NAME || 'ITMS_Route_DB_v4';
    /** @type {number} */
    this.dbVersion = cfg.DB_VERSION || 2;
    /** @type {string} */
    this.storeName = cfg.ROUTE_STORE_NAME || 'routes';
    /** @type {string} */
    this.backupStoreName = cfg.BACKUP_STORE_NAME || 'backups';
    /** @type {number} */
    this.idCounter = 0;

    /** @type {BusRoute[]} Initial synchronous data from localStorage or seed */
    this.routes = this.loadRoutesSync();
    /** @type {string|null} */
    this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
    /** @type {(() => void)|null} Callback fired when async storage finishes loading */
    this.onDataLoaded = null;

    // Initialize High-Capacity IndexedDB Database (Unlimited Storage & Auto-Backup Version History)
    this.initIndexedDB();
  }

  generateUniqueId(prefix = 'route') {
    this.idCounter++;
    return `${prefix}_${Date.now()}_${this.idCounter}_${Math.random().toString(36).substr(2, 7)}`;
  }

  getSeedRoutes() {
    return [
      {
        id: 'route_seed_320',
        code: '320',
        name: 'Charminar - Falaknuma',
        startPoint: { en: 'Charminar', te: 'చార్మినార్', hi: 'चारमीनार' },
        destination: { en: 'Falaknuma', te: 'ఫలక్‌నుమా', hi: 'फलकनुमा' },
        direction: 'UP',
        speed: 5,
        dwellTime: 2000,
        scrollMode: 'scroll-left',
        stops: [
          { id: 'stop_320_1', seq: 1, en: 'Charminar', te: 'చార్మినార్', hi: 'चारमीनार' },
          { id: 'stop_320_2', seq: 2, en: 'Shalibanda', te: 'శాలిబండ', hi: 'शालिबंडा' },
          { id: 'stop_320_3', seq: 3, en: 'Aliabad', te: 'అలియాబాద్', hi: 'आलियाबाद' },
          { id: 'stop_320_4', seq: 4, en: 'Engine Bowli', te: 'ఇంజిన్ బౌలి', hi: 'इंजन बाउली' },
          { id: 'stop_320_5', seq: 5, en: 'Falaknuma', te: 'ఫలక్‌నుమా', hi: 'फलकनुमा' }
        ]
      },
      {
        id: 'route_seed_351',
        code: '351',
        name: 'Koti - Shamshabad',
        startPoint: { en: 'Koti', te: 'కోటి', hi: 'कोटी' },
        destination: { en: 'Shamshabad', te: 'శంషాబాద్', hi: 'शमशाबाद' },
        direction: 'UP',
        speed: 5,
        dwellTime: 2000,
        scrollMode: 'scroll-left',
        stops: [
          { id: 'stop_351_1', seq: 1, en: 'Koti', te: 'కోటి', hi: 'कोटी' },
          { id: 'stop_351_2', seq: 2, en: 'Afzalgunj', te: 'అఫ్జల్‌గంజ్', hi: 'अफजलगंज' },
          { id: 'stop_351_3', seq: 3, en: 'Chandrayangutta', te: 'చాంద్రాయణగుట్ట', hi: 'चांद्रायणगुट्टा' },
          { id: 'stop_351_4', seq: 4, en: 'Aramghar', te: 'ఆరామ్‌ఘర్', hi: 'आरामघर' },
          { id: 'stop_351_5', seq: 5, en: 'Shamshabad', te: 'శంషాబాద్', hi: 'शमशाबाद' }
        ]
      },
      {
        id: 'route_seed_360',
        code: '360',
        name: 'JBS - Bowenpally',
        startPoint: { en: 'JBS', te: 'జెబిఎస్', hi: 'जेबीएस' },
        destination: { en: 'Bowenpally', te: 'బోయిన్‌పల్లి', hi: 'बोवेनపల్లి' },
        direction: 'UP',
        speed: 5,
        dwellTime: 2000,
        scrollMode: 'scroll-left',
        stops: [
          { id: 'stop_360_1', seq: 1, en: 'JBS', te: 'జెబిఎస్', hi: 'जेबीएस' },
          { id: 'stop_360_2', seq: 2, en: 'Tadbund', te: 'తాడ్‌బండ్', hi: 'ताड़बंद' },
          { id: 'stop_360_3', seq: 3, en: 'Diamond Point', te: 'డైమండ్ పాయింట్', hi: 'डायमंड पॉइंट' },
          { id: 'stop_360_4', seq: 4, en: 'Bowenpally', te: 'బోయిన్‌పల్లి', hi: 'बोवेनపల్లి' }
        ]
      }
    ];
  }

  // Helper: Sanitize string inputs (removes ASCII control chars, limits length)
  sanitizeString(val, maxLen = 250, defaultVal = '') {
    if (typeof window !== 'undefined' && window.ITMSUtils && typeof window.ITMSUtils.sanitizeString === 'function') {
      return window.ITMSUtils.sanitizeString(val, maxLen, defaultVal);
    }
    if (val === undefined || val === null) return defaultVal;
    let str = String(val).replace(/[\x00-\x1F\x7F]/g, '').trim();
    return str.length > maxLen ? str.substring(0, maxLen) : (str || defaultVal);
  }

  // Helper: Clamp numeric inputs to strict min/max bounds
  clampNumber(val, minVal, maxVal, defaultVal) {
    if (typeof window !== 'undefined' && window.ITMSUtils && typeof window.ITMSUtils.clampNumber === 'function') {
      return window.ITMSUtils.clampNumber(val, minVal, maxVal, defaultVal);
    }
    const num = parseInt(val, 10);
    return isNaN(num) ? defaultVal : Math.max(minVal, Math.min(maxVal, num));
  }

  // Initialize IndexedDB with auto-migration and version recovery snapshot store
  initIndexedDB() {
    if (!window.indexedDB) return;

    try {
      const req = window.indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.backupStoreName)) {
          const backupStore = db.createObjectStore(this.backupStoreName, { keyPath: 'id' });
          backupStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        this.db = e.target.result;
        // Asynchronously load routes from IndexedDB
        this.loadFromIndexedDB().then(dbRoutes => {
          if (dbRoutes && dbRoutes.length > 0) {
            const sanitized = this.sanitizeRoutesArray(dbRoutes);
            if (sanitized.length > 0) {
              this.routes = sanitized;
              if (this.activeRouteId === null && this.routes.length > 0) {
                this.activeRouteId = this.routes[0].id;
              }
              if (typeof this.onDataLoaded === 'function') {
                this.onDataLoaded();
              }
            }
          } else if (this.routes.length > 0) {
            // Seed IndexedDB with initial routes from localStorage
            this.saveToIndexedDB(this.routes);
            this.createAutoBackup('Initial Storage Load');
          }
        });
      };

      req.onerror = (e) => {
        if (typeof window.notifyUserError === 'function') {
          window.notifyUserError('IndexedDB', 'Storage Notice: IndexedDB database is unavailable. Operating in local storage mode.', 'warning', e);
        }
      };
    } catch (e) {
      if (typeof window.notifyUserError === 'function') {
        window.notifyUserError('IndexedDB', 'Storage Notice: Could not initialize IndexedDB database.', 'warning', e);
      }
    }
  }

  // Exponential Backoff Retry Mechanism for Robust IndexedDB Operations
  async withIndexedDBRetry(operationFn, maxRetries = 3, initialDelay = 100) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await operationFn();
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          if (typeof window.notifyUserError === 'function') {
            window.notifyUserError('IndexedDB', `Database Alert: Storage transaction failed after ${maxRetries} retries. Switched to fallback storage.`, 'warning', err);
          }
          throw err;
        }
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  loadFromIndexedDB() {
    return this.withIndexedDBRetry(() => {
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
    }).catch(() => null);
  }

  saveToIndexedDB(routes) {
    if (!this.db) return;
    this.withIndexedDBRetry(() => {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          store.clear();
          routes.forEach(r => store.put(r));
          tx.oncomplete = () => resolve(true);
          tx.onerror = (e) => reject(e.target.error || new Error('IndexedDB write failed'));
        } catch (e) {
          reject(e);
        }
      });
    }).catch(e => {
      if (typeof window.notifyUserError === 'function') {
        const cat = (window.ITMS && window.ITMS.ErrorCategory) ? window.ITMS.ErrorCategory.STORAGE : 'STORAGE';
        window.notifyUserError(cat, e, {
          title: 'Database Persistence Notice',
          resolution: 'IndexedDB transaction failed. Your routes are safely cached in localStorage.'
        });
      }
    });
  }

  // Automatic Version Recovery Snapshots (Keeps up to 10 latest snapshots in IndexedDB)
  createAutoBackup(label = 'Auto-Backup') {
    if (!this.db) return;
    try {
      const snapshot = {
        id: this.generateUniqueId('backup'),
        timestamp: Date.now(),
        dateStr: new Date().toLocaleString(),
        label: this.sanitizeString(label, 100, 'Auto-Backup'),
        routeCount: this.routes.length,
        routes: JSON.parse(JSON.stringify(this.routes))
      };

      const tx = this.db.transaction(this.backupStoreName, 'readwrite');
      const store = tx.objectStore(this.backupStoreName);
      store.put(snapshot);

      // Prune snapshots older than top 10
      const index = store.index('timestamp');
      const req = index.getAll();
      req.onsuccess = () => {
        const snapshots = req.result || [];
        if (snapshots.length > 10) {
          snapshots.sort((a, b) => b.timestamp - a.timestamp);
          const toDelete = snapshots.slice(10);
          const delTx = this.db.transaction(this.backupStoreName, 'readwrite');
          const delStore = delTx.objectStore(this.backupStoreName);
          toDelete.forEach(s => delStore.delete(s.id));
        }
      };
    } catch (e) {
      if (typeof window.notifyUserError === 'function') {
        window.notifyUserError('BackupEngine', 'Backup Warning: Could not create automatic version snapshot.', 'warning', e);
      }
    }
  }

  // Get available version recovery snapshots
  getBackupSnapshots() {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction(this.backupStoreName, 'readonly');
        const store = tx.objectStore(this.backupStoreName);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => b.timestamp - a.timestamp);
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  // Restore route state from a historical IndexedDB backup snapshot
  restoreFromBackup(backupId) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(this.backupStoreName, 'readonly');
        const store = tx.objectStore(this.backupStoreName);
        const req = store.get(backupId);
        req.onsuccess = () => {
          const snapshot = req.result;
          if (snapshot && Array.isArray(snapshot.routes)) {
            const restored = this.sanitizeRoutesArray(snapshot.routes);
            if (restored.length > 0) {
              this.routes = restored;
              this.activeRouteId = this.routes[0].id;
              this.saveRoutes();
              return resolve(true);
            }
          }
          resolve(false);
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // Strict Schema Validator for Imported JSON Route Payloads
  validateRouteSchema(r) {
    if (!r) return false;
    if (typeof r === 'string') return r.trim().length > 0 && r.trim().length <= 500;
    if (typeof r !== 'object') return false;

    // Reject Prototype Pollution Keys
    if (Object.prototype.hasOwnProperty.call(r, '__proto__') || 
        Object.prototype.hasOwnProperty.call(r, 'constructor') ||
        Object.prototype.hasOwnProperty.call(r, 'prototype')) {
      return false;
    }

    // Validate code and name data types if present
    if (r.code !== undefined && r.code !== null && typeof r.code !== 'string' && typeof r.code !== 'number') return false;
    if (r.name !== undefined && r.name !== null && typeof r.name !== 'string' && typeof r.name !== 'number') return false;

    return true;
  }

  // Sanitize and normalize a route object to prevent JS null/undefined property crashes and infinite loops
  sanitizeRoute(r) {
    if (!this.validateRouteSchema(r)) return null;

    // Remove Prototype Pollution Properties
    delete r.__proto__;
    delete r.constructor;

    // Handle string inputs (e.g. if single stop name or string route was passed)
    if (typeof r === 'string') {
      const nameStr = this.sanitizeString(r, 200, '');
      if (!nameStr) return null;
      return {
        id: this.generateUniqueId('route'),
        code: 'ROUTE',
        name: nameStr,
        startPoint: { en: nameStr, te: '', hi: '' },
        destination: { en: nameStr, te: '', hi: '' },
        direction: 'UP',
        speed: 5,
        dwellTime: 2000,
        scrollMode: 'static',
        stops: [{ id: this.generateUniqueId('stop'), seq: 1, en: nameStr, te: '', hi: '' }]
      };
    }

    if (typeof r !== 'object') return null;

    // Discover Code (Strictly bounded: max 50 chars)
    const rawCode = (r.code !== undefined && r.code !== null) ? r.code :
                    (r.routeCode || r.route_code || r.RouteCode || r.RouteNo || r.route_no || r.Route || r.route || r.Number || r.num || '');
    const code = this.sanitizeString(rawCode, 50, 'ROUTE');

    // Discover Name (Strictly bounded: max 250 chars)
    let rawName = (r.name !== undefined && r.name !== null) ? r.name :
                  (r.routeName || r.route_name || r.RouteName || r.RouteDesc || r.description || r.title || r.Name || '');
    let name = this.sanitizeString(rawName, 250, '');

    // Discover Stops Array (Strictly bounded: max 500 stops per route)
    const rawStops = Array.isArray(r.stops) ? r.stops :
                     Array.isArray(r.Stops) ? r.Stops :
                     Array.isArray(r.busStops) ? r.busStops :
                     Array.isArray(r.bus_stops) ? r.bus_stops :
                     Array.isArray(r.stationList) ? r.stationList :
                     Array.isArray(r.wayPoints) ? r.wayPoints :
                     Array.isArray(r.viaStops) ? r.viaStops :
                     Array.isArray(r.via) ? r.via :
                     Array.isArray(r.nodes) ? r.nodes :
                     Array.isArray(r.stopList) ? r.stopList : [];

    const boundedStops = rawStops.slice(0, 500);

    const sanitizedStops = boundedStops.map((s, idx) => {
      if (typeof s === 'string') {
        const sName = this.sanitizeString(s, 200, 'Stop ' + (idx + 1));
        return {
          id: this.generateUniqueId('stop'),
          seq: idx + 1,
          en: sName,
          te: '',
          hi: ''
        };
      } else if (s && typeof s === 'object') {
        const rawEn = (s.en !== undefined) ? s.en : (s.name || s.stopName || s.StopName || s.stationName || s.nameEn || s.name_en || s.stop_name || s.title || s.text || s.Name || '');
        const rawTe = (s.te !== undefined) ? s.te : (s.nameTe || s.name_te || s.stopTelugu || s.telugu || s.Telugu || '');
        const rawHi = (s.hi !== undefined) ? s.hi : (s.nameHi || s.name_hi || s.stopHindi || s.hindi || s.Hindi || '');
        return {
          id: (typeof s.id === 'string' && s.id.length <= 100) ? s.id : this.generateUniqueId('stop'),
          seq: this.clampNumber(s.seq, 1, 10000, idx + 1),
          en: this.sanitizeString(rawEn, 200, 'Stop ' + (idx + 1)),
          te: this.sanitizeString(rawTe, 200, ''),
          hi: this.sanitizeString(rawHi, 200, '')
        };
      }
      return {
        id: this.generateUniqueId('stop'),
        seq: idx + 1,
        en: 'Stop ' + (idx + 1),
        te: '',
        hi: ''
      };
    });

    // Discover Start Point (Strictly bounded: max 250 chars per lang)
    let startEn = this.sanitizeString((r.startPoint && typeof r.startPoint === 'object') ? r.startPoint.en : (r.startEn || r.start_point || r.StartPoint || r.start || r.Start || r.from || r.Origin || ''), 250, '');
    let startTe = this.sanitizeString((r.startPoint && typeof r.startPoint === 'object') ? r.startPoint.te : (r.startTe || ''), 250, '');
    let startHi = this.sanitizeString((r.startPoint && typeof r.startPoint === 'object') ? r.startPoint.hi : (r.startHi || ''), 250, '');

    if (startEn === '' && sanitizedStops.length > 0 && r.startPoint === undefined) {
      startEn = sanitizedStops[0].en;
      if (!startTe) startTe = sanitizedStops[0].te;
      if (!startHi) startHi = sanitizedStops[0].hi;
    }

    // Discover Destination Point (Strictly bounded: max 250 chars per lang)
    let destEn = this.sanitizeString((r.destination && typeof r.destination === 'object') ? r.destination.en : (r.destEn || r.dest_point || r.Destination || r.dest || r.Dest || r.to || r.Terminus || ''), 250, '');
    let destTe = this.sanitizeString((r.destination && typeof r.destination === 'object') ? r.destination.te : (r.destTe || ''), 250, '');
    let destHi = this.sanitizeString((r.destination && typeof r.destination === 'object') ? r.destination.hi : (r.destHi || ''), 250, '');

    if (destEn === '' && sanitizedStops.length > 1 && r.destination === undefined) {
      destEn = sanitizedStops[sanitizedStops.length - 1].en;
      if (!destTe) destTe = sanitizedStops[sanitizedStops.length - 1].te;
      if (!destHi) destHi = sanitizedStops[sanitizedStops.length - 1].hi;
    }

    if (!name && (startEn || destEn)) {
      name = `${startEn} - ${destEn}`;
    }

    // Validate & Clamp Display Parameters (Speed: 1-10, DwellTime: 100-10000ms, ScrollMode: enum)
    const speed = this.clampNumber(r.speed || r.scrollSpeed || r.Speed, 1, 10, 5);
    const dwellTime = this.clampNumber(r.dwellTime || r.delay || r.DwellTime, 100, 10000, 2000);
    const validModes = ['static', 'scroll-left', 'scroll-right', 'blink'];
    const scrollMode = validModes.includes(r.scrollMode || r.displayMode) ? (r.scrollMode || r.displayMode) : 'static';
    const direction = (r.direction === 'DOWN' || r.direction === 'down') ? 'DOWN' : 'UP';

    return {
      id: (typeof r.id === 'string' && r.id.length <= 100) ? r.id : this.generateUniqueId('route'),
      code: code,
      name: name || 'Route ' + code,
      startPoint: { en: startEn, te: startTe, hi: startHi },
      destination: { en: destEn, te: destTe, hi: destHi },
      direction: direction,
      speed: speed,
      dwellTime: dwellTime,
      scrollMode: scrollMode,
      stops: sanitizedStops
    };
  }

  // Deep Anti-Prototype Pollution Protection: Strips unsafe object keys & uses prototype-less target objects
  cleanObjectPrototypes(obj, depth = 0) {
    if (depth > 25) return null; // Recursion depth limit guard
    if (obj === null || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanObjectPrototypes(item, depth + 1));
    }

    const DANGEROUS_KEYS = new Set([
      '__proto__', 'constructor', 'prototype',
      '__defineGetter__', '__defineSetter__',
      '__lookupGetter__', '__lookupSetter__'
    ]);

    // Create a prototype-less object to prevent prototype chain pollution
    const cleanObj = Object.create(null);
    const keys = Object.getOwnPropertyNames(obj);

    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) continue;

      // Sanitize key string against control characters
      const cleanKey = key.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
      if (!cleanKey) continue;

      const val = obj[key];
      if (typeof val === 'function') continue; // Reject executable function references

      cleanObj[cleanKey] = this.cleanObjectPrototypes(val, depth + 1);
    }
    return cleanObj;
  }

  sanitizeRoutesArray(list) {
    if (!Array.isArray(list)) return [];
    const cleaned = this.cleanObjectPrototypes(list);
    return cleaned.map(r => this.sanitizeRoute(r)).filter(r => r !== null);
  }

  // Load synchronous routes from encrypted storage
  loadRoutesSync() {
    try {
      const storage = (typeof window !== 'undefined' && window.SecureStorage)
        ? window.SecureStorage
        : ((typeof window !== 'undefined' && window.ITMSStorage) ? window.ITMSStorage : (typeof window !== 'undefined' ? window.localStorage : null));
      const data = storage ? storage.getItem(this.storageKey) : null;
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          const sanitized = this.sanitizeRoutesArray(parsed);
          if (sanitized.length > 0) return sanitized;
        }
      }
    } catch (e) {
      if (typeof window !== 'undefined' && typeof window.notifyUserError === 'function') {
        window.notifyUserError('RouteStorage', 'Storage Notice: Could not read routes from local storage. Seeding default routes.', 'warning', e);
      }
    }
    const seed = this.getSeedRoutes();
    this.saveRoutesSync(seed);
    return seed;
  }

  // Save routes array to IndexedDB and fallback encrypted storage
  saveRoutes(routes = this.routes) {
    this.routes = this.sanitizeRoutesArray(routes);

    // Sync active state to ITMS.State
    if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
      window.ITMS.State.set('route.activeRouteId', this.activeRouteId, { silent: true });
    }

    // Immediate sync to memory/SecureStorage cache
    this.saveRoutesSync(this.routes);

    // Debounced asynchronous persistence to IndexedDB and version backup snapshot
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this.saveToIndexedDB(this.routes);
    }, 150);

    clearTimeout(this._backupTimer);
    this._backupTimer = setTimeout(() => {
      this.createAutoBackup('Route Data Saved');
    }, 800);
  }

  saveRoutesSync(routes) {
    try {
      if (typeof window !== 'undefined' && window.SecureStorage) {
        window.SecureStorage.setItem(this.storageKey, JSON.stringify(routes));
      } else if (typeof window !== 'undefined' && window.ITMSStorage) {
        window.ITMSStorage.setItem(this.storageKey, JSON.stringify(routes));
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(routes));
      }
    } catch (e) {
      if (typeof window !== 'undefined' && typeof window.notifyUserError === 'function') {
        window.notifyUserError('RouteStorage', 'Storage Notice: Local storage 5MB quota reached. Data is safely persisted in IndexedDB.', 'info', e);
      }
    }
  }

  // Get route by ID
  getRoute(id) {
    return this.routes.find(r => r.id === id) || null;
  }

  // Get all routes array
  getAllRoutes() {
    return Array.isArray(this.routes) ? this.routes : [];
  }

  getRoutes() {
    return this.getAllRoutes();
  }

  // Active route reference
  getActiveRoute() {
    return this.getRoute(this.activeRouteId) || this.routes[0];
  }

  // Add new route
  addRoute(code, name, startEn, startTe, destEn, destTe) {
    const newRoute = {
      id: this.generateUniqueId('route'),
      code: code || 'NEW',
      name: name || 'New Route',
      startPoint: { en: startEn || 'Start', te: startTe || 'ప్రారంభం', hi: '' },
      destination: { en: destEn || 'Destination', te: destTe || 'గమ్యం', hi: '' },
      direction: 'UP',
      stops: [
        { id: this.generateUniqueId('stop'), seq: 1, en: startEn || 'Start', te: startTe || 'ప్రారంభం', hi: '' },
        { id: this.generateUniqueId('stop'), seq: 2, en: destEn || 'Destination', te: destTe || 'గమ్యం', hi: '' }
      ]
    };
    this.routes.unshift(newRoute);
    this.activeRouteId = newRoute.id;
    this.saveRoutes();
    return newRoute;
  }

  // Update route details
  updateRoute(id, updatedData) {
    const idx = this.routes.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.routes[idx] = { ...this.routes[idx], ...updatedData };
      this.saveRoutes();
    }
  }

  // Delete single route
  deleteRoute(id) {
    this.routes = this.routes.filter(r => r.id !== id);
    if (this.activeRouteId === id) {
      this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
    }
    this.saveRoutes();
  }

  // Delete multiple routes in bulk
  deleteRoutesBulk(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const idSet = new Set(ids);
    const initialCount = this.routes.length;
    this.routes = this.routes.filter(r => !idSet.has(r.id));
    const deletedCount = initialCount - this.routes.length;
    if (this.activeRouteId && idSet.has(this.activeRouteId)) {
      this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
    }
    this.saveRoutes();
    return deletedCount;
  }

  // Add stop to active route
  addStopToRoute(routeId, enName, teName, hiName = '') {
    const route = this.getRoute(routeId);
    if (!route) return;

    const newStop = {
      id: this.generateUniqueId('stop'),
      seq: route.stops.length + 1,
      en: enName || 'New Stop',
      te: teName || 'క్రొత్త స్టాప్',
      hi: hiName || ''
    };

    route.stops.push(newStop);
    this.saveRoutes();
    return newStop;
  }

  /**
   * Adds or replaces multiple stops on a route in bulk.
   * @param {string} routeId 
   * @param {Array<{en: string, te?: string, hi?: string}>} stopsArray 
   * @param {boolean} replace 
   * @returns {number} count of stops added
   */
  bulkAddStopsToRoute(routeId, stopsArray, replace = false) {
    const route = this.getRoute(routeId);
    if (!route || !Array.isArray(stopsArray) || stopsArray.length === 0) return 0;

    if (replace) {
      route.stops = [];
    }

    const currentLen = route.stops.length;
    const addedStops = stopsArray
      .filter(s => s && typeof s.en === 'string' && s.en.trim().length > 0)
      .map((s, idx) => ({
        id: this.generateUniqueId('stop'),
        seq: currentLen + idx + 1,
        en: this.sanitizeString(s.en, 150),
        te: this.sanitizeString(s.te || '', 150),
        hi: this.sanitizeString(s.hi || '', 150)
      }));

    if (addedStops.length === 0) return 0;

    route.stops = route.stops.concat(addedStops);
    // Re-verify sequence numbers
    route.stops.forEach((s, i) => { s.seq = i + 1; });
    this.saveRoutes();
    return addedStops.length;
  }

  // Reorder stop in route
  reorderStop(routeId, stopIndex, direction) {
    const route = this.getRoute(routeId);
    if (!route) return;

    const targetIdx = direction === 'UP' ? stopIndex - 1 : stopIndex + 1;
    if (targetIdx < 0 || targetIdx >= route.stops.length) return;

    // Swap items
    const temp = route.stops[stopIndex];
    route.stops[stopIndex] = route.stops[targetIdx];
    route.stops[targetIdx] = temp;

    // Re-assign sequence numbers
    route.stops.forEach((s, idx) => { s.seq = idx + 1; });
    this.saveRoutes();
  }

  // Remove stop from route
  deleteStop(routeId, stopId) {
    const route = this.getRoute(routeId);
    if (!route) return;

    route.stops = route.stops.filter(s => s.id !== stopId);
    route.stops.forEach((s, idx) => { s.seq = idx + 1; });
    this.saveRoutes();
  }

  // Search routes by search query
  searchRoutes(query) {
    if (!query) return this.routes;
    const q = query.toLowerCase();
    return this.routes.filter(r => 
      (r.code || '').toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.startPoint?.en || '').toLowerCase().includes(q) ||
      (r.destination?.en || '').toLowerCase().includes(q)
    );
  }

  // Export all routes as JSON
  exportJSON() {
    return JSON.stringify(this.routes, null, 2);
  }

  // Export Full Database Backup (Routes, Stops, and Saved Glyphs)
  exportFullDatabase(glyphs = []) {
    const totalStops = this.routes.reduce((acc, r) => acc + (r.stops ? r.stops.length : 0), 0);
    const backupObj = {
      backupVersion: '2.0.0',
      system: 'ITMS LED Display & Route Management Suite Database Backup',
      generator: 'Containe Technologies Limited ITMS Suite',
      exportTimestamp: new Date().toISOString(),
      stats: {
        totalRoutes: this.routes.length,
        totalStops: totalStops,
        totalGlyphs: Array.isArray(glyphs) ? glyphs.length : 0
      },
      routes: JSON.parse(JSON.stringify(this.routes)),
      glyphs: Array.isArray(glyphs) ? JSON.parse(JSON.stringify(glyphs)) : []
    };
    return JSON.stringify(backupObj, null, 2);
  }

  // Restore Full Database Backup with Comprehensive Schema & Relaxed JSON Handling
  importFullDatabase(backupPayload, mode = 'append') {
    try {
      let parsed = null;
      if (typeof backupPayload === 'string') {
        const cleanedStr = backupPayload.trim().replace(/^\uFEFF/, '');
        try {
          parsed = JSON.parse(cleanedStr);
        } catch (e1) {
          try {
            // Relaxed JSON parse (strip trailing commas)
            const strippedStr = cleanedStr.replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(strippedStr);
          } catch (e2) {
            return { success: false, message: 'Invalid JSON syntax: ' + e1.message };
          }
        }
      } else if (typeof backupPayload === 'object' && backupPayload !== null) {
        parsed = backupPayload;
      }

      if (!parsed) {
        return { success: false, message: 'Invalid or empty backup payload.' };
      }

      parsed = this.cleanObjectPrototypes(parsed);

      let routeList = [];
      let glyphList = [];

      // Flexible Key Discovery
      const knownRouteKeys = ['routes', 'data', 'items', 'MasterRoutes', 'BusRoutes', 'RouteDetails', 'Payload', 'Result', 'routesList', 'route_list'];
      for (const k of knownRouteKeys) {
        if (Array.isArray(parsed[k])) {
          routeList = parsed[k];
          break;
        }
      }

      if (routeList.length === 0) {
        if (Array.isArray(parsed)) {
          routeList = parsed;
        } else if (parsed.code || parsed.name || parsed.id || parsed.routeCode || parsed.RouteNo || parsed.stops || parsed.Stops) {
          routeList = [parsed];
        } else {
          const values = Object.values(parsed);
          if (values.length > 0 && values.some(v => v && typeof v === 'object' && (v.code || v.name || v.stops))) {
            routeList = values.filter(v => v && typeof v === 'object');
          }
        }
      }

      const knownGlyphKeys = ['glyphs', 'savedGlyphs', 'saved_glyphs', 'glyphList', 'glyph_list'];
      for (const gk of knownGlyphKeys) {
        if (Array.isArray(parsed[gk])) {
          glyphList = parsed[gk];
          break;
        }
      }

      const sanitizedRoutes = this.sanitizeRoutesArray(routeList);
      if (sanitizedRoutes.length === 0 && glyphList.length === 0) {
        return { success: false, message: 'No valid bus routes or glyph records found in backup payload.' };
      }

      if (mode === 'replace') {
        this.routes = sanitizedRoutes;
      } else {
        const existingIds = new Set(this.routes.map(r => r.id));
        sanitizedRoutes.forEach(nr => {
          if (existingIds.has(nr.id)) {
            nr.id = this.generateUniqueId('route');
          }
          this.routes.push(nr);
          existingIds.add(nr.id);
        });
      }

      this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
      this.saveRoutes();

      return {
        success: true,
        restoredRoutesCount: sanitizedRoutes.length,
        restoredGlyphs: glyphList,
        totalRoutes: this.routes.length,
        backupStats: parsed.stats || null,
        exportDate: parsed.exportTimestamp || null
      };
    } catch (e) {
      return { success: false, message: e.message || 'Error processing database backup file.' };
    }
  }

  /**
   * Sanitizes and escapes a CSV cell value according to RFC 4180 and OWASP CSV Injection Guidelines.
   * Neutralizes formula characters (=, +, -, @, \t, \r, %) by prefixing a single quote.
   * @param {*} val 
   * @returns {string}
   */
  static sanitizeCsvCell(val) {
    if (typeof window !== 'undefined' && window.ITMSUtils && typeof window.ITMSUtils.sanitizeCsvCell === 'function') {
      return window.ITMSUtils.sanitizeCsvCell(val);
    }
    let str = (val !== undefined && val !== null) ? String(val) : '';
    if (/^[=+\-@\t\r%]/.test(str)) str = "'" + str;
    const needsQuotes = /[",\n\r]/.test(str) || /^[=+\-@\t\r%]/.test(str);
    const escapedStr = str.replace(/"/g, '""');
    return needsQuotes ? `"${escapedStr}"` : escapedStr;
  }

  // Export all routes as CSV (Strict RFC 4180 Escaping & CSV Formula Injection Protection)
  exportCSV() {
    const sanitize = RouteManager.sanitizeCsvCell;
    const rows = [['Route Code', 'Route Name', 'Stop Sequence', 'Stop English', 'Stop Telugu', 'Stop Hindi']];
    this.routes.forEach(r => {
      const stops = Array.isArray(r.stops) ? r.stops : [];
      stops.forEach(s => {
        rows.push([
          sanitize(r.code),
          sanitize(r.name),
          s.seq || 1,
          sanitize(s.en),
          sanitize(s.te),
          sanitize(s.hi)
        ]);
      });
    });
    return rows.map(e => e.join(',')).join('\r\n');
  }

  // Strict RFC 4180 CSV String Parser
  parseCSVTable(text) {
    if (!text || typeof text !== 'string') return [];
    const str = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;

    let delimiter = ',';
    const firstLine = str.split('\n')[0] || '';
    if (firstLine.includes('\t') && firstLine.split('\t').length > firstLine.split(',').length) {
      delimiter = '\t';
    } else if (firstLine.includes(';') && firstLine.split(';').length > firstLine.split(',').length) {
      delimiter = ';';
    }

    while (i < str.length) {
      const char = str[i];
      const nextChar = str[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            currentCell += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          currentCell += char;
          i++;
          continue;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
          i++;
          continue;
        } else if (char === delimiter) {
          currentRow.push(currentCell.trim());
          currentCell = '';
          i++;
          continue;
        } else if (char === '\n') {
          currentRow.push(currentCell.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
          i++;
          continue;
        } else {
          currentCell += char;
          i++;
          continue;
        }
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  // Helper to strip formula injection and cleanup cell string
  cleanTableCell(val) {
    if (val === undefined || val === null) return '';
    let str = String(val).trim();
    // Strip leading single quote used to neutralize formula injection
    if (str.startsWith("'") && str.length > 1) {
      str = str.substring(1).trim();
    }
    return str;
  }

  // Parse 2D Table Array (from CSV, TSV, or XLSX Sheet) into BusRoute objects
  parseTableToRoutes(tableRows) {
    if (!Array.isArray(tableRows) || tableRows.length === 0) {
      return { success: false, routes: [], totalParsedRoutes: 0, totalParsedStops: 0, errors: ['File contains no tabular data.'] };
    }

    // Filter out completely blank rows
    const nonEmptyRows = tableRows.filter(row => Array.isArray(row) && row.some(cell => String(cell || '').trim().length > 0));
    if (nonEmptyRows.length === 0) {
      return { success: false, routes: [], totalParsedRoutes: 0, totalParsedStops: 0, errors: ['File contains no readable rows.'] };
    }

    const cleanCell = (v) => this.cleanTableCell(v);

    let headerRowIdx = -1;
    const colMap = {};

    // 1. Scan the first 6 rows for header keywords
    for (let r = 0; r < Math.min(6, nonEmptyRows.length); r++) {
      const rowCleaned = nonEmptyRows[r].map(c => cleanCell(c).toLowerCase().replace(/[^a-z0-9]/g, ''));
      const detected = {};
      let matchCount = 0;

      rowCleaned.forEach((h, idx) => {
        if (!h) return;
        if (/^(routecode|routeno|routenumber|routeid|busno|busnumber|lineno|service|route|code|bus|line|rt)/i.test(h) && detected.code === undefined) {
          detected.code = idx; matchCount++;
        } else if (/^(routename|routedesc|routedescription|routetitle|busname|name|description|title|routenm)/i.test(h) && detected.name === undefined) {
          detected.name = idx; matchCount++;
        } else if (/^(stopsequence|stopseq|sequence|seqno|seq|stopno|srno|slno|order|step|serial|sno)/i.test(h) && detected.seq === undefined) {
          detected.seq = idx; matchCount++;
        } else if (/^(stopenglish|stopnameen|stopnameenglish|stopname|stationname|busstop|stop|station|place|location|village|city|town|english|nameen|stage|en)/i.test(h) && detected.stopEn === undefined) {
          detected.stopEn = idx; matchCount++;
        } else if (/^(stoptelugu|stopteluguname|stopnamete|teluguname|telugu|namete|tlg|te)/i.test(h) && detected.stopTe === undefined) {
          detected.stopTe = idx; matchCount++;
        } else if (/^(stophindi|stophindiname|stopnamehi|hindiname|hindi|namehi|hin|hi)/i.test(h) && detected.stopHi === undefined) {
          detected.stopHi = idx; matchCount++;
        } else if (/^(startterminal|startterminalenglish|originenglish|startpoint|startstop|origin|source|starten|start|from)/i.test(h) && detected.startEn === undefined) {
          detected.startEn = idx; matchCount++;
        } else if (/^(startterminaltelugu|origintelugu|starttelugu|startte)/i.test(h) && detected.startTe === undefined) {
          detected.startTe = idx; matchCount++;
        } else if (/^(destinationterminal|destinationterminalenglish|destinationpoint|destinationstop|destterminal|destination|endpoint|desten|dest|to)/i.test(h) && detected.destEn === undefined) {
          detected.destEn = idx; matchCount++;
        } else if (/^(destinationterminaltelugu|destinationtelugu|desttelugu|destte)/i.test(h) && detected.destTe === undefined) {
          detected.destTe = idx; matchCount++;
        } else if (/^(viastops|viastopnames|viastations|waypoints|intermediate|stoplist|via|stops)/i.test(h) && detected.via === undefined) {
          detected.via = idx; matchCount++;
        }
      });

      if (matchCount >= 1 && Object.keys(colMap).length === 0) {
        headerRowIdx = r;
        Object.assign(colMap, detected);
      }
    }

    const dataRows = (headerRowIdx !== -1) ? nonEmptyRows.slice(headerRowIdx + 1) : nonEmptyRows;
    const workingRows = (dataRows.length > 0) ? dataRows : nonEmptyRows;

    // 2. Content Heuristics if headers are incomplete or missing
    const sampleRows = workingRows.slice(0, Math.min(15, workingRows.length));
    const maxCols = Math.max(...sampleRows.map(r => r.length));

    if (Object.keys(colMap).length === 0 || colMap.stopEn === undefined && colMap.via === undefined && colMap.startEn === undefined) {
      for (let c = 0; c < maxCols; c++) {
        const colVals = sampleRows.map(r => String(r[c] || '').trim()).filter(v => v.length > 0);
        const hasTelugu = colVals.some(v => /[\u0C00-\u0C7F]/.test(v));
        const hasHindi = colVals.some(v => /[\u0900-\u097F]/.test(v));
        const isDelimited = colVals.some(v => /[,;|•→\n]/.test(v) && v.split(/[,;|•→\n]/).length > 1);
        const isNumericSeq = colVals.length > 0 && colVals.every(v => /^\d{1,4}$/.test(v)) && colVals.some(v => ['1', '2'].includes(v));

        if (hasTelugu && colMap.stopTe === undefined) colMap.stopTe = c;
        else if (hasHindi && colMap.stopHi === undefined) colMap.stopHi = c;
        else if (isDelimited && colMap.via === undefined) colMap.via = c;
        else if (isNumericSeq && colMap.seq === undefined) colMap.seq = c;
      }

      const unmapped = [];
      for (let c = 0; c < maxCols; c++) {
        if (!Object.values(colMap).includes(c)) unmapped.push(c);
      }

      if (unmapped.length === 1) {
        if (colMap.code === undefined) colMap.code = unmapped[0];
        else if (colMap.stopEn === undefined) colMap.stopEn = unmapped[0];
      } else if (unmapped.length === 2) {
        if (colMap.code === undefined && colMap.stopEn === undefined) {
          colMap.code = unmapped[0];
          colMap.stopEn = unmapped[1];
        } else if (colMap.startEn === undefined && colMap.destEn === undefined) {
          colMap.startEn = unmapped[0];
          colMap.destEn = unmapped[1];
        }
      } else if (unmapped.length === 3) {
        if (colMap.code === undefined) colMap.code = unmapped[0];
        if (colMap.name === undefined) colMap.name = unmapped[1];
        if (colMap.stopEn === undefined) colMap.stopEn = unmapped[2];
      } else if (unmapped.length >= 4) {
        if (colMap.code === undefined) colMap.code = unmapped[0];
        if (colMap.name === undefined) colMap.name = unmapped[1];
        if (colMap.startEn === undefined) colMap.startEn = unmapped[2];
        if (colMap.destEn === undefined) colMap.destEn = unmapped[3];
        if (unmapped.length >= 5 && colMap.via === undefined) colMap.via = unmapped[4];
      }
    }

    const cols = colMap;
    const errors = [];
    /** @type {Map<string, { code: string, name: string, startEn: string, startTe: string, destEn: string, destTe: string, stops: any[] }>} */
    const routesMap = new Map();

    workingRows.forEach((row, rowIdx) => {
      if (!row || row.every(c => !c || String(c).trim().length === 0)) return;

      const codeRaw = (cols.code !== undefined && row[cols.code] !== undefined) ? cleanCell(row[cols.code]) : '';
      const nameRaw = (cols.name !== undefined && row[cols.name] !== undefined) ? cleanCell(row[cols.name]) : '';
      let routeKey = (codeRaw ? `${codeRaw}___${nameRaw}` : (nameRaw || `ROUTE_${rowIdx + 1}`)).toUpperCase();
      const rawSeq = (cols.seq !== undefined && row[cols.seq] !== undefined) ? parseInt(cleanCell(row[cols.seq]), 10) : null;

      // If sequence restarts at 1 for the same route, create a separate trip instance
      if (rawSeq === 1 && routesMap.has(routeKey) && routesMap.get(routeKey).stops.length > 0) {
        let instance = 2;
        while (routesMap.has(`${routeKey}_TRIP_${instance}`)) {
          instance++;
        }
        routeKey = `${routeKey}_TRIP_${instance}`;
      }

      if (!routesMap.has(routeKey)) {
        routesMap.set(routeKey, {
          code: codeRaw || `R-${rowIdx + 1}`,
          name: nameRaw || (codeRaw ? `Route ${codeRaw}` : `Route ${rowIdx + 1}`),
          startEn: (cols.startEn !== undefined && row[cols.startEn] !== undefined) ? cleanCell(row[cols.startEn]) : '',
          startTe: (cols.startTe !== undefined && row[cols.startTe] !== undefined) ? cleanCell(row[cols.startTe]) : '',
          destEn: (cols.destEn !== undefined && row[cols.destEn] !== undefined) ? cleanCell(row[cols.destEn]) : '',
          destTe: (cols.destTe !== undefined && row[cols.destTe] !== undefined) ? cleanCell(row[cols.destTe]) : '',
          stops: []
        });
      }

      const routeEntry = routesMap.get(routeKey);

      // 1. Single-row format with delimited 'Via' / 'Stops' column
      if (cols.via !== undefined && row[cols.via] !== undefined) {
        const rawVia = cleanCell(row[cols.via]);
        if (rawVia) {
          const splitStops = rawVia.split(/[,;|•→\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
          splitStops.forEach(st => {
            const teAuto = (typeof window !== 'undefined' && window.translitEng && typeof window.translitEng.transliterate === 'function') 
              ? window.translitEng.transliterate(st, 'te') 
              : '';
            routeEntry.stops.push({
              id: this.generateUniqueId('stop'),
              seq: routeEntry.stops.length + 1,
              en: st,
              te: teAuto,
              hi: ''
            });
          });
        }
      }

      // 2. Multi-row stop item
      const stopEn = (cols.stopEn !== undefined && row[cols.stopEn] !== undefined) ? cleanCell(row[cols.stopEn]) : '';
      let stopTe = (cols.stopTe !== undefined && row[cols.stopTe] !== undefined) ? cleanCell(row[cols.stopTe]) : '';
      const stopHi = (cols.stopHi !== undefined && row[cols.stopHi] !== undefined) ? cleanCell(row[cols.stopHi]) : '';

      if (!stopTe && stopEn && typeof window !== 'undefined' && window.translitEng && typeof window.translitEng.transliterate === 'function') {
        stopTe = window.translitEng.transliterate(stopEn, 'te');
      }

      if (stopEn || stopTe || stopHi) {
        routeEntry.stops.push({
          id: this.generateUniqueId('stop'),
          seq: (!isNaN(rawSeq) && rawSeq > 0) ? rawSeq : (routeEntry.stops.length + 1),
          en: stopEn || `Stop ${routeEntry.stops.length + 1}`,
          te: stopTe || '',
          hi: stopHi || ''
        });
      }
    });

    const parsedRoutes = [];
    let totalParsedStops = 0;

    routesMap.forEach((entry) => {
      let stops = entry.stops;

      // Sort stops by sequence and normalize 1-based indexing
      stops.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      stops.forEach((s, idx) => { s.seq = idx + 1; });

      // Determine start and destination points
      let startEn = entry.startEn;
      let startTe = entry.startTe;
      let destEn = entry.destEn;
      let destTe = entry.destTe;

      if (!startEn && stops.length > 0) {
        startEn = stops[0].en;
        startTe = stops[0].te || '';
      }
      if (!destEn && stops.length > 1) {
        destEn = stops[stops.length - 1].en;
        destTe = stops[stops.length - 1].te || '';
      } else if (!destEn && stops.length === 1) {
        destEn = stops[0].en;
        destTe = stops[0].te || '';
      }

      // If stops are empty, create start and end stops from terminals
      if (stops.length === 0 && (startEn || destEn)) {
        if (startEn) {
          stops.push({ id: this.generateUniqueId('stop'), seq: 1, en: startEn, te: startTe || '', hi: '' });
        }
        if (destEn && destEn !== startEn) {
          stops.push({ id: this.generateUniqueId('stop'), seq: 2, en: destEn, te: destTe || '', hi: '' });
        }
      }

      // If still no stops, create a default stop from route code / name
      if (stops.length === 0) {
        stops.push({
          id: this.generateUniqueId('stop'),
          seq: 1,
          en: entry.name || entry.code || 'Main Station',
          te: (typeof window !== 'undefined' && window.translitEng) ? window.translitEng.transliterate(entry.name || entry.code || 'Main Station', 'te') : '',
          hi: ''
        });
      }

      let routeName = entry.name;
      if ((!routeName || routeName.startsWith('Route R-')) && (startEn || destEn)) {
        routeName = `${startEn || 'Start'} - ${destEn || 'Destination'}`;
      }

      const newRoute = {
        id: this.generateUniqueId('route'),
        code: this.sanitizeString(entry.code, 50, 'ROUTE'),
        name: this.sanitizeString(routeName, 250, 'Imported Route'),
        startPoint: {
          en: this.sanitizeString(startEn || (stops[0] ? stops[0].en : ''), 250, ''),
          te: this.sanitizeString(startTe || (stops[0] ? stops[0].te : ''), 250, ''),
          hi: ''
        },
        destination: {
          en: this.sanitizeString(destEn || (stops[stops.length - 1] ? stops[stops.length - 1].en : ''), 250, ''),
          te: this.sanitizeString(destTe || (stops[stops.length - 1] ? stops[stops.length - 1].te : ''), 250, ''),
          hi: ''
        },
        direction: 'UP',
        speed: 5,
        dwellTime: 2000,
        scrollMode: 'static',
        stops: stops
      };

      parsedRoutes.push(newRoute);
      totalParsedStops += stops.length;
    });

    const sanitizedRoutes = this.sanitizeRoutesArray(parsedRoutes);
    return {
      success: sanitizedRoutes.length > 0,
      routes: sanitizedRoutes,
      totalParsedRoutes: sanitizedRoutes.length,
      totalParsedStops: totalParsedStops,
      errors: errors
    };
  }

  // Import bulk routes from CSV text string
  importFromCSV(csvText, append = true) {
    const table = this.parseCSVTable(csvText);
    const result = this.parseTableToRoutes(table);
    if (!result.success || result.routes.length === 0) {
      return result;
    }

    if (append) {
      const existingIds = new Set(this.routes.map(r => r.id));
      result.routes.forEach(nr => {
        if (existingIds.has(nr.id)) {
          nr.id = this.generateUniqueId('route');
        }
        this.routes.push(nr);
        existingIds.add(nr.id);
      });
    } else {
      this.routes = result.routes;
    }

    this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
    this.saveRoutes();
    return result;
  }

  // Extract 2D Table Array from Excel XLSX ArrayBuffer using JSZip
  async parseXLSXTable(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is required to unpack Excel .xlsx spreadsheets.');
    }

    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // 1. Extract Shared Strings (xl/sharedStrings.xml)
    const sharedStrings = [];
    const ssFiles = zip.file(/xl\/sharedStrings\.xml/i);
    const sharedStringsFile = ssFiles && ssFiles.length > 0 ? ssFiles[0] : null;
    if (sharedStringsFile) {
      const ssXml = await sharedStringsFile.async('string');
      const parser = new DOMParser();
      const ssDoc = parser.parseFromString(ssXml, 'application/xml');
      const siNodes = ssDoc.getElementsByTagName('si');
      for (let i = 0; i < siNodes.length; i++) {
        const tNodes = siNodes[i].getElementsByTagName('t');
        let combinedText = '';
        for (let j = 0; j < tNodes.length; j++) {
          combinedText += tNodes[j].textContent || '';
        }
        sharedStrings.push(combinedText);
      }
    }

    // 2. Locate Primary Worksheet (sheet1.xml or first available worksheet)
    let sheetFile = zip.file(/^xl\/worksheets\/sheet1\.xml$/i) || zip.file('xl/worksheets/sheet1.xml');
    if (!sheetFile) {
      const sheetFiles = zip.file(/worksheets\/.*\.xml$/i);
      if (sheetFiles && sheetFiles.length > 0) {
        sheetFile = sheetFiles[0];
      }
    }

    if (!sheetFile) {
      throw new Error('Could not locate any valid worksheet inside the Excel file.');
    }

    const sheetXml = await sheetFile.async('string');
    const parser = new DOMParser();
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    
    const getNodes = (parent, tag) => {
      if (!parent) return [];
      let list = parent.getElementsByTagName(tag);
      if (!list || list.length === 0) {
        list = parent.getElementsByTagNameNS('*', tag);
      }
      return list || [];
    };

    const rowNodes = getNodes(sheetDoc, 'row');
    const tableRows = [];

    // Helper: Convert column reference letter ('A', 'B', 'AA') to 0-based column index
    const colLetterToIndex = (letters) => {
      const clean = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '');
      let col = 0;
      for (let i = 0; i < clean.length; i++) {
        col = col * 26 + (clean.charCodeAt(i) - 64);
      }
      return col > 0 ? col - 1 : 0;
    };

    for (let r = 0; r < rowNodes.length; r++) {
      const rowNode = rowNodes[r];
      const cellNodes = getNodes(rowNode, 'c');
      const rowData = [];

      for (let c = 0; c < cellNodes.length; c++) {
        const cellNode = cellNodes[c];
        const cellRef = cellNode.getAttribute('r') || '';
        const colLetters = cellRef.replace(/[0-9]/g, '');
        const colIdx = colLetters ? colLetterToIndex(colLetters) : c;

        const type = cellNode.getAttribute('t');
        let val = '';

        if (type === 's') {
          // Shared string lookup
          const valNode = getNodes(cellNode, 'v')[0];
          const sIdx = parseInt(valNode ? valNode.textContent : '', 10);
          val = (!isNaN(sIdx) && sharedStrings[sIdx] !== undefined) ? sharedStrings[sIdx] : '';
        } else if (type === 'inlineStr') {
          // Inline rich text
          const tNodes = getNodes(cellNode, 't');
          for (let k = 0; k < tNodes.length; k++) {
            val += tNodes[k].textContent || '';
          }
        } else {
          // Direct value / formula result / number
          const valNode = getNodes(cellNode, 'v')[0] || getNodes(cellNode, 't')[0];
          val = valNode ? (valNode.textContent || '') : '';
        }

        while (rowData.length < colIdx) {
          rowData.push('');
        }
        rowData[colIdx] = val;
      }

      if (rowData.some(cell => String(cell || '').trim().length > 0)) {
        tableRows.push(rowData);
      }
    }

    return tableRows;
  }

  // Import bulk routes from XLSX ArrayBuffer using local JSZip & DOMParser
  async importFromXLSX(arrayBuffer, append = true) {
    try {
      const tableRows = await this.parseXLSXTable(arrayBuffer);
      const result = this.parseTableToRoutes(tableRows);
      if (!result.success || result.routes.length === 0) {
        return result;
      }

      if (append) {
        const existingIds = new Set(this.routes.map(r => r.id));
        result.routes.forEach(nr => {
          if (existingIds.has(nr.id)) {
            nr.id = this.generateUniqueId('route');
          }
          this.routes.push(nr);
          existingIds.add(nr.id);
        });
      } else {
        this.routes = result.routes;
      }

      this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
      this.saveRoutes();
      return result;
    } catch (err) {
      return { success: false, routes: [], totalParsedRoutes: 0, totalParsedStops: 0, errors: [err.message || 'Error processing Excel spreadsheet.'] };
    }
  }

  // Import JSON file data safely (supports all ITMS payloads, string arrays, single route objects, and wrapper keys)
  importJSON(jsonInput, append = true) {
    try {
      let parsed = null;

      if (typeof jsonInput === 'string') {
        const cleanedStr = jsonInput.trim().replace(/^\uFEFF/, '');
        try {
          parsed = JSON.parse(cleanedStr);
        } catch (e1) {
          // Relaxed JSON parse (strips trailing commas)
          try {
            const strippedStr = cleanedStr.replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(strippedStr);
          } catch (e2) {
            if (typeof window.notifyUserError === 'function') {
              window.notifyUserError('JSONImport', 'Import Error: Failed to parse JSON file string. Invalid JSON syntax.', 'danger', e1);
            }
            return false;
          }
        }
      } else if (typeof jsonInput === 'object' && jsonInput !== null) {
        parsed = jsonInput;
      }

      if (!parsed) return false;
      parsed = this.cleanObjectPrototypes(parsed);

      let routeList = [];

      if (Array.isArray(parsed)) {
        const first = parsed[0];
        const isRouteObject = first && typeof first === 'object' && (
          first.stops || first.Stops || first.busStops || first.bus_stops ||
          first.code || first.routeCode || first.RouteNo || first.route_code ||
          first.startPoint || first.destination || first.startEn || first.destEn ||
          first.start || first.dest || first.from || first.to ||
          first.routeName || first.route_name || first.RouteName
        );

        if (!isRouteObject && (typeof first === 'string' || (first && typeof first === 'object' && (first.stopName || first.StopName || first.stationName)))) {
          // The array itself is a list of stops for a single route!
          routeList = [{
            code: 'IMPORTED',
            name: 'Imported Route',
            stops: parsed
          }];
        } else {
          routeList = parsed;
        }
      } else if (typeof parsed === 'object') {
        const knownKeys = ['routes', 'data', 'items', 'MasterRoutes', 'BusRoutes', 'RouteDetails', 'Payload', 'Result', 'routesList', 'route_list'];
        let foundArray = null;

        for (const k of knownKeys) {
          if (Array.isArray(parsed[k])) {
            foundArray = parsed[k];
            break;
          }
        }

        if (foundArray) {
          routeList = foundArray;
        } else if (parsed.code || parsed.name || parsed.id || parsed.routeCode || parsed.RouteNo || parsed.stops || parsed.Stops || parsed.busStops) {
          // Single route object
          routeList = [parsed];
        } else {
          // Object values dictionary
          const values = Object.values(parsed);
          if (values.length > 0 && values.some(v => v && typeof v === 'object')) {
            routeList = values.filter(v => v && typeof v === 'object');
          }
        }
      }

      const sanitizedNew = this.sanitizeRoutesArray(routeList);
      if (sanitizedNew.length === 0) return false;

      if (append) {
        const existingIds = new Set(this.routes.map(r => r.id));
        sanitizedNew.forEach(nr => {
          if (existingIds.has(nr.id)) {
            nr.id = this.generateUniqueId('route');
          }
          this.routes.push(nr);
          existingIds.add(nr.id);
        });
      } else {
        this.routes = sanitizedNew;
      }

      this.activeRouteId = this.routes.length > 0 ? this.routes[0].id : null;
      this.saveRoutes();
      return true;
    } catch (e) {
      if (typeof window.notifyUserError === 'function') {
        const cat = (window.ITMS && window.ITMS.ErrorCategory) ? window.ITMS.ErrorCategory.STORAGE : 'STORAGE';
        window.notifyUserError(cat, e, {
          title: 'JSON Route Import Failed',
          resolution: 'Ensure the uploaded file contains valid ITMS route objects.'
        });
      }
      return false;
    }
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.RouteManager = RouteManager;
  window.RouteManager = RouteManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RouteManager;
}



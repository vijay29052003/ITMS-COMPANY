/**
 * @typedef {import('./types.d.ts').BusRoute} BusRoute
 * @typedef {import('./types.d.ts').RouteStop} RouteStop
 * @typedef {import('./types.d.ts').SavedGlyph} SavedGlyph
 * @typedef {import('./types.d.ts').CustomFontRecord} CustomFontRecord
 */

/* ==========================================================================
   ITMS LED MANAGER - MAIN APPLICATION CONTROLLER & ROUTER
   Modular Storage, AES-GCM Crypto, & Toasts loaded from js/storage-security.js
   ========================================================================== */

function initializeMainApplication() {
  // Initialize Core Engines
  const routeMgr = new RouteManager();
  const ledEng = new LEDEngine('led-canvas');
  const exporter = new ITMSExporter(ledEng, routeMgr);
  const translitEng = new IndicTransliterationEngine();
  const glyphMgr = new GlyphManager();
  glyphMgr.setRouteManager(routeMgr);
  glyphMgr.init();
  const serialFlasher = new WebSerialFlasher();
  window.routeMgr = routeMgr;
  window.ledEng = ledEng;

  // Register engine singletons into Central State Registry
  if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
    window.ITMS.State.registerEngine('routeManager', routeMgr);
    window.ITMS.State.registerEngine('ledEngine', ledEng);
    window.ITMS.State.registerEngine('exporter', exporter);
    window.ITMS.State.registerEngine('translitEngine', translitEng);
    window.ITMS.State.registerEngine('glyphManager', glyphMgr);
    window.ITMS.State.registerEngine('serialFlasher', serialFlasher);
  }

  // Register Service Worker for PWA Offline Caching (supported only on http/https/localhost origins)
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('ITMS PWA ServiceWorker registered:', reg.scope);
      }).catch(err => {
        console.warn('ITMS ServiceWorker registration failed:', err);
      });
    });
  }

  // Security XSS & Attribute Sanitization Helpers (Backed by shared ITMSUtils)
  const escapeHtml = (typeof window !== 'undefined' && window.ITMSUtils && window.ITMSUtils.escapeHtml)
    ? window.ITMSUtils.escapeHtml
    : (str) => (str === null || str === undefined) ? '' : String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const escapeAttr = (typeof window !== 'undefined' && window.ITMSUtils && window.ITMSUtils.escapeAttr)
    ? window.ITMSUtils.escapeAttr
    : (str) => (str === null || str === undefined) ? '' : String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Auto-refresh views when IndexedDB high-capacity database finishes loading
  routeMgr.onDataLoaded = () => {
    updateDashboard();
    if (activeView === 'routes') renderRouteManagerView();
  };

  // Dedicated LED Marquee Engine for Dashboard Preview
  let dashMarqueeEng = null;
  const marqueeCanvas = document.getElementById('dash-marquee-canvas');
  if (marqueeCanvas) {
    dashMarqueeEng = new LEDEngine('dash-marquee-canvas');
    dashMarqueeEng.config.isInteractive = false;
    dashMarqueeEng.config.matrixWidth = 512;
    dashMarqueeEng.config.matrixHeight = 64;
    dashMarqueeEng.config.fontSize = 20;
    dashMarqueeEng.config.ledColor = '#ff2a2a';
    dashMarqueeEng.config.scrollMode = 'scroll-left';
    dashMarqueeEng.config.scrollSpeed = 28;
    window.__dashMarqueeEng = dashMarqueeEng;
  }

  // Central State References & Synchronizers
  const AppState = (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) ? window.ITMS.State : null;

  let activeView = AppState ? AppState.get('app.activeView', 'dashboard') : 'dashboard';
  let currentPreviewRouteId = (AppState && AppState.get('route.activeRouteId')) || 'ALL';
  let currentSelectedLedColor = AppState ? AppState.get('led.ledColor', '#ff2a2a') : '#ff2a2a';
  let dashHistoryCurrentPage = AppState ? AppState.get('route.currentPage', 1) : 1;
  let dashHistoryPageSize = AppState ? AppState.get('route.pageSize', 15) : 15;
  let currentDrawerRouteId = AppState ? AppState.get('route.drawerRouteId', null) : null;

  // Slide Drawer: Edit Route & Stops (Bus History Tab)
  function openHistoryRouteDrawer(routeId) {
    const route = routeMgr.getRoute(routeId);
    if (!route) return;
    currentDrawerRouteId = routeId;
    if (AppState) AppState.set('route.drawerRouteId', routeId);
    renderHistoryRouteDrawerDetails();
    const overlay = document.getElementById('history-drawer-overlay');
    if (overlay) overlay.classList.add('active');
  }

  function closeHistoryRouteDrawer() {
    const overlay = document.getElementById('history-drawer-overlay');
    if (overlay) overlay.classList.remove('active');
    currentDrawerRouteId = null;
    if (AppState) AppState.set('route.drawerRouteId', null);
  }

  function renderHistoryRouteDrawerDetails() {
    if (!currentDrawerRouteId) return;
    const route = routeMgr.getRoute(currentDrawerRouteId);
    if (!route) {
      closeHistoryRouteDrawer();
      return;
    }

    const titleEl = document.getElementById('drawer-route-title');
    const badgeEl = document.getElementById('drawer-route-badge');
    if (titleEl) titleEl.textContent = `Edit Route & Stops: ${route.name}`;
    if (badgeEl) badgeEl.textContent = route.code || 'ROUTE';

    document.getElementById('drawer-route-code').value = route.code || '';
    document.getElementById('drawer-route-name').value = route.name || '';
    document.getElementById('drawer-start-en').value = route.startPoint?.en || '';
    document.getElementById('drawer-start-te').value = route.startPoint?.te || '';
    document.getElementById('drawer-dest-en').value = route.destination?.en || '';
    document.getElementById('drawer-dest-te').value = route.destination?.te || '';

    const countEl = document.getElementById('drawer-stops-count');
    if (countEl) countEl.textContent = Array.isArray(route.stops) ? route.stops.length : 0;

    const stopsContainer = document.getElementById('drawer-stops-list');
    if (stopsContainer) {
      stopsContainer.innerHTML = route.stops.map((stop, idx) => {
        const stopIdAttr = escapeAttr(stop.id);
        const stopEnAttr = escapeAttr(stop.en || '');
        const stopTeAttr = escapeAttr(stop.te || '');
        return `
        <div class="stop-row-item" data-idx="${idx}" data-id="${stopIdAttr}">
          <span class="seq-num">#${stop.seq}</span>
          <div>
            <div class="input-action-wrapper">
              <input type="text" class="form-control drawer-stop-input-en" data-id="${stopIdAttr}" value="${stopEnAttr}" placeholder="English Stop Name">
              <button type="button" class="input-translit-btn btn-drawer-translit" data-id="${stopIdAttr}" title="Auto-suggest Telugu (తెలుగు)">⚡ TE</button>
            </div>
          </div>
          <div>
            <input type="text" class="form-control drawer-stop-input-te" data-id="${stopIdAttr}" value="${stopTeAttr}" placeholder="Telugu Stop Name">
          </div>
          <div style="display:flex; gap:4px; justify-content:flex-end;">
            <button class="btn btn-sm btn-secondary drawer-stop-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move stop up (earlier in sequence)" style="padding:4px 8px; font-weight:700;">▲</button>
            <button class="btn btn-sm btn-secondary drawer-stop-move-down" data-idx="${idx}" ${idx === route.stops.length - 1 ? 'disabled' : ''} title="Move stop down (later in sequence)" style="padding:4px 8px; font-weight:700;">▼</button>
            <button class="btn btn-sm btn-danger drawer-stop-delete" data-id="${stopIdAttr}" title="Remove this stop">&times;</button>
          </div>
        </div>
      `;
      }).join('');

      stopsContainer.querySelectorAll('.btn-drawer-translit').forEach(btn => {
        btn.addEventListener('click', () => {
          const stop = route.stops.find(s => s.id === btn.dataset.id);
          if (stop && stop.en) {
            stop.te = translitEng.transliterate(stop.en);
            routeMgr.saveRoutes();
            renderHistoryRouteDrawerDetails();
            updateDashboard();
            showToast(`Auto-suggested Telugu: ${stop.en} ➔ ${stop.te}`, 'info');
          }
        });
      });



      stopsContainer.querySelectorAll('.drawer-stop-input-en').forEach(input => {
        input.addEventListener('change', (e) => {
          const stop = route.stops.find(s => s.id === e.target.dataset.id);
          if (stop) {
            stop.en = e.target.value;
            routeMgr.saveRoutes();
            updateDashboard();
          }
        });
      });

      stopsContainer.querySelectorAll('.drawer-stop-input-te').forEach(input => {
        input.addEventListener('change', (e) => {
          const stop = route.stops.find(s => s.id === e.target.dataset.id);
          if (stop) {
            stop.te = e.target.value;
            routeMgr.saveRoutes();
            updateDashboard();
          }
        });
      });

      stopsContainer.querySelectorAll('.drawer-stop-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.reorderStop(route.id, parseInt(btn.dataset.idx, 10), 'UP');
          renderHistoryRouteDrawerDetails();
          updateDashboard();
        });
      });

      stopsContainer.querySelectorAll('.drawer-stop-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.reorderStop(route.id, parseInt(btn.dataset.idx, 10), 'DOWN');
          renderHistoryRouteDrawerDetails();
          updateDashboard();
        });
      });

      stopsContainer.querySelectorAll('.drawer-stop-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.deleteStop(route.id, btn.dataset.id);
          renderHistoryRouteDrawerDetails();
          updateDashboard();
          showToast('Stop removed from route', 'info');
        });
      });
      initIcons(stopsContainer);
    }
  }

  // Lightweight debounce helper to prevent UI lag on rapid keystrokes
  function debounce(func, wait = 120) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Icons Helper (Bootstrap Icons rendered via CSS font glyphs)
  function initIcons(container = null) {
    // No-op: Bootstrap Icons render natively via CSS
  }

  // Live Digital Clock in Top Bar
  function updateLiveClock() {
    const clockEl = document.getElementById('dash-live-clock') || document.getElementById('live-clock');
    if (!clockEl) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hours}:${minutes}:${seconds}`;
  }
  // Clock & Layout Initializers
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // View Routing Manager
  function switchView(viewName, force = false) {
    const targetPage = document.getElementById(`view-${viewName}`);
    if (!force && activeView === viewName && targetPage && targetPage.classList.contains('active')) return;

    // Pause inactive LED engines when switching away to preserve CPU, memory & battery
    if (dashMarqueeEng && typeof dashMarqueeEng.stopAnimation === 'function') {
      dashMarqueeEng.stopAnimation();
    }
    if (ledEng && typeof ledEng.stopAnimation === 'function') {
      ledEng.stopAnimation();
    }
    if (typeof glyphMgr !== 'undefined' && glyphMgr.ledEng && typeof glyphMgr.ledEng.stopAnimation === 'function') {
      glyphMgr.ledEng.stopAnimation();
    }

    activeView = viewName;
    if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
      window.ITMS.State.set('app.activeView', viewName, { silent: true });
    }
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === viewName);
    });

    document.querySelectorAll('.view-page').forEach(el => {
      el.classList.toggle('active', el.id === `view-${viewName}`);
    });

    // Update Header Title
    const titles = {
      dashboard: 'System Overview Dashboard',
      routes: 'Bus Route Information Manager',
      bitmap: 'LED Bitmap Creator & Matrix Editor',
      languages: 'Multi-Lingual Language Library & Font Manager',
      export: 'Export Center & Package Generator'
    };
    document.getElementById('header-title').textContent = titles[viewName] || 'ITMS Manager';

    // Trigger View Refresh Logic
    if (viewName === 'dashboard') {
      updateDashboard();
      if (dashMarqueeEng) dashMarqueeEng.startAnimation();
    } else if (viewName === 'routes') {
      renderRouteManagerView();
    } else if (viewName === 'bitmap') {
      syncBitmapCreatorInputs();
      initIcons(document.getElementById('view-bitmap'));
      if (ledEng) ledEng.startAnimation();
    } else if (viewName === 'languages') {
      renderLanguageLibraryView();
      if (typeof glyphMgr !== 'undefined' && glyphMgr.ledEng) {
        glyphMgr.ledEng.startAnimation();
      }
    } else if (viewName === 'export') {
      renderExportCenterView();
    }

    const currentViewEl = document.getElementById(`view-${viewName}`);
    if (currentViewEl) initIcons(currentViewEl);

    // Close mobile drawer if open
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.classList.remove('sidebar-mobile-open');
    }
  }

  // Central State Reactive Subscription for Navigation
  if (AppState) {
    AppState.subscribe('app.activeView', (newView) => {
      if (newView && newView !== activeView) {
        switchView(newView);
      }
    });
  }

  // Handle Navigation Click Events
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
    });
  });

  // Handle Sidebar Sub-Menu Navigation Click Events
  document.querySelectorAll('.nav-sub-item').forEach(subItem => {
    subItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const view = subItem.dataset.view;
      const subtab = subItem.dataset.subtab;

      switchView(view);

      if (typeof glyphMgr !== 'undefined') {
        glyphMgr.switchSubTab(subtab);
      }

      document.querySelectorAll('.nav-sub-item').forEach(si => {
        si.classList.toggle('active', si === subItem);
      });
    });
  });

  // Handle Dashboard Quick Operation Card Clicks
  const quickActionCards = [
    { id: 'dash-act-bitmap', view: 'bitmap' },
    { id: 'dash-act-routes', view: 'routes' },
    { id: 'dash-act-languages', view: 'languages' },
    { id: 'dash-act-export', view: 'export' },
    { id: 'dash-card-active-routes', view: 'routes' }
  ];

  quickActionCards.forEach(({ id, view }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', () => switchView(view));
    }
  });

  // Enterprise Hardware-Accelerated Hamburger Menu & Accessibility Controller
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const appContainer = document.getElementById('app-container');

  function updateMenuAriaState() {
    if (!menuToggleBtn || !appContainer) return;
    const isMobile = window.innerWidth <= 768;
    const isOpenedOrCollapsed = isMobile
      ? appContainer.classList.contains('sidebar-mobile-open')
      : appContainer.classList.contains('sidebar-collapsed');

    menuToggleBtn.setAttribute('aria-expanded', isOpenedOrCollapsed ? 'true' : 'false');
  }

  function toggleSidebar(forceCloseMobile = false) {
    if (!appContainer) return;
    const viewContainer = document.querySelector('.view-container');
    const scrollPos = viewContainer ? viewContainer.scrollTop : 0;

    const isMobile = window.innerWidth <= 768;
    if (forceCloseMobile) {
      appContainer.classList.remove('sidebar-mobile-open');
    } else {
      if (isMobile) {
        appContainer.classList.toggle('sidebar-mobile-open');
      } else {
        appContainer.classList.toggle('sidebar-collapsed');
      }
    }

    if (viewContainer && viewContainer.scrollTop !== scrollPos) {
      viewContainer.scrollTop = scrollPos;
    }
    updateMenuAriaState();

    // Smoothly notify responsive canvases/charts after CSS transition completes
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
      const handleTransitionEnd = (e) => {
        if (e.propertyName === 'width' || e.propertyName === 'transform') {
          sidebar.removeEventListener('transitionend', handleTransitionEnd);
          window.dispatchEvent(new Event('resize'));
        }
      };
      sidebar.addEventListener('transitionend', handleTransitionEnd);
    }
  }

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleSidebar();
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      toggleSidebar(true);
    });
  }

  // Keyboard Accessibility & Navigation Shortcuts (Escape to close, Ctrl+S to save, Ctrl+N, Ctrl+F)
  document.addEventListener('keydown', (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    // 1. ESCAPE: Close active modals, drawers, or mobile sidebar
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        e.preventDefault();
        return;
      }
      const historyOverlay = document.getElementById('history-drawer-overlay');
      if (historyOverlay && historyOverlay.classList.contains('active')) {
        closeHistoryRouteDrawer();
        e.preventDefault();
        return;
      }
      if (appContainer && appContainer.classList.contains('sidebar-mobile-open')) {
        toggleSidebar(true);
        menuToggleBtn?.focus();
        e.preventDefault();
        return;
      }
    }

    // 2. CTRL+S / CMD+S: Save current form or sync database
    if (isCtrlOrCmd && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();

      const addRouteModal = document.getElementById('modal-add-route');
      if (addRouteModal && addRouteModal.classList.contains('active')) {
        const form = document.getElementById('form-add-route');
        if (form) {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          return;
        }
      }

      const bulkImportModal = document.getElementById('modal-bulk-import');
      if (bulkImportModal && bulkImportModal.classList.contains('active')) {
        const importBtn = document.getElementById('btn-confirm-bulk-import') || document.getElementById('bulk-import-submit-btn');
        if (importBtn && !importBtn.disabled) {
          importBtn.click();
          return;
        }
      }

      // General route manager persistence
      if (routeMgr && typeof routeMgr.saveToLocalStorage === 'function') {
        routeMgr.saveToLocalStorage();
      }
      if (routeMgr && typeof routeMgr.saveToIndexedDB === 'function' && Array.isArray(routeMgr.routes)) {
        routeMgr.saveToIndexedDB(routeMgr.routes);
      }
      showToast('All routes and application state saved successfully!', 'success');
      return;
    }

    // 3. CTRL+N / CMD+N: Quick New Route (when not typing in an input)
    if (isCtrlOrCmd && (e.key === 'n' || e.key === 'N') && !e.shiftKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        openRouteModal('create');
        return;
      }
    }

    // 4. CTRL+F / CMD+F: Quick Search Focus
    if (isCtrlOrCmd && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        if (activeView === 'routes') {
          (document.getElementById('route-search-input') || document.getElementById('route-search'))?.focus();
        } else if (activeView === 'dashboard') {
          (document.getElementById('dash-route-search-input') || document.getElementById('dash-search-input'))?.focus();
        } else if (activeView === 'export') {
          document.getElementById('export-route-search')?.focus();
        }
        return;
      }
    }

    // 5. ? or CTRL+/ : Open Keyboard Shortcuts HUD
    if ((e.key === '?' && !isCtrlOrCmd) || (isCtrlOrCmd && (e.key === '/' || e.key === '?'))) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        openModal('modal-keyboard-shortcuts');
        return;
      }
    }
  });



  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && appContainer && appContainer.classList.contains('sidebar-mobile-open')) {
      appContainer.classList.remove('sidebar-mobile-open');
    }
    updateMenuAriaState();
  });

  // Auto-pause animation ticker when tab is in background / hidden to eliminate unnecessary background CPU load
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (dashMarqueeEng && typeof dashMarqueeEng.stopAnimation === 'function') dashMarqueeEng.stopAnimation();
      if (ledEng && typeof ledEng.stopAnimation === 'function') ledEng.stopAnimation();
      if (glyphMgr && typeof glyphMgr.stopAnimation === 'function') glyphMgr.stopAnimation();
    } else {
      if (activeView === 'dashboard' && dashMarqueeEng && typeof dashMarqueeEng.startAnimation === 'function') {
        dashMarqueeEng.startAnimation();
      }
      if (activeView === 'bitmap' && ledEng && typeof ledEng.startAnimation === 'function') {
        ledEng.startAnimation();
      }
      if (activeView === 'languages' && glyphMgr && typeof glyphMgr.startAnimation === 'function') {
        glyphMgr.startAnimation();
      }
    }
  });

  // =========================================================================
  // DASHBOARD VIEW LOGIC
  // =========================================================================
  function updateRoutePreviewDropdown() {
    const selectEl = document.getElementById('dash-marquee-route-select');
    if (!selectEl) return;

    const routes = routeMgr.routes;
    let html = `<option value="ALL" ${currentPreviewRouteId === 'ALL' ? 'selected' : ''}>All Active Routes</option>`;

    routes.forEach(r => {
      const isSelected = currentPreviewRouteId === r.id ? 'selected' : '';
      html += `<option value="${r.id}" ${isSelected}>[${r.code}] ${r.name}</option>`;
    });

    selectEl.innerHTML = html;
  }

  let dashPreviewDisplayMode = 'auto-cycle';
  let dashPreviewSplitRatio = 0.60;
  let dashCycleStage = 0; // 0: English, 1: Hindi, 2: Telugu
  let dashCycleInterval = null;
  window.__getDashCycleStage = () => dashCycleStage;
  window.__setDashCycleStage = (s) => { dashCycleStage = s; updateDashboardMarquee(); };
  window.__updateDashboardMarquee = updateDashboardMarquee;

  function updateDashboardMarquee() {
    if (!dashMarqueeEng) return;

    try {
    dashMarqueeEng.config.ledColor = currentSelectedLedColor;

    const heightSelect = document.getElementById('dash-marquee-height-select');
    const widthSelect = document.getElementById('dash-marquee-width-select');
    const modeSelect = document.getElementById('dash-marquee-mode-select');
    const splitSlider = document.getElementById('dash-line-split-slider');
    const splitBadge = document.getElementById('dash-line-split-badge');
    const splitCard = document.getElementById('dash-line-split-card');

    if (modeSelect) dashPreviewDisplayMode = modeSelect.value;
    if (splitSlider) dashPreviewSplitRatio = parseInt(splitSlider.value, 10) / 100;

    const mHeight = heightSelect ? parseInt(heightSelect.value, 10) : 64;
    const mWidth = widthSelect ? parseInt(widthSelect.value, 10) : 512;

    dashMarqueeEng.config.matrixHeight = mHeight;
    dashMarqueeEng.config.matrixWidth = mWidth;
    dashMarqueeEng.config.splitRatio = dashPreviewSplitRatio;

    const h1 = Math.max(6, Math.min(mHeight - 6, Math.round(mHeight * dashPreviewSplitRatio)));
    const h2 = mHeight - h1;
    if (splitBadge) {
      splitBadge.textContent = `${Math.round(dashPreviewSplitRatio * 100)}% / ${100 - Math.round(dashPreviewSplitRatio * 100)}%`;
      splitBadge.title = `Top Line 1: ${h1}px / Bottom Line 2: ${h2}px`;
    }

    if (splitCard) {
      const showSplit = (dashPreviewDisplayMode === 'auto-cycle' || dashPreviewDisplayMode === 'two-line-en');
      splitCard.style.opacity = showSplit ? '1' : '0.4';
      splitCard.style.pointerEvents = showSplit ? 'auto' : 'none';
    }

    const routes = (typeof routeMgr !== 'undefined' && Array.isArray(routeMgr.routes)) ? routeMgr.routes : [];

    if (routes.length === 0) {
      dashMarqueeEng.config.text = 'ADD BUS ROUTES TO PREVIEW LED DISPLAY';
      dashMarqueeEng.renderTextToMatrix('ADD BUS ROUTES TO PREVIEW LED DISPLAY');
      dashMarqueeEng.startAnimation();
      return;
    }

    const includeStopsChk = document.getElementById('dash-marquee-include-stops');
    const includeStops = includeStopsChk ? includeStopsChk.checked : true;

    function getViaStops(r, lang = 'en') {
      try {
        if (!r || !r.stops || !Array.isArray(r.stops) || r.stops.length <= 0) return [];
        const startRaw = (typeof r.startPoint === 'object' ? r.startPoint?.[lang] : '') || (lang !== 'en' ? translitEng.transliterate(typeof r.startPoint === 'object' ? r.startPoint?.en : (r.startPoint || ''), lang) : (r.startPoint || ''));
        const destRaw = (typeof r.destination === 'object' ? r.destination?.[lang] : '') || (lang !== 'en' ? translitEng.transliterate(typeof r.destination === 'object' ? r.destination?.en : (r.destination || ''), lang) : (r.destination || ''));
        const start = String(startRaw || '').trim().toLowerCase();
        const dest = String(destRaw || '').trim().toLowerCase();
        const all = r.stops.map(s => {
          if (!s) return '';
          let val = (s[lang] || '').trim();
          if (!val && lang !== 'en' && s.en) {
            val = translitEng.transliterate(s.en, lang);
          }
          return val;
        }).filter(Boolean);

        const via = all.filter(name => {
          const l = name.toLowerCase();
          return l !== start && l !== dest;
        });
        if (via.length > 0) return via;
        return all.length > 2 ? all.slice(1, -1) : [];
      } catch (_) {
        return [];
      }
    }

    // Determine current effective layout mode
    let effectiveMode = dashPreviewDisplayMode;
    if (effectiveMode === 'auto-cycle') {
      effectiveMode = (dashCycleStage === 0) ? 'stage-en' : ((dashCycleStage === 1) ? 'stage-hi' : 'stage-te');
    } else if (effectiveMode === 'next-stop') {
      effectiveMode = (dashCycleStage === 0) ? 'stop-en' : ((dashCycleStage === 1) ? 'stop-hi' : 'stop-te');
    }

    // Target route(s)
    let targetRoute = null;
    if (currentPreviewRouteId && currentPreviewRouteId !== 'ALL' && window.routeMgr && typeof routeMgr.getRoute === 'function') {
      targetRoute = routeMgr.getRoute(currentPreviewRouteId);
      if (!targetRoute) {
        currentPreviewRouteId = 'ALL';
      }
    }
    const isAllRoutes = (!currentPreviewRouteId || currentPreviewRouteId === 'ALL' || !targetRoute);
    const code = (!isAllRoutes && targetRoute) ? (targetRoute.code || 'BUS') : (routes.length === 1 ? (routes[0]?.code || 'BUS') : 'ALL');

    if (effectiveMode === 'stage-en' || effectiveMode === 'two-line-en') {
      // 1. ENGLISH STAGE (Two-Line Split or Single Line)
      let line1En = '';
      let line2Via = '';

      if (isAllRoutes) {
        const previewRoutes = routes.slice(0, 6);
        line1En = previewRoutes.map(r => {
          const start = (r.startPoint?.en || '').trim();
          const dest = (r.destination?.en || '').trim();
          const name = (r.name || `${start} - ${dest}`).replace(/^ROUTE\s*NAME\s*[:-]\s*/i, '');
          return `[${r.code}] ${name}`;
        }).join('   ★   ');

        if (includeStops) {
          line2Via = previewRoutes.map(r => {
            const via = getViaStops(r, 'en');
            return via.length > 0 ? `[${r.code}] VIA: ${via.join(' - ')}` : '';
          }).filter(Boolean).join('   ★   ');
        }
      } else if (targetRoute) {
        const start = (targetRoute.startPoint?.en || '').trim();
        const dest = (targetRoute.destination?.en || '').trim();
        const rName = (targetRoute.name || `${start} - ${dest}`).replace(/^ROUTE\s*NAME\s*[:-]\s*/i, '');
        line1En = `[${targetRoute.code || 'BUS'}] ${rName}`;
        if (includeStops) {
          const via = getViaStops(targetRoute, 'en');
          line2Via = via.length > 0 ? `VIA :- ${via.join(' - ')}` : '';
        }
      }

      // Two Lines English: Line 1 (Destination) + Line 2 (VIA Stops) with adjustable individual line heights
      dashMarqueeEng.renderDualZoneMarquee(code, line1En, line2Via, { splitRatio: dashPreviewSplitRatio });

    } else if (effectiveMode === 'stage-hi' || effectiveMode === 'one-line-hi') {
      // 2. HINDI STAGE (हिंदी)
      let lineHi = '';
      if (isAllRoutes) {
        const previewRoutes = routes.slice(0, 6);
        lineHi = previewRoutes.map(r => {
          const startHi = (r.startPoint?.hi || translitEng.transliterate(r.startPoint?.en || '', 'hi')).trim();
          const destHi = (r.destination?.hi || translitEng.transliterate(r.destination?.en || '', 'hi')).trim();
          const via = includeStops ? getViaStops(r, 'hi') : [];
          const viaStr = via.length > 0 ? ` (वाया: ${via.join(' - ')})` : '';
          return `[${r.code}] ${startHi} - ${destHi}${viaStr}`;
        }).join('   ★   ');
      } else if (targetRoute) {
        const startHi = (targetRoute.startPoint?.hi || translitEng.transliterate(targetRoute.startPoint?.en || '', 'hi')).trim();
        const destHi = (targetRoute.destination?.hi || translitEng.transliterate(targetRoute.destination?.en || '', 'hi')).trim();
        const via = includeStops ? getViaStops(targetRoute, 'hi') : [];
        const viaStr = via.length > 0 ? `   (वाया: ${via.join(' - ')})` : '';
        lineHi = `[${targetRoute.code || 'BUS'}] ${startHi} - ${destHi}${viaStr}`;
      }

      dashMarqueeEng.renderDualZoneMarquee(code, lineHi, '', { splitRatio: 1.0 });

    } else if (effectiveMode === 'stage-te' || effectiveMode === 'one-line-te') {
      // 3. TELUGU / LOCAL LANGUAGE STAGE (తెలుగు)
      let lineTe = '';
      if (isAllRoutes) {
        const previewRoutes = routes.slice(0, 6);
        lineTe = previewRoutes.map(r => {
          const startTe = (r.startPoint?.te || translitEng.transliterate(r.startPoint?.en || '', 'te')).trim();
          const destTe = (r.destination?.te || translitEng.transliterate(r.destination?.en || '', 'te')).trim();
          const via = includeStops ? getViaStops(r, 'te') : [];
          const viaStr = via.length > 0 ? ` (వియా: ${via.join(' - ')})` : '';
          return `[${r.code}] ${startTe} - ${destTe}${viaStr}`;
        }).join('   ★   ');
      } else if (targetRoute) {
        const startTe = (targetRoute.startPoint?.te || translitEng.transliterate(targetRoute.startPoint?.en || '', 'te')).trim();
        const destTe = (targetRoute.destination?.te || translitEng.transliterate(targetRoute.destination?.en || '', 'te')).trim();
        const via = includeStops ? getViaStops(targetRoute, 'te') : [];
        const viaStr = via.length > 0 ? `   (వియా: ${via.join(' - ')})` : '';
        lineTe = `[${targetRoute.code || 'BUS'}] ${startTe} - ${destTe}${viaStr}`;
      }

      dashMarqueeEng.renderDualZoneMarquee(code, lineTe, '', { splitRatio: 1.0 });

    } else if (effectiveMode.startsWith('stop-')) {
      // Next Stop Multi-Lingual Sequence (EN ➔ HI ➔ TE)
      let stopEn = 'NEXT STOP';
      let stopHi = 'अगला स्टॉप';
      let stopTe = 'తదుపరి స్టాప్';

      if (targetRoute && Array.isArray(targetRoute.stops) && targetRoute.stops.length > 0) {
        const s = targetRoute.stops[Math.min(1, targetRoute.stops.length - 1)];
        if (s) {
          stopEn = (s.en || targetRoute.destination?.en || 'DESTINATION').toUpperCase();
          stopHi = s.hi || translitEng.transliterate(s.en || '', 'hi');
          stopTe = s.te || translitEng.transliterate(s.en || '', 'te');
        }
      }

      let announcementText = '';
      if (effectiveMode === 'stop-en') {
        announcementText = `🔔 NEXT STOP: ${stopEn}`;
      } else if (effectiveMode === 'stop-hi') {
        announcementText = `🔔 अगला स्टॉप: ${stopHi}`;
      } else {
        announcementText = `🔔 తదుపరి స్టాప్: ${stopTe}`;
      }

      dashMarqueeEng.renderTextToMatrix(announcementText);
    }

    // Auto-cycle management: Wait for COMPLETE scroll traversal before switching language
    if (dashCycleInterval) {
      clearTimeout(dashCycleInterval);
      clearInterval(dashCycleInterval);
      dashCycleInterval = null;
    }

    if (dashPreviewDisplayMode === 'auto-cycle' || dashPreviewDisplayMode === 'next-stop') {
      let cycleHandled = false;
      dashMarqueeEng.onScrollCycleComplete = () => {
        if (cycleHandled) return;
        cycleHandled = true;
        dashMarqueeEng.onScrollCycleComplete = null;
        if (activeView === 'dashboard' && (dashPreviewDisplayMode === 'auto-cycle' || dashPreviewDisplayMode === 'next-stop')) {
          dashCycleInterval = setTimeout(() => {
            if (activeView === 'dashboard' && (dashPreviewDisplayMode === 'auto-cycle' || dashPreviewDisplayMode === 'next-stop')) {
              dashCycleStage = (dashCycleStage + 1) % 3;
              updateDashboardMarquee();
            }
          }, 400);
        }
      };

      // Fallback dwell timer ONLY if text fits completely on screen without scrolling
      const fullW = dashMarqueeEng.config.matrixWidth || 512;
      const isScrollable = dashMarqueeEng.isDualZone 
        ? ((dashMarqueeEng.line1TextWidth || 0) > fullW || (dashMarqueeEng.hasLine2 && (dashMarqueeEng.line2TextWidth || 0) > fullW))
        : (dashMarqueeEng.config.scrollMode !== 'static' && (dashMarqueeEng.fullMatrixTextWidth || 0) > fullW);

      if (!isScrollable) {
        dashCycleInterval = setTimeout(() => {
          if (activeView === 'dashboard' && (dashPreviewDisplayMode === 'auto-cycle' || dashPreviewDisplayMode === 'next-stop')) {
            dashCycleStage = (dashCycleStage + 1) % 3;
            updateDashboardMarquee();
          }
        }, 3500);
      }
    } else {
      dashMarqueeEng.onScrollCycleComplete = null;
    }

    if (dashMarqueeEng && activeView === 'dashboard') {
      dashMarqueeEng.startAnimation();
    }
  } catch (err) {
    console.error('[DashboardMarquee] Error rendering marquee:', err);
  }
}

  function updateSelectedLedColor(color) {
    currentSelectedLedColor = color;
    ledEng.config.ledColor = color;
    ledEng.drawUIBoard();

    if (dashMarqueeEng) {
      dashMarqueeEng.config.ledColor = color;
      dashMarqueeEng.drawUIBoard();
      dashMarqueeEng.startAnimation();
    }
  }

  function goToLiveLedPreview(routeId, scrollIntoView = true) {
    dashCycleStage = 0; // Reset sequence to English first
    if (routeId) {
      currentPreviewRouteId = routeId;
    }
    if (typeof routeMgr !== 'undefined' && routeId) {
      routeMgr.activeRouteId = routeId;
    }
    const select = document.getElementById('dash-marquee-route-select');
    if (select && routeId) {
      select.value = routeId;
    }
    if (activeView !== 'dashboard') {
      switchView('dashboard');
      scrollIntoView = true;
    } else {
      updateRoutePreviewDropdown();
      updateDashboardMarquee();
    }
    updateDashboard(true);

    if (scrollIntoView) {
      const previewCard = document.getElementById('dash-card-live-preview');
      if (previewCard) {
        previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        previewCard.classList.remove('highlight-pulse');
        void previewCard.offsetWidth; // force reflow
        previewCard.classList.add('highlight-pulse');
        setTimeout(() => previewCard.classList.remove('highlight-pulse'), 2100);
      }
    }

    setTimeout(() => {
      const activeRow = document.querySelector('#dash-recent-routes tr.row-preview-active');
      if (activeRow) {
        activeRow.classList.add('row-pulse-flash');
        setTimeout(() => activeRow.classList.remove('row-pulse-flash'), 1200);
      }
    }, 50);
  }

  let isRouteBulkSelectMode = false;
  let selectedRouteIds = new Set();
  let pendingBulkDeleteIds = [];

  function openBulkDeleteModal(routeIds) {
    if (!Array.isArray(routeIds) || routeIds.length === 0) return;
    pendingBulkDeleteIds = routeIds;
    const countText = document.getElementById('bulk-delete-modal-count-text');
    const listContainer = document.getElementById('bulk-delete-modal-routes-list');

    if (countText) {
      countText.textContent = `${routeIds.length} route${routeIds.length > 1 ? 's' : ''}`;
    }

    if (listContainer) {
      const routesToDelete = routeIds.map(id => routeMgr.getRoute(id)).filter(Boolean);
      listContainer.innerHTML = routesToDelete.map(r => `
        <span style="background:rgba(239,68,68,0.12); color:#dc2626; border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:4px 8px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
          <strong>[${escapeHtml(r.code)}]</strong> ${escapeHtml(r.name)}
        </span>
      `).join('');
    }

    openModal('modal-confirm-bulk-delete');
  }

  function updateDashboard(refreshMarquee = true) {
    const dashSearchInput = document.getElementById('dash-route-search-input');
    const query = dashSearchInput ? dashSearchInput.value.trim() : '';

    const routes = routeMgr.searchRoutes(query);
    const totalRoutes = routes.length;

    const statRoutesEl = document.getElementById('dash-stat-routes');
    if (statRoutesEl) statRoutesEl.textContent = routeMgr.routes.length;

    if (activeView === 'dashboard') {
      updateRoutePreviewDropdown();
      if (refreshMarquee) {
        updateDashboardMarquee();
      }
      initIcons(document.getElementById('view-dashboard'));
    }

    // Render Recent Routes Table
    const tbody = document.getElementById('dash-recent-routes');
    if (tbody) {
      if (routes.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">
              ${query ? 'No matching routes found for "' + query + '".' : 'No bus routes yet. Click <strong>New Route</strong> to add your first route manually.'}
            </td>
          </tr>
        `;
        renderDashHistoryPagination(0);
        return;
      }

      // Calculate Pagination Slice (Default 15 per page)
      const totalPages = Math.max(1, Math.ceil(totalRoutes / dashHistoryPageSize));
      if (dashHistoryCurrentPage > totalPages) {
        dashHistoryCurrentPage = totalPages;
      }

      const startIndex = (dashHistoryCurrentPage - 1) * dashHistoryPageSize;
      const endIndex = startIndex + dashHistoryPageSize;
      const pageRoutes = routes.slice(startIndex, endIndex);

      // Update Dashboard Bulk Delete Button & Select All Checkbox
      const dashBulkBtn = document.getElementById('dash-btn-bulk-delete');
      const dashBulkCount = document.getElementById('dash-bulk-selected-count');
      if (dashBulkBtn) {
        if (selectedRouteIds.size > 0) {
          dashBulkBtn.style.display = 'inline-flex';
          if (dashBulkCount) dashBulkCount.textContent = selectedRouteIds.size;
        } else {
          dashBulkBtn.style.display = 'none';
        }
      }

      const selectAllChk = document.getElementById('dash-select-all-routes');
      if (selectAllChk) {
        selectAllChk.checked = pageRoutes.length > 0 && pageRoutes.every(r => selectedRouteIds.has(r.id));
      }

      tbody.innerHTML = pageRoutes.map(r => {
        const startEn = escapeHtml(r.startPoint?.en || r.startEn || 'Start');
        const destEn = escapeHtml(r.destination?.en || r.destEn || 'Destination');
        const stopCount = Array.isArray(r.stops) ? r.stops.length : 0;
        const code = escapeHtml(r.code || 'ROUTE');
        const name = escapeHtml(r.name || 'Unnamed Route');
        const codeAttr = escapeAttr(r.code || 'ROUTE');
        const nameAttr = escapeAttr(r.name || 'Unnamed Route');
        const isChecked = selectedRouteIds.has(r.id);
        const isLiveInPreview = (r.id === currentPreviewRouteId);
        const liveBadgeHtml = isLiveInPreview ? `
          <span class="live-preview-chip" title="Currently Live in LED Bus Preview"><i class="bi bi-broadcast" style="width:10px; height:10px; font-size:10px;"></i> LIVE</span>
        ` : '';

        return `
        <tr class="${isChecked ? 'row-selected' : ''} ${isLiveInPreview ? 'row-preview-active' : ''}">
          <td style="text-align:center;">
            <input type="checkbox" class="dash-route-row-chk" data-id="${escapeAttr(r.id)}" ${isChecked ? 'checked' : ''} style="cursor:pointer; width:15px; height:15px; accent-color:#00ABEF;">
          </td>
          <td class="col-code"><span class="route-num-badge">${code}</span></td>
          <td class="col-name"><strong style="${isLiveInPreview ? 'color:#0284c7;' : ''}">${name}</strong>${liveBadgeHtml}</td>
          <td class="col-terminals">${startEn} &rarr; ${destEn}</td>
          <td class="col-stops"><strong style="color:var(--primary);">${stopCount} Stops</strong></td>
          <td class="col-action">
            <div class="action-btn-group">
              <button class="btn btn-sm ${isLiveInPreview ? 'btn-live-active' : 'btn-success'} action-preview-route" data-id="${escapeAttr(r.id)}" data-code="${codeAttr}" data-name="${nameAttr}"><i class="bi bi-display" style="width:12px; height:12px; stroke-width:2.2; font-size:12px;"></i> ${isLiveInPreview ? 'Active in LED' : 'Preview LED'}</button>
              <button class="btn btn-sm btn-primary action-edit-route" data-id="${escapeAttr(r.id)}" title="Edit route ${name}"><i class="bi bi-pencil"></i> Edit</button>
              <button class="btn btn-sm btn-secondary action-manage-route" data-id="${escapeAttr(r.id)}"><i class="bi bi-list-ol"></i> Manage Stops</button>
              <button class="btn btn-sm btn-danger action-delete-route" data-id="${escapeAttr(r.id)}" data-code="${codeAttr}" data-name="${nameAttr}"><i class="bi bi-trash3"></i> Delete</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');

      initIcons(tbody);

      // Row Checkbox Listeners
      tbody.querySelectorAll('.dash-route-row-chk').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const id = e.target.dataset.id;
          if (e.target.checked) {
            selectedRouteIds.add(id);
          } else {
            selectedRouteIds.delete(id);
          }
          updateDashboard();
          if (activeView === 'routes') renderRouteManagerView();
        });
      });

      tbody.querySelectorAll('.action-edit-route').forEach(btn => {
        btn.addEventListener('click', () => {
          openRouteModal('edit', btn.dataset.id);
        });
      });

      tbody.querySelectorAll('.action-manage-route').forEach(btn => {
        btn.addEventListener('click', () => {
          openHistoryRouteDrawer(btn.dataset.id);
        });
      });

      tbody.querySelectorAll('.action-preview-route').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const routeId = btn.dataset.id;
          const r = routeMgr.getRoute(routeId);
          currentPreviewRouteId = routeId;
          dashCycleStage = 0; // Reset sequence to English first
          if (typeof routeMgr !== 'undefined') {
            routeMgr.activeRouteId = routeId;
          }
          const select = document.getElementById('dash-marquee-route-select');
          if (select) select.value = routeId;
          updateDashboardMarquee();
          updateDashboard(false);

          // Smoothly scroll to the Live LED Bus Display Preview
          const liveCard = document.getElementById('dash-card-live-preview');
          if (liveCard) {
            liveCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            liveCard.classList.add('highlight-pulse');
            setTimeout(() => liveCard.classList.remove('highlight-pulse'), 1800);
          }

          if (r) {
            showToast(`Route [${r.code}] ${r.name} loaded into Live LED Preview`, 'success');
          }
        });
      });

      tbody.querySelectorAll('.action-delete-route').forEach(btn => {
        btn.addEventListener('click', () => {
          const routeId = btn.dataset.id;
          const routeCode = btn.dataset.code;
          const routeName = btn.dataset.name;
          if (confirm(`Are you sure you want to delete route [${routeCode}] ${routeName}?`)) {
            routeMgr.deleteRoute(routeId);
            selectedRouteIds.delete(routeId);
            updateDashboard();
            if (activeView === 'routes') renderRouteManagerView();
            showToast(`Route [${routeCode}] deleted successfully`, 'danger');
          }
        });
      });

      renderDashHistoryPagination(totalRoutes);
    }
  }

  // Dashboard Select All Checkbox Handler
  document.getElementById('dash-select-all-routes')?.addEventListener('change', (e) => {
    const dashSearchInput = document.getElementById('dash-route-search-input');
    const query = dashSearchInput ? dashSearchInput.value.trim() : '';
    const routes = routeMgr.searchRoutes(query);
    const startIndex = (dashHistoryCurrentPage - 1) * dashHistoryPageSize;
    const pageRoutes = routes.slice(startIndex, startIndex + dashHistoryPageSize);

    pageRoutes.forEach(r => {
      if (e.target.checked) {
        selectedRouteIds.add(r.id);
      } else {
        selectedRouteIds.delete(r.id);
      }
    });

    updateDashboard();
    if (activeView === 'routes') renderRouteManagerView();
  });

  // Dashboard Bulk Delete Button
  document.getElementById('dash-btn-bulk-delete')?.addEventListener('click', () => {
    if (selectedRouteIds.size === 0) return;
    openBulkDeleteModal(Array.from(selectedRouteIds));
  });

  // Floating Pagination Pill Controller (Bottom Middle of History & Summary Tab)
  function renderDashHistoryPagination(totalRoutes) {
    const container = document.getElementById('dash-history-pagination');
    if (!container) return;

    if (totalRoutes === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const totalPages = Math.max(1, Math.ceil(totalRoutes / dashHistoryPageSize));

    const startRecord = (dashHistoryCurrentPage - 1) * dashHistoryPageSize + 1;
    const endRecord = Math.min(totalRoutes, dashHistoryCurrentPage * dashHistoryPageSize);

    let pageNumsHtml = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, dashHistoryCurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      const isActive = p === dashHistoryCurrentPage ? 'active' : '';
      pageNumsHtml += `<button class="page-num-btn ${isActive}" data-page="${p}">${p}</button>`;
    }

    container.innerHTML = `
      <div class="page-records-summary">
        Total <strong>${totalRoutes}</strong> records (${startRecord}–${endRecord})
      </div>

      <button id="dash-page-prev" class="page-nav-btn" ${dashHistoryCurrentPage <= 1 ? 'disabled' : ''} title="Previous Page">&lt;</button>
      <div class="page-numbers-group">${pageNumsHtml}</div>
      <button id="dash-page-next" class="page-nav-btn" ${dashHistoryCurrentPage >= totalPages ? 'disabled' : ''} title="Next Page">&gt;</button>

      <div class="page-size-wrapper">
        <select id="dash-page-size-select" class="page-size-select">
          <option value="10" ${dashHistoryPageSize === 10 ? 'selected' : ''}>10 / page</option>
          <option value="15" ${dashHistoryPageSize === 15 ? 'selected' : ''}>15 / page</option>
          <option value="25" ${dashHistoryPageSize === 25 ? 'selected' : ''}>25 / page</option>
          <option value="50" ${dashHistoryPageSize === 50 ? 'selected' : ''}>50 / page</option>
        </select>
      </div>

      <div class="page-goto-wrapper">
        <span>Go to</span>
        <input type="number" id="dash-page-goto-input" class="page-goto-input" min="1" max="${totalPages}" value="${dashHistoryCurrentPage}">
        <span>Page</span>
      </div>
    `;

    // Event listeners
    container.querySelector('#dash-page-prev')?.addEventListener('click', () => {
      if (dashHistoryCurrentPage > 1) {
        dashHistoryCurrentPage--;
        updateDashboard();
      }
    });

    container.querySelector('#dash-page-next')?.addEventListener('click', () => {
      if (dashHistoryCurrentPage < totalPages) {
        dashHistoryCurrentPage++;
        updateDashboard();
      }
    });

    container.querySelectorAll('.page-num-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        dashHistoryCurrentPage = parseInt(btn.dataset.page, 10);
        updateDashboard();
      });
    });

    container.querySelector('#dash-page-size-select')?.addEventListener('change', (e) => {
      dashHistoryPageSize = parseInt(e.target.value, 10);
      dashHistoryCurrentPage = 1;
      updateDashboard();
    });

    const gotoInput = container.querySelector('#dash-page-goto-input');
    if (gotoInput) {
      const handleGoto = () => {
        const val = parseInt(gotoInput.value, 10);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
          dashHistoryCurrentPage = val;
          updateDashboard();
        }
      };

      gotoInput.addEventListener('change', handleGoto);
      gotoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleGoto();
      });
    }
  }

  // Action Cards & Stat Card Event Binding
  document.getElementById('dash-act-bitmap')?.addEventListener('click', () => switchView('bitmap'));
  document.getElementById('dash-act-routes')?.addEventListener('click', () => switchView('routes'));
  document.getElementById('dash-act-languages')?.addEventListener('click', () => switchView('languages'));
  document.getElementById('dash-act-export')?.addEventListener('click', () => switchView('export'));

  document.getElementById('dash-card-active-routes')?.addEventListener('click', () => {
    document.getElementById('dash-card-route-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  (document.getElementById('dash-btn-quick-add-route') || document.getElementById('dash-btn-new-route'))?.addEventListener('click', () => {
    openRouteModal('add');
  });
  (document.getElementById('dash-act-export') || document.getElementById('dash-btn-export-pkg'))?.addEventListener('click', () => {
    switchView('export');
  });

  // Slide Drawer Event Listeners
  document.getElementById('drawer-close-btn')?.addEventListener('click', closeHistoryRouteDrawer);
  document.getElementById('drawer-btn-cancel')?.addEventListener('click', closeHistoryRouteDrawer);
  document.getElementById('history-drawer-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'history-drawer-overlay') closeHistoryRouteDrawer();
  });

  document.getElementById('drawer-btn-add-stop')?.addEventListener('click', () => {
    if (!currentDrawerRouteId) return;
    routeMgr.addStopToRoute(currentDrawerRouteId, 'New Stop Name', 'కొత్త స్టాప్ పేరు');
    renderHistoryRouteDrawerDetails();
    updateDashboard();

    const stopsContainer = document.getElementById('drawer-stops-list');
    if (stopsContainer) {
      stopsContainer.scrollTop = stopsContainer.scrollHeight;
    }
    showToast('New stop added to route', 'success');
  });

  // Marquee Speed Control Listener
  const speedSlider = document.getElementById('dash-marquee-speed-select');
  const speedVal = document.getElementById('dash-marquee-speed-val');
  speedSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (speedVal) speedVal.textContent = val;
    if (dashMarqueeEng) {
      dashMarqueeEng.config.scrollSpeed = val;
      dashMarqueeEng.startAnimation();
    }
  });

  // Display Mode & Characteristics Listeners
  document.getElementById('dash-marquee-mode-select')?.addEventListener('change', (e) => {
    dashPreviewDisplayMode = e.target.value;
    dashCycleStage = 0;
    updateDashboardMarquee();
  });

  document.getElementById('dash-line-split-slider')?.addEventListener('input', (e) => {
    dashPreviewSplitRatio = parseInt(e.target.value, 10) / 100;
    updateDashboardMarquee();
  });

  document.getElementById('dash-marquee-height-select')?.addEventListener('change', () => {
    updateDashboardMarquee();
  });

  document.getElementById('dash-marquee-width-select')?.addEventListener('change', () => {
    updateDashboardMarquee();
  });

  document.getElementById('dash-marquee-route-select')?.addEventListener('change', (e) => {
    currentPreviewRouteId = e.target.value;
    dashCycleStage = 0; // Reset sequence to English first
    updateDashboardMarquee();
    updateDashboard(false);
  });

  document.getElementById('dash-marquee-include-stops')?.addEventListener('change', () => {
    updateDashboardMarquee();
  });

  document.querySelectorAll('.dash-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.dash-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      const color = dot.dataset.color || '#ff2a2a';
      updateSelectedLedColor(color);
    });
  });

  document.getElementById('drawer-btn-save')?.addEventListener('click', () => {
    if (!currentDrawerRouteId) return;
    routeMgr.updateRoute(currentDrawerRouteId, {
      code: document.getElementById('drawer-route-code').value,
      name: document.getElementById('drawer-route-name').value,
      startPoint: {
        en: document.getElementById('drawer-start-en').value,
        te: document.getElementById('drawer-start-te').value
      },
      destination: {
        en: document.getElementById('drawer-dest-en').value,
        te: document.getElementById('drawer-dest-te').value
      }
    });

    updateDashboard();
    if (activeView === 'routes') renderRouteManagerView();
    showToast('Route details & stops updated successfully!', 'success');
    closeHistoryRouteDrawer();
  });

  document.getElementById('drawer-btn-preview-led')?.addEventListener('click', () => {
    if (!currentDrawerRouteId) return;
    const routeId = currentDrawerRouteId;
    closeHistoryRouteDrawer();
    goToLiveLedPreview(routeId);
    showToast(`Focused Live LED Display on Route`, 'info');
  });

  // =========================================================================
  // LED BITMAP CREATOR MODULE LOGIC
  // =========================================================================
  const textInput = document.getElementById('bmp-input-text');
  const fontSelect = document.getElementById('bmp-font-family');
  const heightSelect = document.getElementById('bmp-matrix-height');
  const widthSelect = document.getElementById('bmp-matrix-width');
  const scrollSelect = document.getElementById('bmp-scroll-mode');
  const pixelStyleSelect = document.getElementById('bmp-pixel-style');
  const threshSlider = document.getElementById('bmp-threshold-slider');
  const threshValSpan = document.getElementById('bmp-threshold-val');
  const offsetXInput = document.getElementById('bmp-offset-x');
  const offsetYInput = document.getElementById('bmp-offset-y');
  const boldCheckbox = document.getElementById('bmp-bold-check');
  const codeBox = document.getElementById('bmp-code-output');

  const debouncedUpdateCodeBox = debounce(() => {
    updateCodeBox();
  }, 160);

  function updateBitmapFromInputs(skipCodeBox = false) {
    if (!textInput) return;

    ledEng.config.text = textInput.value || '';
    ledEng.config.fontFamily = fontSelect ? fontSelect.value : 'auto';
    ledEng.config.matrixHeight = parseInt(heightSelect ? heightSelect.value : ledEng.config.matrixHeight, 10) || 16;
    ledEng.config.matrixWidth = parseInt(widthSelect ? widthSelect.value : ledEng.config.matrixWidth, 10) || 128;
    ledEng.config.scrollMode = scrollSelect ? scrollSelect.value : 'static';
    ledEng.config.pixelStyle = pixelStyleSelect ? pixelStyleSelect.value : 'circle';
    ledEng.config.threshold = parseInt(threshSlider ? threshSlider.value : 128, 10) || 128;
    ledEng.config.offsetX = parseInt(offsetXInput ? offsetXInput.value : 0, 10) || 0;
    ledEng.config.offsetY = parseInt(offsetYInput ? offsetYInput.value : 0, 10) || 0;
    ledEng.config.bold = boldCheckbox ? boldCheckbox.checked : true;
    ledEng.config.fontSize = Math.floor(ledEng.config.matrixHeight * 0.85);

    if (threshValSpan && threshSlider) threshValSpan.textContent = threshSlider.value;

    ledEng.renderTextToMatrix();
    ledEng.startAnimation();
    if (!skipCodeBox) {
      debouncedUpdateCodeBox();
    }
  }

  const debouncedUpdateBitmap = debounce(() => {
    updateBitmapFromInputs(false);
  }, 80);

  const formatSelect = document.getElementById('bmp-format-select');

  function updateCodeBox() {
    if (codeBox) {
      const selectedFormat = formatSelect ? formatSelect.value : 'C-ARRAY';
      codeBox.textContent = ledEng.getHexString(selectedFormat);
    }
  }

  formatSelect?.addEventListener('change', updateCodeBox);

  function syncBitmapCreatorInputs() {
    updateBitmapFromInputs();
  }

  const fontTrigger = document.getElementById('bmp-font-trigger');
  const fontSelectedLabel = document.getElementById('bmp-font-selected-label');
  const fontMenu = document.getElementById('bmp-font-menu');
  const fontChevron = document.getElementById('bmp-font-chevron');
  const fontDropdownContainer = document.getElementById('bmp-font-dropdown-container');

  const standardFonts = [
    { value: 'auto', label: 'Auto-Detect Script' },
    { value: "'Noto Sans Telugu', 'Nirmala UI', 'Gautami', 'Mandali', sans-serif", label: 'Telugu (Noto Sans / Nirmala UI / Gautami)' },
    { value: "'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif", label: 'Hindi (Noto / Devanagari)' },
    { value: "'Noto Sans Kannada', 'Nirmala UI', 'Tunga', sans-serif", label: 'Kannada (Noto Sans)' },
    { value: "'Noto Sans Tamil', 'Nirmala UI', 'Latha', sans-serif", label: 'Tamil (Noto Sans)' },
    { value: "'Inter', sans-serif", label: 'Latin / English (Inter)' },
    { value: "'Courier New', monospace", label: 'Monospace Pixel Standard' },
    { value: "'Arial Black', sans-serif", label: 'Bold Block Latin' }
  ];

  function getDeletedFonts() {
    try {
      return JSON.parse(localStorage.getItem('itms_deleted_fonts') || '[]');
    } catch {
      return [];
    }
  }

  function setDeletedFonts(deleted) {
    localStorage.setItem('itms_deleted_fonts', JSON.stringify(deleted));
  }

  function toggleFontDropdown(open) {
    if (!fontMenu) return;
    const shouldOpen = open !== undefined ? open : (fontMenu.style.display !== 'block');
    fontMenu.style.display = shouldOpen ? 'block' : 'none';
    if (fontChevron) {
      fontChevron.style.transform = shouldOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  fontTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFontDropdown();
  });

  document.addEventListener('click', (e) => {
    if (fontDropdownContainer && !fontDropdownContainer.contains(e.target)) {
      toggleFontDropdown(false);
    }
  });

  function updateBmpFontFamilyOptions(customFonts = []) {
    if (!fontSelect || !fontMenu) return;
    const currentVal = fontSelect.value || 'auto';
    const deletedFonts = getDeletedFonts();
    const visiblePresets = standardFonts.filter(sf => sf.value === 'auto' || !deletedFonts.includes(sf.value));

    // 1. Update native select (for engine)
    let nativeHtml = '';
    visiblePresets.forEach(sf => {
      const isSel = currentVal === sf.value;
      nativeHtml += `<option value="${escapeHtml(sf.value)}" ${isSel ? 'selected' : ''}>${escapeHtml(sf.label)}</option>`;
    });

    if (customFonts && customFonts.length > 0) {
      customFonts.forEach(f => {
        const val = `${f.family}, sans-serif`;
        const isSel = currentVal.includes(f.family);
        nativeHtml += `<option value="${escapeHtml(val)}" data-id="${escapeHtml(f.id)}" ${isSel ? 'selected' : ''}>Uploaded: ${escapeHtml(f.name)}</option>`;
      });
    }
    fontSelect.innerHTML = nativeHtml;

    // 2. Build Custom Dropdown Menu with inline ✕ Delete Buttons on all fonts
    let menuHtml = '';
    let selectedLabelText = 'Auto-Detect Script';

    visiblePresets.forEach(sf => {
      const isSel = currentVal === sf.value;
      if (isSel) selectedLabelText = sf.label;
      const canDelete = sf.value !== 'auto';
      const safeLabel = escapeHtml(sf.label);
      const safeVal = escapeHtml(sf.value);

      menuHtml += `
        <div class="custom-font-item" data-value="${safeVal}" data-label="${safeLabel}"
          style="display:flex; justify-content:space-between; align-items:center; padding:7px 10px; border-radius:6px; font-size:12.5px; cursor:pointer; ${isSel ? 'background:rgba(0,171,239,0.12); font-weight:700; color:var(--primary, #00ABEF);' : 'color:var(--text-main, #14151f);'} transition:background 0.15s ease;"
          onmouseover="if(!this.dataset.selected) this.style.background='rgba(0,171,239,0.06)'"
          onmouseout="if(!this.dataset.selected) this.style.background='transparent'"
          ${isSel ? 'data-selected="true"' : ''}>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${safeLabel}</span>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            ${isSel ? '<span style="font-size:11px; color:var(--primary, #00ABEF); margin-right:2px;">✓</span>' : ''}
            ${canDelete ? `
              <button type="button" class="btn-delete-font-item" data-val="${safeVal}" data-name="${safeLabel}" title="Delete font ${safeLabel}"
                style="background:#fee2e2; border:1px solid #fca5a5; color:#dc2626; font-size:11px; font-weight:700; cursor:pointer; padding:2px 7px; border-radius:4px; line-height:1; display:inline-flex; align-items:center; gap:3px; flex-shrink:0; transition:all 0.15s ease;"
                onmouseover="this.style.background='#ef4444'; this.style.color='#ffffff';"
                onmouseout="this.style.background='#fee2e2'; this.style.color='#dc2626';">
                ✕
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    if (customFonts && customFonts.length > 0) {
      menuHtml += `<div style="height:1px; background:#e2e8f0; margin:4px 0;"></div>`;
      menuHtml += `<div style="font-size:10.5px; font-weight:700; text-transform:uppercase; color:#94a3b8; padding:4px 8px; letter-spacing:0.5px;">Custom Uploaded Fonts</div>`;

      customFonts.forEach(f => {
        const val = `${f.family}, sans-serif`;
        const isSel = currentVal.includes(f.family);
        const label = `Uploaded: ${f.name}`;
        if (isSel) selectedLabelText = label;
        const safeName = escapeHtml(f.name);
        const safeId = escapeHtml(f.id);
        const safeVal = escapeHtml(val);
        const safeLabel = escapeHtml(label);

        menuHtml += `
          <div class="custom-font-item custom-font-uploaded" data-value="${safeVal}" data-label="${safeLabel}" data-id="${safeId}"
            style="display:flex; justify-content:space-between; align-items:center; padding:7px 10px; border-radius:6px; font-size:12.5px; cursor:pointer; ${isSel ? 'background:rgba(0,171,239,0.12); font-weight:700; color:var(--primary, #00ABEF);' : 'color:var(--text-main, #14151f);'} transition:background 0.15s ease;"
            onmouseover="if(!this.dataset.selected) this.style.background='rgba(0,171,239,0.06)'"
            onmouseout="if(!this.dataset.selected) this.style.background='transparent'"
            ${isSel ? 'data-selected="true"' : ''}>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${safeLabel}</span>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              ${isSel ? '<span style="font-size:11px; color:var(--primary, #00ABEF); margin-right:2px;">✓</span>' : ''}
              <button type="button" class="btn-delete-font-item" data-id="${safeId}" data-name="${safeName}" title="Delete font ${safeName}"
                style="background:#fee2e2; border:1px solid #fca5a5; color:#dc2626; font-size:11px; font-weight:700; cursor:pointer; padding:2px 7px; border-radius:4px; line-height:1; display:inline-flex; align-items:center; gap:3px; flex-shrink:0; transition:all 0.15s ease;"
                onmouseover="this.style.background='#ef4444'; this.style.color='#ffffff';"
                onmouseout="this.style.background='#fee2e2'; this.style.color='#dc2626';">
                ✕
              </button>
            </div>
          </div>
        `;
      });
    }

    fontMenu.innerHTML = menuHtml;
    if (fontSelectedLabel) {
      fontSelectedLabel.textContent = selectedLabelText;
    }

    // 3. Attach Click Listeners to select font items
    fontMenu.querySelectorAll('.custom-font-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-font-item')) return;
        const val = item.dataset.value;
        const label = item.dataset.label;
        if (fontSelect) fontSelect.value = val;
        if (fontSelectedLabel) fontSelectedLabel.textContent = label;
        toggleFontDropdown(false);
        updateBmpFontFamilyOptions(customFonts);
        updateBitmapFromInputs();
      });
    });

    // 4. Attach Click Listeners to ✕ delete buttons
    fontMenu.querySelectorAll('.btn-delete-font-item').forEach(delBtn => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fontId = delBtn.getAttribute('data-id');
        const fontVal = delBtn.getAttribute('data-val');
        const fontName = delBtn.getAttribute('data-name');

        if (fontId) {
          // Custom uploaded font
          await deleteCustomFontById(fontId, fontName);
        } else if (fontVal) {
          // Preset font
          const deleted = getDeletedFonts();
          if (!deleted.includes(fontVal)) {
            deleted.push(fontVal);
            setDeletedFonts(deleted);
          }
          if (fontSelect && fontSelect.value === fontVal) {
            fontSelect.value = 'auto';
            if (fontSelectedLabel) fontSelectedLabel.textContent = 'Auto-Detect Script';
          }
          updateBmpFontFamilyOptions(customFonts);
          updateBitmapFromInputs();
          if (typeof showToast === 'function') {
            showToast(`Font "${fontName}" removed from dropdown.`, 'info');
          }
        }
      });
    });
  }

  async function deleteCustomFontById(fontId, fontName = 'custom font') {
    if (!fontId) return;
    try {
      if (window.FontStorage) {
        await window.FontStorage.deleteFont(fontId);
      }
      const updatedList = window.FontStorage ? await window.FontStorage.getAllFonts() : [];
      if (fontSelect && fontSelect.value.includes(fontId)) {
        fontSelect.value = 'auto';
        if (fontSelectedLabel) fontSelectedLabel.textContent = 'Auto-Detect Script';
      }
      updateBmpFontFamilyOptions(updatedList);
      window.dispatchEvent(new CustomEvent('customFontsChanged', { detail: updatedList }));
      updateBitmapFromInputs();
      if (typeof showToast === 'function') {
        showToast(`Font "${fontName}" deleted successfully.`, 'info');
      }
    } catch (err) {
      console.error('Delete font error:', err);
      if (typeof showToast === 'function') {
        showToast(`Could not delete font: ${err.message || err}`, 'danger');
      }
    }
  }

  // Load and apply stored custom fonts from IndexedDB on startup
  if (window.FontStorage) {
    window.FontStorage.getAllFonts().then(storedFonts => {
      if (storedFonts && storedFonts.length > 0) {
        storedFonts.forEach(async (f) => {
          try {
            if (f.buffer && f.family) {
              const fontFace = new FontFace(f.family, f.buffer);
              const loadedFace = await fontFace.load();
              document.fonts.add(loadedFace);
            }
          } catch (e) {
            console.warn('Font load notice:', e);
          }
        });
        updateBmpFontFamilyOptions(storedFonts);
      }
    });
  }

  window.addEventListener('customFontsChanged', (e) => {
    updateBmpFontFamilyOptions(e.detail || []);
  });

  // Handle Font Upload (.TTF / .OTF / .WOFF) in Bitmap Creator Tab
  const bmpFontFileInput = document.getElementById('bmp-font-file-input');
  if (bmpFontFileInput) {
    bmpFontFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const notify = (msg, type = 'danger') => {
        if (typeof showToast === 'function') {
          showToast(msg, type);
        } else {
          alert(msg);
        }
      };

      // 1. Extension Check & Executable Rejection
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const ALLOWED_EXT = ['.ttf', '.otf', '.woff', '.woff2', '.bdf'];
      const REJECT_EXT = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.js', '.scr', '.msi', '.php', '.py', '.ps1', '.html', '.htm'];

      if (REJECT_EXT.includes(ext) || !ALLOWED_EXT.includes(ext)) {
        notify(`Security Alert: Rejected unapproved file extension (${file.name}). Allowed: .TTF, .OTF, .WOFF, .WOFF2`, 'danger');
        bmpFontFileInput.value = '';
        return;
      }

      // 2. Size limit check (15MB max)
      if (file.size > 15 * 1024 * 1024) {
        notify(`Security Alert: Font file "${file.name}" exceeds 15MB size limit.`, 'danger');
        bmpFontFileInput.value = '';
        return;
      }

      try {
        // 3. Read Binary ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // 4. Magic Byte Verification
        const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
        const magicHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
        const validSignatures = ['00010000', '74727565', '4f54544f', '774f4646', '774f4632'];
        const isValidSignature = validSignatures.includes(magicHex) || file.name.endsWith('.bdf');

        if (!isValidSignature) {
          notify(`Security Alert: Invalid font file signature detected in "${file.name}". Font upload rejected.`, 'danger');
          bmpFontFileInput.value = '';
          return;
        }

        const fontId = `font_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const safeFamily = `CustomFont_${fontId}`;
        const cleanName = file.name.replace(/\.[^/.]+$/, '');

        // 5. Register Native FontFace
        try {
          const fontFace = new FontFace(safeFamily, arrayBuffer);
          const loadedFace = await fontFace.load();
          document.fonts.add(loadedFace);
        } catch (fontErr) {
          notify(`Format Alert: Font file "${file.name}" contains corrupted or unsupported font outlines.`, 'danger');
          bmpFontFileInput.value = '';
          return;
        }

        // 6. Persist to High-Capacity IndexedDB
        const fontRecord = {
          id: fontId,
          name: cleanName,
          family: safeFamily,
          format: ext.replace('.', ''),
          buffer: arrayBuffer,
          size: file.size,
          timestamp: Date.now()
        };

        if (window.FontStorage) {
          await window.FontStorage.saveFont(fontRecord);
        }

        // 7. Update UI Dropdown and Auto-Select the Uploaded Font
        let customFontsList = [];
        if (window.FontStorage) {
          customFontsList = await window.FontStorage.getAllFonts();
        } else {
          customFontsList = [fontRecord];
        }

        updateBmpFontFamilyOptions(customFontsList);

        if (fontSelect) {
          fontSelect.value = `${safeFamily}, sans-serif`;
        }

        // Broadcast to other components (Pixel Studio, Language Library, etc.)
        window.dispatchEvent(new CustomEvent('customFontsChanged', { detail: customFontsList }));

        // Refresh LED Bitmap preview
        updateBitmapFromInputs();

        const sizeKb = (file.size / 1024).toFixed(1);
        notify(`Custom font "${cleanName}" (${sizeKb} KB) uploaded & applied to LED Matrix!`, 'success');

      } catch (err) {
        console.error('Font upload error:', err);
        notify(`Error processing font "${file.name}": ${err.message || 'Invalid font data'}`, 'danger');
      } finally {
        bmpFontFileInput.value = '';
      }
    });
  }

  // Live input change listeners (Debounced for 60fps fluid response)
  [textInput, threshSlider, offsetXInput, offsetYInput].forEach(el => {
    el?.addEventListener('input', () => {
      if (threshValSpan && el === threshSlider) threshValSpan.textContent = threshSlider.value;
      debouncedUpdateBitmap();
    });
  });

  [fontSelect, heightSelect, widthSelect, scrollSelect, pixelStyleSelect, boldCheckbox].forEach(el => {
    el?.addEventListener('change', () => {
      updateBitmapFromInputs(false);
    });
  });

  // LED Color Selector Buttons & Custom Color Picker
  document.querySelectorAll('.color-dot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-dot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const selectedColor = btn.dataset.color;
      const customPicker = document.getElementById('bmp-custom-color-picker');
      if (customPicker) customPicker.value = selectedColor;

      updateSelectedLedColor(selectedColor);
    });
  });

  const customColorInput = document.getElementById('bmp-custom-color-picker');
  customColorInput?.addEventListener('input', (e) => {
    document.querySelectorAll('.color-dot-btn').forEach(b => b.classList.remove('active'));
    updateSelectedLedColor(e.target.value);
  });

  // Matrix edit event callback
  ledEng.onMatrixChange = () => {
    updateCodeBox();
  };

  // Bitmap Undo / Redo Toolbar Controls
  const bmpUndoBtn = document.getElementById('bmp-btn-undo');
  const bmpRedoBtn = document.getElementById('bmp-btn-redo');

  function updateBmpUndoRedoButtons() {
    if (bmpUndoBtn) {
      const canUndo = ledEng.undoStack && ledEng.undoStack.length > 0;
      bmpUndoBtn.style.opacity = canUndo ? '1' : '0.4';
      bmpUndoBtn.style.pointerEvents = canUndo ? 'auto' : 'none';
      bmpUndoBtn.title = canUndo ? `Undo Pixel Edit (Ctrl+Z) - ${ledEng.undoStack.length} step(s)` : 'Undo Pixel Edit (Ctrl+Z)';
    }
    if (bmpRedoBtn) {
      const canRedo = ledEng.redoStack && ledEng.redoStack.length > 0;
      bmpRedoBtn.style.opacity = canRedo ? '1' : '0.4';
      bmpRedoBtn.style.pointerEvents = canRedo ? 'auto' : 'none';
      bmpRedoBtn.title = canRedo ? `Redo Pixel Edit (Ctrl+Y) - ${ledEng.redoStack.length} step(s)` : 'Redo Pixel Edit (Ctrl+Y)';
    }
  }

  ledEng.onUndoRedoChange = () => {
    updateBmpUndoRedoButtons();
  };

  bmpUndoBtn?.addEventListener('click', () => {
    ledEng.undo();
  });

  bmpRedoBtn?.addEventListener('click', () => {
    ledEng.redo();
  });

  // Global Keyboard Shortcuts for Bitmap Creator (Ctrl+Z / Ctrl+Y)
  window.addEventListener('keydown', (e) => {
    if (activeView !== 'bitmap') return;
    const activeEl = document.activeElement;
    const tag = (activeEl && activeEl.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }

    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && !e.altKey) {
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        ledEng.undo();
      } else if ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault();
        ledEng.redo();
      }
    }
  });

  // Invert Pixels Button
  document.getElementById('bmp-btn-invert')?.addEventListener('click', () => {
    ledEng.invertMatrix();
    showToast('Pixel matrix inverted', 'info');
  });

  // Clear Canvas Button
  document.getElementById('bmp-btn-clear')?.addEventListener('click', () => {
    ledEng.clearMatrix();
    showToast('Canvas cleared', 'info');
  });

  // Copy C-array code button
  document.getElementById('bmp-btn-copy-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(ledEng.getHexString('C-ARRAY'));
    showToast('C-Array Bitmap code copied to clipboard!', 'success');
  });

  // Copy output data button (for format selector)
  document.getElementById('bmp-btn-copy-output')?.addEventListener('click', () => {
    const fmt = formatSelect ? formatSelect.value : 'C-ARRAY';
    navigator.clipboard.writeText(ledEng.getHexString(fmt));
    showToast(`Bitmap data (${fmt}) copied to clipboard!`, 'success');
  });

  // Download Header / Data File (.h, .cs, .json, .hex, .txt, .py)
  document.getElementById('bmp-btn-download-hex')?.addEventListener('click', () => {
    const fmt = formatSelect ? formatSelect.value : 'C-ARRAY';
    const text = ledEng.getHexString(fmt);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
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
    link.download = `led_bitmap_${ledEng.config.matrixWidth}x${ledEng.config.matrixHeight}${ext}`;
    link.click();
    showToast(`Bitmap data file (${fmt}) downloaded!`, 'success');
  });

  // Download PNG button
  document.getElementById('bmp-btn-download-png')?.addEventListener('click', () => {
    ledEng.downloadPNG(`LED_${ledEng.config.matrixWidth}x${ledEng.config.matrixHeight}_bitmap.png`);
    showToast('LED Preview PNG downloaded!', 'success');
  });

  // Flash Live Bitmap to USB LED Controller (Web Serial)
  document.getElementById('bmp-btn-flash-usb')?.addEventListener('click', async () => {
    if (!serialFlasher.isSupported()) {
      showToast('Web Serial is supported in Google Chrome, Microsoft Edge & Opera on Desktop.', 'warning');
      return;
    }
    const baud = parseInt(document.getElementById('usb-baud-select')?.value || '115200', 10);
    try {
      if (!serialFlasher.isConnected) {
        const ok = await serialFlasher.connect(baud);
        if (!ok) return;
      }
      const bytes = ledEng.getPackedColumnByteArray();
      const w = ledEng.config.matrixWidth;
      const h = ledEng.config.matrixHeight;
      showToast(`Flashing ${w}x${h} bitmap (${bytes.length} bytes) via USB at ${serialFlasher.baudRate} bps...`, 'info');
      await serialFlasher.flashBitmap(bytes, w, h);
      showToast(`Bitmap (${w}x${h}) flashed to LED display controller!`, 'success');
    } catch (err) {
      console.error('USB Flash error:', err);
      showToast(`USB Flash failed: ${err.message || err}`, 'danger');
    }
  });

  // =========================================================================
  // ROUTE MANAGER MODULE LOGIC
  // =========================================================================
  function renderRouteManagerView() {
    const routeListContainer = document.getElementById('route-list-items');
    const searchInput = document.getElementById('route-search-input');
    const countBadge = document.getElementById('route-library-count');
    if (countBadge) {
      countBadge.textContent = routeMgr.routes.length;
    }

    const query = searchInput ? searchInput.value : '';
    const routes = routeMgr.searchRoutes(query);

    // Update Bulk Select Bar in Route Manager Sidebar
    const bulkBar = document.getElementById('route-bulk-actions-bar');
    if (bulkBar) {
      bulkBar.style.display = isRouteBulkSelectMode ? 'flex' : 'none';
    }

    const bulkToggleBtn = document.getElementById('route-btn-bulk-toggle');
    if (bulkToggleBtn) {
      bulkToggleBtn.classList.toggle('active', isRouteBulkSelectMode);
      bulkToggleBtn.title = isRouteBulkSelectMode ? "Finish selecting routes" : "Select multiple routes for bulk deletion";
      bulkToggleBtn.innerHTML = isRouteBulkSelectMode
        ? `<i class="bi bi-check-lg" style="width:12px; height:12px; font-size:12px;"></i> Done`
        : `<i class="bi bi-check2-square" style="width:12px; height:12px; font-size:12px;"></i> Select`;
    }

    const bulkCountLabel = document.getElementById('route-bulk-selected-count-label');
    if (bulkCountLabel) {
      bulkCountLabel.textContent = `${selectedRouteIds.size} selected`;
    }

    const bulkDeleteBtn = document.getElementById('route-btn-bulk-delete');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.disabled = selectedRouteIds.size === 0;
      bulkDeleteBtn.innerHTML = `<i class="bi bi-trash3" style="width:12px; height:12px; font-size:12px;"></i> Delete (${selectedRouteIds.size})`;
    }

    const bulkSelectAllChk = document.getElementById('route-bulk-select-all');
    if (bulkSelectAllChk) {
      bulkSelectAllChk.checked = routes.length > 0 && routes.every(r => selectedRouteIds.has(r.id));
    }

    if (routeListContainer) {
      if (routes.length === 0) {
        routeListContainer.innerHTML = `
          <div style="text-align:center; color:var(--text-muted); padding:20px 8px; font-size:12.5px;">
            No routes yet. Click <strong>+ Add</strong> to create one.
          </div>
        `;
      } else {
        routeListContainer.innerHTML = routes.map(r => {
          const code = escapeHtml(r.code || 'ROUTE');
          const name = escapeHtml(r.name || 'Unnamed Route');
          const startEn = escapeHtml(r.startPoint?.en || r.startEn || 'Start');
          const destEn = escapeHtml(r.destination?.en || r.destEn || 'Destination');
          const stopCount = Array.isArray(r.stops) ? r.stops.length : 0;
          const idAttr = escapeAttr(r.id);
          const isChecked = selectedRouteIds.has(r.id);
          const isLiveInPreview = (r.id === currentPreviewRouteId);

          const checkboxHtml = isRouteBulkSelectMode ? `
            <div class="route-select-chk-wrap" style="display:flex; align-items:center; margin-right:4px; flex-shrink:0;">
              <input type="checkbox" class="route-card-select-chk" data-id="${idAttr}" ${isChecked ? 'checked' : ''} style="cursor:pointer; width:15px; height:15px; accent-color:#00ABEF;">
            </div>
          ` : '';

          return `
          <div class="route-card-item ${r.id === routeMgr.activeRouteId ? 'active' : ''} ${isChecked ? 'row-selected' : ''}" data-id="${idAttr}" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            ${checkboxHtml}
            <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; overflow:hidden;">
              <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                <span class="route-num-badge" style="flex-shrink:0;">${code}</span>
                <strong style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</strong>
              </div>
              <span style="font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${startEn} &rarr; ${destEn}</span>
            </div>
            <div class="route-card-actions" style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
              <span style="font-size:11px; font-weight:600; color:var(--primary); margin-right:4px;">${stopCount}</span>
              <button class="btn btn-sm ${isLiveInPreview ? 'btn-live-active' : 'btn-success'} route-card-preview" data-id="${idAttr}" title="Preview in Live LED display"><i class="bi bi-display" style="width:11px; height:11px; stroke-width:2.2; font-size:11px;"></i> ${isLiveInPreview ? 'Active' : 'LED'}</button>
              <button class="btn btn-sm btn-primary route-card-edit" data-id="${idAttr}" title="Edit route">Edit</button>
            </div>
          </div>
        `;
        }).join('');

        initIcons(routeListContainer);

        // Card Click & Selection Handler
        routeListContainer.querySelectorAll('.route-card-item').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.route-card-edit') || e.target.closest('.route-card-preview')) return;
            if (isRouteBulkSelectMode) {
              const id = card.dataset.id;
              if (selectedRouteIds.has(id)) {
                selectedRouteIds.delete(id);
              } else {
                selectedRouteIds.add(id);
              }
              renderRouteManagerView();
              updateDashboard();
              return;
            }

            routeMgr.activeRouteId = card.dataset.id;
            renderRouteManagerView();
          });
        });

        // Individual Checkbox Change Listeners
        routeListContainer.querySelectorAll('.route-card-select-chk').forEach(chk => {
          chk.addEventListener('change', (e) => {
            e.stopPropagation();
            const id = e.target.dataset.id;
            if (e.target.checked) {
              selectedRouteIds.add(id);
            } else {
              selectedRouteIds.delete(id);
            }
            renderRouteManagerView();
            updateDashboard();
          });
        });

        routeListContainer.querySelectorAll('.route-card-preview').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            goToLiveLedPreview(btn.dataset.id);
          });
        });

        routeListContainer.querySelectorAll('.route-card-edit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openRouteModal('edit', btn.dataset.id);
          });
        });
      }
    }

    renderActiveRouteDetails();
    initIcons(document.getElementById('view-routes'));
  }

  let activeRouteRegionalLang = 'te'; // 'te' (Telugu) or 'hi' (Hindi)

  function renderActiveRouteDetails() {
    const route = routeMgr.getActiveRoute();
    const emptyState = document.getElementById('route-empty-state');
    const editForm = document.getElementById('route-edit-form');

    if (!route) {
      if (emptyState) emptyState.style.display = 'flex';
      if (editForm) editForm.style.display = 'none';
      initIcons();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (editForm) editForm.style.display = 'flex';

    // Synchronize Regional Language Dropdowns
    const regSelect = document.getElementById('route-regional-lang-select');
    const stopsRegSelect = document.getElementById('stops-regional-lang-select');
    if (regSelect) regSelect.value = activeRouteRegionalLang;
    if (stopsRegSelect) stopsRegSelect.value = activeRouteRegionalLang;

    const langTitle = activeRouteRegionalLang === 'hi' ? 'Hindi' : 'Telugu';
    const autoBadge = activeRouteRegionalLang === 'hi' ? 'Auto HI' : 'Auto TE';
    const startPlaceh = activeRouteRegionalLang === 'hi' ? 'आरंभ / शुरुआती स्टॉप' : 'ఆరంభం';
    const destPlaceh = activeRouteRegionalLang === 'hi' ? 'गंतव्य / अंतिम स्टॉप' : 'గమ్యం';
    const stopPlaceh = activeRouteRegionalLang === 'hi' ? 'हिंदी स्टॉप नाम' : 'తెలుగు స్టాప్ పేరు';

    const startLbl = document.getElementById('route-start-lang-label');
    const destLbl = document.getElementById('route-dest-lang-label');
    const btnStartTxt = document.getElementById('btn-translit-start-text');
    const btnDestTxt = document.getElementById('btn-translit-dest-text');

    if (startLbl) startLbl.textContent = langTitle;
    if (destLbl) destLbl.textContent = langTitle;
    if (btnStartTxt) btnStartTxt.textContent = autoBadge;
    if (btnDestTxt) btnDestTxt.textContent = autoBadge;

    document.getElementById('route-edit-code').value = route.code || '';
    document.getElementById('route-edit-name').value = route.name || '';
    document.getElementById('route-edit-start-en').value = (route.startPoint && route.startPoint.en) || '';
    
    const startRegInput = document.getElementById('route-edit-start-regional');
    if (startRegInput) {
      startRegInput.value = (route.startPoint && route.startPoint[activeRouteRegionalLang]) || '';
      startRegInput.placeholder = startPlaceh;
    }

    document.getElementById('route-edit-dest-en').value = (route.destination && route.destination.en) || '';
    const destRegInput = document.getElementById('route-edit-dest-regional');
    if (destRegInput) {
      destRegInput.value = (route.destination && route.destination[activeRouteRegionalLang]) || '';
      destRegInput.placeholder = destPlaceh;
    }

    // Render Stops Table
    const stopsContainer = document.getElementById('route-stops-list');
    if (stopsContainer) {
      stopsContainer.innerHTML = route.stops.map((stop, idx) => {
        const stopIdAttr = escapeAttr(stop.id);
        const stopEnAttr = escapeAttr(stop.en || '');
        const stopRegAttr = escapeAttr(stop[activeRouteRegionalLang] || '');
        const translitPill = activeRouteRegionalLang === 'hi' ? 'HI' : 'TE';
        return `
        <div class="stop-row-item" data-idx="${idx}" data-id="${stopIdAttr}">
          <span class="seq-num">#${stop.seq}</span>
          <div>
            <div class="input-action-wrapper">
              <input type="text" class="form-control stop-input-en" data-id="${stopIdAttr}" value="${stopEnAttr}" placeholder="English Stop Name">
              <button type="button" class="input-translit-btn btn-route-translit" data-id="${stopIdAttr}" title="Auto-suggest ${langTitle} (${activeRouteRegionalLang === 'hi' ? 'हिंदी' : 'తెలుగు'})"><i class="bi bi-arrow-left-right"></i> ${translitPill}</button>
            </div>
          </div>
          <div>
            <input type="text" class="form-control stop-input-regional" data-id="${stopIdAttr}" value="${stopRegAttr}" placeholder="${stopPlaceh}">
          </div>
          <div style="display:flex; gap:4px; justify-content:flex-end;">
            <button class="btn btn-sm btn-secondary stop-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move stop up (earlier in sequence)" style="padding:4px 8px; font-weight:700;">▲</button>
            <button class="btn btn-sm btn-secondary stop-move-down" data-idx="${idx}" ${idx === route.stops.length - 1 ? 'disabled' : ''} title="Move stop down (later in sequence)" style="padding:4px 8px; font-weight:700;">▼</button>
            <button class="btn btn-sm btn-danger stop-delete" data-id="${stopIdAttr}" title="Remove this stop">&times;</button>
          </div>
        </div>
      `;
      }).join('');

      initIcons(stopsContainer);

      stopsContainer.querySelectorAll('.btn-route-translit').forEach(btn => {
        btn.addEventListener('click', () => {
          const stop = route.stops.find(s => s.id === btn.dataset.id);
          if (stop && stop.en) {
            stop[activeRouteRegionalLang] = translitEng.transliterate(stop.en, activeRouteRegionalLang);
            routeMgr.saveRoutes();
            renderActiveRouteDetails();
            updateDashboard();
            showToast(`Auto-suggested ${langTitle}: ${stop.en} ➔ ${stop[activeRouteRegionalLang]}`, 'info');
          }
        });
      });

      // Event listeners for inline stop editing
      stopsContainer.querySelectorAll('.stop-input-en').forEach(input => {
        input.addEventListener('change', (e) => {
          const stop = route.stops.find(s => s.id === e.target.dataset.id);
          if (stop) { stop.en = e.target.value; routeMgr.saveRoutes(); updateDashboard(); }
        });
      });

      stopsContainer.querySelectorAll('.stop-input-regional').forEach(input => {
        input.addEventListener('change', (e) => {
          const stop = route.stops.find(s => s.id === e.target.dataset.id);
          if (stop) { stop[activeRouteRegionalLang] = e.target.value; routeMgr.saveRoutes(); updateDashboard(); }
        });
      });

      stopsContainer.querySelectorAll('.stop-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.reorderStop(route.id, parseInt(btn.dataset.idx, 10), 'UP');
          renderActiveRouteDetails();
          updateDashboard();
        });
      });

      stopsContainer.querySelectorAll('.stop-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.reorderStop(route.id, parseInt(btn.dataset.idx, 10), 'DOWN');
          renderActiveRouteDetails();
          updateDashboard();
        });
      });

      stopsContainer.querySelectorAll('.stop-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          routeMgr.deleteStop(route.id, btn.dataset.id);
          renderActiveRouteDetails();
          updateDashboard();
          showToast('Stop removed from route', 'info');
        });
      });
    }
  }

  // Regional Language Selectors (Synchronized between Terminals & Stops header)
  const handleRegionalLangSwitch = (e) => {
    const newLang = e.target.value;
    const route = routeMgr.getActiveRoute();
    if (route) {
      const startRegVal = document.getElementById('route-edit-start-regional')?.value;
      const destRegVal = document.getElementById('route-edit-dest-regional')?.value;
      if (startRegVal !== undefined) {
        route.startPoint = route.startPoint || {};
        route.startPoint[activeRouteRegionalLang] = startRegVal;
      }
      if (destRegVal !== undefined) {
        route.destination = route.destination || {};
        route.destination[activeRouteRegionalLang] = destRegVal;
      }
      routeMgr.saveRoutes();
    }
    activeRouteRegionalLang = newLang;
    renderActiveRouteDetails();
  };

  document.getElementById('route-regional-lang-select')?.addEventListener('change', handleRegionalLangSwitch);
  document.getElementById('stops-regional-lang-select')?.addEventListener('change', handleRegionalLangSwitch);

  // Terminal Auto-Transliteration Buttons
  document.getElementById('btn-translit-start-term')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    const enVal = document.getElementById('route-edit-start-en')?.value || '';
    if (route && enVal) {
      route.startPoint = route.startPoint || {};
      const converted = translitEng.transliterate(enVal, activeRouteRegionalLang);
      route.startPoint[activeRouteRegionalLang] = converted;
      const regInput = document.getElementById('route-edit-start-regional');
      if (regInput) regInput.value = converted;
      routeMgr.saveRoutes();
      updateDashboard();
      const langTitle = activeRouteRegionalLang === 'hi' ? 'Hindi' : 'Telugu';
      showToast(`Auto-suggested ${langTitle}: ${enVal} ➔ ${converted}`, 'info');
    }
  });

  document.getElementById('btn-translit-dest-term')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    const enVal = document.getElementById('route-edit-dest-en')?.value || '';
    if (route && enVal) {
      route.destination = route.destination || {};
      const converted = translitEng.transliterate(enVal, activeRouteRegionalLang);
      route.destination[activeRouteRegionalLang] = converted;
      const regInput = document.getElementById('route-edit-dest-regional');
      if (regInput) regInput.value = converted;
      routeMgr.saveRoutes();
      updateDashboard();
      const langTitle = activeRouteRegionalLang === 'hi' ? 'Hindi' : 'Telugu';
      showToast(`Auto-suggested ${langTitle}: ${enVal} ➔ ${converted}`, 'info');
    }
  });

  // Save Route Info Modifications (Top & Bottom Save Buttons)
  const saveRouteAction = async () => {
    const route = routeMgr.getActiveRoute();
    if (!route) return;

    const saveBtn = document.getElementById('route-btn-save');
    const saveBtnBottom = document.getElementById('route-btn-save-bottom');
    const loadingMgr = window.ITMSLoadingManager || window.LoadingManager;

    const code = (document.getElementById('route-edit-code')?.value || '').trim();
    const name = (document.getElementById('route-edit-name')?.value || '').trim();
    const startEn = (document.getElementById('route-edit-start-en')?.value || '').trim();
    const startReg = (document.getElementById('route-edit-start-regional')?.value || '').trim();
    const destEn = (document.getElementById('route-edit-dest-en')?.value || '').trim();
    const destReg = (document.getElementById('route-edit-dest-regional')?.value || '').trim();

    const validator = window.ITMSInputValidator || window.InputValidator;
    if (validator) {
      const codeRes = validator.validateRouteCode(code, routeMgr.routes, route.id);
      if (!codeRes.isValid) {
        window.notifyUserWarning(codeRes.message, 'Validation Check');
        return;
      }
      const nameRes = validator.validateRouteName(name);
      if (!nameRes.isValid) {
        window.notifyUserWarning(nameRes.message, 'Validation Check');
        return;
      }
    }

    if (loadingMgr) {
      if (saveBtn) loadingMgr.showButtonLoading(saveBtn);
      if (saveBtnBottom) loadingMgr.showButtonLoading(saveBtnBottom);
    }

    try {
      route.startPoint = route.startPoint || {};
      route.destination = route.destination || {};

      route.startPoint.en = startEn;
      route.startPoint[activeRouteRegionalLang] = startReg;

      route.destination.en = destEn;
      route.destination[activeRouteRegionalLang] = destReg;

      routeMgr.updateRoute(route.id, {
        code,
        name,
        startPoint: route.startPoint,
        destination: route.destination
      });

      renderRouteManagerView();
      updateDashboard();
      window.notifyUserSuccess(`Route ${code} details updated successfully!`, 'Route Saved');
    } finally {
      if (loadingMgr) {
        if (saveBtn) loadingMgr.hideButtonLoading(saveBtn);
        if (saveBtnBottom) loadingMgr.hideButtonLoading(saveBtnBottom);
      }
    }
  };

  document.getElementById('route-btn-save')?.addEventListener('click', saveRouteAction);
  document.getElementById('route-btn-save-bottom')?.addEventListener('click', saveRouteAction);

  // Add Stop Button (With Auto-Scroll to Newly Added 6th+ Item)
  document.getElementById('route-btn-add-stop')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (!route) return;
    const defaultTe = 'కొత్త స్టాప్ పేరు';
    const defaultHi = 'नया स्टॉप नाम';
    routeMgr.addStopToRoute(route.id, 'New Stop Name', defaultTe);
    const lastStop = route.stops[route.stops.length - 1];
    if (lastStop) lastStop.hi = defaultHi;
    routeMgr.saveRoutes();
    renderActiveRouteDetails();
    updateDashboard();

    const stopsContainer = document.getElementById('route-stops-list');
    if (stopsContainer) {
      stopsContainer.scrollTop = stopsContainer.scrollHeight;
    }
    showToast('New stop added to route', 'success');
  });

  // =========================================================================
  // BULK-PASTE & BATCH TRANSLITERATE CONTROLLER
  // =========================================================================
  let bulkPasteTargetRouteId = null;
  let bulkPasteContext = 'manager'; // 'manager' or 'drawer'
  let parsedBulkStopsCache = [];

  function openBulkPasteModal(routeId, context = 'manager') {
    if (!routeId) {
      showToast('Please select or create a route first.', 'warning');
      return;
    }
    bulkPasteTargetRouteId = routeId;
    bulkPasteContext = context;
    parsedBulkStopsCache = [];

    const targetLangSelect = document.getElementById('bulk-paste-target-lang');
    if (targetLangSelect) {
      targetLangSelect.value = (context === 'manager') ? activeRouteRegionalLang : 'te';
    }

    const textarea = document.getElementById('bulk-paste-textarea');
    if (textarea) {
      textarea.value = '';
    }

    const previewContainer = document.getElementById('bulk-paste-preview-container');
    if (previewContainer) {
      previewContainer.style.display = 'none';
    }

    const submitBtn = document.getElementById('bulk-paste-btn-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    const submitCount = document.getElementById('bulk-paste-submit-count');
    if (submitCount) {
      submitCount.textContent = '0';
    }

    openModal('modal-bulk-paste-stops');
    initIcons(document.getElementById('modal-bulk-paste-stops'));
    textarea?.focus();
  }

  function parseBulkPasteInput() {
    const textarea = document.getElementById('bulk-paste-textarea');
    const targetLang = document.getElementById('bulk-paste-target-lang')?.value || 'te';
    const langLabel = targetLang === 'hi' ? 'Hindi' : 'Telugu';
    const hdrLang = document.getElementById('bulk-paste-preview-lang-hdr');
    if (hdrLang) hdrLang.textContent = langLabel;

    const rawText = textarea ? textarea.value : '';
    const lines = rawText.split(/\r?\n/);
    const parsedList = [];

    lines.forEach((line) => {
      let trimmed = line.trim();
      if (!trimmed) return;

      // Clean leading list numbers/bullets: e.g. "1. Stop", "2) Stop", "- Stop", "#3 Stop", "• Stop"
      trimmed = trimmed.replace(/^(\d+[\.\)\-:#\s]+|[-•*#\s]+)/, '').trim();
      if (!trimmed) return;

      // Check if line is multi-column (copied from Excel tab-delimited or comma-separated)
      let englishVal = trimmed;
      let regionalVal = '';

      if (trimmed.includes('\t')) {
        const parts = trimmed.split('\t').map(p => p.trim()).filter(Boolean);
        englishVal = parts[0] || '';
        regionalVal = parts[1] || '';
      } else if (trimmed.includes(',') && !/^[A-Za-z0-9\s]+,\s*[A-Za-z0-9\s]+$/.test(trimmed)) {
        // Only split if not a simple locality name like "Begumpet, Hyderabad"
      }

      if (!englishVal) return;

      if (!regionalVal) {
        regionalVal = translitEng.transliterate(englishVal, targetLang);
      }

      parsedList.push({
        en: englishVal,
        reg: regionalVal
      });
    });

    parsedBulkStopsCache = parsedList;

    const previewContainer = document.getElementById('bulk-paste-preview-container');
    const tbody = document.getElementById('bulk-paste-preview-tbody');
    const countEl = document.getElementById('bulk-paste-parsed-count');
    const submitBtn = document.getElementById('bulk-paste-btn-submit');
    const submitCount = document.getElementById('bulk-paste-submit-count');

    if (parsedList.length > 0) {
      if (previewContainer) previewContainer.style.display = 'block';
      if (countEl) countEl.textContent = parsedList.length;
      if (submitCount) submitCount.textContent = parsedList.length;
      if (submitBtn) submitBtn.disabled = false;

      if (tbody) {
        tbody.innerHTML = parsedList.map((item, idx) => `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="text-align:center; font-weight:700; color:var(--text-muted); padding:6px 10px;">#${idx + 1}</td>
            <td style="font-weight:600; color:var(--text-main); padding:6px 10px;">${escapeHtml(item.en)}</td>
            <td style="color:#0284c7; font-weight:600; padding:6px 10px;">${escapeHtml(item.reg)}</td>
          </tr>
        `).join('');
      }
    } else {
      if (previewContainer) previewContainer.style.display = 'none';
      if (countEl) countEl.textContent = '0';
      if (submitCount) submitCount.textContent = '0';
      if (submitBtn) submitBtn.disabled = true;
      if (tbody) tbody.innerHTML = '';
    }
  }

  // Bind Bulk Paste Textarea & Lang Dropdown Events
  const bulkTextarea = document.getElementById('bulk-paste-textarea');
  bulkTextarea?.addEventListener('input', debounce(parseBulkPasteInput, 100));
  bulkTextarea?.addEventListener('paste', () => {
    setTimeout(parseBulkPasteInput, 50);
  });

  document.getElementById('bulk-paste-target-lang')?.addEventListener('change', parseBulkPasteInput);

  document.getElementById('bulk-paste-btn-clear')?.addEventListener('click', () => {
    const textarea = document.getElementById('bulk-paste-textarea');
    if (textarea) textarea.value = '';
    parseBulkPasteInput();
    textarea?.focus();
  });

  document.getElementById('bulk-paste-btn-submit')?.addEventListener('click', () => {
    if (!bulkPasteTargetRouteId || parsedBulkStopsCache.length === 0) return;

    const route = routeMgr.getRoute(bulkPasteTargetRouteId);
    if (!route) {
      showToast('Target route not found.', 'danger');
      return;
    }

    const isReplace = document.getElementById('bulk-paste-mode-replace')?.checked || false;
    const targetLang = document.getElementById('bulk-paste-target-lang')?.value || 'te';

    const stopsToInsert = parsedBulkStopsCache.map(p => {
      const stopObj = {
        en: p.en,
        te: (targetLang === 'te') ? p.reg : translitEng.transliterate(p.en, 'te'),
        hi: (targetLang === 'hi') ? p.reg : translitEng.transliterate(p.en, 'hi')
      };
      return stopObj;
    });

    const addedCount = routeMgr.bulkAddStopsToRoute(bulkPasteTargetRouteId, stopsToInsert, isReplace);

    if (bulkPasteContext === 'manager') {
      renderActiveRouteDetails();
    } else {
      renderHistoryRouteDrawerDetails();
    }
    updateDashboard();

    closeModal('modal-bulk-paste-stops');
    showToast(`Successfully added ${addedCount} stops with auto-transliterations!`, 'success');
  });

  // Open Bulk Paste from Route Manager View
  document.getElementById('route-btn-bulk-paste-stops')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (route) {
      openBulkPasteModal(route.id, 'manager');
    }
  });

  // Open Bulk Paste from Drawer View
  document.getElementById('drawer-btn-bulk-paste-stops')?.addEventListener('click', () => {
    if (currentDrawerRouteId) {
      openBulkPasteModal(currentDrawerRouteId, 'drawer');
    }
  });

  // 1-Click "Transliterate All Stops" in Route Manager View
  document.getElementById('route-btn-batch-translit-stops')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (!route || !Array.isArray(route.stops) || route.stops.length === 0) {
      showToast('No stops on this route to transliterate.', 'info');
      return;
    }

    const lang = activeRouteRegionalLang;
    const langLabel = lang === 'hi' ? 'Hindi' : 'Telugu';
    let count = 0;

    route.stops.forEach(stop => {
      if (stop.en) {
        stop[lang] = translitEng.transliterate(stop.en, lang);
        count++;
      }
    });

    routeMgr.saveRoutes();
    renderActiveRouteDetails();
    updateDashboard();
    showToast(`Transliterated all ${count} stops to ${langLabel}!`, 'success');
  });

  // 1-Click "Transliterate All Stops" in Drawer View
  document.getElementById('drawer-btn-batch-translit-stops')?.addEventListener('click', () => {
    if (!currentDrawerRouteId) return;
    const route = routeMgr.getRoute(currentDrawerRouteId);
    if (!route || !Array.isArray(route.stops) || route.stops.length === 0) {
      showToast('No stops on this route to transliterate.', 'info');
      return;
    }

    let count = 0;
    route.stops.forEach(stop => {
      if (stop.en) {
        stop.te = translitEng.transliterate(stop.en, 'te');
        stop.hi = translitEng.transliterate(stop.en, 'hi');
        count++;
      }
    });

    routeMgr.saveRoutes();
    renderHistoryRouteDrawerDetails();
    updateDashboard();
    showToast(`Transliterated all ${count} stops in drawer!`, 'success');
  });

  // Clear Route Form Data (Bottom & Top Buttons)
  const clearActiveRouteForm = () => {
    const route = routeMgr.getActiveRoute();
    if (!route) return;
    if (!confirm('Are you sure you want to clear all form fields and stops for this route?')) return;

    routeMgr.updateRoute(route.id, {
      code: '',
      name: '',
      startPoint: { en: '', te: '', hi: '' },
      destination: { en: '', te: '', hi: '' },
      stops: []
    });

    renderActiveRouteDetails();
    updateDashboard();
    showToast('All route fields & stops cleared!', 'warning');
  };

  document.getElementById('route-btn-clear-data')?.addEventListener('click', clearActiveRouteForm);

  document.getElementById('drawer-btn-clear-data')?.addEventListener('click', () => {
    if (!currentDrawerRouteId) return;
    if (!confirm('Are you sure you want to clear all fields and stops in this drawer?')) return;

    routeMgr.updateRoute(currentDrawerRouteId, {
      code: '',
      name: '',
      startPoint: { en: '', te: '', hi: '' },
      destination: { en: '', te: '', hi: '' },
      stops: []
    });

    renderHistoryRouteDrawerDetails();
    updateDashboard();
    if (activeView === 'routes') renderRouteManagerView();
    showToast('All drawer route fields & stops cleared!', 'warning');
  });

  // Save Route Changes from Drawer View with Validation & Button Loading
  document.getElementById('drawer-btn-save')?.addEventListener('click', async () => {
    if (!currentDrawerRouteId) return;
    const saveBtn = document.getElementById('drawer-btn-save');
    const loadingMgr = window.ITMSLoadingManager || window.LoadingManager;

    const code = (document.getElementById('drawer-route-code')?.value || '').trim();
    const name = (document.getElementById('drawer-route-name')?.value || '').trim();
    const startEn = (document.getElementById('drawer-start-en')?.value || '').trim();
    const startTe = (document.getElementById('drawer-start-te')?.value || '').trim();
    const destEn = (document.getElementById('drawer-dest-en')?.value || '').trim();
    const destTe = (document.getElementById('drawer-dest-te')?.value || '').trim();

    const validator = window.ITMSInputValidator || window.InputValidator;
    if (validator) {
      const codeRes = validator.validateRouteCode(code, routeMgr.routes, currentDrawerRouteId);
      if (!codeRes.isValid) {
        window.notifyUserWarning(codeRes.message, 'Validation Check');
        return;
      }
      const nameRes = validator.validateRouteName(name);
      if (!nameRes.isValid) {
        window.notifyUserWarning(nameRes.message, 'Validation Check');
        return;
      }
    }

    if (loadingMgr && saveBtn) loadingMgr.showButtonLoading(saveBtn);

    try {
      const existing = routeMgr.getRoute(currentDrawerRouteId);
      routeMgr.updateRoute(currentDrawerRouteId, {
        code,
        name,
        startPoint: {
          en: startEn,
          te: startTe,
          hi: existing?.startPoint?.hi || ''
        },
        destination: {
          en: destEn,
          te: destTe,
          hi: existing?.destination?.hi || ''
        }
      });

      closeHistoryRouteDrawer();
      updateDashboard();
      if (activeView === 'routes') renderRouteManagerView();
      window.notifyUserSuccess(`Route ${code} updated successfully!`, 'Drawer Changes Saved');
    } finally {
      if (loadingMgr && saveBtn) loadingMgr.hideButtonLoading(saveBtn);
    }
  });

  document.getElementById('drawer-btn-cancel')?.addEventListener('click', () => {
    closeHistoryRouteDrawer();
  });

  document.getElementById('drawer-btn-preview-led')?.addEventListener('click', () => {
    if (currentDrawerRouteId) {
      if (AppState) AppState.setActiveRoute(currentDrawerRouteId);
      currentPreviewRouteId = currentDrawerRouteId;
      updateDashboardMarquee(currentDrawerRouteId);
      closeHistoryRouteDrawer();
      window.notifyUserInfo('Loaded route preview onto Live LED Marquee above.', 'LED Preview');
    }
  });

  // Debounced Route Search Filter (Route Manager sidebar)
  document.getElementById('route-search-input')?.addEventListener('input', debounce(() => {
    renderRouteManagerView();
  }, 120));

  // Debounced Route Search Filter (Dashboard History table)
  document.getElementById('dash-route-search-input')?.addEventListener('input', debounce(() => {
    dashHistoryCurrentPage = 1;
    updateDashboard(false);
  }, 120));

  // Route Manager Bulk Select Toggle
  document.getElementById('route-btn-bulk-toggle')?.addEventListener('click', () => {
    isRouteBulkSelectMode = !isRouteBulkSelectMode;
    if (!isRouteBulkSelectMode) {
      selectedRouteIds.clear();
    }
    renderRouteManagerView();
    updateDashboard();
  });

  // Route Manager Bulk Done / Cancel
  document.getElementById('route-btn-bulk-cancel')?.addEventListener('click', () => {
    isRouteBulkSelectMode = false;
    selectedRouteIds.clear();
    renderRouteManagerView();
    updateDashboard();
  });

  // Route Manager Bulk Select All Checkbox
  document.getElementById('route-bulk-select-all')?.addEventListener('change', (e) => {
    const searchInput = document.getElementById('route-search-input');
    const query = searchInput ? searchInput.value : '';
    const routes = routeMgr.searchRoutes(query);

    routes.forEach(r => {
      if (e.target.checked) {
        selectedRouteIds.add(r.id);
      } else {
        selectedRouteIds.delete(r.id);
      }
    });

    renderRouteManagerView();
    updateDashboard();
  });

  // Route Manager Bulk Delete Button
  document.getElementById('route-btn-bulk-delete')?.addEventListener('click', () => {
    if (selectedRouteIds.size === 0) return;
    openBulkDeleteModal(Array.from(selectedRouteIds));
  });

  // Confirm Bulk Delete Modal Submit
  document.getElementById('btn-confirm-bulk-delete-submit')?.addEventListener('click', () => {
    if (!pendingBulkDeleteIds || pendingBulkDeleteIds.length === 0) return;
    const deletedCount = routeMgr.deleteRoutesBulk(pendingBulkDeleteIds);
    selectedRouteIds.clear();
    pendingBulkDeleteIds = [];
    isRouteBulkSelectMode = false;

    closeModal('modal-confirm-bulk-delete');
    renderRouteManagerView();
    updateDashboard();
    showToast(`Successfully deleted ${deletedCount} route(s)!`, 'success');
  });

  // Add New Route Modal Handling
  document.getElementById('route-btn-new')?.addEventListener('click', () => {
    openRouteModal('add');
  });

  document.getElementById('dash-btn-quick-add-route')?.addEventListener('click', () => {
    openRouteModal('add');
  });

  document.getElementById('dash-btn-view-all-routes')?.addEventListener('click', () => {
    switchView('routes');
  });

  document.getElementById('route-empty-add-btn')?.addEventListener('click', () => {
    openRouteModal('add');
  });

  document.getElementById('route-btn-preview-led')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (route) {
      goToLiveLedPreview(route.id);
      showToast(`Navigated to Live LED Display for Route [${route.code}] ${route.name}`, 'info');
    }
  });

  document.getElementById('route-btn-edit')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (route) openRouteModal('edit', route.id);
  });

  function openRouteModal(mode, routeId = null) {
    const titleEl = document.getElementById('modal-route-title');
    const submitBtn = document.getElementById('modal-route-submit');
    const editIdInput = document.getElementById('edit-route-id');
    const form = document.getElementById('form-add-route');

    form.reset();
    editIdInput.value = '';

    if (mode === 'edit' && routeId) {
      const route = routeMgr.getRoute(routeId);
      if (!route) return;

      titleEl.textContent = 'Edit Bus Route';
      submitBtn.textContent = 'Update Route';
      editIdInput.value = route.id;
      document.getElementById('new-route-code').value = route.code;
      document.getElementById('new-route-name').value = route.name;
      document.getElementById('new-route-start-en').value = route.startPoint.en || '';
      document.getElementById('new-route-start-te').value = route.startPoint.te || '';
      document.getElementById('new-route-dest-en').value = route.destination.en || '';
      document.getElementById('new-route-dest-te').value = route.destination.te || '';
    } else {
      titleEl.textContent = 'Create New Bus Route';
      submitBtn.textContent = 'Create Route';
    }

    openModal('modal-add-route');
  }

  // Live Auto-Transliteration for Route Terminals (Start & Destination)
  const setupLiveTranslit = (enId, teId) => {
    const enEl = document.getElementById(enId);
    const teEl = document.getElementById(teId);
    if (enEl && teEl) {
      enEl.addEventListener('input', () => {
        if (!teEl.value || teEl.dataset.autoFilled === 'true') {
          teEl.value = translitEng.transliterate(enEl.value);
          teEl.dataset.autoFilled = 'true';
        }
      });
      teEl.addEventListener('input', () => {
        teEl.dataset.autoFilled = 'false';
      });
    }
  };

  setupLiveTranslit('route-edit-start-en', 'route-edit-start-regional');
  setupLiveTranslit('route-edit-dest-en', 'route-edit-dest-regional');
  setupLiveTranslit('drawer-start-en', 'drawer-start-te');
  setupLiveTranslit('drawer-dest-en', 'drawer-dest-te');
  setupLiveTranslit('new-route-start-en', 'new-route-start-te');
  setupLiveTranslit('new-route-dest-en', 'new-route-dest-te');

  document.getElementById('btn-translit-start-term')?.addEventListener('click', () => {
    const enVal = document.getElementById('route-edit-start-en')?.value;
    if (enVal) {
      const regVal = translitEng.transliterate(enVal, activeRouteRegionalLang || 'te');
      const regEl = document.getElementById('route-edit-start-regional');
      if (regEl) { regEl.value = regVal; regEl.dataset.autoFilled = 'true'; }
      const langName = activeRouteRegionalLang === 'hi' ? 'Hindi' : 'Telugu';
      showToast(`Auto-suggested Start Terminal ${langName}: ${regVal}`, 'info');
    }
  });

  document.getElementById('btn-translit-dest-term')?.addEventListener('click', () => {
    const enVal = document.getElementById('route-edit-dest-en')?.value;
    if (enVal) {
      const regVal = translitEng.transliterate(enVal, activeRouteRegionalLang || 'te');
      const regEl = document.getElementById('route-edit-dest-regional');
      if (regEl) { regEl.value = regVal; regEl.dataset.autoFilled = 'true'; }
      const langName = activeRouteRegionalLang === 'hi' ? 'Hindi' : 'Telugu';
      showToast(`Auto-suggested Dest Terminal ${langName}: ${regVal}`, 'info');
    }
  });

  document.getElementById('drawer-btn-translit-start')?.addEventListener('click', () => {
    const enVal = document.getElementById('drawer-start-en')?.value;
    if (enVal) {
      const teVal = translitEng.transliterate(enVal);
      const teEl = document.getElementById('drawer-start-te');
      if (teEl) { teEl.value = teVal; teEl.dataset.autoFilled = 'true'; }
      showToast(`Auto-suggested Start Terminal Telugu: ${teVal}`, 'info');
    }
  });

  document.getElementById('drawer-btn-translit-dest')?.addEventListener('click', () => {
    const enVal = document.getElementById('drawer-dest-en')?.value;
    if (enVal) {
      const teVal = translitEng.transliterate(enVal);
      const teEl = document.getElementById('drawer-dest-te');
      if (teEl) { teEl.value = teVal; teEl.dataset.autoFilled = 'true'; }
      showToast(`Auto-suggested Dest Terminal Telugu: ${teVal}`, 'info');
    }
  });

  document.getElementById('modal-btn-translit-start')?.addEventListener('click', () => {
    const enVal = document.getElementById('new-route-start-en')?.value;
    if (enVal) {
      const teVal = translitEng.transliterate(enVal);
      const teEl = document.getElementById('new-route-start-te');
      if (teEl) { teEl.value = teVal; teEl.dataset.autoFilled = 'true'; }
      showToast(`Auto-suggested Start Terminal Telugu: ${teVal}`, 'info');
    }
  });

  document.getElementById('modal-btn-translit-dest')?.addEventListener('click', () => {
    const enVal = document.getElementById('new-route-dest-en')?.value;
    if (enVal) {
      const teVal = translitEng.transliterate(enVal);
      const teEl = document.getElementById('new-route-dest-te');
      if (teEl) { teEl.value = teVal; teEl.dataset.autoFilled = 'true'; }
      showToast(`Auto-suggested Dest Terminal Telugu: ${teVal}`, 'info');
    }
  });

  document.getElementById('modal-btn-clear-form')?.addEventListener('click', () => {
    document.getElementById('new-route-code').value = '';
    document.getElementById('new-route-name').value = '';
    document.getElementById('new-route-start-en').value = '';
    document.getElementById('new-route-start-te').value = '';
    document.getElementById('new-route-dest-en').value = '';
    document.getElementById('new-route-dest-te').value = '';
    showToast('Cleared modal form fields', 'info');
  });

  document.getElementById('form-add-route')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const loadingMgr = window.ITMSLoadingManager || window.LoadingManager;

    const code = (document.getElementById('new-route-code')?.value || '').trim();
    const name = (document.getElementById('new-route-name')?.value || '').trim();
    const startEn = (document.getElementById('new-route-start-en')?.value || '').trim();
    const startTe = (document.getElementById('new-route-start-te')?.value || '').trim();
    const destEn = (document.getElementById('new-route-dest-en')?.value || '').trim();
    const destTe = (document.getElementById('new-route-dest-te')?.value || '').trim();
    const editId = document.getElementById('edit-route-id')?.value || '';

    const validator = window.ITMSInputValidator || window.InputValidator;
    if (validator) {
      const codeRes = validator.validateRouteCode(code, routeMgr.routes, editId || null);
      if (!codeRes.isValid) {
        window.notifyUserWarning(codeRes.message, 'Validation Check');
        return;
      }
      const nameRes = validator.validateRouteName(name);
      if (!nameRes.isValid) {
        window.notifyUserWarning(nameRes.message, 'Validation Check');
        return;
      }
    }

    if (loadingMgr && submitBtn) loadingMgr.showButtonLoading(submitBtn);

    try {
      if (editId) {
        const existing = routeMgr.getRoute(editId);
        routeMgr.updateRoute(editId, {
          code,
          name,
          startPoint: {
            en: startEn,
            te: startTe,
            hi: existing?.startPoint?.hi || ''
          },
          destination: {
            en: destEn,
            te: destTe,
            hi: existing?.destination?.hi || ''
          }
        });
        routeMgr.activeRouteId = editId;
        closeModal('modal-add-route');
        renderRouteManagerView();
        updateDashboard();
        window.notifyUserSuccess(`Route ${code} updated successfully!`, 'Route Saved');
        return;
      }

      routeMgr.addRoute(code, name, startEn, startTe, destEn, destTe);
      closeModal('modal-add-route');
      renderRouteManagerView();
      updateDashboard();
      window.notifyUserSuccess(`Route ${code} created successfully!`, 'Route Created');
    } finally {
      if (loadingMgr && submitBtn) loadingMgr.hideButtonLoading(submitBtn);
    }
  });

  // Delete Route Button
  document.getElementById('route-btn-delete')?.addEventListener('click', () => {
    const route = routeMgr.getActiveRoute();
    if (!route) return;
    if (confirm(`Are you sure you want to delete ${route.code} - ${route.name}?`)) {
      routeMgr.deleteRoute(route.id);
      renderRouteManagerView();
      updateDashboard();
      showToast('Route deleted', 'danger');
    }
  });

  // Export JSON / CSV
  document.getElementById('route-btn-export-json')?.addEventListener('click', () => {
    const jsonStr = routeMgr.exportJSON();
    downloadFile('itms_routes_backup.json', jsonStr, 'application/json');
    showToast('Routes exported as JSON', 'success');
  });

  document.getElementById('route-btn-export-csv')?.addEventListener('click', () => {
    const csvStr = routeMgr.exportCSV();
    downloadFile('itms_routes_export.csv', csvStr, 'text/csv');
    showToast('Routes exported as CSV', 'success');
  });

  document.getElementById('dash-btn-export-excel')?.addEventListener('click', () => {
    const csvStr = routeMgr.exportCSV();
    const bomCsv = '\uFEFF' + csvStr;
    downloadFile('bus_routes_history_export.csv', bomCsv, 'text/csv;charset=utf-8');
    showToast('Bus Route History exported to Excel successfully!', 'success');
  });

  // =========================================================================
  // FULL DATABASE BACKUP & DISASTER RECOVERY RESTORE
  // =========================================================================
  document.getElementById('export-btn-full-db-backup')?.addEventListener('click', () => {
    const glyphs = (glyphMgr && typeof glyphMgr.exportGlyphsData === 'function')
      ? glyphMgr.exportGlyphsData()
      : [];
    const backupJson = routeMgr.exportFullDatabase(glyphs);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `ITMS_Full_Database_Backup_${dateStr}.json`;
    downloadFile(filename, backupJson, 'application/json');
    showToast(`Full Database Backup exported (${routeMgr.routes.length} routes, ${glyphs.length} glyphs)!`, 'success');
  });

  let pendingDatabaseBackup = null;

  document.getElementById('export-btn-full-db-restore')?.addEventListener('click', () => {
    document.getElementById('full-db-restore-file')?.click();
  });

  document.getElementById('full-db-restore-file')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const validator = window.ITMSInputValidator || window.InputValidator || (window.ITMS && window.ITMS.InputValidator);
    if (validator && typeof validator.validateFileUpload === 'function') {
      const check = validator.validateFileUpload(file, {
        maxSizeBytes: 25 * 1024 * 1024,
        allowedExtensions: ['.json'],
        allowedMimeTypes: ['application/json', 'text/plain', 'application/octet-stream']
      });

      if (!check.isValid) {
        window.notifyUserError(window.ITMS.ErrorCategory.STORAGE, check.message, {
          title: 'Database Backup File Blocked',
          resolution: 'Ensure you select a valid .json ITMS backup file under 25MB.'
        });
        e.target.value = '';
        return;
      }
    }

    try {
      const text = await file.text();
      const cleanedStr = text.trim().replace(/^\uFEFF/, '');
      let parsed = null;
      try {
        parsed = JSON.parse(cleanedStr);
      } catch (e1) {
        const strippedStr = cleanedStr.replace(/,\s*([}\]])/g, '$1');
        parsed = JSON.parse(strippedStr);
      }

      if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
        showToast('Invalid backup file format: file does not contain valid JSON.', 'danger');
        e.target.value = '';
        return;
      }

      pendingDatabaseBackup = parsed;
      const routeCount = Array.isArray(parsed.routes) ? parsed.routes.length :
                         Array.isArray(parsed.data) ? parsed.data.length :
                         Array.isArray(parsed) ? parsed.length :
                         (parsed.code ? 1 : 0);
      const glyphCount = Array.isArray(parsed.glyphs) ? parsed.glyphs.length :
                         Array.isArray(parsed.savedGlyphs) ? parsed.savedGlyphs.length : 0;
      const exportDate = parsed.exportTimestamp ? new Date(parsed.exportTimestamp).toLocaleString() : 'Recent';

      const detailsEl = document.getElementById('restore-backup-details');
      if (detailsEl) {
        detailsEl.innerHTML = `
          <div><strong>Backup Timestamp:</strong> ${escapeHtml(exportDate)}</div>
          <div><strong>Routes in File:</strong> <span style="color:#00ABEF; font-weight:700;">${routeCount}</span></div>
          <div><strong>Saved Glyphs in File:</strong> <span style="color:#10b981; font-weight:700;">${glyphCount}</span></div>
          <div><strong>Current Active Routes in Suite:</strong> ${routeMgr.routes.length}</div>
        `;
      }

      openModal('modal-restore-backup');
    } catch (err) {
      window.notifyUserError(window.ITMS.ErrorCategory.STORAGE, err, {
        title: 'Corrupt JSON Backup File',
        resolution: 'Check that the backup file is not truncated or corrupted and contains valid JSON syntax.'
      });
    }
    e.target.value = '';
  });

  document.getElementById('btn-confirm-restore-backup')?.addEventListener('click', () => {
    if (!pendingDatabaseBackup) return;

    const modeRadios = document.getElementsByName('restore-db-mode');
    let strategy = 'append';
    for (const r of modeRadios) {
      if (r.checked) {
        strategy = r.value;
        break;
      }
    }

    const res = routeMgr.importFullDatabase(pendingDatabaseBackup, strategy);
    let restoredGlyphsCount = 0;
    const glyphsData = pendingDatabaseBackup.glyphs || pendingDatabaseBackup.savedGlyphs || pendingDatabaseBackup.saved_glyphs;
    if (glyphsData && glyphMgr && typeof glyphMgr.importGlyphsData === 'function') {
      restoredGlyphsCount = glyphMgr.importGlyphsData(glyphsData, strategy === 'append');
    }

    closeModal('modal-restore-backup');
    pendingDatabaseBackup = null;

    if (res && res.success) {
      if (AppState) {
        AppState.set('route.activeRouteId', routeMgr.activeRouteId);
      }
      renderRouteManagerView();
      updateDashboard();
      renderExportCenterView();
      if (typeof glyphMgr !== 'undefined') glyphMgr.renderUI();
      window.notifyUserSuccess(`Database Restored successfully! (${res.restoredRoutesCount} routes, ${restoredGlyphsCount} glyphs restored. Total routes: ${routeMgr.routes.length})`, 'Database Restored');
    } else {
      window.notifyUserError(window.ITMS.ErrorCategory.STORAGE, (res && res.message) || 'No valid route records found in the backup file.', {
        title: 'Database Restore Incomplete',
        resolution: 'Verify that the JSON backup contains a list of routes with valid codes, names, or stop sequences.'
      });
    }
  });

  // =========================================================================
  // BULK CSV / EXCEL (.XLSX) ROUTE IMPORTER
  // =========================================================================
  let pendingBulkImportRoutes = [];

  document.getElementById('route-btn-import-bulk')?.addEventListener('click', () => {
    pendingBulkImportRoutes = [];
    const previewWrap = document.getElementById('bulk-import-preview-wrap');
    if (previewWrap) previewWrap.style.display = 'none';
    const confirmBtn = document.getElementById('btn-confirm-bulk-import');
    if (confirmBtn) confirmBtn.disabled = true;
    const fileInput = document.getElementById('bulk-import-file-input');
    if (fileInput) fileInput.value = '';
    openModal('modal-bulk-import');
  });


  // Drag and drop dropzone handlers
  const dropzone = document.getElementById('bulk-import-dropzone');
  const bulkFileInput = document.getElementById('bulk-import-file-input');

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.borderColor = 'var(--primary)';
    dropzone.style.background = 'rgba(0,171,239,0.1)';
  });

  dropzone?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.borderColor = '#00ABEF';
    dropzone.style.background = 'rgba(0,171,239,0.03)';
  });

  dropzone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.borderColor = '#00ABEF';
    dropzone.style.background = 'rgba(0,171,239,0.03)';
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      await processBulkImportFile(files[0]);
    }
  });

  bulkFileInput?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      await processBulkImportFile(selectedFile);
    }
    // Only reset after async processing completes so file handle remains valid during read
    e.target.value = '';
  });

  async function readFileAsText(file) {
    if (typeof file.text === 'function') {
      return await file.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function readFileAsArrayBuffer(file) {
    if (typeof file.arrayBuffer === 'function') {
      return await file.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  async function processBulkImportFile(file) {
    if (!file) return;

    const fileName = file.name || 'uploaded_spreadsheet.csv';
    const ext = '.' + fileName.split('.').pop().toLowerCase();

    // 1. Comprehensive File Security & Type Validation
    const validator = window.ITMSInputValidator || window.InputValidator || (window.ITMS && window.ITMS.InputValidator);
    if (validator && typeof validator.validateFileUpload === 'function') {
      const check = validator.validateFileUpload(file, {
        maxSizeBytes: 25 * 1024 * 1024,
        allowedExtensions: ['.csv', '.tsv', '.xlsx', '.xls', '.txt'],
        allowedMimeTypes: [
          'text/csv',
          'text/plain',
          'text/tab-separated-values',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/octet-stream'
        ]
      });

      if (!check.isValid) {
        window.notifyUserError(window.ITMS.ErrorCategory.IMPORT, check.message, {
          title: 'File Upload Validation Blocked',
          resolution: 'Select a valid .csv or .xlsx spreadsheet under 25MB with a standard alphanumeric filename.'
        });
        return;
      }
    }

    showToast(`Parsing ${fileName}...`, 'info');
    const dropzoneContent = document.getElementById('bulk-dropzone-content');
    const originalDropzoneHtml = dropzoneContent ? dropzoneContent.innerHTML : '';
    if (dropzoneContent) {
      dropzoneContent.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:12px;">
          <span style="display:inline-block; width:28px; height:28px; border:3px solid #cbd5e1; border-top-color:#00ABEF; border-radius:50%; animation:spin 0.75s linear infinite;"></span>
          <span style="font-size:13.5px; font-weight:700; color:var(--text-main);">Parsing ${escapeHtml(fileName)}...</span>
          <span style="font-size:11.5px; color:var(--text-muted);">Extracting route codes, stops and language translations</span>
        </div>
      `;
    }

    try {
      let table = [];

      if (ext === '.xlsx') {
        const arrayBuf = await readFileAsArrayBuffer(file);
        table = await routeMgr.parseXLSXTable(arrayBuf);
      } else {
        const text = await readFileAsText(file);
        table = routeMgr.parseCSVTable(text);
      }

      if (!table || table.length === 0) {
        window.notifyUserError(window.ITMS.ErrorCategory.IMPORT, `Spreadsheet ${fileName} contains no tabular rows.`, {
          title: 'Empty Spreadsheet Rows',
          resolution: 'Ensure your CSV or Excel file has a header row followed by valid bus route data rows.'
        });
        return;
      }

      const result = routeMgr.parseTableToRoutes(table);

      if (!result || !result.success || !result.routes || result.routes.length === 0) {
        window.notifyUserError(window.ITMS.ErrorCategory.IMPORT, `Could not extract bus routes from ${fileName}.`, {
          title: 'Missing Route Columns',
          resolution: 'Ensure your table headers include "Route Code", "Route Name", "Start Terminal", "Destination", and stop columns.'
        });
        return;
      }

      pendingBulkImportRoutes = result.routes;

      // Transform dropzone into Success State
      if (dropzoneContent) {
        dropzoneContent.innerHTML = `
          <i class="bi bi-check-circle" style="width:44px; height:44px; color:#10b981; margin-bottom:8px; font-size:44px;"></i>
          <div style="font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:4px;">Loaded: ${escapeHtml(fileName)}</div>
          <div style="font-size:12.5px; color:#10b981; font-weight:700; margin-bottom:12px;">Successfully parsed ${result.totalParsedRoutes} Route(s) & ${result.totalParsedStops} Stop(s)</div>
          <span class="btn btn-sm btn-secondary" style="padding:4px 16px; font-size:12px; border-radius:6px; pointer-events:none; font-weight:600;">
            <i class="bi bi-arrow-repeat" style="width:13px; height:13px; margin-right:4px; font-size:13px;"></i> Click to Choose Another File
          </span>
        `;
        // Icons rendered natively via CSS
      }

      // Update Preview UI
      const previewWrap = document.getElementById('bulk-import-preview-wrap');
      const summaryText = document.getElementById('bulk-preview-summary-text');
      const fileBadge = document.getElementById('bulk-preview-file-badge');
      const tableBody = document.getElementById('bulk-preview-table-body');
      const confirmBtn = document.getElementById('btn-confirm-bulk-import');

      if (summaryText) summaryText.textContent = `${result.totalParsedRoutes} Route(s), ${result.totalParsedStops} Stop(s)`;
      if (fileBadge) {
        fileBadge.innerHTML = `<i class="bi bi-file-earmark-spreadsheet" style="width:13px; height:13px; color:#0284c7; margin-right:3px; font-size:13px;"></i> ${escapeHtml(fileName)}`;
        // Icons rendered natively via CSS
      }

      if (tableBody) {
        tableBody.innerHTML = result.routes.map(r => `
          <tr style="border-bottom:1px solid #e2e8f0; background:transparent;">
            <td style="padding:9px 12px; font-weight:800; color:#0284c7; font-size:13px;">${escapeHtml(r.code || 'ROUTE')}</td>
            <td style="padding:9px 12px; font-weight:700; color:#0f172a; font-size:12px;">${escapeHtml(r.name || 'Imported Route')}</td>
            <td style="padding:9px 12px; color:#475569; font-size:12px; font-weight:500;">${escapeHtml(r.startPoint?.en || '')} &rarr; ${escapeHtml(r.destination?.en || '')}</td>
            <td style="padding:9px 12px;"><span style="display:inline-block; background:#0284c7; color:#ffffff; font-weight:800; padding:3px 10px; border-radius:12px; font-size:11px; letter-spacing:0.3px; box-shadow:0 1px 3px rgba(2,132,199,0.3);">${Array.isArray(r.stops) ? r.stops.length : 0} stops</span></td>
          </tr>
        `).join('');
      }

      if (previewWrap) previewWrap.style.display = 'block';

      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.removeAttribute('disabled');
        confirmBtn.style.opacity = '1';
        confirmBtn.style.pointerEvents = 'auto';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.innerHTML = `<i class="bi bi-check-lg"></i> Confirm & Import ${result.totalParsedRoutes} Route(s)`;
        // Icons rendered natively via CSS
      }

      window.notifyUserSuccess(`Ready to import ${result.totalParsedRoutes} routes & ${result.totalParsedStops} stops from ${fileName}! Click 'Confirm & Import' below.`, 'Spreadsheet Verified');
    } catch (err) {
      if (dropzoneContent && originalDropzoneHtml) {
        dropzoneContent.innerHTML = originalDropzoneHtml;
        // Icons rendered natively via CSS
      }
      window.notifyUserError(window.ITMS.ErrorCategory.IMPORT, err, {
        title: 'Spreadsheet Parsing Exception',
        resolution: 'Check that the spreadsheet is not corrupted, password-protected, or open in another application.'
      });
    }
  }

  document.getElementById('btn-confirm-bulk-import')?.addEventListener('click', () => {
    if (!pendingBulkImportRoutes || pendingBulkImportRoutes.length === 0) {
      showToast('Please select and load a spreadsheet file first.', 'warning');
      return;
    }

    const modeRadios = document.getElementsByName('bulk-import-mode');
    let strategy = 'append';
    for (const r of modeRadios) {
      if (r.checked) {
        strategy = r.value;
        break;
      }
    }

    if (strategy === 'replace') {
      routeMgr.routes = pendingBulkImportRoutes;
    } else {
      const existingIds = new Set(routeMgr.routes.map(r => r.id));
      pendingBulkImportRoutes.forEach(nr => {
        if (existingIds.has(nr.id)) {
          nr.id = routeMgr.generateUniqueId('route');
        }
        routeMgr.routes.push(nr);
        existingIds.add(nr.id);
      });
    }

    routeMgr.activeRouteId = routeMgr.routes.length > 0 ? routeMgr.routes[0].id : null;
    routeMgr.saveRoutes();

    closeModal('modal-bulk-import');
    renderRouteManagerView();
    updateDashboard();

    showToast(`Bulk Import Complete! Added ${pendingBulkImportRoutes.length} route(s). Total fleet routes: ${routeMgr.routes.length}`, 'success');
    pendingBulkImportRoutes = [];
  });

  document.getElementById('route-btn-import-json')?.addEventListener('click', () => {
    const fileInput = document.getElementById('route-import-file');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  // Strict Binary Magic Byte & File Signature Guard
  async function validateBinaryMagicHeader(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const bytes = new Uint8Array(e.target.result);
        if (bytes.length === 0) return resolve(false);

        // Windows Executable / DLL / SCR / SYS (MZ -> 0x4D 0x5A)
        if (bytes.length >= 2 && bytes[0] === 0x4D && bytes[1] === 0x5A) return resolve(false);

        // ELF Binary Executable (0x7F 0x45 0x4C 0x46)
        if (bytes.length >= 4 && bytes[0] === 0x7F && bytes[1] === 0x45 && bytes[2] === 0x4C && bytes[3] === 0x46) return resolve(false);

        // Zip / Jar / Apk / 7z / Rar archives (0x50 0x4B 0x03 0x04, 0x37 0x7A, 0x52 0x61)
        if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return resolve(false);
        if (bytes.length >= 2 && bytes[0] === 0x37 && bytes[1] === 0x7A) return resolve(false); // 7z
        if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return resolve(false); // Rar!

        // PDF Document (0x25 0x50 0x44 0x46)
        if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return resolve(false);

        // Image / Media headers (PNG, JPG, GIF)
        if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return resolve(false); // PNG
        if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return resolve(false); // JPG

        resolve(true);
      };
      reader.onerror = () => resolve(false);
      reader.readAsArrayBuffer(file.slice(0, 128));
    });
  }

  document.getElementById('route-import-file')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validator = window.ITMSInputValidator || window.InputValidator || (window.ITMS && window.ITMS.InputValidator);
    let successCount = 0;
    let importedRoutesAdded = 0;
    const initialRouteCount = routeMgr.routes.length;

    for (const file of files) {
      if (validator && typeof validator.validateFileUpload === 'function') {
        const check = validator.validateFileUpload(file, {
          maxSizeBytes: 25 * 1024 * 1024,
          allowedExtensions: ['.json'],
          allowedMimeTypes: ['application/json', 'text/plain', 'application/octet-stream']
        });

        if (!check.isValid) {
          window.notifyUserError(window.ITMS.ErrorCategory.STORAGE, check.message, {
            title: 'File Security Validation',
            resolution: 'Ensure your backup file is a valid .json file under 25MB with no directory traversal characters.'
          });
          continue;
        }
      }

      // Binary Magic Byte Signature Inspection
      const isSafeHeader = await validateBinaryMagicHeader(file);
      if (!isSafeHeader) {
        showToast(`Binary or non-JSON file detected in ${file.name}`, 'danger');
        continue;
      }

      try {
        const text = await file.text();

        // 4. Executable Header & Script Injection Pre-Scan
        if (text.startsWith('MZ') || /<script[\s\S]*?>/i.test(text)) {
          showToast(`Suspicious script or executable signature detected in ${file.name}`, 'danger');
          continue;
        }

        const ok = routeMgr.importJSON(text, true);
        if (ok) {
          successCount++;
        } else {
          showToast(`Could not parse valid route data from ${file.name}`, 'warning');
        }
      } catch (err) {
        console.error('File import error:', err);
        showToast(`Error reading file: ${file.name}`, 'danger');
      }
    }

    importedRoutesAdded = routeMgr.routes.length - initialRouteCount;

    if (successCount > 0) {
      if (!routeMgr.activeRouteId && routeMgr.routes.length > 0) {
        routeMgr.activeRouteId = routeMgr.routes[0].id;
      }
      renderRouteManagerView();
      updateDashboard();
      showToast(`Successfully imported ${successCount} JSON file(s) (+${importedRoutesAdded} routes)! Total routes: ${routeMgr.routes.length}`, 'success');
    } else if (files.length === 1 && !successCount) {
      showToast('Failed to import selected JSON file. Please ensure it contains valid route records.', 'danger');
    }
    e.target.value = '';
  });


  // =========================================================================
  // LANGUAGE & FONT MANAGER MODULE LOGIC
  // =========================================================================
  let langLibraryInitialized = false;
  function renderLanguageLibraryView() {
    if (typeof glyphMgr !== 'undefined') {
      if (!langLibraryInitialized) {
        glyphMgr.renderUI();
        langLibraryInitialized = true;
      } else {
        glyphMgr.updateBinarizedMatrix();
      }
    }
  }

  // =========================================================================
  // ITMS EXPORT CENTER LOGIC
  // =========================================================================
  function renderExportCenterView() {
    const routeSelect = document.getElementById('export-route-select');
    const totalCountEl = document.getElementById('export-total-count');
    const searchSummaryEl = document.getElementById('export-search-summary');
    const searchInput = document.getElementById('export-route-search');
    const clearBtn = document.getElementById('export-search-clear-btn');
    if (!routeSelect) return;

    const totalRoutes = routeMgr.routes.length;
    if (totalCountEl) totalCountEl.textContent = totalRoutes;

    if (totalRoutes === 0) {
      routeSelect.innerHTML = '<option value="">No bus routes available</option>';
      if (searchSummaryEl) searchSummaryEl.textContent = '';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    const searchTerm = (searchInput?.value || '').trim().toLowerCase();
    if (clearBtn) {
      clearBtn.style.display = searchTerm ? 'block' : 'none';
    }

    const filtered = routeMgr.routes.filter(r => {
      if (!searchTerm) return true;
      const codeMatch = (r.code || '').toLowerCase().includes(searchTerm);
      const nameMatch = (r.name || '').toLowerCase().includes(searchTerm);
      const startEnMatch = (r.startPoint?.en || '').toLowerCase().includes(searchTerm);
      const startTeMatch = (r.startPoint?.te || '').toLowerCase().includes(searchTerm);
      const destEnMatch = (r.destination?.en || '').toLowerCase().includes(searchTerm);
      const destTeMatch = (r.destination?.te || '').toLowerCase().includes(searchTerm);
      const stopMatch = Array.isArray(r.stops) && r.stops.some(s => (s.en || '').toLowerCase().includes(searchTerm) || (s.te || '').toLowerCase().includes(searchTerm));
      return codeMatch || nameMatch || startEnMatch || startTeMatch || destEnMatch || destTeMatch || stopMatch;
    });

    if (searchSummaryEl) {
      if (searchTerm) {
        searchSummaryEl.textContent = `Showing ${filtered.length} of ${totalRoutes} routes`;
      } else {
        searchSummaryEl.textContent = '';
      }
    }

    let optionsHtml = '';
    if (!searchTerm && totalRoutes > 1) {
      optionsHtml += `<option value="__ALL_ROUTES__" style="font-weight:700; color:#00ABEF;">★ ALL ROUTES — Export Master Fleet Bundle (${totalRoutes} Routes)</option>`;
    }

    optionsHtml += filtered.map(r => `
      <option value="${r.id}">${r.code} - ${r.name} (${Array.isArray(r.stops) ? r.stops.length : 0} Stops)</option>
    `).join('');

    routeSelect.innerHTML = optionsHtml;
  }

  // Bind export search input & clear button listeners (Debounced for smooth typing)
  document.getElementById('export-route-search')?.addEventListener('input', debounce(renderExportCenterView, 120));
  document.getElementById('export-search-clear-btn')?.addEventListener('click', () => {
    const searchInput = document.getElementById('export-route-search');
    if (searchInput) {
      searchInput.value = '';
      renderExportCenterView();
    }
  });

  // Instant Cancel Export Button
  document.getElementById('export-btn-cancel')?.addEventListener('click', () => {
    if (exporter) {
      exporter.cancelExport();
    }
    const btn = document.getElementById('export-btn-generate');
    const progressWrap = document.getElementById('export-progress-wrap');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download Package (.ZIP)';
    }
    if (progressWrap) {
      progressWrap.style.display = 'none';
    }
    showToast('Export cancelled', 'warning');
  });

  // Generate & Download Package with Non-Blocking Streaming & Progress Bar
  document.getElementById('export-btn-generate')?.addEventListener('click', async () => {
    const routeId = document.getElementById('export-route-select')?.value;
    if (!routeId) {
      window.notifyUserWarning('Please select a valid bus route to export.', 'No Route Selected');
      return;
    }

    const langs = [];
    if (document.getElementById('export-chk-en')?.checked) langs.push('en');
    if (document.getElementById('export-chk-te')?.checked) langs.push('te');
    if (document.getElementById('export-chk-hi')?.checked) langs.push('hi');

    if (langs.length === 0) {
      window.notifyUserWarning('Please select at least one language for export (English, Telugu, or Hindi).', 'Language Selection Required');
      return;
    }

    const height = parseInt(document.getElementById('export-height')?.value || '16', 10);
    const width = parseInt(document.getElementById('export-width')?.value || '128', 10);
    const includePreviews = document.getElementById('export-chk-previews') ? document.getElementById('export-chk-previews').checked : true;

    const btn = document.getElementById('export-btn-generate');
    const progressWrap = document.getElementById('export-progress-wrap');
    const progressBar = document.getElementById('export-progress-bar');
    const progressPercent = document.getElementById('export-progress-percent');
    const progressStatus = document.getElementById('export-progress-status');
    const progressDetail = document.getElementById('export-progress-detail');

    btn.disabled = true;
    btn.textContent = 'Processing Export ...';
    if (progressWrap) progressWrap.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressStatus) progressStatus.textContent = 'Starting non-blocking packaging...';

    const onProgress = ({ processed, total, percent, message, currentRoute }) => {
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressPercent) progressPercent.textContent = `${percent}%`;
      if (progressStatus) progressStatus.textContent = message || 'Processing...';
      if (progressDetail) {
        progressDetail.textContent = currentRoute ? `Active Route: ${currentRoute} | ${processed}/${total} items` : `${processed}/${total} items processed`;
      }
      if (AppState) {
        AppState.update('export', {
          isExporting: true,
          exportProgress: { percent, message, processed, total }
        }, { silent: true });
      }
    };

    try {
      let zipName = '';
      if (routeId === '__ALL_ROUTES__') {
        zipName = await exporter.generateAllRoutesPackage(langs, {
          matrixHeight: height,
          matrixWidth: width,
          includePreviews,
          onProgress
        });
        window.notifyUserSuccess(`Master Fleet Package (${zipName}) successfully generated & downloaded!`, 'Fleet Export Complete');
      } else {
        zipName = await exporter.generatePackage(routeId, langs, {
          matrixHeight: height,
          matrixWidth: width,
          includePreviews,
          onProgress
        });
        window.notifyUserSuccess(`Package ${zipName} generated & downloaded!`, 'Route Export Complete');
      }
    } catch (err) {
      if (err.message && err.message.includes('cancelled')) {
        window.notifyUserInfo('Export operation was cancelled.', 'Export Cancelled');
      } else {
        window.notifyUserError(window.ITMS.ErrorCategory.EXPORT, err, {
          title: 'Export Package Generation Failed',
          resolution: 'Ensure vendor/jszip.min.js is present and at least one valid bus route is configured.'
        });
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download Package (.ZIP)';
      if (progressWrap) {
        progressWrap.style.display = 'none';
      }
      if (AppState) {
        AppState.set('export.isExporting', false, { silent: true });
      }
    }
  });

  // =========================================================================
  // WEB SERIAL DIRECT USB HARDWARE FLASHER INTEGRATION
  // =========================================================================
  const usbConsole = document.getElementById('usb-terminal-console');
  const usbStatusBadge = document.getElementById('usb-status-badge');
  const usbBtnConnect = document.getElementById('usb-btn-connect');
  const usbBtnDisconnect = document.getElementById('usb-btn-disconnect');
  const usbProgressWrap = document.getElementById('usb-progress-wrap');
  const usbProgressBar = document.getElementById('usb-progress-bar');
  const usbProgressStatus = document.getElementById('usb-progress-status');
  const usbProgressPercent = document.getElementById('usb-progress-percent');

  // Serial Monitor Terminal Logger
  serialFlasher.onLog = ({ timestamp, message, type }) => {
    if (!usbConsole) return;
    const colorMap = {
      info: '#a5b4fc',
      success: '#4ade80',
      warn: '#fbbf24',
      error: '#f87171',
      rx: '#38bdf8'
    };
    const color = colorMap[type] || '#a5b4fc';
    const line = document.createElement('div');
    line.style.color = color;
    line.style.wordBreak = 'break-all';
    line.textContent = `[${timestamp}] ${message}`;
    usbConsole.appendChild(line);
    usbConsole.scrollTop = usbConsole.scrollHeight;
  };

  // Connection State Synchronization
  serialFlasher.onConnect = ({ baudRate, portInfo }) => {
    if (usbStatusBadge) {
      usbStatusBadge.style.background = '#dcfce7';
      usbStatusBadge.style.color = '#15803d';
      usbStatusBadge.innerHTML = `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#22c55e;"></span> Connected (${baudRate} bps)`;
    }
    if (usbBtnConnect) usbBtnConnect.style.display = 'none';
    if (usbBtnDisconnect) usbBtnDisconnect.style.display = 'inline-flex';
  };

  serialFlasher.onDisconnect = () => {
    if (usbStatusBadge) {
      usbStatusBadge.style.background = '#fee2e2';
      usbStatusBadge.style.color = '#dc2626';
      usbStatusBadge.innerHTML = `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#dc2626;"></span> Disconnected`;
    }
    if (usbBtnConnect) usbBtnConnect.style.display = 'inline-flex';
    if (usbBtnDisconnect) usbBtnDisconnect.style.display = 'none';
  };

  // Progress Bar Synchronization
  serialFlasher.onProgress = ({ percent, message }) => {
    if (usbProgressWrap) usbProgressWrap.style.display = 'block';
    if (usbProgressBar) usbProgressBar.style.width = `${percent}%`;
    if (usbProgressPercent) usbProgressPercent.textContent = `${percent}%`;
    if (usbProgressStatus) usbProgressStatus.textContent = message || 'Streaming binary packets...';
  };

  // Connect USB Port Button
  usbBtnConnect?.addEventListener('click', async () => {
    const baud = parseInt(document.getElementById('usb-baud-select')?.value || '115200', 10);
    try {
      await serialFlasher.connect(baud);
      showToast(`Connected to USB Device at ${baud} bps!`, 'success');
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        showToast(`USB Connection error: ${err.message || err}`, 'danger');
      }
    }
  });

  // Disconnect USB Port Button
  usbBtnDisconnect?.addEventListener('click', async () => {
    await serialFlasher.disconnect();
    showToast('USB Device disconnected.', 'info');
  });

  // Clear Serial Console Button
  document.getElementById('usb-btn-clear-console')?.addEventListener('click', () => {
    if (usbConsole) {
      usbConsole.innerHTML = '<span style="color:#64748b;">// Serial Monitor cleared. Ready for packets...</span>';
    }
  });

  // Direct USB Fleet Flashing Button in Export Center
  document.getElementById('export-btn-usb-flash-pkg')?.addEventListener('click', async () => {
    if (!serialFlasher.isSupported()) {
      window.notifyUserError(window.ITMS.ErrorCategory.SERIAL, 'Web Serial API is not supported in this browser.', {
        title: 'Browser Compatibility Warning',
        severity: 'warning',
        resolution: 'Please open this application in Google Chrome, Microsoft Edge, or Opera to connect directly to microcontrollers.'
      });
      return;
    }
    const routeId = document.getElementById('export-route-select')?.value;
    if (!routeId) {
      window.notifyUserWarning('Please select a bus route to flash via USB.', 'No Route Selected');
      return;
    }
    const langs = [];
    if (document.getElementById('export-chk-en')?.checked) langs.push('en');
    if (document.getElementById('export-chk-te')?.checked) langs.push('te');
    if (document.getElementById('export-chk-hi')?.checked) langs.push('hi');
    if (langs.length === 0) {
      window.notifyUserWarning('Please select at least one language for USB flashing.', 'Language Selection Required');
      return;
    }

    const height = parseInt(document.getElementById('export-height')?.value || '16', 10);
    const width = parseInt(document.getElementById('export-width')?.value || '128', 10);
    const baud = parseInt(document.getElementById('usb-baud-select')?.value || '115200', 10);

    try {
      if (!serialFlasher.isConnected) {
        const ok = await serialFlasher.connect(baud);
        if (!ok) return;
      }

      // Prepare binary file objects from route database
      const binaryFiles = [];
      const routesToProcess = (routeId === '__ALL_ROUTES__' ? routeMgr.routes : [routeMgr.getRoute(routeId)]).filter(Boolean);

      const headlessCanvas = document.createElement('canvas');
      headlessCanvas.width = width;
      headlessCanvas.height = height;
      const headlessEng = new LEDEngine();
      headlessEng.canvas = headlessCanvas;
      headlessEng.ctx = headlessCanvas.getContext('2d');
      headlessEng.config.matrixHeight = height;
      headlessEng.config.matrixWidth = width;
      headlessEng.config.scrollMode = 'static';
      headlessEng.config.isInteractive = false;

      for (const r of routesToProcess) {
        const cleanCode = (r.code || 'Route').replace(/[^a-zA-Z0-9_-]/g, '_');
        for (const lang of langs) {
          const routeText = `${r.code} - ${r.name}`;
          headlessEng.renderTextToMatrix(routeText, { autoExpand: true });
          const headerBytes = headlessEng.getPackedColumnByteArray();
          binaryFiles.push({ path: `routes/${cleanCode}/bitmaps/${lang}/route_header.bin`, buffer: headerBytes });

          (r.stops || []).forEach((stop, sIdx) => {
            const stopText = stop[lang] || stop.en || 'Stop';
            headlessEng.renderTextToMatrix(stopText, { autoExpand: true });
            const stopBytes = headlessEng.getPackedColumnByteArray();
            const slug = `stop_${(stop.seq || sIdx + 1).toString().padStart(2, '0')}_${lang}.bin`;
            binaryFiles.push({ path: `routes/${cleanCode}/bitmaps/${lang}/${slug}`, buffer: stopBytes });
          });
        }
      }

      window.notifyUserInfo(`Flashing ${binaryFiles.length} binary files to microcontroller via USB at ${baud} bps...`, 'USB Streaming Started');
      await serialFlasher.flashFleetBinaries(binaryFiles);
      window.notifyUserSuccess(`Flash Complete! Streamed ${binaryFiles.length} binary files directly to device!`, 'USB Flash Successful');
    } catch (err) {
      window.notifyUserError(window.ITMS.ErrorCategory.SERIAL, err, {
        title: 'USB Hardware Flash Failure',
        resolution: 'Ensure the USB cable is firmly plugged in, correct COM port is selected, and baud rate matches your hardware.'
      });
    } finally {
      if (usbProgressWrap) {
        setTimeout(() => { usbProgressWrap.style.display = 'none'; }, 4000);
      }
    }
  });

  // =========================================================================
  // MODAL & HELPER FUNCTIONS
  // =========================================================================
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      initIcons();
      // Accessibility: focus first visible input or close button
      setTimeout(() => {
        const firstFocusable = el.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not(.modal-close):not([disabled]), .modal-close');
        if (firstFocusable) firstFocusable.focus();
      }, 50);
    }
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  }

  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('active');
    });
  });

  // Accessibility: Global Escape key to dismiss any active modal dialog or slide drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
      }
      const activeDrawer = document.querySelector('.slide-drawer.open');
      if (activeDrawer) {
        activeDrawer.classList.remove('open');
      }
    }
  });

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // Real-Time Form Validation & Live Input Feedback
  function initRealTimeValidation() {
    const validator = window.ITMSInputValidator || window.InputValidator || (window.ITMS && window.ITMS.InputValidator);
    if (!validator) return;

    // 1. Modal New Route Inputs
    const newCode = document.getElementById('new-route-code');
    const newName = document.getElementById('new-route-name');
    const newStart = document.getElementById('new-route-start-en');
    const newDest = document.getElementById('new-route-dest-en');

    if (newCode) {
      validator.attachLiveInputValidation(newCode, (val) => {
        const editId = document.getElementById('edit-route-id')?.value || null;
        return validator.validateRouteCode(val, routeMgr.routes, editId);
      });
      validator.attachCharCounter(newCode, 10);
    }
    if (newName) {
      validator.attachLiveInputValidation(newName, (val) => validator.validateRouteName(val));
      validator.attachCharCounter(newName, 100);
    }
    if (newStart) {
      validator.attachLiveInputValidation(newStart, (val) => validator.validateTerminalName(val, 'Start Terminal'));
    }
    if (newDest) {
      validator.attachLiveInputValidation(newDest, (val) => validator.validateTerminalName(val, 'Destination Terminal'));
    }

    // 2. Slide Drawer Inputs
    const drawerCode = document.getElementById('drawer-route-code');
    const drawerName = document.getElementById('drawer-route-name');
    const drawerStart = document.getElementById('drawer-start-en');
    const drawerDest = document.getElementById('drawer-dest-en');

    if (drawerCode) {
      validator.attachLiveInputValidation(drawerCode, (val) => {
        return validator.validateRouteCode(val, routeMgr.routes, currentDrawerRouteId);
      });
      validator.attachCharCounter(drawerCode, 10);
    }
    if (drawerName) {
      validator.attachLiveInputValidation(drawerName, (val) => validator.validateRouteName(val));
      validator.attachCharCounter(drawerName, 100);
    }
    if (drawerStart) {
      validator.attachLiveInputValidation(drawerStart, (val) => validator.validateTerminalName(val, 'Start Terminal'));
    }
    if (drawerDest) {
      validator.attachLiveInputValidation(drawerDest, (val) => validator.validateTerminalName(val, 'Destination Terminal'));
    }

    // 3. Quick Edit Route Inputs
    const quickCode = document.getElementById('route-edit-code');
    const quickName = document.getElementById('route-edit-name');
    const quickStart = document.getElementById('route-edit-start-en');
    const quickDest = document.getElementById('route-edit-dest-en');

    if (quickCode) {
      validator.attachLiveInputValidation(quickCode, (val) => {
        const activeRoute = routeMgr.getActiveRoute();
        return validator.validateRouteCode(val, routeMgr.routes, activeRoute?.id);
      });
      validator.attachCharCounter(quickCode, 10);
    }
    if (quickName) {
      validator.attachLiveInputValidation(quickName, (val) => validator.validateRouteName(val));
      validator.attachCharCounter(quickName, 100);
    }
    if (quickStart) {
      validator.attachLiveInputValidation(quickStart, (val) => validator.validateTerminalName(val, 'Start Terminal'));
    }
    if (quickDest) {
      validator.attachLiveInputValidation(quickDest, (val) => validator.validateTerminalName(val, 'Destination Terminal'));
    }

    // 4. Matrix Dimensions Validation
    const bmpW = document.getElementById('bmp-matrix-width');
    const bmpH = document.getElementById('bmp-matrix-height');
    if (bmpW && bmpH) {
      const validateMatrix = () => validator.validateMatrixDimensions(bmpW.value, bmpH.value);
      validator.attachLiveInputValidation(bmpW, () => validateMatrix());
      validator.attachLiveInputValidation(bmpH, () => validateMatrix());
    }

    // 5. Export Version Validation
    const expVer = document.getElementById('export-pkg-version');
    if (expVer) {
      validator.attachLiveInputValidation(expVer, (val) => validator.validateExportVersion(val));
    }
  }

  // Initial Boot
  initIcons();
  syncBitmapCreatorInputs();
  initRealTimeValidation();
  switchView(activeView || 'dashboard', true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMainApplication);
} else {
  initializeMainApplication();
}


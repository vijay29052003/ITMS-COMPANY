/**
 * @file loading-manager.js
 * @description Centralized Asynchronous Loading States, Button Spinners, Card Overlays, and Long-Operation Progress Indicators.
 * @module LoadingManager
 */

(function () {
  'use strict';

  class ITMSLoadingManager {
    constructor() {
      /** @type {Map<string, Object>} Active task controllers */
      this._activeTasks = new Map();
      this._progressModalContainer = null;
    }

    /**
     * Shows inline spinner on an action button and disables it during async execution.
     * @param {string|HTMLButtonElement} btnOrId 
     * @param {string} [loadingText=''] 
     */
    showButtonLoading(btnOrId, loadingText = '') {
      if (typeof document === 'undefined') return;
      const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
      if (!btn) return;

      if (!btn.dataset.origHtml) {
        btn.dataset.origHtml = btn.innerHTML;
      }
      btn.classList.add('btn-loading');
      btn.disabled = true;
      btn.setAttribute('disabled', 'true');
      btn.style.cursor = 'not-allowed';

      if (loadingText) {
        btn.dataset.loadingText = loadingText;
      }
    }

    /**
     * Hides inline button spinner and restores original state.
     * @param {string|HTMLButtonElement} btnOrId 
     */
    hideButtonLoading(btnOrId) {
      if (typeof document === 'undefined') return;
      const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
      if (!btn) return;

      btn.classList.remove('btn-loading');
      btn.disabled = false;
      btn.removeAttribute('disabled');
      btn.style.cursor = '';

      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
    }

    /**
     * Displays a glassmorphic blurred loading overlay inside a card or container.
     * @param {string|HTMLElement} cardOrId 
     * @param {string} [message='Processing...'] 
     * @param {string} [subtext=''] 
     */
    showCardLoading(cardOrId, message = 'Processing...', subtext = '') {
      if (typeof document === 'undefined') return;
      const card = typeof cardOrId === 'string' ? document.getElementById(cardOrId) : cardOrId;
      if (!card) return;

      // Ensure relative positioning on parent
      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }

      this.hideCardLoading(card); // Remove any existing overlay

      const overlay = document.createElement('div');
      overlay.className = 'card-loading-overlay';
      overlay.innerHTML = `
        <div class="loading-spinner-ring"></div>
        <div class="loading-overlay-text">${this._escapeHtml(message)}</div>
        ${subtext ? `<div class="loading-overlay-subtext">${this._escapeHtml(subtext)}</div>` : ''}
      `;
      card.appendChild(overlay);
    }

    /**
     * Removes card loading overlay.
     * @param {string|HTMLElement} cardOrId 
     */
    hideCardLoading(cardOrId) {
      if (typeof document === 'undefined') return;
      const card = typeof cardOrId === 'string' ? document.getElementById(cardOrId) : cardOrId;
      if (!card) return;

      const overlay = card.querySelector('.card-loading-overlay');
      if (overlay) {
        overlay.remove();
      }
    }

    /**
     * Opens an interactive, animated progress modal for long-running batch operations.
     * @param {string} title 
     * @param {string} [initialMessage='Initializing...'] 
     * @param {Object} [options={}]
     */
    showProgressModal(title, initialMessage = 'Initializing...', options = {}) {
      if (typeof document === 'undefined') return;

      this._ensureProgressModalContainer();
      if (!this._progressModalContainer) return;

      this._progressModalContainer.innerHTML = `
        <div class="modal-overlay active" id="global-progress-modal-overlay" style="z-index: 10001;">
          <div class="modal-card glass-panel" style="max-width: 520px; border-top: 4px solid var(--primary, #00ABEF); box-shadow: 0 20px 40px rgba(0,0,0,0.25);">
            <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="display:inline-block; width:18px; height:18px; border:2.5px solid #cbd5e1; border-top-color:var(--primary, #00ABEF); border-radius:50%; animation:btnSpin 0.75s linear infinite;"></span>
                <h3 class="modal-title" style="margin:0; font-size:16px; font-weight:700; color:var(--text-main);">${this._escapeHtml(title)}</h3>
              </div>
              ${options.canCancel ? `<button type="button" class="modal-close" id="btn-cancel-global-progress">&times;</button>` : ''}
            </div>

            <div class="modal-body" style="padding: 20px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                <span id="global-progress-status-text" style="font-size:13.5px; font-weight:600; color:var(--text-main);">${this._escapeHtml(initialMessage)}</span>
                <span id="global-progress-percent-badge" style="font-size:13px; font-weight:800; font-family:monospace; color:var(--primary, #00ABEF); background:rgba(0,171,239,0.1); padding:2px 8px; border-radius:12px;">0%</span>
              </div>

              <div style="width:100%; height:10px; background:#e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:12px;">
                <div id="global-progress-fill-bar" class="progress-bar-animated-stripes" style="width:0%; height:100%; background:linear-gradient(90deg, #00ABEF, #0284c7); border-radius:6px; transition:width 0.25s ease;"></div>
              </div>

              <div id="global-progress-detail-text" style="font-size:12px; color:var(--text-muted, #64748b); line-height:1.4;">
                ${options.detail ? this._escapeHtml(options.detail) : 'Processing operation in background...'}
              </div>
            </div>

            ${options.canCancel ? `
              <div class="modal-footer" style="padding: 12px 20px; border-top: 1px solid rgba(0,0,0,0.06); display:flex; justify-content:flex-end;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-global-progress-footer">Cancel Operation</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      if (options.onCancel) {
        const cancelBtn1 = document.getElementById('btn-cancel-global-progress');
        const cancelBtn2 = document.getElementById('btn-cancel-global-progress-footer');
        if (cancelBtn1) cancelBtn1.addEventListener('click', options.onCancel);
        if (cancelBtn2) cancelBtn2.addEventListener('click', options.onCancel);
      }
    }

    /**
     * Updates active progress modal status and percentage.
     * @param {number} percent (0 - 100)
     * @param {string} [message=''] 
     * @param {string} [detail=''] 
     */
    updateProgress(percent, message = '', detail = '') {
      if (typeof document === 'undefined') return;

      const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
      const fillBar = document.getElementById('global-progress-fill-bar');
      const badge = document.getElementById('global-progress-percent-badge');
      const statusText = document.getElementById('global-progress-status-text');
      const detailText = document.getElementById('global-progress-detail-text');

      if (fillBar) fillBar.style.width = `${safePercent}%`;
      if (badge) badge.textContent = `${safePercent}%`;
      if (message && statusText) statusText.textContent = message;
      if (detail && detailText) detailText.textContent = detail;
    }

    /**
     * Closes the active progress modal.
     */
    hideProgressModal() {
      if (typeof document === 'undefined') return;
      const overlay = document.getElementById('global-progress-modal-overlay');
      if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 200);
      }
    }

    /**
     * Wraps any asynchronous promise action with automatic button/card loading state handling.
     * @param {HTMLElement|string} targetEl 
     * @param {Function} asyncFn 
     * @param {Object} [options={}]
     * @returns {Promise<any>}
     */
    async withLoading(targetEl, asyncFn, options = {}) {
      const isButton = targetEl && (targetEl.tagName === 'BUTTON' || (typeof targetEl === 'string' && targetEl.includes('btn')));
      try {
        if (isButton) {
          this.showButtonLoading(targetEl, options.loadingText);
        } else if (targetEl) {
          this.showCardLoading(targetEl, options.message || 'Loading...', options.subtext);
        }

        return await asyncFn();
      } finally {
        if (isButton) {
          this.hideButtonLoading(targetEl);
        } else if (targetEl) {
          this.hideCardLoading(targetEl);
        }
      }
    }

    /**
     * Ensures DOM container for progress modal exists.
     * @private
     */
    _ensureProgressModalContainer() {
      if (this._progressModalContainer && document.body && document.body.contains(this._progressModalContainer)) return;
      this._progressModalContainer = document.getElementById('itms-global-progress-container');
      if (!this._progressModalContainer && document.body) {
        this._progressModalContainer = document.createElement('div');
        this._progressModalContainer.id = 'itms-global-progress-container';
        document.body.appendChild(this._progressModalContainer);
      }
    }

    /**
     * Escapes HTML to prevent XSS.
     * @private
     */
    _escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  }

  // Create Singleton Instance
  const LoadingManagerInstance = new ITMSLoadingManager();

  // Export to Global & ITMS Namespace
  if (typeof window !== 'undefined') {
    window.ITMS = window.ITMS || {};
    window.ITMS.LoadingManager = LoadingManagerInstance;
    window.ITMS.ITMSLoadingManager = ITMSLoadingManager;
    window.ITMSLoadingManager = LoadingManagerInstance;
    window.LoadingManager = LoadingManagerInstance;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ITMSLoadingManager, LoadingManagerInstance };
  }
})();

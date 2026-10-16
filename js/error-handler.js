/**
 * @file error-handler.js
 * @description Granular Error Taxonomy, User-Friendly Error Notifications, and Interactive Error Modals for ITMS LED Suite.
 * @module ErrorHandler
 */

(function () {
  'use strict';

  /**
   * Granular Error Categories
   */
  const ITMSErrorCategory = {
    STORAGE: 'STORAGE',
    CRYPTO: 'CRYPTO',
    SERIAL: 'SERIAL',
    RASTER: 'RASTER',
    EXPORT: 'EXPORT',
    NETWORK: 'NETWORK',
    VALIDATION: 'VALIDATION',
    IMPORT: 'IMPORT',
    FONT: 'FONT',
    SYSTEM: 'SYSTEM'
  };

  /**
   * Structured Error Class
   */
  class ITMSError {
    /**
     * @param {Object} opts
     * @param {string} opts.code Unique error code (e.g., 'ERR_STORAGE_QUOTA')
     * @param {string} opts.category Category from ITMSErrorCategory
     * @param {'info'|'warning'|'error'|'critical'} [opts.severity='error'] Severity level
     * @param {string} opts.title Short user-friendly error title
     * @param {string} opts.message Explanation of what happened
     * @param {string} [opts.resolution=''] Actionable advice on how the user can resolve it
     * @param {any} [opts.technicalDetails=null] Original error stack or technical context
     */
    constructor(opts = {}) {
      this.code = opts.code || 'ERR_UNKNOWN';
      this.category = opts.category || ITMSErrorCategory.SYSTEM;
      this.severity = opts.severity || 'error';
      this.title = opts.title || 'An Unexpected Condition Occurred';
      this.message = opts.message || 'The application encountered an unexpected situation.';
      this.resolution = opts.resolution || 'Try refreshing the page or repeating the operation.';
      this.technicalDetails = opts.technicalDetails || null;
      this.timestamp = new Date().toISOString();
    }
  }

  /**
   * Main Error Handler & User Notification Dispatcher
   */
  class ITMSErrorHandler {
    constructor() {
      /** @type {ITMSError[]} Ring buffer of last 50 error events */
      this._errorLog = [];
      this._maxLogSize = 50;

      /** @type {HTMLElement|null} Container element for toasts */
      this._toastContainer = null;

      // Attach Global Window Error & Promise Rejection Handlers
      if (typeof window !== 'undefined') {
        window.addEventListener('error', (event) => {
          // Ignore non-critical resource loading errors (like optional missing image assets)
          if (event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
            return;
          }
          // Ignore generic browser synthetic 'Script error.' emitted on file:// or cross-origin boundary
          if (event.message === 'Script error.' || !event.message) {
            return;
          }
          const err = event.error || new Error(event.message || 'Unknown runtime error');
          this.handleError(ITMSErrorCategory.SYSTEM, err, {
            title: 'System Runtime Notice',
            severity: 'warning'
          });
        });

        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason || new Error('Unhandled Promise Rejection');
          // Suppress intentional cancellation exceptions
          if (reason && typeof reason.message === 'string' && /cancelled|aborted/i.test(reason.message)) {
            return;
          }
          this.handleError(ITMSErrorCategory.SYSTEM, reason, {
            title: 'Asynchronous Task Notice',
            severity: 'warning'
          });
        });
      }
    }

    /**
     * Centralized Error Handler. Parses raw errors, logs them, and dispatches appropriate UI notifications.
     * @param {string|ITMSErrorCategory} category Error category
     * @param {any} rawError Raw Error object, string, or DOMException
     * @param {Object} [context={}] Additional contextual information
     * @returns {ITMSError} Parsed ITMSError instance
     */
    handleError(category, rawError, context = {}) {
      const itmsError = this._translateError(category, rawError, context);

      // Record in diagnostic ring buffer
      this._logError(itmsError);

      // Log to developer console
      console.group(`[ITMS Error] [${itmsError.category}] ${itmsError.code} (${itmsError.severity.toUpperCase()})`);
      console.warn(`Title: ${itmsError.title}`);
      console.warn(`User Message: ${itmsError.message}`);
      console.warn(`Resolution: ${itmsError.resolution}`);
      if (itmsError.technicalDetails) console.error(`Technical Details:`, itmsError.technicalDetails);
      console.groupEnd();

      // Dispatch UI notification based on severity
      if (itmsError.severity === 'critical' || context.showModal) {
        this.showErrorModal(itmsError);
      } else {
        const toastType = itmsError.severity === 'error' ? 'danger' : (itmsError.severity === 'critical' ? 'danger' : itmsError.severity);
        this.showToast(itmsError.message, toastType, 4500, itmsError.title);
      }

      return itmsError;
    }

    /**
     * Re-enabled and elevated Toast Notification System with modern glassmorphic styling.
     * @param {string} message 
     * @param {'info'|'success'|'warning'|'danger'|'error'} [type='info'] 
     * @param {number} [duration=3500] Duration in ms
     * @param {string} [title=''] Optional title
     */
    showToast(message, type = 'info', duration = 3500, title = '') {
      if (typeof document === 'undefined') return;

      this._ensureToastContainer();
      if (!this._toastContainer) return;

      const normalizedType = type === 'error' ? 'danger' : type;

      // Bootstrap Icon mappings
      const icons = {
        success: 'bi-check-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        danger: 'bi-exclamation-octagon-fill',
        info: 'bi-info-circle-fill'
      };
      const iconClass = icons[normalizedType] || 'bi-info-circle-fill';

      const toastEl = document.createElement('div');
      toastEl.className = `itms-toast itms-toast-${normalizedType}`;
      toastEl.setAttribute('role', 'alert');

      const titleHtml = title ? `<div class="itms-toast-title">${this._escapeHtml(title)}</div>` : '';
      const msgHtml = `<div class="itms-toast-msg">${this._escapeHtml(message)}</div>`;

      toastEl.innerHTML = `
        <div class="itms-toast-icon">
          <i class="bi ${iconClass}"></i>
        </div>
        <div class="itms-toast-content">
          ${titleHtml}
          ${msgHtml}
        </div>
        <button type="button" class="itms-toast-close" title="Dismiss">&times;</button>
        <div class="itms-toast-progress" style="animation-duration: ${duration}ms;"></div>
      `;

      // Attach dismiss handler
      const closeBtn = toastEl.querySelector('.itms-toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this._removeToast(toastEl));
      }

      // Append to container (keep max 5 toasts visible)
      if (this._toastContainer.children.length >= 5) {
        this._removeToast(this._toastContainer.children[0]);
      }
      this._toastContainer.appendChild(toastEl);

      // Bootstrap Icons render natively via CSS

      // Auto dismiss timer
      setTimeout(() => this._removeToast(toastEl), duration);
    }

    /**
     * Interactive Error Modal Dialog for Critical Failures
     * @param {ITMSError} error 
     */
    showErrorModal(error) {
      if (typeof document === 'undefined') return;

      let modalContainer = document.getElementById('itms-error-modal-container');
      if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'itms-error-modal-container';
        document.body.appendChild(modalContainer);
      }

      const techStr = error.technicalDetails
        ? (typeof error.technicalDetails === 'string' ? error.technicalDetails : JSON.stringify(error.technicalDetails, null, 2))
        : 'No technical stack trace available.';

      modalContainer.innerHTML = `
        <div class="modal-overlay active" id="itms-error-modal-overlay" style="z-index: 10000;">
          <div class="modal-card glass-panel" style="max-width: 600px; border-left: 5px solid var(--danger, #ff4757);">
            <div class="modal-header">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; background:rgba(255,71,87,0.15); color:var(--danger, #ff4757); font-size:20px; font-weight:bold;">⚠️</span>
                <div>
                  <h3 class="modal-title" style="margin:0; color:var(--text-main, #14151f); font-size:16px;">${this._escapeHtml(error.title)}</h3>
                  <div style="display:flex; gap:6px; margin-top:2px;">
                    <span style="font-size:11px; font-family:monospace; background:rgba(0,0,0,0.06); padding:2px 6px; border-radius:4px; font-weight:700; color:var(--primary, #00ABEF);">${this._escapeHtml(error.category)}</span>
                    <span style="font-size:11px; font-family:monospace; background:rgba(0,0,0,0.06); padding:2px 6px; border-radius:4px; color:#64748b;">${this._escapeHtml(error.code)}</span>
                  </div>
                </div>
              </div>
              <button class="modal-close" id="btn-close-error-modal">&times;</button>
            </div>
            
            <div class="modal-body" style="padding: 16px; font-size: 13.5px; line-height: 1.5;">
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                <strong style="color: #0f172a; display: block; margin-bottom: 4px; font-size: 13px;">What Happened:</strong>
                <p style="margin: 0; color: #334155;">${this._escapeHtml(error.message)}</p>
              </div>

              <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                <strong style="color: #059669; display: block; margin-bottom: 4px; font-size: 13px;">💡 How to Fix:</strong>
                <p style="margin: 0; color: #065f46;">${this._escapeHtml(error.resolution)}</p>
              </div>

              <details style="background: #0f172a; border-radius: 6px; padding: 8px 12px; margin-top: 10px;">
                <summary style="cursor: pointer; color: #94a3b8; font-size: 12px; font-weight: 600;">Technical Diagnostics & Stack Trace</summary>
                <pre style="margin-top: 8px; font-family: monospace; font-size: 11px; color: #f87171; max-height: 150px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;">${this._escapeHtml(techStr)}</pre>
              </details>
            </div>

            <div class="modal-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #e2e8f0;">
              <button class="btn btn-secondary" id="btn-copy-error-log" style="padding: 6px 12px; font-size: 12px;">📋 Copy Log</button>
              <button class="btn btn-secondary" id="btn-export-diagnostics" style="padding: 6px 12px; font-size: 12px;">📥 Save Diagnostic Report</button>
              <button class="btn btn-primary" id="btn-dismiss-error-modal" style="padding: 6px 16px; font-size: 12px;">Dismiss</button>
            </div>
          </div>
        </div>
      `;

      const closeBtn = document.getElementById('btn-close-error-modal');
      const dismissBtn = document.getElementById('btn-dismiss-error-modal');
      const copyBtn = document.getElementById('btn-copy-error-log');
      const exportBtn = document.getElementById('btn-export-diagnostics');

      const closeModal = () => {
        const overlay = document.getElementById('itms-error-modal-overlay');
        if (overlay) overlay.classList.remove('active');
      };

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const logPayload = `ITMS ERROR REPORT\nCategory: ${error.category}\nCode: ${error.code}\nTitle: ${error.title}\nMessage: ${error.message}\nResolution: ${error.resolution}\nTimestamp: ${error.timestamp}\nDetails: ${techStr}`;
          navigator.clipboard.writeText(logPayload).then(() => {
            this.showToast('Error details copied to clipboard', 'info', 2000);
          }).catch(() => {
            this.showToast('Could not copy to clipboard', 'warning');
          });
        });
      }

      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          this.exportDiagnosticLogs();
        });
      }
    }

    /**
     * Exports full diagnostic logs buffer as a JSON file download.
     */
    exportDiagnosticLogs() {
      const payload = {
        app: 'ITMS LED Suite Diagnostics',
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
        totalLoggedErrors: this._errorLog.length,
        errors: this._errorLog
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ITMS_Diagnostics_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      this.showToast('Diagnostic log report downloaded!', 'success');
    }

    /**
     * Returns all logged diagnostic error records.
     * @returns {Array<ITMSError>}
     */
    getErrorLog() {
      return this._errorLog.slice();
    }

    /**
     * Returns recent errors up to the specified limit.
     * @param {number} [limit=10]
     * @returns {Array<ITMSError>}
     */
    getRecentErrors(limit = 10) {
      return this._errorLog.slice(-limit);
    }

    /**
     * Translates low-level browser exceptions or raw errors into structured ITMSError instances.
     * @private
     */
    _translateError(category, rawError, context) {
      if (rawError instanceof ITMSError) return rawError;

      const rawMsg = rawError ? (rawError.message || String(rawError)) : 'Unknown exception';
      const rawStack = rawError ? (rawError.stack || rawError) : null;

      let code = `${category}_GENERIC_ERROR`;
      let severity = 'error';
      let title = 'Operation Notice';
      let message = rawMsg;
      let resolution = 'Please check the entered values or retry the operation.';

      // Pattern Matching for Specific Granular Categories
      if (category === ITMSErrorCategory.IMPORT) {
        if (/missing required column|header|column/i.test(rawMsg)) {
          code = 'ERR_IMPORT_MISSING_COLUMNS';
          severity = 'error';
          title = 'Spreadsheet Columns Incomplete';
          message = 'The uploaded CSV/Excel spreadsheet is missing essential route headers.';
          resolution = 'Ensure your file includes columns for: "Route Code", "Route Name", "Start Terminal", "Destination", and stops.';
        } else if (/empty file|0 bytes|no rows/i.test(rawMsg)) {
          code = 'ERR_IMPORT_EMPTY_FILE';
          severity = 'warning';
          title = 'Empty Import File';
          message = 'The selected file contains no bus route rows or data.';
          resolution = 'Select a CSV or Excel (.xlsx) file that contains route and stop information.';
        } else if (/unsupported file|extension/i.test(rawMsg)) {
          code = 'ERR_IMPORT_INVALID_FORMAT';
          severity = 'error';
          title = 'Unsupported File Type';
          message = 'Only CSV (.csv) and Excel (.xlsx) formats are supported for bulk route import.';
          resolution = 'Save your route spreadsheet as a standard .CSV (Comma Delimited) or Excel (.xlsx) workbook.';
        } else {
          code = 'ERR_IMPORT_PARSE_FAILED';
          severity = 'error';
          title = 'Bulk Import Failed';
          message = rawMsg || 'Could not parse route rows from the selected file.';
          resolution = 'Verify that the spreadsheet does not contain unclosed quotes or unsupported binary encoding.';
        }
      } else if (category === ITMSErrorCategory.FONT) {
        if (/opentype|tables|cff|glyf/i.test(rawMsg)) {
          code = 'ERR_FONT_OPENTYPE_CORRUPT';
          severity = 'error';
          title = 'Font File Corrupted';
          message = 'The uploaded TrueType/OpenType font could not be parsed by the vector engine.';
          resolution = 'Verify the font file is a valid standard TrueType (.ttf) or OpenType (.otf) font.';
        } else if (/size|limit|exceeds/i.test(rawMsg)) {
          code = 'ERR_FONT_SIZE_EXCEEDED';
          severity = 'warning';
          title = 'Font File Exceeds Limit';
          message = 'Custom font files must be under 15MB to maintain fast offline rendering.';
          resolution = 'Choose a subset or standard WOFF/TTF font under 15MB.';
        } else {
          code = 'ERR_FONT_LOAD_FAILED';
          severity = 'error';
          title = 'Custom Font Failed to Load';
          message = rawMsg || 'The font file could not be registered into the browser.';
          resolution = 'Ensure the font file has a valid .ttf, .otf, or .woff extension.';
        }
      } else if (category === ITMSErrorCategory.STORAGE) {
        if (/QuotaExceededError/i.test(rawMsg) || /quota/i.test(rawMsg)) {
          code = 'ERR_STORAGE_QUOTA_EXCEEDED';
          severity = 'warning';
          title = 'Local Storage Quota Full';
          message = 'Synchronous browser cache (5MB) is full. High-capacity IndexedDB is active.';
          resolution = 'Your data is safe in IndexedDB. Delete unneeded temporary drafts or backup history to free memory.';
        } else if (/IndexedDB|database|transaction/i.test(rawMsg)) {
          code = 'ERR_STORAGE_INDEXEDDB_LOCK';
          severity = 'warning';
          title = 'Database Synchronization Notice';
          message = 'IndexedDB encountered a momentary transaction lock.';
          resolution = 'The system auto-recovered. You can continue using the application normally.';
        } else if (/JSON/i.test(rawMsg) || /parse/i.test(rawMsg)) {
          code = 'ERR_STORAGE_INVALID_JSON';
          severity = 'error';
          title = 'Invalid JSON Structure';
          message = 'The uploaded backup file contains corrupt or malformed JSON syntax.';
          resolution = 'Please use a valid ITMS Route Backup or Fleet JSON export file.';
        }
      } else if (category === ITMSErrorCategory.SERIAL) {
        if (/not supported/i.test(rawMsg) || /navigator\.serial/i.test(rawMsg)) {
          code = 'ERR_SERIAL_UNSUPPORTED_BROWSER';
          severity = 'critical';
          title = 'Web Serial API Not Supported';
          message = 'Your web browser does not support physical hardware Serial COM flashing.';
          resolution = 'Please open this application in Google Chrome, Microsoft Edge, or Opera on Windows, macOS, or Linux.';
        } else if (/already open|busy|locked|in use/i.test(rawMsg)) {
          code = 'ERR_SERIAL_PORT_BUSY';
          severity = 'warning';
          title = 'USB Serial Port In Use';
          message = 'The selected Serial COM port is locked by another running program.';
          resolution = 'Close any open terminal monitors (e.g. Arduino Serial Monitor, PuTTY, TeraTerm) and try reconnecting.';
        } else if (/device disconnected|lost|closed|unplugged/i.test(rawMsg)) {
          code = 'ERR_SERIAL_DEVICE_DISCONNECTED';
          severity = 'warning';
          title = 'Hardware Controller Disconnected';
          message = 'The LED hardware microcontroller was disconnected from USB.';
          resolution = 'Verify the USB cable connection, then click "Flash Fleet via USB" to reconnect.';
        } else if (/permission|denied|canceled|user/i.test(rawMsg)) {
          code = 'ERR_SERIAL_PERMISSION_CANCELLED';
          severity = 'info';
          title = 'USB Selection Cancelled';
          message = 'No USB device port was selected by the user.';
          resolution = 'Plug in your microcontroller via USB and select the corresponding COM port in the browser popup.';
        }
      } else if (category === ITMSErrorCategory.EXPORT) {
        if (/JSZip/i.test(rawMsg)) {
          code = 'ERR_EXPORT_MISSING_JSZIP';
          severity = 'critical';
          title = 'ZIP Compression Engine Missing';
          message = 'The JSZip firmware packaging engine could not be initialized.';
          resolution = 'Refresh the browser to reload the vendor libraries.';
        } else if (/cancelled|aborted/i.test(rawMsg)) {
          code = 'ERR_EXPORT_CANCELLED';
          severity = 'info';
          title = 'Export Cancelled';
          message = 'Firmware package export was cancelled by user.';
          resolution = 'You can restart export at any time.';
        } else if (/no.*routes/i.test(rawMsg)) {
          code = 'ERR_EXPORT_NO_ROUTES';
          severity = 'warning';
          title = 'No Routes Selected';
          message = 'There are no bus routes available to package in the export bundle.';
          resolution = 'Add at least one route in Route Manager or import a fleet spreadsheet first.';
        }
      } else if (category === ITMSErrorCategory.VALIDATION) {
        code = 'ERR_VALIDATION_FAILED';
        severity = 'warning';
        title = 'Validation Notice';
        message = context.detail || rawMsg || 'The input values did not satisfy schema requirements.';
        resolution = 'Check the route code, terminal names, and stop sequence numbers, then try again.';
      } else if (category === ITMSErrorCategory.RASTER) {
        code = 'ERR_RASTER_RENDER_EXCEPTION';
        severity = 'warning';
        title = 'LED Matrix Rendering Alert';
        message = rawMsg || 'The virtual LED dot matrix canvas encountered a rendering issue.';
        resolution = 'Ensure Hardware Acceleration is enabled in your browser settings.';
      } else if (category === ITMSErrorCategory.CRYPTO) {
        code = 'ERR_CRYPTO_AES_NOTICE';
        severity = 'warning';
        title = 'Storage Security Notice';
        message = 'Web Crypto AES-GCM engine is using secure synchronous memory fallback.';
        resolution = 'For maximum encryption, run the application on HTTPS or localhost.';
      }

      if (context.code) code = context.code;
      if (context.title) title = context.title;
      if (context.severity) severity = context.severity;
      if (context.message) message = context.message;
      if (context.resolution) resolution = context.resolution;

      return new ITMSError({
        code,
        category,
        severity,
        title,
        message,
        resolution,
        technicalDetails: rawStack
      });
    }

    /**
     * Stores error in ring buffer.
     * @private
     */
    _logError(itmsError) {
      this._errorLog.unshift(itmsError);
      if (this._errorLog.length > this._maxLogSize) {
        this._errorLog.pop();
      }
    }

    /**
     * Helper to safely remove toast with animation.
     * @private
     */
    _removeToast(toastEl) {
      if (!toastEl || toastEl.classList.contains('itms-toast-leaving')) return;
      toastEl.classList.add('itms-toast-leaving');
      setTimeout(() => {
        if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      }, 300);
    }

    /**
     * Ensures container for toasts exists in DOM.
     * @private
     */
    _ensureToastContainer() {
      if (this._toastContainer && document.body.contains(this._toastContainer)) return;
      this._toastContainer = document.getElementById('itms-toast-container') || document.getElementById('toast-container');
      if (!this._toastContainer) {
        this._toastContainer = document.createElement('div');
        this._toastContainer.id = 'itms-toast-container';
        this._toastContainer.className = 'itms-toast-container';
        this._toastContainer.setAttribute('aria-live', 'polite');
        document.body.appendChild(this._toastContainer);
      }
    }

    /**
     * Escapes HTML strings to prevent DOM XSS.
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
  const ErrorHandlerInstance = new ITMSErrorHandler();

  // Convenience Notification Global Wrappers
  function notifyUserError(category, err, context = {}) {
    return ErrorHandlerInstance.handleError(category, err, context);
  }

  function notifyUserSuccess(message, title = 'Operation Successful') {
    ErrorHandlerInstance.showToast(message, 'success', 3500, title);
  }

  function notifyUserWarning(message, title = 'Notice') {
    ErrorHandlerInstance.showToast(message, 'warning', 4000, title);
  }

  function notifyUserInfo(message, title = 'Information') {
    ErrorHandlerInstance.showToast(message, 'info', 3500, title);
  }

  // Export to Global & ITMS Namespace
  if (typeof window !== 'undefined') {
    window.ITMS = window.ITMS || {};
    window.ITMS.ErrorHandler = ErrorHandlerInstance;
    window.ITMS.ErrorCategory = ITMSErrorCategory;
    window.ITMS.ITMSError = ITMSError;
    window.ITMSErrorHandler = ErrorHandlerInstance;
    window.ITMSErrorCategory = ITMSErrorCategory;
    window.notifyUserError = notifyUserError;
    window.notifyUserSuccess = notifyUserSuccess;
    window.notifyUserWarning = notifyUserWarning;
    window.notifyUserInfo = notifyUserInfo;
    window.showToast = (msg, type = 'info', duration = 3500, title = '') => ErrorHandlerInstance.showToast(msg, type, duration, title);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ITMSErrorHandler,
      ITMSErrorCategory,
      ITMSError,
      ErrorHandlerInstance,
      notifyUserError,
      notifyUserSuccess,
      notifyUserWarning,
      notifyUserInfo
    };
  }
})();

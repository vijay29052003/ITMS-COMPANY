/**
 * @file input-validator.js
 * @description Real-Time Form Validation, Input Sanitization, and Dynamic Feedback Engine for ITMS LED Suite.
 * @module InputValidator
 */

(function () {
  'use strict';

  class ITMSInputValidator {
    constructor() {
      // Regex validation patterns
      this.patterns = {
        routeCode: /^[A-Za-z0-9\-\/]{1,10}$/,
        routeName: /^[\p{L}\p{N}\s\-.,()[\]]{2,100}$/u,
        stopName: /^[\p{L}\p{N}\s\-.,()[\]]{1,80}$/u,
        terminalName: /^[\p{L}\p{N}\s\-.,()[\]]{2,80}$/u,
        version: /^\d+\.\d+\.\d+$/,
        positiveInteger: /^\d+$/,
        hexColor: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
      };
    }

    /**
     * Validates a Bus Route Code with uniqueness checking
     * @param {string} code 
     * @param {Array<Object>} [existingRoutes=[]] 
     * @param {string|null} [currentRouteId=null] 
     * @returns {{ isValid: boolean, message: string }}
     */
    validateRouteCode(code, existingRoutes = [], currentRouteId = null) {
      const val = (code || '').trim();
      if (!val) {
        return { isValid: false, message: 'Route code is required (e.g. 5C, 320, 218).' };
      }
      if (val.length > 10) {
        return { isValid: false, message: `Route code exceeds 10 characters (current: ${val.length}).` };
      }
      if (!this.patterns.routeCode.test(val)) {
        return { isValid: false, message: 'Route code may only contain letters, numbers, hyphens (-), and slashes (/).' };
      }

      // Check duplicate route code in existing routes list
      if (Array.isArray(existingRoutes) && existingRoutes.length > 0) {
        const isDuplicate = existingRoutes.some(r => {
          if (!r || !r.code) return false;
          if (currentRouteId && r.id === currentRouteId) return false;
          return r.code.trim().toUpperCase() === val.toUpperCase();
        });
        if (isDuplicate) {
          return { isValid: false, message: `Route code "${val}" already exists in fleet database.` };
        }
      }

      return { isValid: true, message: 'Valid route code' };
    }

    /**
     * Validates Route Name
     * @param {string} name 
     * @returns {{ isValid: boolean, message: string }}
     */
    validateRouteName(name) {
      const val = (name || '').trim();
      if (!val) {
        return { isValid: false, message: 'Route name is required (e.g. Charminar - Falaknuma).' };
      }
      if (val.length < 2) {
        return { isValid: false, message: 'Route name must be at least 2 characters.' };
      }
      if (val.length > 100) {
        return { isValid: false, message: `Route name exceeds 100 characters (current: ${val.length}).` };
      }
      return { isValid: true, message: 'Valid route name' };
    }

    /**
     * Validates Start or Destination Terminal Name
     * @param {string} name 
     * @param {string} [label='Terminal'] 
     * @returns {{ isValid: boolean, message: string }}
     */
    validateTerminalName(name, label = 'Terminal') {
      const val = (name || '').trim();
      if (!val) {
        return { isValid: false, message: `${label} name is required.` };
      }
      if (val.length < 2) {
        return { isValid: false, message: `${label} must be at least 2 characters.` };
      }
      if (val.length > 80) {
        return { isValid: false, message: `${label} exceeds 80 characters.` };
      }
      return { isValid: true, message: `Valid ${label.toLowerCase()}` };
    }

    /**
     * Validates LED Matrix Dimensions
     * @param {number|string} width 
     * @param {number|string} height 
     * @returns {{ isValid: boolean, message: string }}
     */
    validateMatrixDimensions(width, height) {
      const w = parseInt(width, 10);
      const h = parseInt(height, 10);

      if (isNaN(w) || w < 16 || w > 1024) {
        return { isValid: false, message: 'Matrix width must be between 16 and 1024 pixels.' };
      }
      if (isNaN(h) || h < 8 || h > 128) {
        return { isValid: false, message: 'Matrix height must be between 8 and 128 pixels.' };
      }
      if (w % 8 !== 0) {
        return { isValid: true, message: 'Notice: Width is not a multiple of 8 (hardware standard is 128, 256, 512).' };
      }
      return { isValid: true, message: 'Valid matrix dimensions' };
    }

    /**
     * Validates Export Firmware Version (SemVer X.Y.Z)
     * @param {string} ver 
     * @returns {{ isValid: boolean, message: string }}
     */
    validateExportVersion(ver) {
      const val = (ver || '').trim();
      if (!val) {
        return { isValid: false, message: 'Version is required (e.g. 2.0.0).' };
      }
      if (!this.patterns.version.test(val)) {
        return { isValid: false, message: 'Version must follow SemVer format "X.Y.Z" (e.g. 1.0.0, 2.1.4).' };
      }
      return { isValid: true, message: 'Valid version format' };
    }

    /**
     * Comprehensive File Upload Security & Integrity Validation:
     * - File size limit enforcement (25MB max)
     * - File type & extension validation
     * - MIME type verification
     * - Path traversal and suspicious filename detection
     * @param {File|Object} file Browser File object or mock file { name, size, type }
     * @param {Object} [options={}]
     * @param {number} [options.maxSizeBytes=26214400] Default 25MB (25 * 1024 * 1024)
     * @param {Array<string>} [options.allowedExtensions=[]] e.g. ['.csv', '.xlsx', '.json']
     * @param {Array<string>} [options.allowedMimeTypes=[]] e.g. ['text/csv', 'application/json']
     * @returns {{ isValid: boolean, message: string, code?: string }}
     */
    validateFileUpload(file, options = {}) {
      if (!file) {
        return { isValid: false, message: 'No file was selected for upload.', code: 'ERR_NO_FILE' };
      }

      const filename = (file.name || '').trim();
      const fileSize = typeof file.size === 'number' ? file.size : 0;
      const fileType = (file.type || '').trim().toLowerCase();
      const maxSizeBytes = typeof options.maxSizeBytes === 'number' ? options.maxSizeBytes : 25 * 1024 * 1024; // 25MB

      // 1. Suspicious Filename & Path Traversal Checks
      if (!filename || filename.length === 0) {
        return { isValid: false, message: 'Uploaded file has an empty or invalid filename.', code: 'ERR_EMPTY_FILENAME' };
      }
      if (filename.length > 255) {
        return { isValid: false, message: 'Filename is too long (exceeds 255 characters limit).', code: 'ERR_FILENAME_TOO_LONG' };
      }
      // Check path traversal or null byte injection
      if (/\.\.|\/|\\|%2e%2e|\x00|[\x01-\x1f]/i.test(filename)) {
        return { isValid: false, message: 'Security alert: Suspicious filename containing illegal directory traversal characters.', code: 'ERR_SUSPICIOUS_FILENAME' };
      }
      // Dangerous executable or script extensions
      const dangerousExtRegex = /\.(exe|bat|cmd|sh|php|phtml|vbs|vbe|js|jsp|asp|aspx|py|pl|cgi|jar|dll|so|dylib|scr|msi|hta|com|ps1)$/i;
      if (dangerousExtRegex.test(filename)) {
        return { isValid: false, message: 'Security alert: Executable or script file formats are blocked for security.', code: 'ERR_DANGEROUS_FILETYPE' };
      }

      // 2. File Size Limit Checking (25MB Max)
      if (fileSize <= 0) {
        return { isValid: false, message: 'The uploaded file is empty (0 bytes).', code: 'ERR_EMPTY_FILE' };
      }
      if (fileSize > maxSizeBytes) {
        const maxMB = (maxSizeBytes / (1024 * 1024)).toFixed(0);
        const actualMB = (fileSize / (1024 * 1024)).toFixed(2);
        return { 
          isValid: false, 
          message: `File size (${actualMB} MB) exceeds the maximum allowed limit of ${maxMB} MB.`,
          code: 'ERR_FILE_TOO_LARGE'
        };
      }

      // 3. File Extension Validation
      const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

      if (Array.isArray(options.allowedExtensions) && options.allowedExtensions.length > 0) {
        const normalizedAllowedExts = options.allowedExtensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`);
        if (!normalizedAllowedExts.includes(ext)) {
          return {
            isValid: false,
            message: `Unsupported file extension "${ext}". Allowed types: ${normalizedAllowedExts.join(', ')}`,
            code: 'ERR_INVALID_EXTENSION'
          };
        }
      }

      // 4. MIME Type Verification (when available from browser)
      if (fileType && Array.isArray(options.allowedMimeTypes) && options.allowedMimeTypes.length > 0) {
        const isMimeAllowed = options.allowedMimeTypes.some(allowed => {
          const normAllowed = allowed.toLowerCase();
          return fileType === normAllowed || fileType.startsWith(normAllowed.replace('*', ''));
        });
        if (!isMimeAllowed) {
          return {
            isValid: false,
            message: `Invalid MIME format "${fileType}". Expected: ${options.allowedMimeTypes.join(', ')}`,
            code: 'ERR_INVALID_MIME_TYPE'
          };
        }
      }

      return { isValid: true, message: 'File is valid and safe for processing.' };
    }

    /**
     * Attaches live, real-time input validation to a single DOM input element
     * @param {HTMLInputElement|HTMLTextAreaElement} inputEl 
     * @param {Function} validatorFn Function(value) => { isValid, message }
     * @param {Object} [options={}]
     */
    attachLiveInputValidation(inputEl, validatorFn, options = {}) {
      if (!inputEl || typeof inputEl.addEventListener !== 'function') return;

      // Ensure feedback helper container exists directly below input or input-action-wrapper
      let parent = (typeof inputEl.closest === 'function' ? inputEl.closest('.input-action-wrapper') : null) || inputEl.parentNode;
      let feedbackEl = parent ? parent.querySelector('.invalid-feedback') : null;
      if (!feedbackEl && parent) {
        feedbackEl = document.createElement('div');
        feedbackEl.className = 'invalid-feedback';
        parent.appendChild(feedbackEl);
      }

      const validate = () => {
        const val = inputEl.value;
        const result = validatorFn(val);

        if (!result.isValid) {
          inputEl.classList.remove('is-valid');
          inputEl.classList.add('is-invalid');
          if (feedbackEl) {
            feedbackEl.innerHTML = `<span style="font-size:12px;">⚠️</span> ${result.message}`;
            feedbackEl.style.display = 'flex';
          }
          if (options.onValidation) options.onValidation(false, result);
        } else {
          inputEl.classList.remove('is-invalid');
          if (val.trim().length > 0 && options.showValidSuccess !== false) {
            inputEl.classList.add('is-valid');
          } else {
            inputEl.classList.remove('is-valid');
          }
          if (feedbackEl) {
            feedbackEl.textContent = '';
            feedbackEl.style.display = 'none';
          }
          if (options.onValidation) options.onValidation(true, result);
        }
      };

      inputEl.addEventListener('input', validate);
      inputEl.addEventListener('blur', validate);

      // Return trigger function
      return validate;
    }

    /**
     * Attaches live character counter to an input
     * @param {HTMLInputElement|HTMLTextAreaElement} inputEl 
     * @param {number} maxChars 
     */
    attachCharCounter(inputEl, maxChars = 100) {
      if (!inputEl || typeof inputEl.addEventListener !== 'function') return;
      const parent = inputEl.parentNode;
      if (!parent) return;

      let counterEl = parent.querySelector('.field-char-counter');
      if (!counterEl) {
        counterEl = document.createElement('div');
        counterEl.className = 'field-char-counter';
        parent.appendChild(counterEl);
      }

      const updateCounter = () => {
        const len = (inputEl.value || '').length;
        counterEl.textContent = `${len} / ${maxChars}`;
        counterEl.classList.toggle('limit-near', len >= maxChars * 0.8 && len < maxChars);
        counterEl.classList.toggle('limit-reached', len >= maxChars);
      };

      inputEl.addEventListener('input', updateCounter);
      updateCounter();
    }
  }

  // Create Singleton Instance
  const InputValidatorInstance = new ITMSInputValidator();

  // Export to Global & ITMS Namespace
  if (typeof window !== 'undefined') {
    window.ITMS = window.ITMS || {};
    window.ITMS.InputValidator = InputValidatorInstance;
    window.ITMS.ITMSInputValidator = ITMSInputValidator;
    window.ITMSInputValidator = InputValidatorInstance;
    window.InputValidator = InputValidatorInstance;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ITMSInputValidator, InputValidatorInstance };
  }
})();

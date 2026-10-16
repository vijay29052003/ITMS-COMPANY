/**
 * @typedef {import('./types.d.ts').LEDEngineConfig} LEDEngineConfig
 * @typedef {import('./types.d.ts').BinaryMatrix} BinaryMatrix
 * @typedef {import('./types.d.ts').LEDMatrixHeight} LEDMatrixHeight
 * @typedef {import('./types.d.ts').LEDMatrixWidth} LEDMatrixWidth
 */

/**
 * Canvas LED matrix simulator, dual-zone renderer and hardware byte encoder.
 */
class LEDEngine {
  /**
   * @param {string} canvasId
   */
  constructor(canvasId) {
    /** @type {HTMLCanvasElement|null} */
    this.canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById(canvasId));
    try {
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      if (this.canvas && !this.ctx) {
        if (typeof window !== 'undefined' && window.ITMSErrorHandler) {
          window.ITMSErrorHandler.handleError(window.ITMSErrorCategory.RASTER, 'HTML5 Canvas 2D context could not be acquired.', { title: 'Canvas Render Alert', resolution: 'Ensure WebGL / 2D Canvas hardware acceleration is enabled in browser.' });
        }
      }
    } catch (err) {
      if (typeof window !== 'undefined' && window.ITMSErrorHandler) {
        window.ITMSErrorHandler.handleError(window.ITMSErrorCategory.RASTER, err, { title: 'Canvas Render Exception' });
      }
      this.ctx = null;
    }

    // Configuration Defaults
    /** @type {LEDEngineConfig} */
    this.config = {
      text: "",
      fontFamily: "auto", // 'auto' for auto-script detection or specific CSS font string
      fontSize: 14, // px
      matrixHeight: 16, // Default hardware height (16, 24, 32, 48, 64)
      matrixWidth: 128, // Default matrix width (64, 96, 128, 256, 512)
      threshold: 128, // 1-bit Binarization threshold (0-255)
      pixelStyle: 'circle', // 'circle', 'square', 'glow'
      ledColor: '#ff2a2a', // Crimson Red
      ledColorGlow: 'rgba(255, 42, 42, 0.5)',
      dotRadius: 3,
      dotSpacing: 7,
      offColor: '#101726',
      offsetX: 0,
      offsetY: 0,
      bold: true,
      isInteractive: true,
      scrollMode: 'static', // 'static', 'scroll-left', 'scroll-right', 'blink'
      scrollSpeed: 28
    };

    // Subscribe to centralized state updates if available
    if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
      const stateLed = window.ITMS.State.get('led');
      if (stateLed) {
        if (stateLed.ledColor) this.config.ledColor = stateLed.ledColor;
        if (stateLed.pixelStyle) this.config.pixelStyle = stateLed.pixelStyle;
      }
      window.ITMS.State.subscribe('led', (ledState) => {
        if (ledState) {
          let dirty = false;
          if (ledState.ledColor && this.config.ledColor !== ledState.ledColor) {
            this.config.ledColor = ledState.ledColor;
            dirty = true;
          }
          if (ledState.pixelStyle && this.config.pixelStyle !== ledState.pixelStyle) {
            this.config.pixelStyle = ledState.pixelStyle;
            dirty = true;
          }
          if (dirty && typeof this.drawUIBoard === 'function') {
            this.drawUIBoard();
          }
        }
      });
    }

    // 2D Matrix State: matrix[row][col] -> 0 (OFF) or 1 (ON)
    /** @type {BinaryMatrix} */
    this.matrix = [];
    /** @type {BinaryMatrix} */
    this.fullMatrix = [];
    /** @type {number} */
    this.fullMatrixWidth = 128;
    this.initMatrix(this.config.matrixHeight, this.config.matrixWidth);

    // Dual-Zone Marquee State
    this.isDualZone = false;
    this.leftMatrix = [];
    this.leftMatrixWidth = 0;
    this.line1FullMatrix = [];
    this.line1FullWidth = 0;
    this.line2FullMatrix = [];
    this.line2FullWidth = 0;
    this.scrollOffset1 = 0;
    this.scrollOffset2 = 0;
    this.isLine1Static = false;

    // Offscreen Canvas for Deterministic 1-Bit Text Binarization
    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = 512;
    this.offCanvas.height = 128;
    this.offCtx = this.offCanvas.getContext('2d', { willReadFrequently: true });

    // Pre-rendered Inactive Background Wells Cache Canvas (Zero per-frame allocation)
    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.bgDirty = true;

    // High-performance Bounded LRU Glyphs & Clusters Cache (Memory-Leak Free)
    this.glyphCache = window.LRUCache ? new window.LRUCache(500) : new Map();

    // Animation state using requestAnimationFrame
    this.animInterval = null;
    this.animFrameId = null;
    this.lastFrameTime = 0;
    this.scrollOffset = 0;
    this.blinkState = true;
    this.lastBlinkToggle = 0;

    // Drawing / Interactive Editing State & 50-step Undo History
    this.isMouseDown = false;
    this.drawMode = 1;
    this.lastEditedCell = null;
    this.undoStack = [];
    this.redoStack = [];
    this.onUndoRedoChange = null;
    this.setupInteractivity();
  }

  initMatrix(height, width) {
    this.config.matrixHeight = height;
    this.config.matrixWidth = width;
    this.bgDirty = true;
    this.matrix = [];
    for (let r = 0; r < height; r++) {
      const row = new Array(width).fill(0);
      this.matrix.push(row);
    }
  }

  updateBgCanvas(pitchX, pitchY, rows, cols, offRadius) {
    const targetWidth = cols * pitchX + pitchX;
    const targetHeight = rows * pitchY + pitchY;
    if (this.bgCanvas.width !== targetWidth || this.bgCanvas.height !== targetHeight) {
      this.bgCanvas.width = targetWidth;
      this.bgCanvas.height = targetHeight;
    }

    this.bgCtx.fillStyle = '#05070c';
    this.bgCtx.fillRect(0, 0, targetWidth, targetHeight);

    const offColor = this.config.offColor || '#101726';
    this.bgCtx.fillStyle = offColor;

    // High-speed GPU hardware single-path batch rendering
    this.bgCtx.beginPath();
    if (offRadius <= 1.8 || pitchX <= 5) {
      const diam = Math.max(1, offRadius * 2);
      for (let r = 0; r < rows; r++) {
        const cy = (r + 1) * pitchY - offRadius;
        for (let c = 0; c < cols; c++) {
          const cx = (c + 1) * pitchX - offRadius;
          this.bgCtx.rect(cx, cy, diam, diam);
        }
      }
    } else {
      const pi2 = Math.PI * 2;
      for (let r = 0; r < rows; r++) {
        const cy = (r + 1) * pitchY;
        for (let c = 0; c < cols; c++) {
          const cx = (c + 1) * pitchX;
          this.bgCtx.moveTo(cx + offRadius, cy);
          this.bgCtx.arc(cx, cy, offRadius, 0, pi2);
        }
      }
    }
    this.bgCtx.fill();
    this.bgDirty = false;
  }

  getDynamicPitchX() {
    const cols = this.config.matrixWidth;
    const rows = this.config.matrixHeight;

    // Optimized pitch for preview & marquee displays to avoid gigantic multi-megapixel canvas sizes
    if (this.config.isInteractive === false) {
      if (cols >= 512) return 3;
      if (cols >= 256) return 5;
      if (cols >= 128) return 8;
      return 12;
    }

    if (cols <= 32) return 26;
    if (cols <= 64) return 22;
    if (cols > 256) return 5;
    if (cols > 128) {
      if (rows <= 16) return 14;
      if (rows <= 24) return 12;
      return 10;
    }

    // For 128x16 matrix: Hardware accurate pitch
    if (rows <= 16) return 16;
    if (rows <= 32) return 14;
    return 12;
  }

  getDynamicPitchY() {
    // 1:1 Square Pixel Pitch matching physical LED display matrix hardware (P10 / P7.62 / P4.75 standard)
    return this.getDynamicPitchX();
  }

  getDynamicPitch() {
    return this.getDynamicPitchX();
  }

  getVisualCenterRow(matrix) {
    let top = -1;
    let bottom = -1;
    for (let r = 0; r < matrix.length; r++) {
      if (matrix[r].some(v => v === 1)) {
        if (top === -1) top = r;
        bottom = r;
      }
    }
    if (top === -1) return Math.floor(matrix.length / 2);
    return (top + bottom) / 2;
  }

  alignMatrixToCenterRow(matrix, targetH, targetCenterRow) {
    const currentCenter = this.getVisualCenterRow(matrix);
    const shift = Math.round(targetCenterRow - currentCenter);
    if (shift === 0) return matrix;

    const width = matrix[0]?.length || 0;
    const aligned = Array.from({ length: targetH }, () => new Array(width).fill(0));
    for (let r = 0; r < matrix.length; r++) {
      const destR = r + shift;
      if (destR >= 0 && destR < targetH) {
        aligned[destR] = matrix[r].slice();
      }
    }
    return aligned;
  }

  // =========================================================================
  // UNICODE SHAPING & SCRIPT DETECTION ENGINE
  // =========================================================================

  normalizeUnicode(text) {
    return (text || '').normalize('NFC');
  }

  segmentTextToGraphemes(text) {
    const norm = this.normalizeUnicode(text);
    const hasIndic = /[\u0900-\u0DFF]/.test(norm);

    if (hasIndic) {
      // For Indic scripts (Telugu, Hindi, Kannada, Tamil, etc.), segment by words & whitespace
      // so native HarfBuzz OpenType engine correctly renders complex conjunct ligatures and subjoined vathulu.
      const tokens = norm.split(/(\s+|[^\u0900-\u0DFFa-zA-Z0-9]+)/);
      const clusters = [];
      tokens.forEach(tok => {
        if (!tok) return;
        if (/[\u0900-\u0DFF]/.test(tok)) {
          clusters.push(tok);
        } else {
          if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            clusters.push(...Array.from(segmenter.segment(tok), s => s.segment));
          } else {
            clusters.push(...Array.from(tok));
          }
        }
      });
      return clusters;
    }

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(norm), s => s.segment);
    }

    const graphemeRegex = /\p{RI}\p{RI}|\p{Emoji}(\u200D\p{Emoji})*|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u1000-\u109F\uA800-\uA82F\u11000-\u1107F](\u200C|\u200D|[\u0900-\u0D7F\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0610-\u061A\u064B-\u065F])*|./gu;
    const matches = norm.match(graphemeRegex);
    return matches ? matches : Array.from(norm);
  }

  detectScriptFont(cluster, fontOverride) {
    if (fontOverride && fontOverride !== 'auto') {
      return fontOverride;
    }

    const code = cluster.codePointAt(0) || 0;

    if (code >= 0x0C00 && code <= 0x0C7F) return "'Nirmala UI', 'Noto Sans Telugu', 'Gautami', 'Suranna', sans-serif";
    if (code >= 0x0900 && code <= 0x097F) return "'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', 'Aparajita', sans-serif";
    if (code >= 0x0B80 && code <= 0x0BFF) return "'Noto Sans Tamil', sans-serif";
    if (code >= 0x0C80 && code <= 0x0CFF) return "'Noto Sans Kannada', sans-serif";
    if (code >= 0x0D00 && code <= 0x0DFF) return "'Noto Sans Malayalam', sans-serif";
    if (code >= 0x0980 && code <= 0x09FF) return "'Noto Sans Bengali', sans-serif";
    if (code >= 0x0A80 && code <= 0x0AFF) return "'Noto Sans Gujarati', sans-serif";
    if (code >= 0x0A00 && code <= 0x0A7F) return "'Noto Sans Gurmukhi', sans-serif";
    if (code >= 0x0B00 && code <= 0x0B7F) return "'Noto Sans Oriya', sans-serif";
    if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0x08A0 && code <= 0x08FF)) {
      return "'Noto Nastaliq Urdu', serif";
    }

    return "'Inter', sans-serif";
  }

  // =========================================================================
  // HARDWARE ACCURATE 1-BIT GLYPH RASTERIZER & PIXEL OPTIMIZER
  // =========================================================================

  optimizeClusterMatrix(matrix, targetH, threshold, cluster = '') {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;

    const copy = matrix.map(r => r.slice());

    const isIndic = /[\u0900-\u0DFF]/.test(cluster);
    const isSmallPunctuation = /^[ij\.\:\!\?\'\"\`\,\;\bullet\★\-\–\—]$/i.test(cluster);

    // 1. Noise Filter: Remove isolated 1x1 orphan ON pixels and floating diagonal spurs (protect essential dots)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (copy[r][c] === 1) {
          let neighbors = 0;
          let orthogonalNeighbors = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && copy[nr][nc] === 1) {
                neighbors++;
                if (dr === 0 || dc === 0) orthogonalNeighbors++;
              }
            }
          }
          if (neighbors === 0) {
            // Protect explicit single dots for punctuation characters (e.g. '.', ':', '!', '?')
            const isProtectedPunct = isSmallPunctuation && (
              cluster === '.' || cluster === ':' || cluster === 'i' || cluster === 'j' || cluster === '!' || cluster === '?'
            );
            // Protect Anusvara/Nukta dots in Indic script if in top or bottom 25% bands
            const isIndicDiacriticBand = isIndic && (r <= Math.max(3, Math.floor(rows * 0.25)) || r >= Math.floor(rows * 0.75));
            if (!isProtectedPunct && !isIndicDiacriticBand) {
              copy[r][c] = 0;
            }
          } else if (neighbors === 1 && orthogonalNeighbors === 0 && !isSmallPunctuation && rows >= 16) {
            // Remove single-pixel floating diagonal spurs that cause noisy jagged edges
            copy[r][c] = 0;
          }
        }
      }
    }

    // 2. Pin-Hole Repair (fill isolated 1x1 zeros surrounded on all 4 sides by 1s)
    if (targetH >= 16) {
      const src = copy.map(r => r.slice());
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          if (src[r][c] === 0) {
            if (src[r - 1][c] === 1 && src[r + 1][c] === 1 && src[r][c - 1] === 1 && src[r][c + 1] === 1) {
              copy[r][c] = 1;
            }
          }
        }
      }
    }

    // 3. Pixel-Perfect Dot, Gap & Stem Reconstruction for 'i' and 'j'
    if (cluster === 'i') {
      let firstCol = -1, lastCol = -1;
      for (let c = 0; c < cols; c++) {
        if (copy.some(row => row[c] === 1)) {
          if (firstCol === -1) firstCol = c;
          lastCol = c;
        }
      }
      if (firstCol !== -1) {
        let bottomRow = 0;
        for (let r = rows - 1; r >= 0; r--) {
          if (copy[r].some(v => v === 1)) { bottomRow = r; break; }
        }

        const stemTop = targetH <= 8 ? 2 : (targetH <= 16 ? 5 : (targetH <= 24 ? 8 : (targetH <= 32 ? 11 : Math.round(targetH * 0.35))));
        const gapSize = targetH <= 16 ? 1 : (targetH <= 24 ? 1 : (targetH <= 32 ? 2 : (targetH <= 48 ? 3 : 4)));
        const dotBottom = stemTop - gapSize - 1;
        const dotH = targetH <= 16 ? 2 : (targetH <= 24 ? 2 : (targetH <= 32 ? 3 : (targetH <= 48 ? 4 : 5)));
        const dotTop = Math.max(0, dotBottom - dotH + 1);

        let stemCols = [];
        for (let c = firstCol; c <= lastCol; c++) {
          let count = 0;
          for (let r = stemTop; r <= bottomRow; r++) {
            if (copy[r][c] === 1) count++;
          }
          if (count >= (bottomRow - stemTop + 1) * 0.3) {
            stemCols.push(c);
          }
        }
        if (stemCols.length === 0) {
          stemCols = [firstCol];
          if (lastCol > firstCol) stemCols.push(lastCol);
        }

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            copy[r][c] = 0;
          }
        }

        for (let r = dotTop; r <= dotBottom; r++) {
          for (const c of stemCols) copy[r][c] = 1;
        }
        for (let r = stemTop; r <= bottomRow; r++) {
          for (const c of stemCols) copy[r][c] = 1;
        }
      }
    } else if (cluster === 'j') {
      let firstCol = -1, lastCol = -1;
      for (let c = 0; c < cols; c++) {
        if (copy.some(row => row[c] === 1)) {
          if (firstCol === -1) firstCol = c;
          lastCol = c;
        }
      }
      if (firstCol !== -1) {
        const stemTop = targetH <= 8 ? 2 : (targetH <= 16 ? 5 : (targetH <= 24 ? 8 : (targetH <= 32 ? 11 : Math.round(targetH * 0.35))));
        const gapSize = targetH <= 16 ? 1 : (targetH <= 24 ? 1 : (targetH <= 32 ? 2 : (targetH <= 48 ? 3 : 4)));
        const dotBottom = stemTop - gapSize - 1;
        const dotH = targetH <= 16 ? 2 : (targetH <= 24 ? 2 : (targetH <= 32 ? 3 : (targetH <= 48 ? 4 : 5)));
        const dotTop = Math.max(0, dotBottom - dotH + 1);

        // Clear gap rows
        for (let r = dotBottom + 1; r < stemTop; r++) {
          for (let c = 0; c < cols; c++) {
            copy[r][c] = 0;
          }
        }
      }
    }

    // 4. Specialized Loop & Aperture Preservation for Indic (Telugu / Kannada / Hindi)
    const isTelugu = /[\u0C00-\u0C7F]/.test(cluster);
    if (isTelugu && targetH <= 32) {
      for (let r = 1; r < rows - 2; r++) {
        for (let c = 1; c < cols - 2; c++) {
          if (copy[r][c] === 1 && copy[r + 1][c] === 1 && copy[r][c + 1] === 1 && copy[r + 1][c + 1] === 1) {
            let topHasStroke = (copy[r - 1] && (copy[r - 1][c] === 1 || copy[r - 1][c + 1] === 1));
            let botHasStroke = (copy[r + 2] && (copy[r + 2][c] === 1 || copy[r + 2][c + 1] === 1));
            let leftHasStroke = (copy[r][c - 1] === 1 || copy[r + 1][c - 1] === 1);
            let rightHasStroke = (copy[r][c + 2] === 1 || copy[r + 1][c + 2] === 1);

            if (topHasStroke && botHasStroke && leftHasStroke && rightHasStroke) {
              copy[r + 1][c + 1] = 0;
            }
          }
        }
      }
    }

    // 5. Hairline Stem Reinforcement for narrow letters (l, I, 1) only if 1-pixel hairline
    if (targetH >= 20 && /^[lI1]$/.test(cluster)) {
      let maxRowWidth = 0;
      for (let r = 0; r < rows; r++) {
        let rowLit = 0;
        for (let c = 0; c < cols; c++) {
          if (copy[r][c] === 1) rowLit++;
        }
        if (rowLit > maxRowWidth) maxRowWidth = rowLit;
      }
      if (maxRowWidth === 1) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols - 1; c++) {
            if (copy[r][c] === 1) {
              copy[r][c + 1] = 1;
              break;
            }
          }
        }
      }
    }

    return copy;
  }

  // Pure 1:1 Hardware-Accurate 16-Dot Proportional LED Matrix Font (A-Z, a-z, 0-9, Symbols)
  getCleanHardwareMatrix16(char) {
    if (!char || char.length > 1) return null;
    const key = char;

    const font16 = {
      // Uppercase A-Z (Harmonious 1-dot geometry, exactly 11 dots high: Rows 2..12, baseline Row 12)
      'A': { w: 7, startR: 2, p: ["0001000", "0010100", "0100010", "0100010", "1000001", "1111111", "1000001", "1000001", "1000001", "1000001", "1000001"] },
      'B': { w: 7, startR: 2, p: ["1111110", "1000001", "1000001", "1000001", "1111110", "1111110", "1000001", "1000001", "1000001", "1000001", "1111110"] },
      'C': { w: 7, startR: 2, p: ["0111110", "1000001", "1000000", "1000000", "1000000", "1000000", "1000000", "1000000", "1000000", "1000001", "0111110"] },
      'D': { w: 7, startR: 2, p: ["1111100", "1000010", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000010", "1111100"] },
      'E': { w: 6, startR: 2, p: ["111111", "100000", "100000", "100000", "100000", "111110", "100000", "100000", "100000", "100000", "111111"] },
      'F': { w: 6, startR: 2, p: ["111111", "100000", "100000", "100000", "100000", "111110", "100000", "100000", "100000", "100000", "100000"] },
      'G': { w: 7, startR: 2, p: ["0111110", "1000001", "1000000", "1000000", "1000000", "1001111", "1000001", "1000001", "1000001", "1000001", "0111110"] },
      'H': { w: 7, startR: 2, p: ["1000001", "1000001", "1000001", "1000001", "1000001", "1111111", "1000001", "1000001", "1000001", "1000001", "1000001"] },
      'I': { w: 5, startR: 2, p: ["11111", "00100", "00100", "00100", "00100", "00100", "00100", "00100", "00100", "00100", "11111"] },
      'J': { w: 6, startR: 2, p: ["000011", "000001", "000001", "000001", "000001", "000001", "000001", "100001", "100001", "100001", "011110"] },
      'K': { w: 7, startR: 2, p: ["1000011", "1000110", "1001100", "1011000", "1110000", "1110000", "1011000", "1001100", "1000110", "1000011", "1000011"] },
      'L': { w: 6, startR: 2, p: ["100000", "100000", "100000", "100000", "100000", "100000", "100000", "100000", "100000", "100000", "111111"] },
      'M': { w: 8, startR: 2, p: ["10000001", "11000011", "10100101", "10011001", "10000001", "10000001", "10000001", "10000001", "10000001", "10000001", "10000001"] },
      'N': { w: 7, startR: 2, p: ["1000001", "1100001", "1010001", "1001001", "1000101", "1000011", "1000001", "1000001", "1000001", "1000001", "1000001"] },
      'O': { w: 7, startR: 2, p: ["0111110", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "0111110"] },
      'P': { w: 7, startR: 2, p: ["1111110", "1000001", "1000001", "1000001", "1000001", "1111110", "1000000", "1000000", "1000000", "1000000", "1000000"] },
      'Q': { w: 7, startR: 2, p: ["0111110", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1001001", "0111110", "0000011"] },
      'R': { w: 7, startR: 2, p: ["1111110", "1000001", "1000001", "1000001", "1111110", "1011000", "1001100", "1000110", "1000011", "1000011", "1000011"] },
      'S': { w: 7, startR: 2, p: ["0111110", "1000001", "1000000", "1000000", "0111110", "0000001", "0000001", "0000001", "0000001", "1000001", "0111110"] },
      'T': { w: 7, startR: 2, p: ["1111111", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000"] },
      'U': { w: 7, startR: 2, p: ["1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "1000001", "0111110"] },
      'V': { w: 7, startR: 2, p: ["1000001", "1000001", "1000001", "0100010", "0100010", "0100010", "0010100", "0010100", "0010100", "0001000", "0001000", "0001000"] },
      'W': { w: 9, startR: 2, p: ["100000001", "100000001", "100000001", "100000001", "100000001", "100010001", "100101001", "101000101", "110000011", "100000001", "100000001", "100000001"] },
      'X': { w: 7, startR: 2, p: ["1000001", "1000001", "0100010", "0010100", "0001000", "0001000", "0010100", "0100010", "1000001", "1000001", "1000001", "1000001"] },
      'Y': { w: 7, startR: 2, p: ["1000001", "1000001", "0100010", "0100010", "0010100", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000", "0001000"] },
      'Z': { w: 7, startR: 2, p: ["1111111", "1111111", "0000010", "0000100", "0001000", "0010000", "0100000", "1000000", "1100000", "1110000", "1111111", "1111111"] },

      // Lowercase a-z (x-height on rows 6..13, ascenders rows 2..13, descenders rows 6..15)
      'a': { w: 6, startR: 6, p: ["011110", "000001", "000001", "011111", "100001", "100001", "100001", "011101"] },
      'b': { w: 6, startR: 2, p: ["100000", "100000", "100000", "100000", "111110", "100001", "100001", "100001", "100001", "100001", "100001", "111110"] },
      'c': { w: 6, startR: 6, p: ["011110", "100001", "100000", "100000", "100000", "100000", "100001", "011110"] },
      'd': { w: 6, startR: 2, p: ["000001", "000001", "000001", "000001", "011111", "100001", "100001", "100001", "100001", "100001", "100001", "011111"] },
      'e': { w: 6, startR: 6, p: ["011110", "100001", "100001", "111111", "100000", "100000", "100001", "011110"] },
      'f': { w: 5, startR: 2, p: ["00111", "01000", "01000", "11110", "01000", "01000", "01000", "01000", "01000", "01000", "01000", "01000"] },
      'g': { w: 6, startR: 6, p: ["011111", "100001", "100001", "100001", "011111", "000001", "000001", "000001", "100001", "011110"] },
      'h': { w: 6, startR: 2, p: ["100000", "100000", "100000", "100000", "111110", "100001", "100001", "100001", "100001", "100001", "100001", "100001"] },
      'i': { w: 3, startR: 2, p: ["010", "010", "000", "000", "010", "010", "010", "010", "010", "010", "010", "111"] },
      'j': { w: 4, startR: 2, p: ["0010", "0010", "0000", "0000", "0010", "0010", "0010", "0010", "0010", "0010", "0010", "1010", "0110"] },
      'k': { w: 6, startR: 2, p: ["100000", "100000", "100000", "100000", "100011", "100110", "111100", "101100", "100110", "100011", "100011", "100011"] },
      'l': { w: 3, startR: 2, p: ["010", "010", "010", "010", "010", "010", "010", "010", "010", "010", "010", "111"] },
      'm': { w: 8, startR: 6, p: ["11011000", "10100101", "10100101", "10100101", "10100101", "10100101", "10100101", "10100101"] },
      'n': { w: 6, startR: 6, p: ["111110", "100001", "100001", "100001", "100001", "100001", "100001", "100001"] },
      'o': { w: 6, startR: 6, p: ["011110", "100001", "100001", "100001", "100001", "100001", "100001", "011110"] },
      'p': { w: 6, startR: 6, p: ["111110", "100001", "100001", "100001", "111110", "100000", "100000", "100000", "100000", "100000", "100000"] },
      'q': { w: 6, startR: 6, p: ["011111", "100001", "100001", "100001", "011111", "000001", "000001", "000001", "000001", "000001", "000001"] },
      'r': { w: 5, startR: 6, p: ["11011", "10100", "10000", "10000", "10000", "10000", "10000", "10000"] },
      's': { w: 5, startR: 6, p: ["01111", "10000", "10000", "01110", "00001", "00001", "10001", "01110"] },
      't': { w: 5, startR: 3, p: ["01000", "01000", "11110", "01000", "01000", "01000", "01000", "01000", "01000", "01001", "00110"] },
      'u': { w: 6, startR: 6, p: ["100001", "100001", "100001", "100001", "100001", "100001", "100011", "011101"] },
      'v': { w: 5, startR: 6, p: ["10001", "10001", "01010", "01010", "01010", "00100", "00100", "00100"] },
      'w': { w: 8, startR: 6, p: ["10000001", "10000001", "10000001", "10010001", "10010001", "10101010", "11000110", "10000001"] },
      'x': { w: 6, startR: 6, p: ["100001", "100001", "010010", "001100", "001100", "010010", "100001", "100001"] },
      'y': { w: 6, startR: 6, p: ["100001", "100001", "100001", "010010", "001100", "001000", "010000", "100000", "100000", "011110"] },
      'z': { w: 6, startR: 6, p: ["111111", "000010", "000100", "001000", "010000", "100000", "100000", "111111"] },

      // Digits 0-9 (Rows 2..12)
      '0': { w: 7, startR: 2, p: ["0111110", "1000001", "1000011", "1000101", "1001001", "1010001", "1100001", "1000001", "1000001", "1000001", "0111110"] },
      '1': { w: 5, startR: 2, p: ["00100", "01100", "10100", "00100", "00100", "00100", "00100", "00100", "00100", "00100", "11111"] },
      '2': { w: 7, startR: 2, p: ["0111110", "1000001", "0000001", "0000010", "0000100", "0001000", "0010000", "0100000", "1000000", "1000000", "1111111"] },
      '3': { w: 7, startR: 2, p: ["0111110", "1000001", "0000001", "0000001", "0111110", "0000001", "0000001", "0000001", "0000001", "1000001", "0111110"] },
      '4': { w: 7, startR: 2, p: ["0000100", "0001100", "0010100", "0100100", "1000100", "1111111", "0000100", "0000100", "0000100", "0000100", "0000100"] },
      '5': { w: 7, startR: 2, p: ["1111111", "1000000", "1000000", "1000000", "1111110", "0000001", "0000001", "0000001", "0000001", "1000001", "0111110"] },
      '6': { w: 7, startR: 2, p: ["0111110", "1000001", "1000000", "1000000", "1111110", "1000001", "1000001", "1000001", "1000001", "1000001", "0111110"] },
      '7': { w: 7, startR: 2, p: ["1111111", "0000001", "0000010", "0000100", "0001000", "0010000", "0010000", "0010000", "0010000", "0010000", "0010000"] },
      '8': { w: 7, startR: 2, p: ["0111110", "1000001", "1000001", "1000001", "0111110", "1000001", "1000001", "1000001", "1000001", "1000001", "0111110"] },
      '9': { w: 7, startR: 2, p: ["0111110", "1000001", "1000001", "1000001", "1000001", "0111111", "0000001", "0000001", "0000001", "1000001", "0111110"] },

      // Symbols & Punctuation
      '-': { w: 5, startR: 7, p: ["11111", "11111"] },
      ':': { w: 2, startR: 4, p: ["11", "11", "00", "00", "00", "11", "11"] },
      '.': { w: 2, startR: 11, p: ["11", "11"] },
      ',': { w: 2, startR: 11, p: ["11", "11", "01", "10"] },
      '/': { w: 5, startR: 2, p: ["00001", "00010", "00010", "00100", "00100", "00100", "01000", "01000", "10000", "10000", "10000"] },
      '+': { w: 5, startR: 5, p: ["00100", "00100", "11111", "00100", "00100"] },
      '=': { w: 5, startR: 5, p: ["11111", "00000", "00000", "11111"] },
      '•': { w: 4, startR: 6, p: ["0110", "1111", "1111", "0110"] },
      '★': { w: 7, startR: 4, p: ["0001000", "0011100", "1111111", "0111110", "0011100", "0100010"] },
      "'": { w: 2, startR: 2, p: ["11", "11", "01"] },
      '"': { w: 4, startR: 2, p: ["1101", "1101", "0100"] }
    };

    const entry = font16[key];
    if (!entry) return null;

    const matrix = Array.from({ length: 16 }, () => new Array(entry.w).fill(0));
    for (let r = 0; r < entry.p.length; r++) {
      const destR = entry.startR + r;
      if (destR >= 0 && destR < 16) {
        for (let c = 0; c < entry.w; c++) {
          if (entry.p[r][c] === '1') {
            matrix[destR][c] = 1;
          }
        }
      }
    }

    return { matrix, width: entry.w + 1 };
  }

  // Pure 1:1 Hardware-Accurate 16-Dot Bold Industrial LED Matrix Font (Heavy 2-dot thick solid strokes)
  getCleanHardwareMatrix16Bold(char) {
    if (!char || char.length > 1) return null;
    const key = char;

    const font16Bold = {
      // Uppercase A-Z (12 dots high: Rows 2..13, 2-dot thick solid strokes)
      'A': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000011", "11000011", "11111111", "11111111", "11000011", "11000011", "11000011", "11000011", "11000011"] },
      'B': { w: 8, startR: 2, p: ["11111100", "11111110", "11000011", "11000011", "11111110", "11111110", "11000011", "11000011", "11000011", "11000011", "11111110", "11111100"] },
      'C': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000000", "11000000", "11000000", "11000000", "11000000", "11000000", "11000011", "01111110", "00111100"] },
      'D': { w: 7, startR: 2, p: ["1111100", "1111110", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1111110", "1111100"] },
      'E': { w: 7, startR: 2, p: ["1111111", "1111111", "1100000", "1100000", "1100000", "1111110", "1111110", "1100000", "1100000", "1100000", "1111111", "1111111"] },
      'F': { w: 7, startR: 2, p: ["1111111", "1111111", "1100000", "1100000", "1100000", "1111110", "1111110", "1100000", "1100000", "1100000", "1100000", "1100000"] },
      'G': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000000", "11000000", "11001111", "11001111", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      'H': { w: 8, startR: 2, p: ["11000011", "11000011", "11000011", "11000011", "11000011", "11111111", "11111111", "11000011", "11000011", "11000011", "11000011", "11000011"] },
      'I': { w: 6, startR: 2, p: ["111111", "111111", "001100", "001100", "001100", "001100", "001100", "001100", "001100", "001100", "111111", "111111"] },
      'J': { w: 7, startR: 2, p: ["0000111", "0000111", "0000011", "0000011", "0000011", "0000011", "0000011", "1100011", "1100011", "1100011", "0111110", "0011100"] },
      'K': { w: 8, startR: 2, p: ["11000011", "11000110", "11001100", "11011000", "11110000", "11110000", "11011000", "11001100", "11000110", "11000011", "11000011", "11000011"] },
      'L': { w: 7, startR: 2, p: ["1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1111111", "1111111"] },
      'M': { w: 9, startR: 2, p: ["110000011", "111000111", "111101111", "110111011", "110010011", "110000011", "110000011", "110000011", "110000011", "110000011", "110000011", "110000011"] },
      'N': { w: 8, startR: 2, p: ["11000011", "11100011", "11110011", "11011011", "11001111", "11000111", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011"] },
      'O': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      'P': { w: 7, startR: 2, p: ["1111110", "1111111", "1100011", "1100011", "1100011", "1111111", "1111110", "1100000", "1100000", "1100000", "1100000", "1100000"] },
      'Q': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11001011", "01111110", "00111111", "00000011"] },
      'R': { w: 8, startR: 2, p: ["11111100", "11111110", "11000011", "11000011", "11111110", "11111100", "11011000", "11001100", "11000110", "11000011", "11000011", "11000011"] },
      'S': { w: 7, startR: 2, p: ["0111110", "1111111", "1100011", "1100000", "1100000", "1111110", "0111111", "0000011", "0000011", "1100011", "1111111", "0111110"] },
      'T': { w: 8, startR: 2, p: ["11111111", "11111111", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000"] },
      'U': { w: 8, startR: 2, p: ["11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      'V': { w: 12, startR: 2, p: ["110000000011", "110000000011", "011000000110", "011000000110", "001100001100", "001100001100", "000110011000", "000110011000", "000011110000", "000011110000", "000001100000", "000001100000"] },
      'W': { w: 10, startR: 2, p: ["1100000011", "1100000011", "1100000011", "1100000011", "1100110011", "1101111011", "1111001111", "1110000111", "1100000011", "1100000011", "1100000011", "1100000011"] },
      'X': { w: 8, startR: 2, p: ["11000011", "11000011", "01100110", "00111100", "00011000", "00011000", "00111100", "01100110", "11000011", "11000011", "11000011", "11000011"] },
      'Y': { w: 8, startR: 2, p: ["11000011", "11000011", "01100110", "01100110", "00111100", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000"] },
      'Z': { w: 10, startR: 2, p: ["1111111111", "1111111111", "0000000110", "0000001100", "0000011000", "0000110000", "0001100000", "0011000000", "0110000000", "1100000000", "1111111111", "1111111111"] },

      // Lowercase a-z (Clean, Simple, Proportional & Highly Legible)
      'a': { w: 6, startR: 6, p: ["011110", "110011", "000011", "011111", "110011", "110011", "110011", "011111"] },
      'b': { w: 6, startR: 2, p: ["110000", "110000", "110000", "110000", "111110", "110011", "110011", "110011", "110011", "110011", "110011", "111110"] },
      'c': { w: 6, startR: 6, p: ["011110", "110011", "110000", "110000", "110000", "110000", "110011", "011110"] },
      'd': { w: 6, startR: 2, p: ["000011", "000011", "000011", "000011", "011111", "110011", "110011", "110011", "110011", "110011", "110011", "011111"] },
      'e': { w: 6, startR: 6, p: ["011110", "110011", "110011", "111111", "110000", "110000", "110011", "011110"] },
      'f': { w: 5, startR: 2, p: ["00111", "01100", "01100", "11111", "11111", "01100", "01100", "01100", "01100", "01100", "01100", "01100"] },
      'g': { w: 6, startR: 6, p: ["011111", "110011", "110011", "110011", "011111", "000011", "000011", "110011", "011110"] },
      'h': { w: 6, startR: 2, p: ["110000", "110000", "110000", "110000", "111110", "110011", "110011", "110011", "110011", "110011", "110011", "110011"] },
      'i': { w: 2, startR: 2, p: ["11", "11", "00", "00", "11", "11", "11", "11", "11", "11", "11", "11"] },
      'j': { w: 3, startR: 2, p: ["011", "011", "000", "000", "011", "011", "011", "011", "011", "011", "011", "011", "111", "110"] },
      'k': { w: 6, startR: 2, p: ["110000", "110000", "110000", "110000", "110011", "110110", "111100", "111100", "110110", "110011", "110011", "110011"] },
      'l': { w: 2, startR: 2, p: ["11", "11", "11", "11", "11", "11", "11", "11", "11", "11", "11", "11"] },
      'm': { w: 8, startR: 6, p: ["11111110", "11011011", "11011011", "11011011", "11011011", "11011011", "11011011", "11011011"] },
      'n': { w: 6, startR: 6, p: ["111110", "110011", "110011", "110011", "110011", "110011", "110011", "110011"] },
      'o': { w: 6, startR: 6, p: ["011110", "110011", "110011", "110011", "110011", "110011", "110011", "011110"] },
      'p': { w: 6, startR: 6, p: ["111110", "110011", "110011", "110011", "110011", "111110", "110000", "110000", "110000", "110000"] },
      'q': { w: 6, startR: 6, p: ["011111", "110011", "110011", "110011", "110011", "011111", "000011", "000011", "000011", "000011"] },
      'r': { w: 5, startR: 6, p: ["11111", "11011", "11000", "11000", "11000", "11000", "11000", "11000"] },
      's': { w: 5, startR: 6, p: ["01111", "11000", "11000", "01110", "00011", "00011", "11011", "01110"] },
      't': { w: 5, startR: 3, p: ["01100", "01100", "11111", "11111", "01100", "01100", "01100", "01100", "01100", "01111", "00111"] },
      'u': { w: 6, startR: 6, p: ["110011", "110011", "110011", "110011", "110011", "110011", "110011", "011111"] },
      'v': { w: 8, startR: 6, p: ["11000011", "11000011", "01100110", "01100110", "00111100", "00111100", "00011000", "00011000"] },
      'w': { w: 8, startR: 6, p: ["11000011", "11000011", "11000011", "11011011", "11011011", "11111111", "01100110", "01100110"] },
      'x': { w: 6, startR: 6, p: ["110011", "110011", "011110", "001100", "001100", "011110", "110011", "110011"] },
      'y': { w: 6, startR: 6, p: ["110011", "110011", "110011", "011011", "011110", "001100", "001100", "001100", "011000", "110000"] },
      'z': { w: 6, startR: 6, p: ["111111", "111111", "000110", "001100", "011000", "110000", "111111", "111111"] },

      // Digits 0-9
      '0': { w: 8, startR: 2, p: ["00111100", "01111110", "11000111", "11001111", "11011011", "11110011", "11100011", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      '1': { w: 6, startR: 2, p: ["001100", "011100", "111100", "001100", "001100", "001100", "001100", "001100", "001100", "001100", "111111", "111111"] },
      '2': { w: 8, startR: 2, p: ["01111100", "11111110", "11000011", "00000011", "00000110", "00001100", "00011000", "00110000", "01100000", "11000000", "11111111", "11111111"] },
      '3': { w: 8, startR: 2, p: ["01111100", "11111110", "11000011", "00000011", "01111110", "01111110", "00000011", "00000011", "11000011", "11000011", "11111110", "01111100"] },
      '4': { w: 8, startR: 2, p: ["00001100", "00011100", "00111100", "01101100", "11001100", "11001100", "11111111", "11111111", "00001100", "00001100", "00001100", "00001100"] },
      '5': { w: 8, startR: 2, p: ["11111111", "11111111", "11000000", "11000000", "11111100", "11111110", "00000011", "00000011", "11000011", "11000011", "11111110", "01111100"] },
      '6': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000000", "11111110", "11111111", "11000011", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      '7': { w: 8, startR: 2, p: ["11111111", "11111111", "00000011", "00000110", "00001100", "00011000", "00110000", "00110000", "00110000", "00110000", "00110000", "00110000"] },
      '8': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000011", "01111110", "01111110", "11000011", "11000011", "11000011", "11000011", "01111110", "00111100"] },
      '9': { w: 8, startR: 2, p: ["00111100", "01111110", "11000011", "11000011", "11000011", "11000011", "01111111", "00111111", "00000011", "11000011", "01111110", "00111100"] },

      // Symbols
      '-': { w: 6, startR: 7, p: ["111111", "111111"] },
      ':': { w: 3, startR: 4, p: ["110", "110", "000", "000", "000", "110", "110"] },
      '.': { w: 3, startR: 11, p: ["110", "110"] },
      ',': { w: 3, startR: 11, p: ["110", "110", "010", "100"] },
      '/': { w: 6, startR: 2, p: ["000011", "000110", "000110", "001100", "001100", "001100", "011000", "011000", "110000", "110000", "110000", "110000"] },
      '+': { w: 7, startR: 5, p: ["0011000", "0011000", "1111111", "1111111", "0011000", "0011000"] }
    };

    const entry = font16Bold[key];
    if (!entry) return null;

    const matrix = Array.from({ length: 16 }, () => new Array(entry.w).fill(0));
    for (let r = 0; r < entry.p.length; r++) {
      const destR = entry.startR + r;
      if (destR >= 0 && destR < 16) {
        for (let c = 0; c < entry.w; c++) {
          if (entry.p[r][c] === '1') {
            matrix[destR][c] = 1;
          }
        }
      }
    }

    return { matrix, width: entry.w + 1 };
  }

  // Pure 1:1 Hardware-Accurate 8-Dot Matrix Font for 2-Lined 16px Displays
  getCleanHardwareMatrix8(char) {
    if (!char || char.length > 1) return null;
    const font8 = {
      'A': { w: 5, startR: 1, p: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"] },
      'B': { w: 5, startR: 1, p: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"] },
      'C': { w: 5, startR: 1, p: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"] },
      'D': { w: 5, startR: 1, p: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"] },
      'E': { w: 5, startR: 1, p: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"] },
      'F': { w: 5, startR: 1, p: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"] },
      'G': { w: 5, startR: 1, p: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"] },
      'H': { w: 5, startR: 1, p: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"] },
      'I': { w: 3, startR: 1, p: ["111", "010", "010", "010", "010", "010", "111"] },
      'J': { w: 4, startR: 1, p: ["0001", "0001", "0001", "0001", "1001", "1001", "0110"] },
      'K': { w: 5, startR: 1, p: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"] },
      'L': { w: 4, startR: 1, p: ["1000", "1000", "1000", "1000", "1000", "1000", "1111"] },
      'M': { w: 5, startR: 1, p: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"] },
      'N': { w: 5, startR: 1, p: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"] },
      'O': { w: 5, startR: 1, p: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"] },
      'P': { w: 5, startR: 1, p: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"] },
      'Q': { w: 5, startR: 1, p: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"] },
      'R': { w: 5, startR: 1, p: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"] },
      'S': { w: 5, startR: 1, p: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"] },
      'T': { w: 5, startR: 1, p: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"] },
      'U': { w: 5, startR: 1, p: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"] },
      'V': { w: 5, startR: 1, p: ["10001", "10001", "10001", "01010", "01010", "00100", "00100"] },
      'W': { w: 5, startR: 1, p: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"] },
      'X': { w: 5, startR: 1, p: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"] },
      'Y': { w: 5, startR: 1, p: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"] },
      'Z': { w: 5, startR: 1, p: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"] },

      // Lowercase a-z
      'a': { w: 4, startR: 3, p: ["1110", "0001", "0111", "1001", "0111"] },
      'b': { w: 4, startR: 1, p: ["1000", "1000", "1110", "1001", "1001", "1001", "1110"] },
      'c': { w: 4, startR: 3, p: ["0111", "1000", "1000", "1000", "0111"] },
      'd': { w: 4, startR: 1, p: ["0001", "0001", "0111", "1001", "1001", "1001", "0111"] },
      'e': { w: 4, startR: 3, p: ["0110", "1001", "1111", "1000", "0111"] },
      'h': { w: 4, startR: 1, p: ["1000", "1000", "1110", "1001", "1001", "1001", "1001"] },
      'i': { w: 1, startR: 1, p: ["1", "0", "1", "1", "1", "1", "1"] },
      'l': { w: 1, startR: 1, p: ["1", "1", "1", "1", "1", "1", "1"] },
      'm': { w: 5, startR: 3, p: ["11010", "10101", "10101", "10101", "10101"] },
      'n': { w: 4, startR: 3, p: ["1110", "1001", "1001", "1001", "1001"] },
      'o': { w: 4, startR: 3, p: ["0110", "1001", "1001", "1001", "0110"] },
      'p': { w: 4, startR: 3, p: ["1110", "1001", "1001", "1110", "1000", "1000", "1000"] },
      'r': { w: 3, startR: 3, p: ["101", "110", "100", "100", "100"] },
      's': { w: 4, startR: 3, p: ["0111", "1000", "0110", "0001", "1110"] },
      't': { w: 3, startR: 2, p: ["010", "111", "010", "010", "011"] },
      'u': { w: 4, startR: 3, p: ["1001", "1001", "1001", "1001", "0111"] },

      // Digits 0-9
      '0': { w: 5, startR: 1, p: ["01110", "10011", "10101", "11001", "10001", "10001", "01110"] },
      '1': { w: 3, startR: 1, p: ["010", "110", "010", "010", "010", "010", "111"] },
      '2': { w: 5, startR: 1, p: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"] },
      '3': { w: 5, startR: 1, p: ["01110", "10001", "00001", "00110", "00001", "10001", "01110"] },
      '4': { w: 5, startR: 1, p: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"] },
      '5': { w: 5, startR: 1, p: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"] },
      '6': { w: 5, startR: 1, p: ["01110", "10001", "10000", "11110", "10001", "10001", "01110"] },
      '7': { w: 5, startR: 1, p: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"] },
      '8': { w: 5, startR: 1, p: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"] },
      '9': { w: 5, startR: 1, p: ["01110", "10001", "10001", "01111", "00001", "10001", "01110"] },

      // Symbols
      '-': { w: 4, startR: 4, p: ["1111"] },
      ':': { w: 2, startR: 2, p: ["11", "00", "00", "11"] },
      '.': { w: 2, startR: 6, p: ["11"] },
      ',': { w: 2, startR: 6, p: ["11", "01"] },
      '/': { w: 4, startR: 1, p: ["0001", "0010", "0010", "0100", "0100", "1000", "1000"] }
    };
    const entry = font8[char];
    if (!entry) return null;
    const matrix = Array.from({ length: 8 }, () => new Array(entry.w).fill(0));
    for (let r = 0; r < entry.p.length; r++) {
      const destR = entry.startR + r;
      if (destR >= 0 && destR < 8) {
        for (let c = 0; c < entry.w; c++) {
          if (entry.p[r][c] === '1') matrix[destR][c] = 1;
        }
      }
    }
    return { matrix, width: entry.w + 1 };
  }

  // Proportional 1:1 Aspect Ratio Glyph Rasterizer (Prevents Horizontal/Vertical Distortion)
  rasterizeGraphemeCluster(cluster, fontStyle, targetH, bold, threshold) {
    const cacheKey = `${cluster}_${fontStyle}_${targetH}_${bold}_${threshold}`;
    if (this.glyphCache.has(cacheKey)) {
      return this.glyphCache.get(cacheKey);
    }

    if (cluster === ' ') {
      const spaceWidth = Math.max(3, Math.floor(targetH * 0.25));
      const emptyMat = Array.from({ length: targetH }, () => new Array(spaceWidth).fill(0));
      const res = { matrix: emptyMat, width: spaceWidth };
      this.glyphCache.set(cacheKey, res);
      return res;
    }

    // Pure 1:1 Hardware-Accurate Font for standard 16-Dot & 8-Dot Latin & Digits
    const isAutoOrDefault = (!fontStyle || fontStyle === 'auto' || fontStyle.includes('Inter') || fontStyle.includes('Courier') || fontStyle.includes('sans-serif'));
    if (targetH === 16 && isAutoOrDefault && cluster.length === 1 && /^[\x20-\x7E\u2022\u2605]$/.test(cluster)) {
      const hwRes = bold ? (this.getCleanHardwareMatrix16Bold(cluster) || this.getCleanHardwareMatrix16(cluster)) : this.getCleanHardwareMatrix16(cluster);
      if (hwRes) {
        this.glyphCache.set(cacheKey, hwRes);
        return hwRes;
      }
    }
    if (targetH === 8 && isAutoOrDefault && cluster.length === 1 && /^[\x20-\x7E]$/.test(cluster)) {
      const hwRes = this.getCleanHardwareMatrix8(cluster);
      if (hwRes) {
        this.glyphCache.set(cacheKey, hwRes);
        return hwRes;
      }
    }

    const isIndic = /[\u0900-\u0DFF]/.test(cluster);

    // 2x Supersampling Scale Factor across all scripts to guarantee crisp, distinct letterforms
    const scale = (targetH <= 32) ? 2 : 1;
    const canvasH = targetH * scale;

    let fontSize;
    let weight;
    let baselineY;

    if (isIndic) {
      // Indic (Telugu / Hindi / Kannada / Tamil) Script Typography Optimization
      if (targetH <= 16) {
        fontSize = 12 * scale;
        weight = bold ? '600 ' : '500 ';
        baselineY = Math.round(11.5 * scale);
      } else if (targetH <= 24) {
        fontSize = 17 * scale;
        weight = bold ? '600 ' : '500 ';
        baselineY = Math.round(16 * scale);
      } else if (targetH <= 32) {
        fontSize = 23 * scale;
        weight = bold ? '600 ' : '500 ';
        baselineY = Math.round(22 * scale);
      } else {
        fontSize = Math.floor(canvasH * 0.72);
        weight = bold ? '600 ' : '500 ';
        baselineY = Math.floor(canvasH * 0.68);
      }
    } else {
      // Latin / English / Digits High-Legibility Proportional Typography
      if (targetH <= 8) {
        fontSize = 7 * scale;
        weight = bold ? 'bold ' : '600 ';
        baselineY = 6 * scale;
      } else if (targetH <= 16) {
        fontSize = 13 * scale;
        weight = bold ? '700 ' : '600 ';
        baselineY = 12 * scale;
      } else if (targetH <= 32) {
        fontSize = 22 * scale;
        weight = bold ? '700 ' : '600 ';
        baselineY = 23 * scale;
      } else {
        fontSize = Math.floor(targetH * 0.72);
        weight = bold ? '700 ' : '600 ';
        baselineY = Math.floor(targetH * 0.72);
      }
    }

    const fontStr = `${weight}${fontSize}px ${fontStyle}`;
    const horizStretch = isIndic ? (targetH <= 16 ? 1.18 : 1.12) : 1.0;

    // Measure width with generous padding to prevent anti-aliasing clipping
    this.offCtx.font = fontStr;
    const metrics = this.offCtx.measureText(cluster);
    const measuredW = Math.max(2 * scale, Math.ceil(metrics.width * horizStretch));
    const pad = Math.max(8 * scale, Math.floor(canvasH * 0.25));
    const renderW = measuredW + pad * 2;

    if (this.offCanvas.width < renderW || this.offCanvas.height < canvasH) {
      this.offCanvas.width = Math.max(512, renderW);
      this.offCanvas.height = Math.max(128, canvasH);
    }

    // Fill background black
    this.offCtx.fillStyle = '#000000';
    this.offCtx.fillRect(0, 0, renderW, canvasH);

    // Render white text shifted by pad to capture full glyph bounds
    this.offCtx.imageSmoothingEnabled = true;
    this.offCtx.font = fontStr;
    this.offCtx.fillStyle = '#FFFFFF';
    this.offCtx.textAlign = 'left';
    this.offCtx.textBaseline = 'alphabetic';

    this.offCtx.save();
    this.offCtx.translate(pad, baselineY);
    this.offCtx.scale(horizStretch, 1.0);
    this.offCtx.fillText(cluster, 0, 0);
    this.offCtx.restore();

    const imgData = this.offCtx.getImageData(0, 0, renderW, canvasH);
    const pixels = imgData.data;

    let matrix;

    if (scale === 2) {
      // 2x2 Subpixel Ridge & Core Density Mapping
      const targetW = Math.ceil(renderW / scale);
      matrix = Array.from({ length: targetH }, () => new Array(targetW).fill(0));

      const isTeluguOrKannada = /[\u0C00-\u0CFF]/.test(cluster);
      const userThresh = threshold || 128;
      // Precise core threshold mapping: nominal stroke threshold is 112 (out of 255)
      const activeThresh = isTeluguOrKannada
        ? Math.max(80, Math.floor(userThresh * 0.65))
        : (isIndic ? Math.max(88, Math.floor(userThresh * 0.70)) : Math.max(95, Math.floor(userThresh * 0.76)));

      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          let sumLuma = 0;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = x * scale + dx;
              const py = y * scale + dy;
              if (px < renderW && py < canvasH) {
                const idx = (py * renderW + px) * 4;
                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];
                const a = pixels[idx + 3] / 255;
                sumLuma += (0.299 * r + 0.587 * g + 0.114 * b) * a;
              }
            }
          }

          const avgLuma = sumLuma / (scale * scale);
          if (avgLuma >= activeThresh) {
            matrix[y][x] = 1;
          }
        }
      }
    } else {
      matrix = Array.from({ length: targetH }, () => new Array(renderW).fill(0));
      let binarizeThresh;
      if (isIndic) {
        binarizeThresh = targetH <= 16 ? 92 : 105;
      } else {
        binarizeThresh = targetH <= 8 ? 85 : Math.max(90, Math.min(150, threshold || 115));
      }

      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < renderW; x++) {
          const idx = (y * renderW + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          const a = pixels[idx + 3] / 255;
          const brightness = (0.299 * r + 0.587 * g + 0.114 * b) * a;

          if (brightness >= binarizeThresh) {
            matrix[y][x] = 1;
          }
        }
      }
    }

    // Top Line & Baseline Normalization for 16px Hardware Matrix (Top at Row 2, Baseline at Row 12)
    if (targetH === 16) {
      const isCapitalOrDigit = /^[A-Z0-9]$/.test(cluster);
      if (isCapitalOrDigit) {
        // Clear stray anti-aliasing noise at row 0 and row 1 for uppercase letters & digits
        for (let c = 0; c < renderW; c++) {
          matrix[0][c] = 0;
          matrix[1][c] = 0;
        }
        let topRow = -1;
        for (let r = 0; r < 16; r++) {
          if (matrix[r].some(val => val === 1)) {
            topRow = r;
            break;
          }
        }
        if (topRow !== -1) {
          const targetTop = 2;
          const shiftY = targetTop - topRow;
          if (shiftY !== 0) {
            const shifted = Array.from({ length: 16 }, () => new Array(renderW).fill(0));
            for (let r = 0; r < 16; r++) {
              const newR = r + shiftY;
              if (newR >= 0 && newR < 16) {
                shifted[newR] = matrix[r].slice();
              }
            }
            matrix = shifted;
          }
        }
      }
    }

    // Apply pixel optimization filter
    matrix = this.optimizeClusterMatrix(matrix, targetH, threshold, cluster);

    // Strictly crop glyph to active lit bounding box [firstLitCol..lastLitCol] and add proportional gap
    let firstLitCol = -1;
    let lastLitCol = -1;
    const mCols = matrix[0]?.length || renderW;
    for (let c = 0; c < mCols; c++) {
      if (matrix.some(row => row[c] === 1)) {
        if (firstLitCol === -1) firstLitCol = c;
        lastLitCol = c;
      }
    }

    let finalMatrix;
    let trimmedW;

    if (firstLitCol === -1) {
      // Blank or invisible character
      trimmedW = Math.max(2, Math.floor(targetH * 0.2));
      finalMatrix = Array.from({ length: targetH }, () => new Array(trimmedW).fill(0));
    } else {
      const glyphW = lastLitCol - firstLitCol + 1;
      const charGap = targetH <= 16 ? 1 : Math.max(2, Math.floor(targetH * 0.05));
      trimmedW = glyphW + charGap;

      finalMatrix = Array.from({ length: targetH }, () => new Array(trimmedW).fill(0));
      for (let r = 0; r < targetH; r++) {
        for (let c = 0; c < glyphW; c++) {
          finalMatrix[r][c] = matrix[r][firstLitCol + c];
        }
      }
    }

    const result = { matrix: finalMatrix, width: trimmedW };
    this.glyphCache.set(cacheKey, result);
    return result;
  }

  // =========================================================================
  // MAIN RENDERING PIPELINE: RENDER TEXT TO MATRIX
  // =========================================================================

  renderTextToMatrix(text = this.config.text, options = {}) {
    this.isDualZone = false;
    this.config.text = text;

    const h = this.config.matrixHeight;
    const baseW = this.config.matrixWidth;
    const threshold = this.config.threshold || 128;
    const fontOverride = options.fontFamily || this.config.fontFamily;
    const isBold = this.config.bold !== false;

    // Detect 2-line structure if text contains newline (\n) or double slash (//)
    const rawLines = (text || '').split(/\r?\n|\/{2}/).map(l => l.trim()).filter(l => l.length > 0);

    if (rawLines.length >= 2) {
      // =========================================================================
      // 2-LINED SYNCHRONIZED MATRIX RENDERING (TOP ZONE & BOTTOM ZONE)
      // =========================================================================
      const subH1 = Math.floor(h / 2);
      const subH2 = h - subH1;

      // Render Line 1 (Top Zone)
      const l1Graphemes = this.segmentTextToGraphemes(rawLines[0]);
      let l1Cols = 0;
      const l1Renders = [];
      for (let i = 0; i < l1Graphemes.length; i++) {
        const g = l1Graphemes[i];
        if (g === ' ') {
          const spaceW = (subH1 <= 8) ? 3 : Math.max(3, Math.floor(subH1 * 0.28));
          l1Cols += spaceW;
          l1Renders.push({ isSpace: true, width: spaceW });
        } else {
          const font = this.detectScriptFont(g, fontOverride);
          const rendered = this.rasterizeGraphemeCluster(g, font, subH1, isBold, threshold);
          const prev = l1Renders[l1Renders.length - 1];
          const isDevanagari = /[\u0900-\u097F]/.test(g);
          const gap = (prev && !prev.isSpace) ? (isDevanagari ? 0 : 1) : 0;
          l1Cols += gap + rendered.width;
          l1Renders.push({ isSpace: false, matrix: rendered.matrix, width: rendered.width, gap });
        }
      }

      // Render Line 2 (Bottom Zone)
      const l2Graphemes = this.segmentTextToGraphemes(rawLines[1]);
      let l2Cols = 0;
      const l2Renders = [];
      for (let i = 0; i < l2Graphemes.length; i++) {
        const g = l2Graphemes[i];
        if (g === ' ') {
          const spaceW = (subH2 <= 8) ? 3 : Math.max(3, Math.floor(subH2 * 0.28));
          l2Cols += spaceW;
          l2Renders.push({ isSpace: true, width: spaceW });
        } else {
          const font = this.detectScriptFont(g, fontOverride);
          const rendered = this.rasterizeGraphemeCluster(g, font, subH2, isBold, threshold);
          const prev = l2Renders[l2Renders.length - 1];
          const isDevanagari = /[\u0900-\u097F]/.test(g);
          const gap = (prev && !prev.isSpace) ? (isDevanagari ? 0 : 1) : 0;
          l2Cols += gap + rendered.width;
          l2Renders.push({ isSpace: false, matrix: rendered.matrix, width: rendered.width, gap });
        }
      }

      const maxTextCols = Math.max(l1Cols, l2Cols);
      this.fullMatrixTextWidth = maxTextCols;
      const fullWidth = Math.max(baseW, maxTextCols + 8);
      this.fullMatrixWidth = fullWidth;
      this.fullMatrix = Array.from({ length: h }, () => new Array(fullWidth).fill(0));

      // Draw Line 1 (Rows 0..subH1-1)
      let startX1 = (l1Cols < baseW) ? (Math.floor((baseW - l1Cols) / 2) + (this.config.offsetX || 0)) : (this.config.offsetX || 0);
      let currX1 = startX1;
      l1Renders.forEach(gr => {
        if (gr.gap) currX1 += gr.gap;
        if (gr.isSpace) {
          currX1 += gr.width;
        } else if (gr.matrix) {
          for (let r = 0; r < subH1; r++) {
            for (let c = 0; c < gr.width; c++) {
              const posX = currX1 + c;
              if (posX >= 0 && posX < fullWidth && gr.matrix[r] && gr.matrix[r][c] === 1) {
                this.fullMatrix[r][posX] = 1;
              }
            }
          }
          currX1 += gr.width;
        }
      });

      // Draw Line 2 (Rows subH1..h-1)
      let startX2 = (l2Cols < baseW) ? (Math.floor((baseW - l2Cols) / 2) + (this.config.offsetX || 0)) : (this.config.offsetX || 0);
      let currX2 = startX2;
      l2Renders.forEach(gr => {
        if (gr.gap) currX2 += gr.gap;
        if (gr.isSpace) {
          currX2 += gr.width;
        } else if (gr.matrix) {
          for (let r = 0; r < subH2; r++) {
            const destR = subH1 + r;
            for (let c = 0; c < gr.width; c++) {
              const posX = currX2 + c;
              if (posX >= 0 && posX < fullWidth && destR < h && gr.matrix[r] && gr.matrix[r][c] === 1) {
                this.fullMatrix[destR][posX] = 1;
              }
            }
          }
          currX2 += gr.width;
        }
      });

      this.initMatrix(h, baseW);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < baseW; x++) {
          if (x < fullWidth && this.fullMatrix[y]) {
            this.matrix[y][x] = this.fullMatrix[y][x] || 0;
          }
        }
      }

      this.drawUIBoard();
      return;
    }

    // =========================================================================
    // SINGLE LINE MATRIX RENDERING
    // =========================================================================
    let textCols = 0;
    const graphemes = this.segmentTextToGraphemes(text);
    const graphemeRenders = [];
    for (let i = 0; i < graphemes.length; i++) {
      const g = graphemes[i];
      if (g === ' ') {
        const spaceW = (h <= 16) ? 5 : Math.max(4, Math.floor(h * 0.28));
        textCols += spaceW;
        graphemeRenders.push({ isSpace: true, width: spaceW });
      } else {
        const font = this.detectScriptFont(g, fontOverride);
        const rendered = this.rasterizeGraphemeCluster(g, font, h, isBold, threshold);
        const prev = graphemeRenders[graphemeRenders.length - 1];
        const isTeluguOrKannada = /[\u0C00-\u0CFF]/.test(g);
        const isDevanagari = /[\u0900-\u097F]/.test(g);
        // Clean 1-dot spacing for Latin & Telugu, 0-dot for connected Devanagari shirorekha
        const gap = (prev && !prev.isSpace) ? (isDevanagari ? 0 : 1) : 0;
        textCols += gap + rendered.width;
        graphemeRenders.push({ isSpace: false, matrix: rendered.matrix, width: rendered.width, gap });
      }
    }

    const isScrolling = (this.config.scrollMode === 'scroll-left' || this.config.scrollMode === 'scroll-right');

    this.fullMatrixTextWidth = textCols;
    let fullWidth = baseW;
    let startX = 0;

    if (isScrolling && textCols > 0) {
      fullWidth = Math.max(baseW, textCols + baseW + 16);
      if (textCols < baseW) {
        startX = Math.floor((baseW - textCols) / 2) + (this.config.offsetX || 0);
      } else {
        startX = (this.config.offsetX !== undefined) ? this.config.offsetX : 0;
      }
    } else {
      fullWidth = Math.max(baseW, textCols + 8);
      if (textCols < baseW) {
        startX = Math.floor((baseW - textCols) / 2) + (this.config.offsetX || 0);
      } else {
        startX = (this.config.offsetX !== undefined) ? this.config.offsetX : 0;
      }
    }

    this.fullMatrixWidth = fullWidth;
    this.fullMatrix = Array.from({ length: h }, () => new Array(fullWidth).fill(0));

    let currX = startX;
    graphemeRenders.forEach(gr => {
      if (gr.gap) {
        currX += gr.gap;
      }
      if (gr.isSpace) {
        currX += gr.width;
      } else if (gr.matrix) {
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < gr.width; c++) {
            const posX = currX + c;
            if (posX >= 0 && posX < fullWidth && gr.matrix[r] && gr.matrix[r][c] === 1) {
              this.fullMatrix[r][posX] = 1;
            }
          }
        }
        currX += gr.width;
      }
    });

    // Automatic Vertical Middle Centering for Matrix (Bus LED Standard)
    if (this.config.offsetY === 0 || this.config.offsetY === undefined) {
      let topLit = -1, botLit = -1;
      for (let r = 0; r < h; r++) {
        if (this.fullMatrix[r].some(v => v === 1)) {
          if (topLit === -1) topLit = r;
          botLit = r;
        }
      }
      if (topLit !== -1 && botLit !== -1) {
        const textH = botLit - topLit + 1;
        const targetTop = Math.max(0, Math.floor((h - textH) / 2));
        const shiftY = targetTop - topLit;
        if (shiftY !== 0) {
          const shifted = Array.from({ length: h }, () => new Array(fullWidth).fill(0));
          for (let r = 0; r < h; r++) {
            const newR = r + shiftY;
            if (newR >= 0 && newR < h) {
              shifted[newR] = this.fullMatrix[r].slice();
            }
          }
          this.fullMatrix = shifted;
        }
      }
    } else if (this.config.offsetY) {
      const shiftY = this.config.offsetY;
      const shifted = Array.from({ length: h }, () => new Array(fullWidth).fill(0));
      for (let r = 0; r < h; r++) {
        const newR = r + shiftY;
        if (newR >= 0 && newR < h) {
          shifted[newR] = this.fullMatrix[r].slice();
        }
      }
      this.fullMatrix = shifted;
    }

    // Always maintain strictly the exact hardware matrix dimensions in this.matrix
    this.initMatrix(h, baseW);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < baseW; x++) {
        if (x < fullWidth && this.fullMatrix[y]) {
          this.matrix[y][x] = this.fullMatrix[y][x] || 0;
        }
      }
    }

    this.drawUIBoard();
  }

  // =========================================================================
  // DUAL-ZONE LED MARQUEE RENDERER
  // =========================================================================

  renderDualZoneMarquee(routeCode, line1Text, line2Text, options = {}) {
    if (this.glyphCache.size > 500) {
      this.glyphCache.clear();
    }
    this.isDualZone = true;
    const h = this.config.matrixHeight || 32;
    const totalW = this.config.matrixWidth || 256;
    const threshold = this.config.threshold || 128;

    // 1. Full-Width Unified LED Display (1st static box section removed for seamless full display)
    this.leftMatrixWidth = 0;
    this.leftMatrix = null;

    // 2. Render Full Matrix Width: Line 1 & Line 2
    const rightZoneW = totalW;
    const cleanL1 = (line1Text || '').trim();
    const cleanL2 = (line2Text || '').trim();

    // Accommodate two lines whenever Line 2 (VIA stops / secondary line) is present
    const useSingleFullRow = (!cleanL2);
    this.hasLine2 = !useSingleFullRow;
    this.rightZoneWidth = rightZoneW;

    if (useSingleFullRow) {
      const combinedL1 = cleanL1 + (cleanL2 ? '   •   ' + cleanL2 : '');
      const l1Graphemes = this.segmentTextToGraphemes(combinedL1);
      let l1Width = 0;
      const l1Renders = l1Graphemes.map(g => {
        const font = this.detectScriptFont(g, options.fontFamily);
        const rendered = this.rasterizeGraphemeCluster(g, font, h, true, threshold);
        l1Width += rendered.width;
        return rendered;
      });

      this.line1TextWidth = l1Width;
      this.line2TextWidth = 0;

      if (l1Width > rightZoneW) {
        this.isLine1Static = false;
        // Allow full clearance space behind text so nothing wraps or repeats during traversal
        const totalL1W = Math.max(rightZoneW, l1Width + rightZoneW + 16);
        this.line1FullWidth = totalL1W;
        this.line1FullMatrix = Array.from({ length: h }, () => new Array(totalL1W).fill(0));

        let startL1X = 0;
        l1Renders.forEach(lr => {
          for (let r = 0; r < h; r++) {
            for (let c = 0; c < lr.width; c++) {
              const posX = startL1X + c;
              if (posX >= 0 && posX < totalL1W && lr.matrix[r] && lr.matrix[r][c] === 1) {
                this.line1FullMatrix[r][posX] = 1;
              }
            }
          }
          startL1X += lr.width;
        });
      } else {
        this.isLine1Static = true;
        this.line1FullWidth = rightZoneW;
        this.line1FullMatrix = Array.from({ length: h }, () => new Array(rightZoneW).fill(0));

        let startL1X = Math.max(0, Math.floor((rightZoneW - l1Width) / 2));
        l1Renders.forEach(lr => {
          for (let r = 0; r < h; r++) {
            for (let c = 0; c < lr.width; c++) {
              const posX = startL1X + c;
              if (posX >= 0 && posX < rightZoneW && lr.matrix[r] && lr.matrix[r][c] === 1) {
                this.line1FullMatrix[r][posX] = 1;
              }
            }
          }
          startL1X += lr.width;
        });
      }

      const boardCenterRow = Math.floor(h / 2);
      this.line1FullMatrix = this.alignMatrixToCenterRow(this.line1FullMatrix, h, boardCenterRow);
    } else {
      this.isLine1Static = true;
      const splitRatio = (options.splitRatio !== undefined && options.splitRatio >= 0.2 && options.splitRatio <= 0.8)
        ? options.splitRatio
        : (this.config.splitRatio || 0.55);

      const subH1 = Math.max(6, Math.min(h - 6, Math.round(h * splitRatio)));
      const subH2 = h - subH1;
      this.splitHeightLine1 = subH1;

      // Line 1: Top Zone (Height = subH1)
      const l1Graphemes = this.segmentTextToGraphemes(cleanL1);
      let l1Width = 0;
      const l1Renders = l1Graphemes.map(g => {
        const font = this.detectScriptFont(g, options.fontFamily);
        const rendered = this.rasterizeGraphemeCluster(g, font, subH1, true, threshold);
        l1Width += rendered.width;
        return rendered;
      });

      this.line1TextWidth = l1Width;

      if (l1Width > rightZoneW) {
        this.isLine1Static = false;
        const totalL1W = Math.max(rightZoneW, l1Width + rightZoneW + 16);
        this.line1FullWidth = totalL1W;
        this.line1FullMatrix = Array.from({ length: subH1 }, () => new Array(totalL1W).fill(0));

        let startL1X = 0;
        l1Renders.forEach(lr => {
          for (let r = 0; r < subH1; r++) {
            for (let c = 0; c < lr.width; c++) {
              const posX = startL1X + c;
              if (posX >= 0 && posX < totalL1W && lr.matrix[r] && lr.matrix[r][c] === 1) {
                this.line1FullMatrix[r][posX] = 1;
              }
            }
          }
          startL1X += lr.width;
        });
      } else {
        this.isLine1Static = true;
        this.line1FullWidth = rightZoneW;
        this.line1FullMatrix = Array.from({ length: subH1 }, () => new Array(rightZoneW).fill(0));

        let startL1X = Math.max(0, Math.floor((rightZoneW - l1Width) / 2));
        l1Renders.forEach(lr => {
          for (let r = 0; r < subH1; r++) {
            for (let c = 0; c < lr.width; c++) {
              const posX = startL1X + c;
              if (posX >= 0 && posX < rightZoneW && lr.matrix[r] && lr.matrix[r][c] === 1) {
                this.line1FullMatrix[r][posX] = 1;
              }
            }
          }
          startL1X += lr.width;
        });
      }

      // Line 2: Bottom Zone (Height = subH2)
      const l2Graphemes = this.segmentTextToGraphemes(cleanL2);
      let l2Width = 0;
      const l2Renders = l2Graphemes.map(g => {
        const font = this.detectScriptFont(g, options.fontFamily);
        const rendered = this.rasterizeGraphemeCluster(g, font, subH2, true, threshold);
        l2Width += rendered.width;
        return rendered;
      });

      this.line2TextWidth = l2Width;

      const totalL2W = Math.max(rightZoneW, l2Width + rightZoneW + 16);
      this.line2FullWidth = totalL2W;
      this.line2FullMatrix = Array.from({ length: subH2 }, () => new Array(totalL2W).fill(0));

      let startL2X = 0;
      l2Renders.forEach(lr => {
        for (let r = 0; r < subH2; r++) {
          for (let c = 0; c < lr.width; c++) {
            const posX = startL2X + c;
            if (posX >= 0 && posX < totalL2W && lr.matrix[r] && lr.matrix[r][c] === 1) {
              this.line2FullMatrix[r][posX] = 1;
            }
          }
        }
        startL2X += lr.width;
      });
    }

    this.scrollOffset1 = 0;
    this.scrollOffset2 = 0;
    this.drawUIBoard();
  }

  // =========================================================================
  // HIGH-PERFORMANCE VIRTUAL LED BOARD RENDERING ENGINE (PRE-RENDERED WELLS & ZERO-ALLOCATION)
  // =========================================================================

  drawUIBoard() {
    if (!this.ctx || !this.canvas) return;

    const pitchX = this.getDynamicPitchX();
    const pitchY = this.getDynamicPitchY();
    const radius = Math.max(1.2, Math.floor(pitchX * 0.35));
    const offRadius = Math.max(1, Math.floor(radius * 0.58));
    const rows = this.config.matrixHeight;
    const cols = this.config.matrixWidth;

    const targetWidth = cols * pitchX + pitchX;
    const targetHeight = rows * pitchY + pitchY;
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this.bgDirty = true;
    }

    // 1. Blit Pre-rendered Inactive Background Wells (Zero heap allocation, 0.02ms GPU blit)
    if (this.bgDirty || !this.bgCanvas || this.bgCanvas.width !== targetWidth || this.bgCanvas.height !== targetHeight) {
      this.updateBgCanvas(pitchX, pitchY, rows, cols, offRadius);
    }
    this.ctx.drawImage(this.bgCanvas, 0, 0);

    // 2. Render Active (ON) Illuminated LED Dots with Hardware-Accelerated Fast Batching
    const isSquare = this.config.pixelStyle === 'square';
    const isGlow = this.config.pixelStyle === 'glow';
    const useFastRect = isSquare || radius <= 2.2 || pitchX <= 5;
    const sqSize = isSquare ? radius * 1.8 : radius * 2;
    const sqHalf = sqSize / 2;
    const pi2 = Math.PI * 2;

    this.ctx.fillStyle = this.config.ledColor || '#ff2a2a';
    if (isGlow) {
      this.ctx.shadowColor = this.config.ledColor || '#ff2a2a';
      this.ctx.shadowBlur = 6;
    } else {
      this.ctx.shadowBlur = 0;
    }

    if (!useFastRect) {
      this.ctx.beginPath();
    }

    let hasLitDots = false;

    if (this.isDualZone) {
      const subH = this.splitHeightLine1 || Math.floor(rows / 2);

      for (let r = 0; r < rows; r++) {
        const cy = (r + 1) * pitchY;
        const cyOffset = cy - sqHalf;

        for (let c = 0; c < cols; c++) {
          let isOn = false;
          if (this.leftMatrixWidth > 0 && c < this.leftMatrixWidth) {
            isOn = !!(this.leftMatrix && this.leftMatrix[r] && this.leftMatrix[r][c] === 1);
          } else {
            const rightCol = this.leftMatrixWidth > 0 ? (c - this.leftMatrixWidth) : c;
            if (!this.hasLine2) {
              const colIdx1 = this.isLine1Static
                ? (rightCol < this.line1FullWidth ? rightCol : 0)
                : (rightCol + this.scrollOffset1);
              isOn = !!(colIdx1 >= 0 && colIdx1 < this.line1FullWidth && this.line1FullMatrix && this.line1FullMatrix[r] && this.line1FullMatrix[r][colIdx1] === 1);
            } else {
              if (r < subH) {
                const colIdx1 = this.isLine1Static
                  ? (rightCol < this.line1FullWidth ? rightCol : 0)
                  : (rightCol + this.scrollOffset1);
                isOn = !!(colIdx1 >= 0 && colIdx1 < this.line1FullWidth && this.line1FullMatrix && this.line1FullMatrix[r] && this.line1FullMatrix[r][colIdx1] === 1);
              } else {
                const subR = r - subH;
                const colIdx2 = rightCol + this.scrollOffset2;
                isOn = !!(colIdx2 >= 0 && colIdx2 < this.line2FullWidth && this.line2FullMatrix && this.line2FullMatrix[subR] && this.line2FullMatrix[subR][colIdx2] === 1);
              }
            }
          }

          if (isOn) {
            hasLitDots = true;
            const cx = (c + 1) * pitchX;
            if (useFastRect) {
              this.ctx.fillRect(cx - sqHalf, cyOffset, sqSize, sqSize);
            } else {
              this.ctx.moveTo(cx + radius, cy);
              this.ctx.arc(cx, cy, radius, 0, pi2);
            }
          }
        }
      }
    } else {
      const isBlinkingOff = (this.config.scrollMode === 'blink' && !this.blinkState);
      const fullW = this.fullMatrixWidth || cols;
      const useFullMatrix = (this.fullMatrix && this.fullMatrix.length > 0 && (this.config.scrollMode === 'scroll-left' || this.config.scrollMode === 'scroll-right'));
      const isScrollLeft = this.config.scrollMode === 'scroll-left';
      const isScrollRight = this.config.scrollMode === 'scroll-right';

      if (!isBlinkingOff) {
        const mode = this.config.scrollMode;
        const step = this.transitionStep || 0;
        const halfCols = Math.floor(cols / 2);

        for (let r = 0; r < rows; r++) {
          const cy = (r + 1) * pitchY;
          const cyOffset = cy - sqHalf;

          for (let c = 0; c < cols; c++) {
            let isOn = false;
            if (useFullMatrix) {
              let colIdx = c;
              if (isScrollLeft) {
                colIdx = c + this.scrollOffset;
              } else if (isScrollRight) {
                colIdx = c - this.scrollOffset;
              }
              const rowData = this.fullMatrix[r];
              isOn = !!(colIdx >= 0 && colIdx < fullW && rowData && rowData[colIdx] === 1);
            } else {
              const baseOn = !!(this.matrix[r] && this.matrix[r][c] === 1);
              if (!baseOn) {
                isOn = false;
              } else if (mode === 'static') {
                isOn = true;
              } else if (mode === 'curtain-open') {
                const distFromMid = Math.abs(c - halfCols);
                isOn = distFromMid <= step;
              } else if (mode === 'curtain-close') {
                const distFromMid = Math.abs(c - halfCols);
                isOn = distFromMid >= (halfCols - step);
              } else if (mode === 'wipe-up') {
                isOn = r >= (rows - step);
              } else if (mode === 'wipe-down') {
                isOn = r <= step;
              } else if (mode === 'dissolve') {
                const hash = ((r * 41 + c * 29 + 17) % 60);
                isOn = hash <= step;
              } else {
                isOn = true;
              }
            }

            if (isOn) {
              hasLitDots = true;
              const cx = (c + 1) * pitchX;
              if (useFastRect) {
                this.ctx.fillRect(cx - sqHalf, cyOffset, sqSize, sqSize);
              } else {
                this.ctx.moveTo(cx + radius, cy);
                this.ctx.arc(cx, cy, radius, 0, pi2);
              }
            }
          }
        }
      }
    }

    if (!useFastRect && hasLitDots) {
      this.ctx.fill();
    }
    this.ctx.shadowBlur = 0;
  }

  drawSingleDot(cx, cy, radius, isOn) {
    this.ctx.save();

    if (isOn) {
      this.ctx.fillStyle = this.config.ledColor;
      if (this.config.pixelStyle === 'glow') {
        this.ctx.shadowColor = this.config.ledColor;
        this.ctx.shadowBlur = 6;
      }

      if (this.config.pixelStyle === 'square') {
        const size = radius * 1.8;
        this.ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      } else {
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    } else {
      this.ctx.fillStyle = this.config.offColor;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, Math.max(1, radius * 0.6), 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  pushUndoState() {
    if (!this.matrix || this.matrix.length === 0) return;
    const snapshot = this.matrix.map(r => (Array.isArray(r) ? [...r] : []));
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    if (typeof this.onUndoRedoChange === 'function') this.onUndoRedoChange();
  }

  undo() {
    if (!this.undoStack || this.undoStack.length === 0) return;
    const current = this.matrix.map(r => (Array.isArray(r) ? [...r] : []));
    this.redoStack.push(current);
    this.matrix = this.undoStack.pop();
    if (this.fullMatrix && this.fullMatrix.length > 0) {
      this.fullMatrix = this.matrix.map(r => [...r]);
    }
    this.drawUIBoard();
    if (this.onMatrixChange) this.onMatrixChange();
    if (typeof this.onUndoRedoChange === 'function') this.onUndoRedoChange();
    if (typeof window.showToast === 'function') {
      window.showToast('Undo Pixel Action (Ctrl+Z)', 'info');
    }
  }

  redo() {
    if (!this.redoStack || this.redoStack.length === 0) return;
    const current = this.matrix.map(r => (Array.isArray(r) ? [...r] : []));
    this.undoStack.push(current);
    this.matrix = this.redoStack.pop();
    if (this.fullMatrix && this.fullMatrix.length > 0) {
      this.fullMatrix = this.matrix.map(r => [...r]);
    }
    this.drawUIBoard();
    if (this.onMatrixChange) this.onMatrixChange();
    if (typeof this.onUndoRedoChange === 'function') this.onUndoRedoChange();
    if (typeof window.showToast === 'function') {
      window.showToast('Redo Pixel Action (Ctrl+Y)', 'info');
    }
  }

  setupInteractivity() {
    if (!this.canvas || this._interactivityBound) return;
    this._interactivityBound = true;

    const handlePointer = (e, isDrag = false) => {
      if (this.config.isInteractive === false) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const clickX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const clickY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      const pitchX = this.getDynamicPitchX();
      const pitchY = this.getDynamicPitchY();
      const col = Math.round(clickX / pitchX) - 1;
      const row = Math.round(clickY / pitchY) - 1;

      if (row >= 0 && row < this.config.matrixHeight && col >= 0 && col < this.config.matrixWidth) {
        const cellKey = `${row},${col}`;
        if (isDrag && this.lastEditedCell === cellKey) return;

        if (!isDrag) {
          this.pushUndoState();
          this.drawMode = (this.matrix[row] && this.matrix[row][col] === 1) ? 0 : 1;
        }

        if (this.matrix && this.matrix[row]) {
          this.matrix[row][col] = this.drawMode;
        }
        if (this.fullMatrix && this.fullMatrix[row]) {
          this.fullMatrix[row][col] = this.drawMode;
        }
        if (this.isDualZone) {
          const subH = this.splitHeightLine1 || Math.floor(this.config.matrixHeight / 2);
          if (col < this.leftMatrixWidth) {
            if (this.leftMatrix && this.leftMatrix[row]) {
              this.leftMatrix[row][col] = this.drawMode;
            }
          } else {
            const rightCol = col - this.leftMatrixWidth;
            if (row < subH) {
              if (this.line1FullMatrix && this.line1FullMatrix[row]) {
                this.line1FullMatrix[row][rightCol] = this.drawMode;
              }
            } else {
              const subR = row - subH;
              if (this.line2FullMatrix && this.line2FullMatrix[subR]) {
                this.line2FullMatrix[subR][rightCol] = this.drawMode;
              }
            }
          }
        }

        this.lastEditedCell = cellKey;
        this.drawUIBoard();
        if (this.onMatrixChange) this.onMatrixChange();
      }
    };

    this._boundMouseDown = (e) => {
      if (e.button !== 0 || this.config.isInteractive === false) return;
      this.isMouseDown = true;
      this.lastEditedCell = null;
      handlePointer(e, false);
    };

    this._boundMouseUp = () => {
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.lastEditedCell = null;
      }
    };

    this._boundMouseMove = (e) => {
      if (this.isMouseDown) {
        handlePointer(e, true);
      }
    };

    this.canvas.addEventListener('mousedown', this._boundMouseDown);
    window.addEventListener('mouseup', this._boundMouseUp);
    this.canvas.addEventListener('mousemove', this._boundMouseMove);
  }

  destroy() {
    this.stopAnimation();
    if (this.canvas) {
      if (this._boundMouseDown) this.canvas.removeEventListener('mousedown', this._boundMouseDown);
      if (this._boundMouseMove) this.canvas.removeEventListener('mousemove', this._boundMouseMove);
    }
    if (this._boundMouseUp) {
      window.removeEventListener('mouseup', this._boundMouseUp);
    }
    this._interactivityBound = false;
  }

  startAnimation() {
    this.stopAnimation();

    const isDynamic = (this.isDualZone && (!this.isLine1Static || this.hasLine2)) || (this.config.scrollMode && this.config.scrollMode !== 'static');

    if (!isDynamic) {
      this.drawUIBoard();
      return;
    }

    const h = this.config.matrixHeight || 32;
    const baseStep = Math.max(1, Math.round(h / 32));
    const targetInterval = Math.max(16, Math.min(45, this.config.scrollSpeed || 28));
    this.lastFrameTime = performance.now();

    const animLoop = (now) => {
      if (!this.canvas || !this.canvas.isConnected) {
        this.stopAnimation();
        return;
      }

      // If view/canvas is hidden in DOM (e.g. inactive tab), throttle loop to eliminate CPU thrashing while remaining resilient
      if (this.canvas.offsetParent === null) {
        this.animFrameId = setTimeout(() => {
          this.animFrameId = requestAnimationFrame(animLoop);
        }, 300);
        return;
      }

      const elapsed = now - this.lastFrameTime;
      if (elapsed >= targetInterval) {
        const steps = Math.min(3, Math.floor(elapsed / targetInterval)) * baseStep;
        this.lastFrameTime = now - (elapsed % targetInterval);

        if (this.isDualZone) {
          if (!this.isLine1Static) {
            this.scrollOffset1 += steps;
          }
          if (this.hasLine2) {
            this.scrollOffset2 += steps;
          }

          this.drawUIBoard();

          const l1Target = (!this.isLine1Static && (this.line1TextWidth || 0) > 0) ? (this.line1TextWidth + 16) : 0;
          const l2Target = (this.hasLine2 && (this.line2TextWidth || 0) > 0) ? (this.line2TextWidth + 16) : 0;
          const maxTravel = Math.max(l1Target, l2Target);

          const currentOffset = Math.max(
            !this.isLine1Static ? this.scrollOffset1 : 0,
            this.hasLine2 ? this.scrollOffset2 : 0
          );

          if (maxTravel > 0 && currentOffset >= maxTravel) {
            if (typeof this.onScrollCycleComplete === 'function') {
              const cb = this.onScrollCycleComplete;
              this.onScrollCycleComplete = null;
              cb();
            } else {
              // Continuous smooth marquee loop when in static language mode
              if (!this.isLine1Static) this.scrollOffset1 = 0;
              if (this.hasLine2) this.scrollOffset2 = 0;
            }
          }
        } else if (this.config.scrollMode !== 'static') {
          const fullW = this.fullMatrixTextWidth || this.config.matrixWidth;
          if (this.config.scrollMode === 'scroll-left' || this.config.scrollMode === 'scroll-right') {
            this.scrollOffset += steps;
            this.drawUIBoard();

            if (this.scrollOffset >= fullW + 12) {
              if (typeof this.onScrollCycleComplete === 'function') {
                const cb = this.onScrollCycleComplete;
                this.onScrollCycleComplete = null;
                cb();
              }
            }
          } else if (this.config.scrollMode === 'curtain-open' || this.config.scrollMode === 'curtain-close') {
            const maxCurtain = Math.floor(this.config.matrixWidth / 2) + 15;
            this.transitionStep = ((this.transitionStep || 0) + steps) % maxCurtain;
            this.drawUIBoard();
          } else if (this.config.scrollMode === 'wipe-up' || this.config.scrollMode === 'wipe-down') {
            const maxWipe = this.config.matrixHeight + 8;
            this.transitionStep = ((this.transitionStep || 0) + steps) % maxWipe;
            this.drawUIBoard();
          } else if (this.config.scrollMode === 'dissolve') {
            this.transitionStep = ((this.transitionStep || 0) + steps) % 80;
            this.drawUIBoard();
          } else if (this.config.scrollMode === 'blink') {
            if (!this.lastBlinkToggle || now - this.lastBlinkToggle > 500) {
              this.blinkState = !this.blinkState;
              this.lastBlinkToggle = now;
            }
            this.drawUIBoard();
          }
        }
      }

      this.animFrameId = requestAnimationFrame(animLoop);
    };

    this.animFrameId = requestAnimationFrame(animLoop);
  }

  stopAnimation() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      clearTimeout(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.animInterval) {
      clearInterval(this.animInterval);
      this.animInterval = null;
    }
    this.scrollOffset = 0;
    this.scrollOffset1 = 0;
    this.scrollOffset2 = 0;
    this.transitionStep = 0;
    this.blinkState = true;
    this.drawUIBoard();
  }

  invertMatrix() {
    this.pushUndoState();
    for (let r = 0; r < this.config.matrixHeight; r++) {
      for (let c = 0; c < this.config.matrixWidth; c++) {
        this.matrix[r][c] = this.matrix[r][c] === 1 ? 0 : 1;
      }
    }
    if (this.fullMatrix) {
      for (let r = 0; r < this.config.matrixHeight; r++) {
        for (let c = 0; c < this.fullMatrixWidth; c++) {
          this.fullMatrix[r][c] = this.fullMatrix[r][c] === 1 ? 0 : 1;
        }
      }
    }
    this.drawUIBoard();
    if (this.onMatrixChange) this.onMatrixChange();
  }

  clearMatrix() {
    this.pushUndoState();
    for (let r = 0; r < this.config.matrixHeight; r++) {
      for (let c = 0; c < this.config.matrixWidth; c++) {
        this.matrix[r][c] = 0;
      }
    }
    if (this.fullMatrix) {
      for (let r = 0; r < this.config.matrixHeight; r++) {
        for (let c = 0; c < this.fullMatrixWidth; c++) {
          this.fullMatrix[r][c] = 0;
        }
      }
    }
    this.drawUIBoard();
    if (this.onMatrixChange) this.onMatrixChange();
  }

  // =========================================================================
  // HARDWARE EXPORT ENGINE (ALL FORMATS)
  // =========================================================================

  // =========================================================================
  // HARDWARE EXPORT ENGINE (ALL SCANNING MODES & CONTROLLER PROTOCOLS)
  // =========================================================================

  /**
   * Generates a 1-bit packed byte array with configurable hardware scan modes:
   * - 'COLUMN_MAJOR_LSB_TOP': Standard ITMS/Bus P10 LED matrix (Byte 0 = Col 0, Rows 0..7 LSB=Top)
   * - 'COLUMN_MAJOR_MSB_TOP': Column-major with MSB at Top row
   * - 'ROW_MAJOR_MSB_LEFT': Standard Hub75 / C Header (Row 0 Byte 0 = Cols 0..7 MSB=Left)
   * - 'ROW_MAJOR_LSB_LEFT': Row-major with LSB at Left col
   * @param {Object} [options]
   * @param {string} [options.scanMode]
   * @param {boolean} [options.invert]
   * @returns {Uint8Array}
   */
  getPackedHardwareByteArray(options = {}) {
    const h = this.config.matrixHeight;
    const w = this.config.matrixWidth;
    const scanMode = options.scanMode || this.config.scanMode || 'COLUMN_MAJOR_LSB_TOP';
    const invert = !!options.invert;

    if (scanMode.startsWith('ROW_MAJOR')) {
      const bytesPerRow = Math.ceil(w / 8);
      const buffer = new Uint8Array(h * bytesPerRow);
      let ptr = 0;
      const isMsb = scanMode === 'ROW_MAJOR_MSB_LEFT';

      for (let r = 0; r < h; r++) {
        for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const c = byteIdx * 8 + bit;
            let isLit = (c < w && this.matrix[r] && this.matrix[r][c] === 1);
            if (invert) isLit = !isLit;
            if (isLit) {
              byteVal |= isMsb ? (1 << (7 - bit)) : (1 << bit);
            }
          }
          buffer[ptr++] = byteVal;
        }
      }
      return buffer;
    } else {
      // Column-Major (Default ITMS standard)
      const bytesPerCol = Math.ceil(h / 8);
      const buffer = new Uint8Array(w * bytesPerCol);
      let ptr = 0;
      const isMsb = scanMode === 'COLUMN_MAJOR_MSB_TOP';

      for (let c = 0; c < w; c++) {
        for (let byteIdx = 0; byteIdx < bytesPerCol; byteIdx++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const r = byteIdx * 8 + bit;
            let isLit = (r < h && this.matrix[r] && this.matrix[r][c] === 1);
            if (invert) isLit = !isLit;
            if (isLit) {
              byteVal |= isMsb ? (1 << (7 - bit)) : (1 << bit);
            }
          }
          buffer[ptr++] = byteVal;
        }
      }
      return buffer;
    }
  }

  getPackedColumnByteArray() {
    return this.getPackedHardwareByteArray({ scanMode: 'COLUMN_MAJOR_LSB_TOP' });
  }

  /**
   * Compute standard CRC16-CCITT checksum for hardware frame validation
   * @param {Uint8Array} data
   * @returns {number}
   */
  computeCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= (data[i] << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  /**
   * Deterministic Hardware Validation & Mismatch Detection
   * Verifies that Matrix Data -> Exported Bytes -> Decoded Framebuffer is 100% Bit-for-Bit Identical.
   * @returns {Object}
   */
  validateHardwareBitmap() {
    const h = this.config.matrixHeight;
    const w = this.config.matrixWidth;
    let totalOnPixels = 0;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (this.matrix[r] && this.matrix[r][c] === 1) totalOnPixels++;
      }
    }

    const packedBytes = this.getPackedColumnByteArray();
    const bytesPerCol = Math.ceil(h / 8);
    let mismatchCount = 0;

    // Round-trip verification: Decode packed bytes and compare with this.matrix
    let ptr = 0;
    for (let c = 0; c < w; c++) {
      for (let byteIdx = 0; byteIdx < bytesPerCol; byteIdx++) {
        const byteVal = packedBytes[ptr++];
        for (let bit = 0; bit < 8; bit++) {
          const r = byteIdx * 8 + bit;
          if (r < h) {
            const expected = (this.matrix[r] && this.matrix[r][c] === 1) ? 1 : 0;
            const decoded = (byteVal & (1 << bit)) ? 1 : 0;
            if (expected !== decoded) {
              mismatchCount++;
            }
          }
        }
      }
    }

    const crc16 = this.computeCRC16(packedBytes);

    return {
      isValid: mismatchCount === 0,
      mismatchCount,
      totalOnPixels,
      totalOffPixels: (h * w) - totalOnPixels,
      matrixDimensions: `${w}x${h}`,
      totalBytes: packedBytes.length,
      crc16Hex: '0x' + crc16.toString(16).padStart(4, '0').toUpperCase(),
      scanMode: 'COLUMN_MAJOR_LSB_TOP',
      hardwareCompliance: (h === 16 || h === 24 || h === 32 || h === 48 || h === 64) && (w % 8 === 0)
    };
  }

  /**
   * Loads and decodes a 1-Bit Column-Major packed byte array directly into the LED Matrix framebuffer.
   * Matches the exact encoding generated by getPackedColumnByteArray() and ITMS hardware displays.
   * @param {Uint8Array|Array<number>} buffer
   * @param {number} [width]
   * @param {number} [height]
   */
  loadPackedColumnByteArray(buffer, width = this.config.matrixWidth, height = this.config.matrixHeight) {
    if (!buffer || buffer.length === 0) return;
    this.pushUndoState();

    const w = parseInt(width || this.config.matrixWidth, 10);
    const h = parseInt(height || this.config.matrixHeight, 10);
    this.config.matrixWidth = w;
    this.config.matrixHeight = h;
    this.initMatrix(h, w);

    const bytesPerCol = Math.ceil(h / 8);
    let ptr = 0;

    for (let c = 0; c < w; c++) {
      for (let byteIdx = 0; byteIdx < bytesPerCol; byteIdx++) {
        if (ptr >= buffer.length) break;
        const byteVal = buffer[ptr++];
        for (let bit = 0; bit < 8; bit++) {
          const r = byteIdx * 8 + bit;
          if (r < h) {
            this.matrix[r][c] = (byteVal & (1 << bit)) ? 1 : 0;
          }
        }
      }
    }

    this.fullMatrix = this.matrix.map(row => row.slice());
    this.fullMatrixWidth = w;
    this.drawUIBoard();
    if (this.onMatrixChange) this.onMatrixChange();
  }

  /**
   * Alias for loadPackedColumnByteArray with support for hex string or binary arrays
   */
  loadBitmapFromBytes(data, width, height) {
    let bytes;
    if (typeof data === 'string') {
      const cleaned = data.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, ' ').trim();
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      bytes = new Uint8Array(tokens.map(t => parseInt(t, 16)));
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else if (Array.isArray(data)) {
      bytes = new Uint8Array(data);
    } else {
      return;
    }
    this.loadPackedColumnByteArray(bytes, width, height);
  }

  getHexString(format = 'C-ARRAY') {
    const bytes = this.getPackedColumnByteArray();
    const hexArr = Array.from(bytes).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase());

    switch (format) {
      case 'C-ARRAY':
        return `// ITMS Hardware LED Bitmap (${this.config.matrixWidth}x${this.config.matrixHeight} Dots - 1-Bit Column-Major)\n` +
          `const uint8_t led_bitmap_${this.config.matrixWidth}x${this.config.matrixHeight}[${hexArr.length}] = {\n  ` +
          hexArr.join(', ') + '\n};';

      case 'CSHARP':
        return `// ITMS Hardware LED Bitmap C# Array (${this.config.matrixWidth}x${this.config.matrixHeight})\n` +
          `public static readonly byte[] LedBitmap = new byte[${hexArr.length}] {\n  ` +
          hexArr.join(', ') + '\n};';

      case 'HEX-PLAIN':
        return hexArr.join(', ');

      case 'RAW-HEX':
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      case 'BINARY':
        return `// 1-Bit Binary Grid (${this.config.matrixWidth}x${this.config.matrixHeight})\n` +
          this.matrix.map(row => row.join('')).join('\n');

      case 'BIN-ARRAY':
        return `// Binary Byte Array (${this.config.matrixWidth}x${this.config.matrixHeight})\n` +
          Array.from(bytes).map(b => '0b' + b.toString(2).padStart(8, '0')).join(', ');

      case 'JSON':
        return JSON.stringify({
          width: this.config.matrixWidth,
          height: this.config.matrixHeight,
          totalBytes: bytes.length,
          packing: 'Column-Major 1-Bit Monochrome',
          hexBytes: hexArr,
          base64Payload: btoa(String.fromCharCode(...bytes))
        }, null, 2);

      case 'BASE64':
        return btoa(String.fromCharCode(...bytes));

      case 'PYTHON':
        return `# ITMS Hardware LED Bitmap (${this.config.matrixWidth}x${this.config.matrixHeight})\n` +
          `led_bitmap = [\n  ` + hexArr.join(', ') + '\n]';

      default:
        return hexArr.join(', ');
    }
  }

  getBinaryGridString() {
    return this.matrix.map(row => row.join('')).join('\n');
  }

  validateBitmap() {
    const h = this.config.matrixHeight;
    const w = this.config.matrixWidth;
    let totalOnPixels = 0;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (this.matrix[r][c] === 1) totalOnPixels++;
      }
    }

    return {
      heightValid: h === 16 || h === 24 || h === 32 || h === 48 || h === 64,
      widthValid: w >= 32 && w % 8 === 0,
      totalOnPixels: totalOnPixels,
      hasContent: totalOnPixels > 0,
      isHardwareStandard: h === 16 && (w === 64 || w === 96 || w === 128 || w === 256 || w === 512)
    };
  }

  downloadPNG(filename = 'led_bitmap_preview.png') {
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.LEDEngine = LEDEngine;
  window.LEDEngine = LEDEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LEDEngine;
  module.exports.LEDEngine = LEDEngine;
}



/**
 * @file led-rasterizer.js
 * @description ITMS 1-Bit Monochrome Glyph Rasterizer, Indic HarfBuzz Shaping Engine, and Hardware Matrix Optimizer.
 * @module LEDRasterizer
 */

class LEDRasterizer {
  constructor(config = {}) {
    this.config = Object.assign({
      matrixHeight: 64,
      fontSize: 20,
      fontFamily: "'Noto Sans Telugu', 'Inter', sans-serif",
      fontWeight: 'bold',
      threshold: 128,
      letterSpacing: 1
    }, config);

    this._offscreenCanvas = null;
    this._offscreenCtx = null;
  }

  getOffscreenContext() {
    if (!this._offscreenCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        try {
          this._offscreenCanvas = new OffscreenCanvas(2048, 256);
          this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });
        } catch (_) {}
      }
      if (!this._offscreenCtx && typeof document !== 'undefined') {
        this._offscreenCanvas = document.createElement('canvas');
        this._offscreenCanvas.width = 2048;
        this._offscreenCanvas.height = 256;
        this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }
    }
    return this._offscreenCtx;
  }

  normalizeUnicode(text) {
    return (text || '').normalize('NFC');
  }

  segmentTextToGraphemes(text) {
    const norm = this.normalizeUnicode(text);
    const hasIndic = /[\u0900-\u0DFF]/.test(norm);
    
    if (hasIndic) {
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
    if (code >= 0x0C00 && code <= 0x0C7F) {
      return "'Noto Sans Telugu', 'Nirmala UI', 'Gautami', 'Mandali', 'Suranna', 'Ramabhadra', sans-serif";
    }
    if (code >= 0x0900 && code <= 0x097F) return "'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', sans-serif";
    if (code >= 0x0B80 && code <= 0x0BFF) return "'Noto Sans Tamil', 'Nirmala UI', 'Latha', sans-serif";
    if (code >= 0x0C80 && code <= 0x0CFF) return "'Noto Sans Kannada', 'Nirmala UI', 'Tunga', sans-serif";
    if (code >= 0x0D00 && code <= 0x0DFF) return "'Noto Sans Malayalam', 'Nirmala UI', 'Kartika', sans-serif";
    if (code >= 0x0980 && code <= 0x09FF) return "'Noto Sans Bengali', 'Nirmala UI', 'Vrinda', sans-serif";
    if (code >= 0x0A80 && code <= 0x0AFF) return "'Noto Sans Gujarati', 'Nirmala UI', 'Shruti', sans-serif";
    if (code >= 0x0A00 && code <= 0x0A7F) return "'Noto Sans Gurmukhi', 'Nirmala UI', 'Raavi', sans-serif";
    if (code >= 0x0B00 && code <= 0x0B7F) return "'Noto Sans Oriya', 'Nirmala UI', 'Kalinga', sans-serif";
    if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0x08A0 && code <= 0x08FF)) {
      return "'Noto Nastaliq Urdu', serif";
    }

    return "'Inter', sans-serif";
  }

  padMatrixToHeight(matrix, targetH, verticalAlign = 'center') {
    const curH = matrix.length;
    if (curH === targetH) return matrix;
    const width = matrix[0]?.length || 0;
    if (width === 0) return Array.from({ length: targetH }, () => []);

    if (curH > targetH) {
      return matrix.slice(0, targetH);
    }

    const diff = targetH - curH;
    let topPad = 0;
    if (verticalAlign === 'center') {
      topPad = Math.floor(diff / 2);
    } else if (verticalAlign === 'bottom') {
      topPad = diff;
    }

    const result = [];
    for (let i = 0; i < topPad; i++) {
      result.push(new Array(width).fill(0));
    }
    for (let i = 0; i < curH; i++) {
      result.push(matrix[i].slice());
    }
    while (result.length < targetH) {
      result.push(new Array(width).fill(0));
    }
    return result;
  }

  optimizeClusterMatrix(matrix, targetH, threshold, cluster = '') {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;

    const copy = matrix.map(r => r.slice());
    const isTelugu = /[\u0C00-\u0C7F]/.test(cluster);
    const isIndic = /[\u0900-\u0DFF]/.test(cluster);
    const isSmallPunctuation = /^[ij\.\:\!\?\'\"\`\,\;\bullet\★\-\–\—]$/i.test(cluster);

    if (!isSmallPunctuation && !isIndic) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (copy[r][c] === 1) {
            let neighbors = 0;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && copy[nr][nc] === 1) {
                  neighbors++;
                }
              }
            }
            if (neighbors === 0) copy[r][c] = 0;
          }
        }
      }
    }

    // Specialized Loop Preservation for Telugu
    if (isTelugu && targetH <= 24) {
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

    if (!isIndic && targetH >= 16) {
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

    return copy;
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.LEDRasterizer = LEDRasterizer;
  window.LEDRasterizer = LEDRasterizer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LEDRasterizer;
}


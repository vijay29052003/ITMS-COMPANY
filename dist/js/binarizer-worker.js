/* ==========================================================================
   OFFSCREEN CANVAS & WEB WORKER BINARIZATION PIPELINE (HIGH PERFORMANCE)
   ========================================================================== */

self.onmessage = function(e) {
  const data = e.data;
  if (!data || !data.type) return;

  if (data.type === 'PROCESS_BINARIZATION') {
    try {
      const { id, pixelsBuffer, renderWidth, renderHeight, rows, cols, oversample, minCoverageRatio } = data;
      if (!pixelsBuffer || !rows || !cols) {
        self.postMessage({ type: 'BINARIZATION_COMPLETE', id, matrix: [] });
        return;
      }
      const pixels = new Uint8Array(pixelsBuffer);
      const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let blackPixelCount = 0;
          let totalSamplePixels = 0;

          for (let subR = 0; subR < oversample; subR++) {
            for (let subC = 0; subC < oversample; subC++) {
              const pixelY = (r * oversample) + subR;
              const pixelX = (c * oversample) + subC;

              if (pixelX < renderWidth && pixelY < renderHeight) {
                const idx = (pixelY * renderWidth + pixelX) * 4;
                const rVal = pixels[idx];
                const gVal = pixels[idx + 1];
                const bVal = pixels[idx + 2];
                const luminance = 0.299 * rVal + 0.587 * gVal + 0.114 * bVal;

                if (luminance < 170) {
                  blackPixelCount++;
                }
                totalSamplePixels++;
              }
            }
          }

          const areaDensity = totalSamplePixels > 0 ? (blackPixelCount / totalSamplePixels) : 0;
          matrix[r][c] = areaDensity >= minCoverageRatio ? 1 : 0;
        }
      }

      // Post back the binarized matrix
      self.postMessage({
        type: 'BINARIZATION_COMPLETE',
        id: id,
        matrix: matrix
      });
    } catch (err) {
      self.postMessage({
        type: 'BINARIZATION_COMPLETE',
        id: data ? data.id : 0,
        matrix: Array.from({ length: (data && data.rows) || 16 }, () => new Array((data && data.cols) || 128).fill(0))
      });
    }
  }
};

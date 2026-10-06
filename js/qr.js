const CardQR = (() => {
  function scanVideo(videoEl, canvasEl) {
    if (!videoEl || !videoEl.videoWidth || typeof jsQR !== 'function') return null;
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (!result || !result.data) return null;
    return { raw: result.data, hit: Store.parseQR(result.data) };
  }

  /**
   * 이미지 URL 에서 QR 문자열을 읽습니다. 못 읽으면 null
   * thorough: 사진 속 QR 이 작을 때를 위해 원본 크기·부분 확대까지 시도 (갤러리 사진용)
   */
  async function decodeImage(url, { thorough = false } = {}) {
    if (typeof jsQR !== 'function') return null;
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const read = (sx, sy, sw, sh, max, upscale) => {
      const s = upscale ? max / Math.max(sw, sh) : Math.min(1, max / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * s));
      const h = Math.max(1, Math.round(sh * s));
      const pad = Math.round(Math.max(w, h) * 0.08);
      c.width = w + pad * 2;
      c.height = h + pad * 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, pad, pad, w, h);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const result = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      return result && result.data ? result.data.trim() : null;
    };
    for (const max of [1200, 800, 500]) {
      const hit = read(0, 0, iw, ih, max, false);
      if (hit) return hit;
    }
    if (!thorough) return null;
    const big = read(0, 0, iw, ih, 2400, false);
    if (big) return big;
    for (const n of [2, 3]) {
      const cw = Math.ceil((iw / n) * 1.3);
      const ch = Math.ceil((ih / n) * 1.3);
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const sx = Math.max(0, Math.min(iw - cw, Math.round((iw * gx) / n - (cw - iw / n) / 2)));
          const sy = Math.max(0, Math.min(ih - ch, Math.round((ih * gy) / n - (ch - ih / n) / 2)));
          const hit = read(sx, sy, Math.min(cw, iw), Math.min(ch, ih), 1000, true);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  function renderToCanvas(canvas, text, size = 220) {
    return new Promise((resolve, reject) => {
      if (!window.QRCode || typeof QRCode.toCanvas !== 'function') {
        reject(new Error('QRCode 라이브러리 없음'));
        return;
      }
      QRCode.toCanvas(
        canvas,
        text,
        { width: size, margin: 2, color: { dark: '#111111', light: '#ffffff' }, errorCorrectionLevel: 'M' },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  function downloadCanvas(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  }

  return { scanVideo, decodeImage, renderToCanvas, downloadCanvas };
})();

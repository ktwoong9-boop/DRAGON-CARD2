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

  /** 이미지 URL 에서 QR 문자열을 읽습니다. 못 읽으면 null */
  async function decodeImage(url) {
    if (typeof jsQR !== 'function') return null;
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    for (const max of [1200, 800, 500]) {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s);
      const h = Math.round(img.naturalHeight * s);
      const pad = Math.round(Math.max(w, h) * 0.08);
      c.width = w + pad * 2;
      c.height = h + pad * 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, pad, pad, w, h);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const result = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      if (result && result.data) return result.data.trim();
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

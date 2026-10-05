/**
 * 스프라이트 엔진
 * - 시트: 격자(cols × rows)에서 동작별 프레임 수만큼 행 우선으로 잘라 씁니다.
 * - 배경 제거: 테두리에서 이어진 흰색/검은색 영역만 투명 처리합니다.
 * - 기본 방향은 왼쪽. flip=true 이면 오른쪽을 봅니다.
 * - 동작 시트가 없으면 대기 시트(없으면 기본 캐릭터)로 그리고, 특수능력은 금빛 효과를 더합니다.
 * - 시트가 하나도 없으면 카드 이미지(또는 token)를 코드 연출로 움직입니다.
 */
const Sprite = (() => {
  const cache = new Map();
  const actors = new Set();
  let fps = 10;
  let tokenScale = 1;
  let rafId = null;
  let last = 0;
  let frozenUntil = 0;

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`이미지 로드 실패: ${url}`));
      img.src = url;
    });
  }

  function removeBackground(g, w, h, mode) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const isBg =
      mode === 'white'
        ? (i) => d[i] >= 222 && d[i + 1] >= 222 && d[i + 2] >= 222
        : (i) => d[i] <= 26 && d[i + 1] <= 26 && d[i + 2] <= 26;
    const nearBg =
      mode === 'white'
        ? (i) => Math.min(d[i], d[i + 1], d[i + 2]) >= 175
        : (i) => Math.max(d[i], d[i + 1], d[i + 2]) <= 70;
    const seen = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const push = (p) => {
      if (!seen[p]) {
        seen[p] = 1;
        queue[tail++] = p;
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const p = queue[head++];
      const i = p * 4;
      if (d[i + 3] !== 0 && !isBg(i)) continue;
      d[i + 3] = 0;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (d[i + 3] === 0 || !nearBg(i)) continue;
      const x = p % w;
      const edge =
        (x > 0 && d[i - 1] === 0) || (x < w - 1 && d[i + 7] === 0) || (p >= w && d[i - w * 4 + 3] === 0) || (p < w * (h - 1) && d[i + w * 4 + 3] === 0);
      if (edge) d[i + 3] = 110;
    }
    g.putImageData(img, 0, 0);
  }

  /** 시트 → { frames: canvas[], w, h } */
  function loadSheet(sheet, frameCount) {
    const key = [sheet.src, sheet.cols, sheet.rows, sheet.bg, frameCount].join('|');
    if (!cache.has(key)) {
      cache.set(
        key,
        (async () => {
          const url = await Store.mediaUrl(sheet.src);
          const img = await loadImage(url);
          const cw = Math.floor(img.naturalWidth / sheet.cols);
          const ch = Math.floor(img.naturalHeight / sheet.rows);
          const total = Math.min(frameCount, sheet.cols * sheet.rows);
          const frames = [];
          for (let i = 0; i < total; i++) {
            const cx = i % sheet.cols;
            const cy = Math.floor(i / sheet.cols);
            const c = document.createElement('canvas');
            c.width = cw;
            c.height = ch;
            const g = c.getContext('2d', { willReadFrequently: sheet.bg !== 'none' });
            g.drawImage(img, cx * cw, cy * ch, cw, ch, 0, 0, cw, ch);
            if (sheet.bg !== 'none') removeBackground(g, cw, ch, sheet.bg);
            frames.push(c);
          }
          return { frames, w: cw, h: ch };
        })().catch((e) => {
          cache.delete(key);
          throw e;
        })
      );
    }
    return cache.get(key);
  }

  function clearCache() {
    cache.clear();
  }

  class Actor {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sheets = {};
      this.fallback = null;
      this.fbScale = 1;
      this.fbOffsetY = 0;
      this.fbFlip = false;
      this.anim = 'idle';
      this.frame = 0;
      this.acc = 0;
      this.t0 = performance.now();
      this.active = true;
      this.flip = false;
      this.done = null;
      this.onImpact = null;
      this.impactFrame = -1;
      this.dirty = true;
      this.loop = false;
      actors.add(this);
      ensureLoop();
    }

    /** card.sprites 를 읽어 시트를 준비합니다. 실패한 동작은 건너뜁니다. */
    async setCard(card) {
      this.sheets = {};
      const tasks = Store.ACTIONS.map(async (a) => {
        const s = card && card.sprites && card.sprites[a];
        if (!s) return;
        try {
          const loaded = await loadSheet(s, Store.ACTION_FRAMES[a]);
          this.sheets[a] = { ...loaded, scale: s.scale, offsetY: s.offsetY, flip: !!s.flip };
        } catch (e) {
          console.warn(e);
        }
      });
      this.setFallbackTransform(card && card.tokenScale, card && card.tokenOffsetY, card && card.tokenFlip);
      const fbRef = (card && (card.token || card.image)) || null;
      tasks.push(
        (async () => {
          try {
            this.fallback = fbRef ? await loadImage(await Store.mediaUrl(fbRef)) : null;
          } catch (_) {
            this.fallback = null;
          }
        })()
      );
      await Promise.all(tasks);
      this.dirty = true;
    }

    /** 스프라이트 시트가 없을 때 쓰는 기본 이미지의 크기·세로 위치·원본 반전 */
    setFallbackTransform(scale, offsetY, flip) {
      this.fbScale = Number(scale) > 0 ? Number(scale) : 1;
      this.fbOffsetY = Number(offsetY) || 0;
      this.fbFlip = !!flip;
      this.dirty = true;
    }

    /** 미리보기용: 단일 시트를 특정 동작으로 지정 */
    setSheet(action, loaded, sheet) {
      if (loaded) this.sheets[action] = { ...loaded, scale: sheet.scale, offsetY: sheet.offsetY, flip: !!sheet.flip };
      else delete this.sheets[action];
      this.dirty = true;
    }

    sheetFor(anim) {
      return this.sheets[anim] || null;
    }

    frameCount(anim) {
      const s = this.sheetFor(anim);
      return s ? s.frames.length : Store.ACTION_FRAMES[anim];
    }

    /** 동작 재생. loop=false 면 끝난 뒤 대기 동작으로 돌아가고 Promise 가 풀립니다. */
    play(anim, opts = {}) {
      if (this.done) this.done();
      this.anim = anim;
      this.frame = 0;
      this.acc = 0;
      this.t0 = performance.now();
      this.loop = !!opts.loop;
      this.onImpact = opts.onImpact || null;
      const n = this.frameCount(anim);
      this.impactFrame = opts.onImpact ? Math.max(0, Math.min(n - 1, Math.floor(n * (opts.impactAt ?? 0.5)))) : -1;
      this.dirty = true;
      clearTimeout(this.safety);
      if (this.loop || anim === 'idle') {
        this.done = null;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        this.done = () => {
          clearTimeout(this.safety);
          this.done = null;
          resolve();
        };
        this.safety = setTimeout(() => this.forceFinish(), (n * 1000) / fps + 800);
      });
    }

    /** 화면이 숨겨져 rAF 가 멈춰도 게임 진행이 막히지 않도록 */
    forceFinish() {
      if (this.onImpact) {
        const fn = this.onImpact;
        this.onImpact = null;
        fn();
      }
      this.anim = 'idle';
      this.frame = 0;
      this.dirty = true;
      if (this.done) this.done();
    }

    setActive(active) {
      if (this.active === active) return;
      this.active = active;
      this.dirty = true;
    }

    setFlip(flip) {
      if (this.flip === flip) return;
      this.flip = flip;
      this.dirty = true;
    }

    destroy() {
      actors.delete(this);
      clearTimeout(this.safety);
      if (this.done) this.done();
    }

    tick(dt) {
      const moving = this.anim !== 'idle' || this.loop || this.active;
      if (!moving) return;
      const n = this.frameCount(this.anim);
      this.acc += dt;
      const step = 1000 / fps;
      while (this.acc >= step) {
        this.acc -= step;
        this.frame += 1;
        this.dirty = true;
        if (this.frame === this.impactFrame && this.onImpact) {
          const fn = this.onImpact;
          this.onImpact = null;
          fn();
        }
        if (this.frame >= n) {
          if (this.anim === 'idle' || this.loop) {
            this.frame = 0;
          } else {
            if (this.onImpact) {
              const fn = this.onImpact;
              this.onImpact = null;
              fn();
            }
            this.anim = 'idle';
            this.frame = 0;
            if (this.done) this.done();
          }
        }
      }
      if (!this.sheetFor(this.anim)) this.dirty = true;
    }

    draw(now) {
      if (!this.dirty) return;
      this.dirty = false;
      const { ctx, canvas } = this;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      const sheet = this.sheetFor(this.anim) || (this.anim === 'idle' ? null : this.sheets.idle);
      const srcFlip = sheet ? !!sheet.flip : this.fbFlip;
      if (this.flip !== srcFlip) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      if (sheet) {
        const standIn = this.anim === 'special' && !this.sheets.special;
        const p = Math.min(1, (this.frame + this.acc / (1000 / fps)) / this.frameCount(this.anim));
        const glow = standIn ? Math.sin(Math.PI * p) : 0;
        const idx = this.anim === 'idle' && !this.active ? 0 : this.frame % sheet.frames.length;
        const f = sheet.frames[idx];
        const s = Math.min(W / sheet.w, H / sheet.h) * (sheet.scale || 1);
        const dw = sheet.w * s;
        const dh = sheet.h * s;
        if (standIn) {
          ctx.shadowColor = 'rgba(255,215,100,0.95)';
          ctx.shadowBlur = 40 * glow;
        }
        ctx.drawImage(f, (W - dw) / 2, H - dh - (sheet.offsetY || 0) * H - glow * H * 0.05, dw, dh);
        if (this.anim === 'hit' && this.frame < 2) this.tint('rgba(255,40,40,0.35)');
        if (standIn) this.tint(`rgba(255,230,140,${0.25 * glow})`);
      } else if (this.fallback) {
        this.drawFallback(now, W, H);
      }
      ctx.restore();
    }

    tint(color) {
      const { ctx, canvas } = this;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    drawFallback(now, W, H) {
      const { ctx } = this;
      const img = this.fallback;
      const n = this.frameCount(this.anim);
      const p = Math.min(1, (this.frame + this.acc / (1000 / fps)) / n);
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight) * this.fbScale * tokenScale;
      const baseY = H - this.fbOffsetY * H;
      let dw = img.naturalWidth * s;
      let dh = img.naturalHeight * s;
      let dx = (W - dw) / 2;
      let dy = baseY - dh;
      if (this.anim === 'idle' && this.active) {
        dy += Math.sin((now - this.t0) / 380) * H * 0.012;
      } else if (this.anim === 'attack') {
        const k = Math.sin(Math.PI * p);
        dx -= k * W * 0.08 * (this.fbFlip ? -1 : 1);
        dh *= 1 + 0.05 * k;
        dy = baseY - dh;
      } else if (this.anim === 'hit') {
        dx += Math.sin(p * 40) * W * 0.03 * (1 - p);
      } else if (this.anim === 'special') {
        ctx.shadowColor = 'rgba(255,215,100,0.95)';
        ctx.shadowBlur = 40 * Math.sin(Math.PI * p);
        dy -= Math.sin(Math.PI * p) * H * 0.05;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
      if (this.anim === 'hit') this.tint(`rgba(255,40,40,${0.45 * (1 - p)})`);
      if (this.anim === 'special') this.tint(`rgba(255,230,140,${0.25 * Math.sin(Math.PI * p)})`);
    }
  }

  function frameLoop(now) {
    const dt = Math.min(100, now - (last || now));
    last = now;
    const frozen = now < frozenUntil;
    actors.forEach((a) => {
      if (!frozen) a.tick(dt);
      a.draw(now);
    });
    rafId = actors.size ? requestAnimationFrame(frameLoop) : null;
    if (!rafId) last = 0;
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(frameLoop);
  }

  return {
    Actor,
    loadSheet,
    clearCache,
    setFps: (v) => (fps = Math.min(30, Math.max(2, Number(v) || 10))),
    getFps: () => fps,
    setTokenScale: (v) => {
      tokenScale = Math.min(2, Math.max(0.4, Number(v) || 1));
      actors.forEach((a) => (a.dirty = true));
    },
    getTokenScale: () => tokenScale,
    /** 타격 순간 모든 동작을 잠깐 멈춥니다 (히트스톱) */
    hitStop: (ms) => {
      frozenUntil = Math.max(frozenUntil, performance.now() + Math.max(0, Number(ms) || 0));
    },
  };
})();

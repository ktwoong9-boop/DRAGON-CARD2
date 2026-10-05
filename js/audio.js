const AudioKit = (() => {
  let ctx = null;
  const bgm = {
    main: new Audio('assets/audio/bgm-main.mp3'),
    strategy: new Audio('assets/audio/bgm-strategy.mp3'),
  };
  const BASE_VOLUME = { main: 0.35, strategy: 0.225 };
  Object.entries(bgm).forEach(([k, a]) => {
    a.loop = true;
    a.volume = BASE_VOLUME[k];
  });

  const SFX_GAIN = 2.0;
  let duckDepth = 0;

  function duckBgm(targetVol = 0.035) {
    duckDepth += 1;
    Object.values(bgm).forEach((a) => (a.volume = Math.min(a.volume, targetVol)));
  }

  function restoreBgm() {
    if (duckDepth <= 0) return;
    duckDepth -= 1;
    if (duckDepth === 0) Object.entries(bgm).forEach(([k, a]) => (a.volume = BASE_VOLUME[k]));
  }

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function playBgm(which) {
    ensureCtx();
    const target = bgm[which];
    Object.entries(bgm).forEach(([k, a]) => {
      if (k !== which) {
        a.pause();
        a.currentTime = 0;
      }
    });
    if (!target || !target.paused) return;
    try {
      await target.play();
    } catch (_) {
      /* 사용자 입력 전 자동재생 차단 */
    }
  }

  function stopBgm() {
    Object.values(bgm).forEach((a) => {
      a.pause();
      a.currentTime = 0;
    });
  }

  function tone(freq, dur = 0.12, type = 'sawtooth', gain = 0.08, slideTo = null) {
    const c = ensureCtx();
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(Math.min(0.48, gain * SFX_GAIN), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.15, gain = 0.1, freq = 900) {
    const c = ensureCtx();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    src.buffer = buf;
    g.gain.value = Math.min(0.55, gain * SFX_GAIN);
    src.connect(f);
    f.connect(g);
    g.connect(c.destination);
    src.start();
  }

  function heavyImpact(strength = 1) {
    tone(70 * strength, 0.28, 'sawtooth', 0.16 * strength, 28);
    tone(110, 0.18, 'square', 0.09 * strength, 40);
    noiseBurst(0.22, 0.2 * strength, 500);
    setTimeout(() => noiseBurst(0.18, 0.14 * strength, 1200), 40);
    setTimeout(() => tone(320, 0.2, 'triangle', 0.06 * strength, 90), 90);
  }

  function sfx(name) {
    try {
      ensureCtx();
    } catch (_) {
      return;
    }
    switch (name) {
      case 'hit':
        noiseBurst(0.2, 0.28, 620);
        tone(125, 0.28, 'sawtooth', 0.22, 45);
        setTimeout(() => noiseBurst(0.14, 0.2, 380), 35);
        break;
      case 'crit':
        heavyImpact(1.15);
        setTimeout(() => {
          tone(520, 0.15, 'square', 0.08);
          tone(780, 0.22, 'triangle', 0.07);
        }, 100);
        break;
      case 'debuff':
        tone(420, 0.25, 'sawtooth', 0.07, 140);
        setTimeout(() => noiseBurst(0.18, 0.12, 300), 60);
        break;
      case 'buff':
        [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.05), i * 60));
        break;
      case 'heal':
        tone(392, 0.12, 'sine', 0.05);
        setTimeout(() => tone(523, 0.14, 'sine', 0.055), 70);
        setTimeout(() => tone(659, 0.2, 'triangle', 0.06), 150);
        setTimeout(() => tone(784, 0.22, 'sine', 0.04), 240);
        break;
      case 'summon':
        tone(196, 0.3, 'sawtooth', 0.06, 392);
        setTimeout(() => tone(784, 0.25, 'triangle', 0.06), 200);
        break;
      case 'death':
        tone(220, 0.5, 'sawtooth', 0.09, 50);
        setTimeout(() => noiseBurst(0.35, 0.15, 250), 80);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.08), i * 120));
        break;
      case 'error':
        tone(180, 0.18, 'square', 0.05);
        break;
      case 'ui':
        tone(660, 0.06, 'sine', 0.04);
        break;
      default:
        break;
    }
  }

  return { playBgm, stopBgm, sfx, ensureCtx, duckBgm, restoreBgm };
})();

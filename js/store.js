/**
 * 콘텐츠 저장소
 * - 배포본: js/content-data.js(window.__CONTENT__) → 없으면 assets/content/content.json
 * - 로컬 편집본: 설정에서 수정하면 IndexedDB 에 저장되어 배포본보다 우선합니다.
 * - 미디어 경로: 'assets/...' 는 그대로, 'idb:키' 는 IndexedDB Blob 을 가리킵니다.
 */
const Store = (() => {
  const PLAY_ONLY = !!(window.DCB_BUILD && window.DCB_BUILD.playOnly);
  const GRADES = ['초급', '중급', '고급', '레어', '레전더스 레어'];
  const ACTIONS = ['idle', 'attack', 'hit', 'special'];
  const ACTION_LABEL = { idle: '대기', attack: '공격', hit: '피격', special: '특수능력' };
  const ACTION_FRAMES = { idle: 4, attack: 8, hit: 6, special: 8 };
  const TARGETS = {
    self: '본인',
    ally1: '지정 아군(1)',
    enemy1: '지정 적군(1)',
    allyAll: '아군 전체',
    enemyAll: '적군 전체',
  };
  const DURATIONS = [
    { v: 'perm', label: '계속' },
    { v: 1, label: '1턴' },
    { v: 2, label: '2턴' },
    { v: 3, label: '3턴' },
  ];
  const COOLDOWNS = [1, 2, 3, 4, 5];
  const PASSWORD = '9466';
  const QR_DRAGON = 'DCB1:';
  const QR_MAGIC = 'DCB2:M:';

  const DEFAULT_SETTINGS = {
    spriteFps: 10,
    tokenScale: 1,
    battleFx: 'normal',
    summonLimit: { 고급: 2, 레어: 1, '레전더스 레어': 1 },
    summonCost: { 초급: 1, 중급: 2, 고급: 3, 레어: 4, '레전더스 레어': 5 },
    magicCost: { 초급: 1, 중급: 2, 고급: 3, 레어: 4, '레전더스 레어': 5 },
    defaultMove: { 초급: 3, 중급: 3, 고급: 2, 레어: 2, '레전더스 레어': 2 },
  };

  let base = null;
  let content = null;
  let usingLocal = false;
  let localBaseVersion = null;
  let readyPromise = null;
  const urlCache = new Map();
  const listeners = new Set();

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function emptyMod() {
    return { atk: 0, def: 0, hp: 0, move: 0 };
  }

  function normalizeEffect(e, withCooldown) {
    if (!e) return null;
    const out = {
      target: TARGETS[e.target] ? e.target : 'self',
      mod: { ...emptyMod(), ...(e.mod || {}) },
      duration: e.duration === 'perm' ? 'perm' : Math.min(3, Math.max(1, Number(e.duration) || 1)),
    };
    Object.keys(out.mod).forEach((k) => (out.mod[k] = Math.trunc(Number(out.mod[k]) || 0)));
    if (withCooldown) {
      out.name = String(e.name || '').trim() || '특수능력';
      out.cooldown = Math.min(5, Math.max(1, Number(e.cooldown) || 1));
    }
    return out;
  }

  function normalizeSheet(s) {
    if (!s || !s.src) return null;
    return {
      src: s.src,
      cols: Math.max(1, Number(s.cols) || 1),
      rows: Math.max(1, Number(s.rows) || 1),
      bg: ['none', 'white', 'black'].includes(s.bg) ? s.bg : 'none',
      scale: Number(s.scale) > 0 ? Number(s.scale) : 1,
      offsetY: Number(s.offsetY) || 0,
      flip: !!s.flip,
    };
  }

  function normalizeDragon(d) {
    const out = {
      id: String(d.id),
      name: String(d.name || '').trim() || '이름 없음',
      grade: GRADES.includes(d.grade) ? d.grade : '초급',
      atk: Math.max(0, Math.trunc(Number(d.atk) || 0)),
      def: Math.max(0, Math.trunc(Number(d.def) || 0)),
      hp: Math.max(1, Math.trunc(Number(d.hp) || 1)),
      move: [1, 2, 3].includes(Number(d.move)) ? Number(d.move) : null,
      image: d.image || null,
      introVideo: d.introVideo || null,
      token: d.token || null,
      tokenScale: Number(d.tokenScale) > 0 ? Math.min(2, Math.max(0.4, Number(d.tokenScale))) : 1,
      tokenOffsetY: Math.min(0.4, Math.max(-0.4, Number(d.tokenOffsetY) || 0)),
      tokenFlip: !!d.tokenFlip,
      qrImage: d.qrImage || null,
      qrCode: d.qrCode ? String(d.qrCode).trim() : null,
      sprites: {},
      ability: d.ability ? normalizeEffect(d.ability, true) : null,
    };
    ACTIONS.forEach((a) => {
      const s = normalizeSheet(d.sprites && d.sprites[a]);
      if (s) out.sprites[a] = s;
    });
    return out;
  }

  function normalizeMagic(m) {
    return {
      id: String(m.id),
      name: String(m.name || '').trim() || '이름 없음',
      grade: GRADES.includes(m.grade) ? m.grade : '초급',
      image: m.image || null,
      introVideo: m.introVideo || null,
      qrImage: m.qrImage || null,
      qrCode: m.qrCode ? String(m.qrCode).trim() : null,
      effect: normalizeEffect(m.effect || { target: 'enemy1', mod: { hp: -30 } }, false),
    };
  }

  /** 등급별 최대 소환 횟수 (0 = 제한 없음) */
  function normalizeLimits(raw) {
    const out = {};
    for (const g of Object.keys(DEFAULT_SETTINGS.summonLimit)) {
      const v = raw && raw[g] !== undefined ? Number(raw[g]) : DEFAULT_SETTINGS.summonLimit[g];
      out[g] = Math.min(10, Math.max(0, Math.trunc(v) || 0));
    }
    return out;
  }

  function normalizeContent(raw) {
    const c = raw || {};
    const s = c.settings || {};
    return {
      version: Number(c.version) || 1,
      settings: {
        spriteFps: Math.min(30, Math.max(2, Number(s.spriteFps) || DEFAULT_SETTINGS.spriteFps)),
        tokenScale: Math.min(2, Math.max(0.4, Number(s.tokenScale) || DEFAULT_SETTINGS.tokenScale)),
        battleFx: ['off', 'weak', 'normal', 'strong'].includes(s.battleFx) ? s.battleFx : DEFAULT_SETTINGS.battleFx,
        summonLimit: normalizeLimits(s.summonLimit),
        summonCost: { ...DEFAULT_SETTINGS.summonCost, ...(s.summonCost || {}) },
        magicCost: { ...DEFAULT_SETTINGS.magicCost, ...(s.magicCost || {}) },
        defaultMove: { ...DEFAULT_SETTINGS.defaultMove, ...(s.defaultMove || {}) },
      },
      dragons: (c.dragons || []).map(normalizeDragon),
      magics: (c.magics || []).map(normalizeMagic),
    };
  }

  async function loadBase() {
    if (window.__CONTENT__) return window.__CONTENT__;
    const res = await fetch('assets/content/content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`content.json HTTP ${res.status}`);
    return res.json();
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        base = normalizeContent(await loadBase());
        let local = null;
        if (!PLAY_ONLY) {
          try {
            local = await DB.get('kv', 'content');
          } catch (e) {
            console.warn('[Store] IndexedDB 사용 불가', e);
          }
        }
        if (local && local.content) {
          content = normalizeContent(local.content);
          usingLocal = true;
          localBaseVersion = local.baseVersion || 0;
        } else {
          content = clone(base);
          usingLocal = false;
        }
      })();
    }
    return readyPromise;
  }

  async function persist() {
    if (PLAY_ONLY) throw new Error('태블릿용 배포본에서는 저장할 수 없습니다.');
    await DB.put('kv', 'content', { baseVersion: base.version, content, savedAt: Date.now() });
    usingLocal = true;
    localBaseVersion = base.version;
    listeners.forEach((fn) => fn());
  }

  async function resetToBase() {
    await DB.del('kv', 'content');
    content = clone(base);
    usingLocal = false;
    localBaseVersion = null;
    listeners.forEach((fn) => fn());
  }

  async function importContent(raw) {
    content = normalizeContent(raw);
    await persist();
  }

  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function normalizeName(s) {
    return String(s || '')
      .replace(/\s+/g, '')
      .replace(/드레곤/g, '드래곤')
      .toLowerCase();
  }

  // ---------- 조회 ----------
  const dragons = () => content.dragons;
  const magics = () => content.magics;
  const getDragon = (id) => content.dragons.find((d) => d.id === id) || null;
  const getMagic = (id) => content.magics.find((m) => m.id === id) || null;
  const settings = () => content.settings;

  function search(query, type) {
    const q = normalizeName(query);
    if (!q) return [];
    const list = type === 'magic' ? content.magics : content.dragons;
    return list.filter((c) => normalizeName(c.name).includes(q)).slice(0, 12);
  }

  function moveOf(card) {
    if (card && [1, 2, 3].includes(Number(card.move))) return Number(card.move);
    return content.settings.defaultMove[card && card.grade] || 2;
  }

  function summonCost(grade) {
    return Number(content.settings.summonCost[grade]) || 1;
  }

  function summonLimit(grade) {
    return Number(content.settings.summonLimit[grade]) || 0;
  }

  function magicCost(grade) {
    return Number(content.settings.magicCost[grade]) || 1;
  }

  function qrPayload(type, card) {
    return (type === 'magic' ? QR_MAGIC : QR_DRAGON) + card.id;
  }

  /** 드래곤 카드용 새 고유 QR 문자열 */
  function newDragonQR(card) {
    return `DCB2:D:${card.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /** QR 문자열 → { type: 'dragon'|'magic', card } */
  function parseQR(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const dragonByCode = content.dragons.find((c) => c.qrCode && c.qrCode === text);
    if (dragonByCode) return { type: 'dragon', card: dragonByCode };
    const byCode = content.magics.find((c) => c.qrCode && c.qrCode === text);
    if (byCode) return { type: 'magic', card: byCode };
    if (text.startsWith(QR_MAGIC)) {
      const m = getMagic(text.slice(QR_MAGIC.length).trim());
      return m ? { type: 'magic', card: m } : null;
    }
    if (text.startsWith('DCB2:D:')) {
      const d = getDragon(text.slice(7).trim());
      return d ? { type: 'dragon', card: d } : null;
    }
    if (text.startsWith(QR_DRAGON)) {
      const d = getDragon(text.slice(QR_DRAGON.length).trim());
      return d ? { type: 'dragon', card: d } : null;
    }
    const n = normalizeName(text);
    const d = content.dragons.find((c) => normalizeName(c.name) === n);
    if (d) return { type: 'dragon', card: d };
    const m = content.magics.find((c) => normalizeName(c.name) === n);
    return m ? { type: 'magic', card: m } : null;
  }

  // ---------- 편집 ----------
  async function upsertDragon(d) {
    const n = normalizeDragon(d);
    const i = content.dragons.findIndex((x) => x.id === n.id);
    if (i >= 0) content.dragons[i] = n;
    else content.dragons.push(n);
    await persist();
    return n;
  }

  async function deleteDragon(id) {
    content.dragons = content.dragons.filter((d) => d.id !== id);
    await persist();
  }

  async function upsertMagic(m) {
    const n = normalizeMagic(m);
    const i = content.magics.findIndex((x) => x.id === n.id);
    if (i >= 0) content.magics[i] = n;
    else content.magics.push(n);
    await persist();
    return n;
  }

  async function deleteMagic(id) {
    content.magics = content.magics.filter((m) => m.id !== id);
    await persist();
  }

  async function updateSettings(patch) {
    content.settings = normalizeContent({ settings: { ...content.settings, ...patch } }).settings;
    await persist();
  }

  // ---------- 미디어 ----------
  async function putFile(blob) {
    const key = newId('f');
    await DB.put('files', key, blob);
    return `idb:${key}`;
  }

  async function getFileBlob(ref) {
    if (!ref || !String(ref).startsWith('idb:')) return null;
    return DB.get('files', ref.slice(4));
  }

  /** 미디어 참조 → 브라우저에서 쓸 수 있는 URL */
  async function mediaUrl(ref) {
    if (!ref) return null;
    const s = String(ref);
    if (!s.startsWith('idb:')) return s;
    if (urlCache.has(s)) return urlCache.get(s);
    const blob = await getFileBlob(s);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(s, url);
    return url;
  }

  function extOf(blob, fallback) {
    const t = (blob && blob.type) || '';
    if (t.includes('png')) return 'png';
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
    if (t.includes('webp')) return 'webp';
    if (t.includes('gif')) return 'gif';
    if (t.includes('mp4')) return 'mp4';
    if (t.includes('webm')) return 'webm';
    return fallback;
  }

  /** 로컬 편집본 → 배포용 ZIP (content.json + js/content-data.js + 새 미디어 파일) */
  async function exportZip() {
    const out = clone(content);
    out.version = Math.max(base.version, content.version) + 1;
    const files = [];

    async function take(ref, folder, name, fallbackExt) {
      if (!ref || !String(ref).startsWith('idb:')) return ref;
      const blob = await getFileBlob(ref);
      if (!blob) return null;
      const path = `assets/content/${folder}/${name}.${extOf(blob, fallbackExt)}`;
      files.push({ name: path, data: blob });
      return path;
    }

    for (const d of out.dragons) {
      d.image = await take(d.image, 'images', d.id, 'png');
      d.introVideo = await take(d.introVideo, 'intros', d.id, 'mp4');
      d.token = await take(d.token, 'sprites', d.id, 'png');
      d.qrImage = await take(d.qrImage, 'qr', `dragon_${d.id}`, 'png');
      for (const a of ACTIONS) {
        if (d.sprites[a]) d.sprites[a].src = await take(d.sprites[a].src, 'sheets', `${d.id}_${a}`, 'png');
      }
    }
    for (const m of out.magics) {
      m.image = await take(m.image, 'magic', m.id, 'png');
      m.introVideo = await take(m.introVideo, 'intros', m.id, 'mp4');
      m.qrImage = await take(m.qrImage, 'qr', m.id, 'png');
    }

    const json = JSON.stringify(out, null, 2);
    files.push({ name: 'assets/content/content.json', data: json });
    files.push({ name: 'js/content-data.js', data: `window.__CONTENT__ = ${JSON.stringify(out)};\n` });
    return { blob: await Zip.build(files), version: out.version, count: files.length };
  }

  function status() {
    return {
      baseVersion: base ? base.version : null,
      usingLocal,
      localBaseVersion,
      baseIsNewer: usingLocal && base && localBaseVersion != null && base.version > localBaseVersion,
    };
  }

  return {
    GRADES,
    ACTIONS,
    ACTION_LABEL,
    ACTION_FRAMES,
    TARGETS,
    DURATIONS,
    COOLDOWNS,
    PASSWORD,
    ready,
    dragons,
    magics,
    getDragon,
    getMagic,
    settings,
    search,
    moveOf,
    summonCost,
    summonLimit,
    magicCost,
    qrPayload,
    newDragonQR,
    parseQR,
    newId,
    emptyMod,
    upsertDragon,
    deleteDragon,
    upsertMagic,
    deleteMagic,
    updateSettings,
    putFile,
    mediaUrl,
    exportZip,
    importContent,
    resetToBase,
    status,
    onChange: (fn) => listeners.add(fn),
  };
})();

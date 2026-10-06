/** 시즌2 전투 — 7×4 육각 보드 */
const Game = (() => {
  const { COLS, ROWS, key } = Rules;
  const BACKGROUNDS = ['assets/bg/bg-field.png', 'assets/bg/bg-desert.png', 'assets/bg/bg-volcano.png'];
  const R = 88;
  const HEX_W = 2 * R;
  const HEX_H = Math.sqrt(3) * R;
  const SQUASH = 0.6;
  const FAR_SCALE = 0.88;
  const THICK = 12;
  const TOP_PAD = 2.1 * R;
  const MAX_H = ROWS - 0.5;
  const BOARD_W = 1.5 * R * (COLS - 1) + HEX_W;
  const GRADE_SCALE = { 초급: 0.92, 중급: 1, 고급: 1.08, 레어: 1.16, '레전더스 레어': 1.24 };
  const SIDE_NAME = { p1: '1P', p2: '2P' };
  const LIMIT_LABEL = { '레전더스 레어': '레전더스' };
  const GALLERY_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M5 17l4.5-4.5 3 3 2.5-2.5L19 17z" fill="currentColor"/></svg>';

  let S = null;
  let hooks = {};
  let bound = false;
  const views = new Map();
  let layers = null;

  // ---------- 좌표/조회 ----------
  /** 눕힌 보드: 세로를 눌러 그리고, 뒤(위) 행일수록 작게 그립니다. s 는 원근 배율 */
  function center(col, row) {
    const h = row + (col & 1 ? 0.5 : 0);
    const s = FAR_SCALE + (1 - FAR_SCALE) * (h / MAX_H);
    const rowY = 0.5 + FAR_SCALE * h + ((1 - FAR_SCALE) * h * h) / (2 * MAX_H);
    return {
      x: BOARD_W / 2 + (col - (COLS - 1) / 2) * 1.5 * R * s,
      y: TOP_PAD + HEX_H * SQUASH * rowY,
      s,
    };
  }

  const BOARD_H = center(1, ROWS - 1).y + (HEX_H * SQUASH) / 2 + THICK + 4;

  const alive = () => S.units.filter((u) => u.hp > 0);
  /** 연출 도중 게임을 나갔거나 새 게임이 시작됐으면 이전 연출은 멈춥니다 */
  const gone = (st) => S !== st || st.over;
  const unitsOf = (side) => alive().filter((u) => u.side === side);
  const enemiesOf = (side) => unitsOf(Rules.other(side));
  const unitAt = (col, row) => alive().find((u) => u.col === col && u.row === row) || null;
  const byUid = (uid) => alive().find((u) => u.uid === uid) || null;
  const mineAt = (col, row) => S.mines.find((m) => m.col === col && m.row === row) || null;
  const minesOwned = (side) => S.mines.filter((m) => m.owner === side);
  const freeMines = (side) => minesOwned(side).filter((m) => !unitAt(m.col, m.row));
  const isAi = (side) => side === 'p2' && S.aiP2;
  const defaultFlip = (side) => side === 'p1';

  function reachable(u) {
    const mv = Rules.stat(u, 'move');
    const occ = new Set(alive().filter((x) => x.uid !== u.uid).map((x) => key(x.col, x.row)));
    const start = key(u.col, u.row);
    const dist = new Map([[start, 0]]);
    const parent = new Map();
    const q = [{ col: u.col, row: u.row }];
    while (q.length) {
      const cur = q.shift();
      const d0 = dist.get(key(cur.col, cur.row));
      if (d0 >= mv) continue;
      for (const n of Rules.neighbors(cur.col, cur.row)) {
        const k = key(n.col, n.row);
        if (dist.has(k) || occ.has(k)) continue;
        dist.set(k, d0 + 1);
        parent.set(k, cur);
        q.push(n);
      }
    }
    dist.delete(start);
    return {
      cells: [...dist.keys()].map((k) => {
        const [col, row] = k.split(',').map(Number);
        return { col, row, d: dist.get(k) };
      }),
      path(col, row) {
        const out = [];
        let cur = { col, row };
        while (cur && key(cur.col, cur.row) !== start) {
          out.unshift(cur);
          cur = parent.get(key(cur.col, cur.row));
        }
        return out;
      },
    };
  }

  function adjacentEnemies(u, pos = u) {
    return enemiesOf(u.side).filter((e) => Rules.dist(pos, e) === 1);
  }

  function canMove(u) {
    return !u.sick && !u.done && !u.moved && Rules.stat(u, 'move') > 0 && reachable(u).cells.length > 0;
  }

  function canAttack(u) {
    return !u.sick && !u.done && !u.acted && adjacentEnemies(u).length > 0;
  }

  function effectCandidates(effect, side, caster) {
    switch (effect.target) {
      case 'self':
        return caster ? [caster] : unitsOf(side);
      case 'ally1':
      case 'allyAll':
        return unitsOf(side);
      case 'enemy1':
      case 'enemyAll':
        return enemiesOf(side);
      default:
        return [];
    }
  }

  const isSingle = (effect, forMagic) => effect.target === 'ally1' || effect.target === 'enemy1' || (forMagic && effect.target === 'self');

  // ---------- 시작/종료 ----------
  function init(h) {
    hooks = h || {};
  }

  function newState() {
    const player = () => ({ mana: Rules.START_MANA, kills: 0, usedDragons: new Set(), usedMagics: new Set(), gradeSummons: {}, summoned: false, magicUsed: false });
    return {
      mines: Rules.placeMines(),
      units: [],
      uidSeq: 1,
      turn: 'p1',
      turnNo: 0,
      players: { p1: player(), p2: player() },
      aiP2: S ? S.aiP2 : false,
      aiDecks: {},
      mode: 'idle',
      sel: null,
      infoUid: null,
      pending: null,
      busy: false,
      over: false,
      bg: BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)],
    };
  }

  async function start({ intro = true } = {}) {
    bindOnce();
    clearViews();
    S = newState();
    if (S.aiP2) S.aiDecks.p2 = Rules.aiDeck();
    Sprite.setFps(Store.settings().spriteFps);
    Sprite.setTokenScale(Store.settings().tokenScale);
    $('#g-bg').style.backgroundImage = `url('${S.bg}')`;
    $('#result').classList.add('hidden');
    $('#g-banner').classList.add('hidden');
    buildBoard();
    refresh();
    UI.showScreen('screen-game');
    if (intro) await playOpenIntro();
    AudioKit.playBgm('strategy');
    await beginTurn('p1');
  }

  function stop() {
    if (S) S.over = true;
    clearViews();
    AudioKit.stopBgm();
  }

  function clearViews() {
    views.forEach((v) => v.actor.destroy());
    views.clear();
    if (layers) Object.values(layers).forEach((l) => (l.innerHTML = ''));
  }

  function playOpenIntro() {
    const wrap = $('#open-intro');
    const video = $('#open-video');
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        video.pause();
        wrap.classList.add('hidden');
        resolve();
      };
      wrap.classList.remove('hidden');
      video.currentTime = 0;
      video.onended = finish;
      video.onerror = finish;
      $('#open-skip').onclick = finish;
      video.play().catch(finish);
    });
  }

  // ---------- 턴 ----------
  async function beginTurn(side) {
    if (S.over) return;
    const st = S;
    S.turn = side;
    S.turnNo += 1;
    Rules.startTurn(S.units, side);
    const p = S.players[side];
    const gain = minesOwned(side).length;
    p.mana = Math.min(Rules.MAX_MANA, p.mana + gain);
    p.summoned = false;
    p.magicUsed = false;
    setMode('idle');
    refresh();
    await showBanner(`${side === 'p1' ? '1' : '2'}플레이어 턴`, `마나 +${gain}`);
    if (gone(st)) return;
    refresh();
    if (isAi(side)) AI.runTurn(api, side);
  }

  async function showBanner(text, sub) {
    const st = S;
    const el = $('#g-banner');
    $('#g-banner-text').innerHTML = `${UI.esc(text)}${sub ? `<small>${UI.esc(sub)}</small>` : ''}`;
    el.classList.remove('hidden', 'p1', 'p2');
    el.classList.add(S.turn);
    AudioKit.sfx('ui');
    await sleep(1300);
    if (S === st) el.classList.add('hidden');
  }

  function hasIdleUnits(side) {
    return unitsOf(side).some((u) => !Rules.isExhausted(u) && (canMove(u) || canAttack(u) || Rules.abilityReady(u)));
  }

  async function tryEndTurn() {
    if (S.busy || S.over || isAi(S.turn)) return;
    if (hasIdleUnits(S.turn)) {
      const ok = await UI.confirm('아직 행동하지 않은 유닛이 있습니다.\n턴을 종료할까요?', { okText: '턴 종료' });
      if (!ok) return;
    }
    await endTurn();
  }

  async function endTurn() {
    if (S.over) return;
    setMode('idle');
    await beginTurn(Rules.other(S.turn));
  }

  // ---------- 보드 렌더 ----------
  function buildBoard() {
    const board = $('#g-board');
    board.innerHTML = '';
    board.classList.remove('focus');
    board.style.width = `${BOARD_W}px`;
    board.style.height = `${BOARD_H}px`;
    const cam = document.createElement('div');
    cam.className = 'g-cam';
    board.appendChild(cam);
    layers = { cam };
    ['hex', 'unit', 'fx'].forEach((n) => {
      const l = document.createElement('div');
      l.className = `layer layer-${n}`;
      cam.appendChild(l);
      layers[n] = l;
    });
  }

  // ---------- 전투 연출 (줌인 · 주변 어둡게 · 히트스톱) ----------
  const FX_LEVELS = {
    weak: { zoom: 1.15, dim: 0.7, stop: 50 },
    normal: { zoom: 1.3, dim: 0.5, stop: 80 },
    strong: { zoom: 1.45, dim: 0.36, stop: 120 },
  };
  const fxLevel = () => FX_LEVELS[Store.settings().battleFx] || null;

  async function focusOn(units, crit = false) {
    const lv = fxLevel();
    const list = units.filter((u) => u && views.get(u.uid));
    if (!lv || !layers || !list.length) return;
    const pts = list.map((u) => center(u.col, u.row));
    const ox = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const oy = pts.reduce((sum, p) => sum + p.y - 0.9 * R * p.s, 0) / pts.length;
    const board = $('#g-board');
    board.style.setProperty('--fx-dim', lv.dim);
    board.classList.add('focus');
    list.forEach((u) => views.get(u.uid).el.classList.add('focused'));
    layers.cam.style.transformOrigin = `${ox}px ${oy}px`;
    layers.cam.style.transform = `scale(${lv.zoom + (crit ? 0.12 : 0)})`;
    await sleep(260);
  }

  async function focusOff() {
    if (!layers || !$('#g-board').classList.contains('focus')) return;
    $('#g-board').classList.remove('focus');
    $$('.unit.focused', layers.unit).forEach((el) => el.classList.remove('focused'));
    layers.cam.style.transform = '';
    await sleep(260);
  }

  function hitStop(crit) {
    const lv = fxLevel();
    if (lv) Sprite.hitStop(lv.stop * (crit ? 1.6 : 1));
  }

  function highlightSets() {
    const out = { reach: new Set(), attack: new Set(), target: new Set(), summon: new Set() };
    const sel = S.sel && byUid(S.sel);
    if (S.mode === 'move' && sel) reachable(sel).cells.forEach((c) => out.reach.add(key(c.col, c.row)));
    if (S.mode === 'attack' && sel) adjacentEnemies(sel).forEach((e) => out.attack.add(key(e.col, e.row)));
    if (S.mode === 'target' && S.pending) S.pending.candidates.forEach((u) => out.target.add(key(u.col, u.row)));
    if (S.mode === 'summon' && S.pending) freeMines(S.pending.side).forEach((m) => out.summon.add(key(m.col, m.row)));
    return out;
  }

  function renderHexes() {
    const hl = highlightSets();
    const layer = layers.hex;
    layer.innerHTML = '';
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (Rules.inBounds(c, r)) cells.push({ c, r, ...center(c, r) });
      }
    }
    cells.sort((a, b) => a.y - b.y);
    for (const { c, r, x, y, s } of cells) {
      const w = HEX_W * s;
      const h = HEX_H * SQUASH * s;
      const m = mineAt(c, r);
      const ownCls = m ? ` mine ${m.owner ? `own-${m.owner}` : 'own-none'}` : '';

      const side = document.createElement('div');
      side.className = `hex-side${ownCls}`;
      const t = THICK * s;
      Object.assign(side.style, {
        left: `${x - w / 2}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h / 2 + t}px`,
        clipPath: `polygon(0 0, ${w / 4}px ${h / 2}px, ${(3 * w) / 4}px ${h / 2}px, ${w}px 0, ${w}px ${t}px, ${(3 * w) / 4}px ${h / 2 + t}px, ${w / 4}px ${h / 2 + t}px, 0 ${t}px)`,
      });
      layer.appendChild(side);

      const hex = document.createElement('div');
      hex.className = `hex${ownCls}`;
      Object.assign(hex.style, { left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` });
      hex.dataset.col = c;
      hex.dataset.row = r;
      if (m) {
        if (m.home) hex.classList.add('home');
        hex.innerHTML = `<span class="mine-gem">${m.home ? '본진' : '◆'}</span>`;
      }
      const k = key(c, r);
      if (hl.reach.has(k)) hex.classList.add('hl-reach');
      if (hl.attack.has(k)) hex.classList.add('hl-attack');
      if (hl.target.has(k)) hex.classList.add('hl-target');
      if (hl.summon.has(k)) hex.classList.add('hl-summon');
      layer.appendChild(hex);
    }
  }

  function unitBox(u) {
    const gs = GRADE_SCALE[u.grade] || 1;
    const { x, y, s } = center(u.col, u.row);
    const size = 2.8 * R * gs * s;
    return { left: x - size / 2, top: y + 0.14 * R * s - size, size, z: Math.round(y) };
  }

  function ensureView(u) {
    let v = views.get(u.uid);
    if (v) return v;
    const el = document.createElement('div');
    el.className = `unit ${u.side}`;
    el.dataset.uid = u.uid;
    el.innerHTML = `
      <div class="unit-body">
        <div class="unit-ring"></div>
        <canvas></canvas>
      </div>
      <div class="unit-bar"><i></i><b></b></div>
      <div class="unit-buffs"></div>
      ${u.gallery ? `<div class="unit-gallery" title="갤러리에서 불러온 카드">${GALLERY_ICON}</div>` : ''}`;
    const box = unitBox(u);
    const canvas = $('canvas', el);
    canvas.width = Math.round(box.size * 1.5);
    canvas.height = Math.round(box.size * 1.5);
    const actor = new Sprite.Actor(canvas);
    actor.setFlip(defaultFlip(u.side));
    actor.setCard(u.card);
    layers.unit.appendChild(el);
    v = { el, actor };
    views.set(u.uid, v);
    return v;
  }

  function removeView(uid) {
    const v = views.get(uid);
    if (!v) return;
    v.actor.destroy();
    v.el.remove();
    views.delete(uid);
  }

  function renderUnits() {
    for (const u of alive()) {
      const v = ensureView(u);
      const box = unitBox(u);
      Object.assign(v.el.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.size}px`,
        height: `${box.size}px`,
        zIndex: box.z,
      });
      const exhausted = u.done || (u.moved && u.acted);
      const activeTurn = u.side === S.turn;
      v.el.classList.toggle('selected', S.sel === u.uid);
      v.el.classList.toggle('exhausted', activeTurn && exhausted);
      v.el.classList.toggle('targetable', S.mode === 'target' && !!S.pending && S.pending.candidates.includes(u));
      v.actor.setActive(activeTurn && !exhausted);
      $('.unit-bar i', v.el).style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      $('.unit-bar b', v.el).textContent = u.hp;
      $('.unit-buffs', v.el).innerHTML = buffBadges(u);
    }
  }

  function buffBadges(u) {
    const names = { atk: '공', def: '방', move: '이' };
    return ['atk', 'def', 'move']
      .map((k) => {
        const d = Rules.stat(u, k) - u.base[k];
        const raw = u.effects.reduce((a, e) => a + (e.mod[k] || 0), 0);
        const v = raw || d;
        if (!v) return '';
        return `<span class="${v > 0 ? 'up' : 'down'}">${names[k]}${v > 0 ? '+' : ''}${v}</span>`;
      })
      .join('');
  }

  function renderRadial() {
    const old = $('.radial', layers.fx);
    if (old) old.remove();
    const u = S.mode === 'menu' && S.sel && byUid(S.sel);
    if (!u || S.busy || isAi(S.turn)) return;
    const { x, y, s } = center(u.col, u.row);
    const cy = y - 0.95 * R * s;
    const ab = u.card.ability;
    const items = [
      { id: 'move', label: '이동', icon: '➜', ok: canMove(u), ang: -90 },
      { id: 'attack', label: '공격', icon: '⚔', ok: canAttack(u), ang: 0 },
      {
        id: 'special',
        label: ab ? (u.cd > 0 ? `대기 ${u.cd}` : '특수') : '없음',
        icon: '✦',
        ok: Rules.abilityReady(u) && effectCandidates(ab, u.side, u).length > 0,
        ang: 90,
      },
      { id: 'end', label: '종료', icon: '■', ok: !Rules.isExhausted(u), ang: 180 },
    ];
    const wrap = document.createElement('div');
    wrap.className = 'radial';
    wrap.style.left = `${x}px`;
    wrap.style.top = `${cy}px`;
    const rad = 1.25 * R * s;
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `radial-btn r-${it.id}`;
      b.disabled = !it.ok;
      b.innerHTML = `<i>${it.icon}</i><span>${it.label}</span>`;
      const a = (it.ang * Math.PI) / 180;
      b.style.left = `${Math.cos(a) * rad}px`;
      b.style.top = `${Math.sin(a) * rad}px`;
      b.onclick = (e) => {
        e.stopPropagation();
        onRadial(it.id, u);
      };
      wrap.appendChild(b);
    }
    if (u.sick) {
      const note = document.createElement('div');
      note.className = 'radial-note';
      note.textContent = '소환 턴 — 다음 턴부터 행동';
      wrap.appendChild(note);
    }
    layers.fx.appendChild(wrap);
  }

  function renderHud() {
    for (const side of ['p1', 'p2']) {
      const p = S.players[side];
      const gems = [];
      for (let i = 0; i < Rules.MAX_MANA; i++) gems.push(`<i class="${i < p.mana ? 'on' : ''}"></i>`);
      $(`#g-mana-${side}`).innerHTML = `${gems.join('')}<b>${p.mana}</b>`;
      const limits = Store.GRADES.filter((g) => Store.summonLimit(g)).map((g) => {
        const used = p.gradeSummons[g] || 0;
        const max = Store.summonLimit(g);
        return `<span class="${used >= max ? 'full' : ''}">${LIMIT_LABEL[g] || g} <b>${used}</b>/${max}</span>`;
      });
      $(`#g-meta-${side}`).innerHTML =
        `격파 <b>${p.kills}</b>/${Rules.KO_TO_WIN} · 광산 <b>${minesOwned(side).length}</b>/5 · 필드 <b>${unitsOf(side).length}</b>/${Rules.MAX_UNITS}` +
        (limits.length ? `<div class="g-limit">소환 ${limits.join(' · ')}</div>` : '');
      const my = S.turn === side && !S.busy && !S.over && !isAi(side);
      $(`#g-summon-${side}`).disabled = !my || p.summoned;
      $(`#g-magic-${side}`).disabled = !my || p.magicUsed;
      $(`#g-summon-${side}`).classList.toggle('pending', S.mode === 'summon' && S.pending && S.pending.side === side);
    }
    $('#g-name-p2').textContent = S.aiP2 ? '2P (AI)' : '2P';
    $('#g-ai').classList.toggle('on', S.aiP2);
    $('#g-ai').textContent = S.aiP2 ? '2P AI 켜짐' : '2P AI';
    $('#g-turn').textContent = `${SIDE_NAME[S.turn]} 턴`;
    $('#g-turn').className = `g-turn ${S.turn}`;
    $('#g-end').disabled = S.busy || S.over || isAi(S.turn);
    $$('.g-side').forEach((el) => el.classList.toggle('active', el.classList.contains(S.turn)));
  }

  function renderInfo() {
    ['p1', 'p2'].forEach((s) => ($(`#g-info-${s}`).innerHTML = ''));
    const u = byUid(S.infoUid) || byUid(S.sel);
    if (!u) return;
    const row = (k, label) => {
      const cur = Rules.stat(u, k);
      const d = cur - u.base[k];
      return `<div><span>${label}</span><b class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${cur}${d ? ` (${d > 0 ? '+' : ''}${d})` : ''}</b></div>`;
    };
    const ab = u.card.ability;
    const effects = u.effects
      .map((e) => {
        const t = Object.entries(e.mod)
          .map(([k, v]) => `${{ atk: '공', def: '방', move: '이' }[k]}${v > 0 ? '+' : ''}${v}`)
          .join(' ');
        return `<li>${t} · ${e.turns === Infinity ? '계속' : `${e.turns}턴`}</li>`;
      })
      .join('');
    $(`#g-info-${u.side}`).innerHTML = `
      <p class="info-name">${UI.esc(u.name)}</p>
      <p class="info-grade">${UI.esc(u.grade)}${u.gallery ? ` <span class="info-gallery">${GALLERY_ICON} 갤러리</span>` : ''}</p>
      <div class="info-stats">
        <div><span>체력</span><b>${u.hp}/${u.maxHp}</b></div>
        ${row('atk', '공격')}${row('def', '방어')}${row('move', '이동')}
      </div>
      ${
        ab
          ? `<div class="info-ab"><b>✦ ${UI.esc(ab.name)}</b><small>${UI.esc(UI.effectText(ab))}</small><small>쿨타임 ${ab.cooldown}턴${u.cd > 0 ? ` · 남은 ${u.cd}` : ' · 사용 가능'}</small></div>`
          : '<div class="info-ab muted"><small>특수능력 없음</small></div>'
      }
      ${effects ? `<ul class="info-fx">${effects}</ul>` : ''}`;
  }

  function setStatus(text, cancellable) {
    const el = $('#g-status');
    el.innerHTML = text ? `${UI.esc(text)}${cancellable ? ' <button type="button" class="ghost-btn xs" id="g-cancel">취소</button>' : ''}` : '';
    const c = $('#g-cancel');
    if (c) c.onclick = cancelPending;
  }

  function refresh() {
    if (!S || !layers) return;
    renderHexes();
    renderUnits();
    renderRadial();
    renderHud();
    renderInfo();
  }

  function setMode(mode, patch = {}) {
    S.mode = mode;
    Object.assign(S, patch);
    if (mode === 'idle') {
      S.sel = null;
      S.pending = null;
    }
    const texts = {
      idle: '',
      menu: '',
      move: '이동할 칸을 선택하세요',
      attack: '공격할 적을 선택하세요',
      target: '대상을 선택하세요',
      summon: '소환할 광산(빈 칸)을 선택하세요',
    };
    setStatus(texts[mode] || '', ['move', 'attack', 'target', 'summon'].includes(mode));
  }

  function cancelPending() {
    if (S.busy) return;
    const sel = S.sel && byUid(S.sel);
    if ((S.mode === 'move' || S.mode === 'attack') && sel) setMode('menu');
    else if (S.mode === 'target' && S.pending && S.pending.kind === 'ability' && sel) setMode('menu', { pending: null });
    else setMode('idle');
    refresh();
  }

  // ---------- 입력 ----------
  function bindOnce() {
    if (bound) return;
    bound = true;
    $('#g-board').addEventListener('click', onBoardClick);
    $('#g-end').onclick = tryEndTurn;
    $('#g-ai').onclick = toggleAi;
    $('#g-menu').onclick = async () => {
      if (await UI.confirm('게임을 종료하고 메인화면으로 갈까요?')) {
        stop();
        hooks.onExit && hooks.onExit();
      }
    };
    ['p1', 'p2'].forEach((side) => {
      $(`#g-summon-${side}`).onclick = () => requestSummon(side);
      $(`#g-magic-${side}`).onclick = () => requestMagic(side);
    });
    $('#btn-retry').onclick = () => start({ intro: false });
    $('#btn-home').onclick = () => {
      stop();
      hooks.onExit && hooks.onExit();
    };
  }

  function boardPoint(e) {
    const rect = $('#g-board').getBoundingClientRect();
    const s = UI.getScale();
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  }

  /** 캐릭터 그림이 옆 칸을 덮으므로 클릭 좌표로 칸을 계산합니다 */
  function cellFromEvent(e) {
    const { x, y } = boardPoint(e);
    let best = null;
    let bestD = Infinity;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (!Rules.inBounds(c, r)) continue;
        const p = center(c, r);
        const d = Math.hypot((p.x - x) / (R * p.s), (p.y - y) / ((HEX_H / 2) * SQUASH * p.s));
        if (d < bestD) {
          bestD = d;
          best = { col: c, row: r };
        }
      }
    }
    return bestD <= 1.05 ? best : null;
  }

  /** 캔버스 좌표(0~1) 주변에 불투명 픽셀이 있는지. 읽을 수 없으면 몸통 타원으로 판정 */
  function opaqueNear(canvas, fx, fy) {
    const ellipse = () => ((fx - 0.5) / 0.25) ** 2 + ((fy - 0.6) / 0.4) ** 2 <= 1;
    try {
      const r = Math.max(2, Math.round(canvas.width * 0.025));
      const cx = Math.round(fx * canvas.width);
      const cy = Math.round(fy * canvas.height);
      const x0 = Math.max(0, cx - r);
      const y0 = Math.max(0, cy - r);
      const w = Math.min(canvas.width, cx + r + 1) - x0;
      const h = Math.min(canvas.height, cy + r + 1) - y0;
      if (w <= 0 || h <= 0) return false;
      const data = canvas.getContext('2d').getImageData(x0, y0, w, h).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 60) return true;
      return false;
    } catch (_) {
      return ellipse();
    }
  }

  /** 누른 위치에 실제로 그려진 캐릭터 (앞줄 우선, 공격·대상 선택 중에는 고를 수 있는 대상 우선) */
  function unitFromPixels(e) {
    const { x, y } = boardPoint(e);
    const hits = [];
    const units = alive()
      .map((u) => ({ u, box: unitBox(u) }))
      .sort((a, b) => b.box.z - a.box.z);
    for (const { u, box } of units) {
      if (x < box.left || x > box.left + box.size || y < box.top || y > box.top + box.size) continue;
      const v = views.get(u.uid);
      if (!v) continue;
      if (opaqueNear(v.actor.canvas, (x - box.left) / box.size, (y - box.top) / box.size)) hits.push(u);
    }
    if (hits.length < 2) return hits[0] || null;
    let pref = null;
    if (S.mode === 'target' && S.pending) pref = S.pending.candidates;
    else if (S.mode === 'attack' && S.sel && byUid(S.sel)) pref = adjacentEnemies(byUid(S.sel));
    return (pref && hits.find((u) => pref.includes(u))) || hits[0];
  }

  function onBoardClick(e) {
    if (!S || S.busy || S.over || isAi(S.turn)) return;
    const cell = cellFromEvent(e);
    let target = cell;
    const cellOnly = S.mode === 'move' || S.mode === 'summon';
    if (!cellOnly) {
      const u = unitFromPixels(e);
      if (u) target = { col: u.col, row: u.row };
    }
    if (!target) {
      if (['menu', 'move', 'attack'].includes(S.mode)) {
        setMode('idle');
        refresh();
      }
      return;
    }
    onCell(target.col, target.row);
  }

  function onCell(col, row) {
    const u = unitAt(col, row);
    const sel = S.sel && byUid(S.sel);
    const k = key(col, row);
    switch (S.mode) {
      case 'move': {
        if (sel && reachable(sel).cells.some((c) => key(c.col, c.row) === k)) return doMove(sel, col, row);
        if (u && u.side === S.turn) return select(u);
        setMode('menu');
        return refresh();
      }
      case 'attack': {
        if (sel && u && adjacentEnemies(sel).includes(u)) return doAttack(sel, u);
        if (u && u.side === S.turn) return select(u);
        setMode('menu');
        return refresh();
      }
      case 'target': {
        if (u && S.pending.candidates.includes(u)) return resolveTarget(u);
        UI.toast('표시된 대상 중에서 선택하세요');
        return;
      }
      case 'summon': {
        if (freeMines(S.pending.side).some((m) => m.col === col && m.row === row)) return placeSummon(col, row);
        UI.toast('빛나는 빈 광산을 선택하세요');
        return;
      }
      default: {
        if (u && u.side === S.turn) {
          if (S.sel === u.uid && S.mode === 'menu') {
            setMode('idle');
            return refresh();
          }
          return select(u);
        }
        S.infoUid = u ? u.uid : null;
        setMode('idle');
        refresh();
      }
    }
  }

  function select(u) {
    AudioKit.sfx('ui');
    S.infoUid = u.uid;
    setMode('menu', { sel: u.uid });
    refresh();
  }

  function onRadial(id, u) {
    AudioKit.sfx('ui');
    if (id === 'move') setMode('move');
    else if (id === 'attack') setMode('attack');
    else if (id === 'end') {
      u.done = true;
      setMode('idle');
    } else if (id === 'special') {
      beginAbility(u);
      return;
    }
    refresh();
  }

  function afterUnitAction(u) {
    if (S.over) return;
    if (!byUid(u.uid) || Rules.isExhausted(u)) setMode('idle');
    else setMode('menu', { sel: u.uid });
    refresh();
  }

  // ---------- 이동 ----------
  function faceTo(u, target) {
    const v = views.get(u.uid);
    if (!v) return;
    const a = center(u.col, u.row);
    const b = center(target.col, target.row);
    if (Math.abs(b.x - a.x) > 1) v.actor.setFlip(b.x > a.x);
  }

  function faceDefault(u) {
    const v = views.get(u.uid);
    if (v) v.actor.setFlip(defaultFlip(u.side));
  }

  async function doMove(u, col, row) {
    const st = S;
    const path = reachable(u).path(col, row);
    if (!path.length) return;
    S.busy = true;
    setMode('menu');
    refresh();
    const v = views.get(u.uid);
    v.el.classList.add('walking');
    for (const step of path) {
      faceTo(u, step);
      u.col = step.col;
      u.row = step.row;
      renderUnits();
      await sleep(190);
      if (gone(st)) return;
    }
    v.el.classList.remove('walking');
    faceDefault(u);
    u.moved = true;
    claimMine(u);
    S.busy = false;
    if (checkWin()) return;
    afterUnitAction(u);
  }

  function claimMine(u) {
    const m = mineAt(u.col, u.row);
    if (m && m.owner !== u.side) {
      m.owner = u.side;
      floatText(u, '광산 점령!', 'gold');
      AudioKit.sfx('buff');
    }
  }

  // ---------- 공격 ----------
  function fxAt(u, src, cls) {
    const { x, y, s } = center(u.col, u.row);
    const img = document.createElement('img');
    img.src = src;
    img.className = `fx-burst ${cls || ''}`;
    img.style.left = `${x}px`;
    img.style.top = `${y - 0.9 * R * s}px`;
    layers.fx.appendChild(img);
    setTimeout(() => img.remove(), 700);
  }

  function floatText(u, text, cls, delay = 0) {
    setTimeout(() => {
      if (!layers) return;
      const { x, y, s } = center(u.col, u.row);
      const el = document.createElement('div');
      el.className = `float-text ${cls || ''}`;
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y - 2.1 * R * s}px`;
      layers.fx.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }, delay);
  }

  function shakeBoard() {
    const b = $('#g-board');
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
  }

  async function doAttack(a, d) {
    const st = S;
    S.busy = true;
    setMode('menu');
    refresh();
    const va = views.get(a.uid);
    const vd = views.get(d.uid);
    faceTo(a, d);
    faceTo(d, a);
    const pa = center(a.col, a.row);
    const pd = center(d.col, d.row);
    const body = $('.unit-body', va.el);
    const { dmg, crit } = Rules.damage(Rules.stat(a, 'atk'), Rules.stat(d, 'def'));
    await focusOn([a, d], crit);
    if (gone(st)) return;
    body.style.transition = 'transform 0.22s ease-out';
    body.style.transform = `translate(${(pd.x - pa.x) * 0.45}px, ${(pd.y - pa.y) * 0.45}px)`;
    let hitDone = Promise.resolve();
    await va.actor.play('attack', {
      impactAt: 0.55,
      onImpact: () => {
        d.hp = Math.max(0, d.hp - dmg);
        hitStop(crit);
        hitDone = vd.actor.play('hit');
        fxAt(d, crit ? 'assets/ui/fx-critical.png' : 'assets/ui/fx-attack.png', crit ? 'crit' : '');
        floatText(d, `-${dmg}`, crit ? 'dmg crit' : 'dmg');
        if (crit) {
          floatText(d, '치명타!', 'crit-label', 120);
          shakeBoard();
        }
        AudioKit.sfx(crit ? 'crit' : 'hit');
        renderUnits();
      },
    });
    body.style.transform = '';
    if (gone(st)) return;
    await Promise.all([hitDone, sleep(240)]);
    if (gone(st)) return;
    body.style.transition = '';
    a.acted = true;
    faceDefault(a);
    if (d.hp <= 0) {
      await killUnit(d, a.side);
      if (gone(st)) return;
    } else faceDefault(d);
    await focusOff();
    if (gone(st)) return;
    S.busy = false;
    if (checkWin()) return;
    afterUnitAction(a);
  }

  async function killUnit(u, killerSide) {
    const st = S;
    S.players[killerSide].kills += 1;
    const v = views.get(u.uid);
    AudioKit.sfx('death');
    floatText(u, '격파!', 'ko');
    if (v) v.el.classList.add('dying');
    await sleep(750);
    if (gone(st)) return;
    u.hp = 0;
    removeView(u.uid);
    if (S.sel === u.uid) S.sel = null;
    if (S.infoUid === u.uid) S.infoUid = null;
    S.units = S.units.filter((x) => x.uid !== u.uid);
    renderHud();
  }

  // ---------- 효과(특수능력·마법) ----------
  async function applyEffectAnimated(effect, targets, casterSide, caster) {
    const st = S;
    const harmful = Rules.isHarmful(effect.mod);
    const results = Rules.applyEffect(effect, targets, casterSide);
    const names = { atk: '공격', def: '방어', hp: '체력', move: '이동' };
    const anims = [];
    results.forEach((r, i) => {
      const v = views.get(r.unit.uid);
      if (v && r.unit !== caster) anims.push(v.actor.play(harmful ? 'hit' : 'special'));
      r.changes.forEach((c, j) => {
        const cls = c.v > 0 ? 'buff' : 'debuff';
        floatText(r.unit, c.k === 'hp' ? `${c.v > 0 ? '+' : ''}${c.v}` : `${names[c.k]} ${c.v > 0 ? '+' : ''}${c.v}`, c.k === 'hp' ? (c.v > 0 ? 'heal' : 'dmg') : cls, i * 60 + j * 260);
      });
      if (harmful) fxAt(r.unit, 'assets/ui/fx-attack.png', 'magic');
    });
    AudioKit.sfx(harmful ? 'debuff' : effect.mod.hp > 0 ? 'heal' : 'buff');
    renderUnits();
    renderInfo();
    await Promise.all([...anims, sleep(700)]);
    for (const r of results) {
      if (gone(st)) return;
      if (r.died && S.units.includes(r.unit)) await killUnit(r.unit, Rules.other(r.unit.side));
    }
  }

  function beginAbility(u) {
    const ab = u.card.ability;
    const cands = effectCandidates(ab, u.side, u);
    if (!cands.length) return UI.toast('대상이 없습니다');
    if (isSingle(ab, false)) {
      setMode('target', { pending: { kind: 'ability', unit: u, effect: ab, candidates: cands } });
      setStatus(`「${ab.name}」 대상을 선택하세요`, true);
      refresh();
      return;
    }
    useAbility(u, cands);
  }

  async function useAbility(u, targets) {
    const st = S;
    const ab = u.card.ability;
    S.busy = true;
    setMode('menu', { sel: u.uid, pending: null });
    refresh();
    const single = targets.length === 1 && targets[0] !== u;
    if (single) faceTo(u, targets[0]);
    if (single) await focusOn([u, targets[0]]);
    if (gone(st)) return;
    showSkillName(u, ab.name);
    const v = views.get(u.uid);
    let applied = Promise.resolve();
    await v.actor.play('special', {
      impactAt: 0.6,
      onImpact: () => {
        applied = applyEffectAnimated(ab, targets, u.side, u);
      },
    });
    if (gone(st)) return;
    await applied;
    if (gone(st)) return;
    if (byUid(u.uid)) {
      u.acted = true;
      u.cd = ab.cooldown;
      faceDefault(u);
    }
    await focusOff();
    if (gone(st)) return;
    S.busy = false;
    if (checkWin()) return;
    afterUnitAction(u);
  }

  function showSkillName(u, name) {
    const { x, y, s } = center(u.col, u.row);
    const el = document.createElement('div');
    el.className = `skill-name ${u.side}`;
    el.textContent = `✦ ${name}`;
    el.style.left = `${x}px`;
    el.style.top = `${y - 2.9 * R * s}px`;
    layers.fx.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  function resolveTarget(u) {
    const p = S.pending;
    if (p.kind === 'ability') return useAbility(p.unit, [u]);
    if (p.kind === 'magic') return castMagic(p.side, p.card, [u]);
  }

  // ---------- 카드 인트로 ----------
  async function playReveal(card) {
    const overlay = $('#reveal');
    const video = $('#reveal-video');
    const img = $('#reveal-img');
    const gen = $('#reveal-card');
    $('#reveal-name').textContent = card.name;
    [video, img, gen].forEach((el) => el.classList.add('hidden'));
    overlay.classList.remove('hidden');
    AudioKit.duckBgm(0.035);
    try {
      const introUrl = await Store.mediaUrl(card.introVideo);
      if (introUrl) {
        video.classList.remove('hidden');
        video.src = introUrl;
        video.muted = false;
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          video.onended = finish;
          video.onerror = finish;
          overlay.onclick = finish;
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(finish);
          });
          setTimeout(finish, 20000);
        });
      } else {
        const imgUrl = await Store.mediaUrl(card.image);
        if (imgUrl) {
          img.src = imgUrl;
          img.classList.remove('hidden');
        } else {
          gen.innerHTML = `<b>${UI.esc(card.name)}</b><small>${UI.esc(card.grade)}</small>`;
          gen.classList.remove('hidden');
        }
        await sleep(3000);
      }
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.onclick = null;
      overlay.classList.add('hidden');
      AudioKit.restoreBgm();
    }
  }

  // ---------- 소환 ----------
  function summonBlocker(side) {
    const p = S.players[side];
    if (p.summoned) return '이번 턴에는 이미 소환했습니다.';
    if (unitsOf(side).length >= Rules.MAX_UNITS) return `필드에는 최대 ${Rules.MAX_UNITS}기까지 소환할 수 있습니다.`;
    if (!freeMines(side).length) return '소환할 수 있는 빈 광산이 없습니다.';
    return null;
  }

  function dragonBlocker(side, card) {
    const p = S.players[side];
    if (p.usedDragons.has(card.id)) return '이미 사용한 드래곤입니다.';
    const limit = Store.summonLimit(card.grade);
    if (limit && (p.gradeSummons[card.grade] || 0) >= limit) return `${card.grade} 카드는 한 게임에 ${limit}번까지만 소환할 수 있습니다.`;
    const cost = Store.summonCost(card.grade);
    if (p.mana < cost) return `마나가 부족합니다 (필요 ${cost}, 보유 ${p.mana})`;
    return null;
  }

  async function requestSummon(side) {
    if (S.busy || S.over || S.turn !== side || isAi(side)) return;
    const block = summonBlocker(side);
    if (block) return UI.alert(block);
    setMode('idle');
    refresh();
    const card = await Scan.open({ type: 'dragon', title: `${SIDE_NAME[side]} 드래곤 소환`, validate: (c) => dragonBlocker(side, c) });
    if (!card) return;
    setMode('summon', { pending: { side, card, gallery: Scan.lastSource() === 'gallery' } });
    refresh();
  }

  async function placeSummon(col, row) {
    const { side, card, gallery } = S.pending;
    return summon(side, card, col, row, gallery);
  }

  async function summon(side, card, col, row, gallery = false) {
    const st = S;
    const p = S.players[side];
    S.busy = true;
    setMode('idle');
    p.mana -= Store.summonCost(card.grade);
    p.usedDragons.add(card.id);
    p.gradeSummons[card.grade] = (p.gradeSummons[card.grade] || 0) + 1;
    p.summoned = true;
    refresh();
    await playReveal(card);
    if (gone(st)) return;
    const u = Rules.makeUnit(S.uidSeq++, side, card, col, row);
    if (gallery) u.gallery = true;
    S.units.push(u);
    const v = ensureView(u);
    v.el.classList.add('summoning');
    AudioKit.sfx('summon');
    claimMine(u);
    refresh();
    await sleep(650);
    if (gone(st)) return;
    v.el.classList.remove('summoning');
    S.busy = false;
    S.infoUid = u.uid;
    if (checkWin()) return;
    refresh();
  }

  // ---------- 마법 ----------
  function magicBlocker(side, card) {
    const p = S.players[side];
    if (p.usedMagics.has(card.id)) return '이미 사용한 마법입니다.';
    const cost = Store.magicCost(card.grade);
    if (p.mana < cost) return `마나가 부족합니다 (필요 ${cost}, 보유 ${p.mana})`;
    if (!effectCandidates(card.effect, side, null).length) return '적용할 대상이 없습니다.';
    return null;
  }

  async function requestMagic(side) {
    if (S.busy || S.over || S.turn !== side || isAi(side)) return;
    if (S.players[side].magicUsed) return UI.alert('마법은 턴마다 1번만 사용할 수 있습니다.');
    setMode('idle');
    refresh();
    const card = await Scan.open({ type: 'magic', title: `${SIDE_NAME[side]} 마법 사용`, validate: (c) => magicBlocker(side, c) });
    if (!card) return;
    const cands = effectCandidates(card.effect, side, null);
    if (isSingle(card.effect, true)) {
      setMode('target', { pending: { kind: 'magic', side, card, candidates: cands } });
      setStatus(`「${card.name}」 대상을 선택하세요`, true);
      refresh();
      return;
    }
    castMagic(side, card, cands);
  }

  async function castMagic(side, card, targets) {
    const st = S;
    const p = S.players[side];
    S.busy = true;
    setMode('idle');
    p.mana -= Store.magicCost(card.grade);
    p.usedMagics.add(card.id);
    p.magicUsed = true;
    refresh();
    await playReveal(card);
    if (gone(st)) return;
    if (targets.length === 1) await focusOn(targets);
    if (gone(st)) return;
    await applyEffectAnimated(card.effect, targets, side, null);
    if (gone(st)) return;
    await focusOff();
    if (gone(st)) return;
    S.busy = false;
    if (checkWin()) return;
    refresh();
  }

  // ---------- 승리 ----------
  function checkWin() {
    for (const side of ['p1', 'p2']) {
      if (minesOwned(side).length === S.mines.length || S.players[side].kills >= Rules.KO_TO_WIN) {
        endGame(side);
        return true;
      }
    }
    return false;
  }

  function endGame(side) {
    S.over = true;
    S.busy = false;
    setMode('idle');
    refresh();
    AudioKit.sfx('win');
    $('#result-img').src = `assets/ui/win-${side}.png`;
    $('#result').classList.remove('hidden');
  }

  // ---------- AI ----------
  function toggleAi() {
    if (!S || S.over) return;
    if (S.busy) return UI.toast('연출이 끝난 뒤에 바꿀 수 있습니다');
    if (S.aiP2 && S.turn === 'p2' && AI.isRunning(api)) return UI.toast('AI 턴이 끝난 뒤에 끌 수 있습니다');
    S.aiP2 = !S.aiP2;
    if (S.aiP2 && !S.aiDecks.p2) S.aiDecks.p2 = Rules.aiDeck();
    UI.toast(S.aiP2 ? '2P AI 켜짐' : '2P AI 꺼짐');
    refresh();
    if (S.aiP2 && S.turn === 'p2' && !S.busy && !S.over) {
      setMode('idle');
      AI.runTurn(api, 'p2');
    }
  }

  const api = {
    get S() {
      return S;
    },
    unitsOf,
    enemiesOf,
    reachable,
    adjacentEnemies,
    canMove,
    canAttack,
    freeMines,
    minesOwned,
    mineAt,
    effectCandidates,
    isSingle,
    summonBlocker,
    dragonBlocker,
    magicBlocker,
    summon,
    castMagic,
    useAbility,
    doMove: (u, col, row) => doMove(u, col, row),
    doAttack: (a, d) => doAttack(a, d),
    endTurn,
    refresh,
  };

  /** 설정 미리보기용: 가장 가까운 줄(원근 1.0)에서의 유닛 크기와 발밑 타일 */
  function unitGeometry(grade) {
    const size = 2.8 * R * (GRADE_SCALE[grade] || 1);
    return { size, footY: size - 0.14 * R, tileW: HEX_W, tileH: HEX_H * SQUASH, thick: THICK };
  }

  return { init, start, stop, api, unitGeometry };
})();

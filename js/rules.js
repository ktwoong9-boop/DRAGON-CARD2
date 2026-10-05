/** 게임 규칙 — 화면과 무관한 순수 계산 */
const Rules = (() => {
  const COLS = 7;
  const ROWS = 4;
  const MAX_MANA = 10;
  const START_MANA = 1;
  const MAX_UNITS = 5;
  const KO_TO_WIN = 7;
  const HOME = { p1: { col: 0, row: 1 }, p2: { col: COLS - 1, row: 1 } };

  const NEIGHBOR = [
    [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]],
    [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]],
  ];

  const key = (col, row) => `${col},${row}`;
  const inBounds = (col, row) =>
    col >= 0 && col < COLS && row >= 0 && row < ROWS &&
    !((col === 0 || col === COLS - 1) && (row === 0 || row === ROWS - 1));
  const other = (side) => (side === 'p1' ? 'p2' : 'p1');

  function toCube(col, row) {
    const q = col;
    const r = row - (col - (col & 1)) / 2;
    return { q, r, s: -q - r };
  }

  function dist(a, b) {
    const A = toCube(a.col, a.row);
    const B = toCube(b.col, b.row);
    return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s));
  }

  function neighbors(col, row) {
    return NEIGHBOR[col & 1].map(([dc, dr]) => ({ col: col + dc, row: row + dr })).filter((p) => inBounds(p.col, p.row));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 본진 2 + 가운데 열 1 + 좌우 대칭 1쌍 */
  function placeMines() {
    const mid = (COLS - 1) / 2;
    const centerRow = Math.floor(Math.random() * ROWS);
    const pairPool = [];
    for (let c = 1; c < mid; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (c === HOME.p1.col && r === HOME.p1.row) continue;
        pairPool.push({ col: c, row: r });
      }
    }
    const pick = pairPool[Math.floor(Math.random() * pairPool.length)];
    return [
      { ...HOME.p1, owner: 'p1', home: 'p1' },
      { ...HOME.p2, owner: 'p2', home: 'p2' },
      { col: mid, row: centerRow, owner: null, home: null },
      { col: pick.col, row: pick.row, owner: null, home: null },
      { col: COLS - 1 - pick.col, row: pick.row, owner: null, home: null },
    ];
  }

  function makeUnit(uid, side, card, col, row) {
    return {
      uid,
      side,
      cardId: card.id,
      card,
      name: card.name,
      grade: card.grade,
      base: { atk: card.atk, def: card.def, move: Store.moveOf(card) },
      maxHp: card.hp,
      hp: card.hp,
      effects: [],
      col,
      row,
      moved: false,
      acted: false,
      done: false,
      sick: true,
      cd: 0,
    };
  }

  function stat(u, k) {
    const sum = u.effects.reduce((acc, e) => acc + (e.mod[k] || 0), 0);
    return Math.max(0, u.base[k] + sum);
  }

  function isExhausted(u) {
    return u.sick || u.done || (u.moved && u.acted);
  }

  function abilityReady(u) {
    return !!u.card.ability && u.cd <= 0 && !u.acted && !u.sick && !u.done;
  }

  function damage(atk, def) {
    const crit = Math.random() < 0.1;
    const a = crit ? atk * 1.5 : atk;
    return { dmg: Math.max(10, Math.floor(a - def / 2)), crit };
  }

  /** 효과가 해로운지(피격 연출) / 이로운지(특수능력 연출) */
  function isHarmful(mod) {
    const vals = ['atk', 'def', 'hp', 'move'].map((k) => mod[k] || 0);
    const neg = vals.filter((v) => v < 0).reduce((a, v) => a - v, 0);
    const pos = vals.filter((v) => v > 0).reduce((a, v) => a + v, 0);
    return neg > pos || (neg > 0 && pos === 0);
  }

  /**
   * 효과 적용. 반환: [{ unit, hpDelta, died, changes: [{k, v}] }]
   * - 체력: 즉시, 최대 체력 이상 회복 불가, 0 이면 사망
   * - 공격/방어/이동: 지속 턴 동안 유지 (시전자 턴 시작 시 1 감소)
   */
  function applyEffect(effect, targets, casterSide) {
    const results = [];
    for (const u of targets) {
      const changes = [];
      const before = u.hp;
      if (effect.mod.hp) {
        u.hp = Math.max(0, Math.min(u.maxHp, u.hp + effect.mod.hp));
        changes.push({ k: 'hp', v: u.hp - before });
      }
      const lasting = {};
      ['atk', 'def', 'move'].forEach((k) => {
        if (effect.mod[k]) {
          lasting[k] = effect.mod[k];
          changes.push({ k, v: effect.mod[k] });
        }
      });
      if (Object.keys(lasting).length) {
        u.effects.push({
          mod: lasting,
          turns: effect.duration === 'perm' ? Infinity : Number(effect.duration) || 1,
          side: casterSide,
        });
      }
      results.push({ unit: u, hpDelta: u.hp - before, died: u.hp <= 0, changes });
    }
    return results;
  }

  /** side 의 턴 시작: 그 편이 건 효과 1턴 감소, 그 편 유닛 쿨타임 감소·행동 초기화 */
  function startTurn(units, side) {
    for (const u of units) {
      u.effects = u.effects
        .map((e) => (e.side === side ? { ...e, turns: e.turns - 1 } : e))
        .filter((e) => e.turns > 0);
      if (u.side === side) {
        u.cd = Math.max(0, u.cd - 1);
        u.moved = false;
        u.acted = false;
        u.done = false;
        u.sick = false;
      }
    }
  }

  function aiDeck() {
    const want = { 초급: 3, 중급: 3, 고급: 2, 레어: 1 };
    const deck = [];
    Object.entries(want).forEach(([g, n]) => {
      deck.push(...shuffle(Store.dragons().filter((d) => d.grade === g)).slice(0, n));
    });
    const magic = shuffle(Store.magics())[0] || null;
    return { dragons: deck, magics: magic ? [magic] : [] };
  }

  return {
    COLS,
    ROWS,
    MAX_MANA,
    START_MANA,
    MAX_UNITS,
    KO_TO_WIN,
    HOME,
    key,
    inBounds,
    other,
    dist,
    neighbors,
    shuffle,
    placeMines,
    makeUnit,
    stat,
    isExhausted,
    abilityReady,
    damage,
    isHarmful,
    applyEffect,
    startTurn,
    aiDeck,
  };
})();

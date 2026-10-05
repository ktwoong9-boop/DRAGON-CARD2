/** 2P AI — 덱: 초급3·중급3·고급2·레어1 + 마법1 */
const AI = (() => {
  const GRADE_RANK = { 초급: 1, 중급: 2, 고급: 3, 레어: 4, '레전더스 레어': 5 };
  let running = null;
  let current = null;

  const alive = (G) => G.S && G.S === running && !G.S.over && G.S.turn === current;

  async function waitIdle(G) {
    while (G.S && G.S.busy && alive(G)) await sleep(80);
  }

  function nearestDist(G, pos, targets) {
    let best = Infinity;
    for (const t of targets) best = Math.min(best, Rules.dist(pos, t));
    return best;
  }

  async function trySummon(G, side) {
    if (G.summonBlocker(side)) return;
    const deck = G.S.aiDecks[side].dragons.filter((c) => !G.dragonBlocker(side, c));
    if (!deck.length) return;
    deck.sort((a, b) => GRADE_RANK[b.grade] - GRADE_RANK[a.grade] || b.atk + b.hp - (a.atk + a.hp));
    const card = deck[0];
    const enemyHome = Rules.HOME[Rules.other(side)];
    const mines = G.freeMines(side).sort((a, b) => Rules.dist(a, enemyHome) - Rules.dist(b, enemyHome));
    await G.summon(side, card, mines[0].col, mines[0].row);
    await waitIdle(G);
  }

  function pickEffectTargets(G, effect, side, caster) {
    const cands = G.effectCandidates(effect, side, caster);
    if (!cands.length) return null;
    if (!G.isSingle(effect, !caster)) return cands;
    const harmful = Rules.isHarmful(effect.mod);
    if (harmful) {
      const sorted = cands.slice().sort((a, b) => a.hp - b.hp);
      return [sorted[0]];
    }
    if (effect.mod.hp > 0) {
      const hurt = cands.filter((u) => u.hp < u.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      return hurt.length ? [hurt[0]] : null;
    }
    const strong = cands.slice().sort((a, b) => Rules.stat(b, 'atk') - Rules.stat(a, 'atk'));
    return [strong[0]];
  }

  function worthCasting(G, effect, targets) {
    if (!targets || !targets.length) return false;
    if (effect.mod.hp > 0 && !Rules.isHarmful(effect.mod)) return targets.some((u) => u.hp < u.maxHp * 0.8);
    return true;
  }

  async function tryMagic(G, side) {
    if (G.S.players[side].magicUsed) return;
    const card = G.S.aiDecks[side].magics.find((m) => !G.magicBlocker(side, m));
    if (!card) return;
    const targets = pickEffectTargets(G, card.effect, side, null);
    if (!worthCasting(G, card.effect, targets)) return;
    await G.castMagic(side, card, targets);
    await waitIdle(G);
  }

  function bestMove(G, u) {
    const enemies = G.enemiesOf(u.side);
    const goals = G.S.mines.filter((m) => m.owner !== u.side);
    const cells = G.reachable(u).cells;
    let best = null;
    let bestScore = -Infinity;
    const score = (pos) => {
      let s = 0;
      const m = G.mineAt(pos.col, pos.row);
      if (m && m.owner !== u.side) s += m.home ? 140 : 100;
      const adj = enemies.filter((e) => Rules.dist(pos, e) === 1);
      if (adj.length && !u.acted) s += 45 - adj.length * 8;
      s -= nearestDist(G, pos, goals.length ? goals : enemies) * 12;
      s -= nearestDist(G, pos, enemies) * 3;
      return s;
    };
    const stay = score(u);
    for (const c of cells) {
      const sc = score(c) + Math.random() * 2;
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return best && bestScore > stay ? best : null;
  }

  async function attackBest(G, u) {
    const foes = G.adjacentEnemies(u).sort((a, b) => a.hp - b.hp);
    if (!foes.length) return false;
    await G.doAttack(u, foes[0]);
    await waitIdle(G);
    return true;
  }

  async function tryAbility(G, u) {
    if (!Rules.abilityReady(u)) return false;
    const ab = u.card.ability;
    const targets = pickEffectTargets(G, ab, u.side, u);
    if (!worthCasting(G, ab, targets)) return false;
    await G.useAbility(u, targets);
    await waitIdle(G);
    return true;
  }

  async function actUnit(G, u) {
    const mine = () => G.unitsOf(u.side).includes(u);
    if (Rules.isExhausted(u)) return;
    const canKill = G.adjacentEnemies(u).some((e) => e.hp <= Math.max(10, Math.floor(Rules.stat(u, 'atk') - Rules.stat(e, 'def') / 2)));
    if (canKill && !u.acted) await attackBest(G, u);
    if (!alive(G) || !mine()) return;

    if (!u.moved && G.canMove(u)) {
      const dest = bestMove(G, u);
      if (dest) {
        await G.doMove(u, dest.col, dest.row);
        await waitIdle(G);
      }
    }
    if (!alive(G) || !mine()) return;

    if (!u.acted) {
      if (!(await tryAbility(G, u))) await attackBest(G, u);
    }
    if (mine()) u.done = true;
  }

  async function runTurn(G, side = 'p2') {
    const st = G.S;
    if (!st || running === st) return;
    running = st;
    current = side;
    const release = () => {
      if (running === st) running = null;
    };
    try {
      await sleep(500);
      if (!alive(G)) return;
      if (!G.S.aiDecks[side]) G.S.aiDecks[side] = Rules.aiDeck();
      await trySummon(G, side);
      if (!alive(G)) return;
      await tryMagic(G, side);
      const units = G.unitsOf(side).slice();
      for (const u of units) {
        if (!alive(G)) return;
        await actUnit(G, u);
        await sleep(250);
      }
      if (!alive(G)) return;
      await sleep(400);
      if (!alive(G)) return;
      release();
      await G.endTurn();
    } catch (e) {
      console.error('[AI]', e);
      await waitIdle(G);
      if (alive(G)) {
        release();
        await G.endTurn();
      }
    } finally {
      release();
    }
  }

  return { runTurn, isRunning: (G) => !!G.S && running === G.S };
})();

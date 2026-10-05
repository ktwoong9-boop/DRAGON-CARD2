/** 설정 화면 — 드래곤/마법 카드, 스프라이트, 특수능력, 재생속도·비용, 배포 */
const Settings = (() => {
  let tab = 'dragons';
  let draft = null;
  let draftType = null;
  let filter = { q: '', grade: '' };
  let actors = [];
  let hooks = {};
  let bound = false;
  let fpsSaveTimer = null;
  let tokenListeners = [];

  const body = () => $('#set-body');

  function init(h) {
    hooks = h || {};
  }

  async function open() {
    if (window.DCB_BUILD && window.DCB_BUILD.playOnly) return;
    if (!(await UI.askPassword('설정 비밀번호를 입력하세요'))) return;
    bindOnce();
    UI.showScreen('screen-settings');
    Sprite.setFps(Store.settings().spriteFps);
    Sprite.setTokenScale(Store.settings().tokenScale);
    switchTab(tab);
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    $$('.set-tab').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
    $('#set-back').onclick = () => {
      clearActors();
      hooks.onExit && hooks.onExit();
    };
    bindEffectInputs(body());
  }

  function setSign(box, sign) {
    box.dataset.sign = sign;
    $$('[data-set-sign]', box).forEach((b) => b.classList.toggle('on', b.dataset.setSign === sign));
  }

  /** 효과 편집기: 상승/감소 버튼(둘 중 하나), 숫자는 0 이상 정수만 */
  function bindEffectInputs(root) {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-set-sign]');
      if (!btn) return;
      const box = btn.closest('[data-mod]');
      box.dataset.auto = 0;
      setSign(box, btn.dataset.setSign);
    });
    root.addEventListener('input', (e) => {
      if (!e.target.matches('[data-mag]')) return;
      const clean = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
      if (clean !== e.target.value) e.target.value = clean;
    });
    root.addEventListener('focusout', (e) => {
      if (e.target.matches('[data-mag]') && e.target.value === '') e.target.value = '0';
    });
    root.addEventListener('change', (e) => {
      if (!e.target.matches('.effect-editor [data-f="target"]')) return;
      const enemy = e.target.value === 'enemy1' || e.target.value === 'enemyAll';
      $$('[data-mod]', e.target.closest('.effect-editor')).forEach((box) => {
        const mag = Number($('[data-mag]', box).value) || 0;
        if (box.dataset.auto === '1' && mag === 0) setSign(box, enemy ? '-' : '+');
      });
    });
  }

  function clearActors() {
    actors.forEach((a) => a.destroy());
    actors = [];
  }

  function switchTab(name) {
    tab = name;
    draft = null;
    clearActors();
    $$('.set-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'dragons' || name === 'magics') renderCardTab();
    else if (name === 'general') renderGeneral();
    else renderDeploy();
  }

  // ---------- 실제 게임 크기 미리보기 ----------
  const previewBox = (attrs) => `<div class="game-prev"><div class="gp-tile"></div><canvas ${attrs}></canvas></div>`;

  /** 미리보기를 게임 화면(가장 가까운 줄)과 같은 크기로 맞춥니다 */
  function sizePreviews(root, grade) {
    const g = Game.unitGeometry(grade);
    const below = g.tileH / 2 + g.thick + 6;
    $$('.game-prev', root).forEach((box) => {
      box.style.width = `${Math.round(g.size)}px`;
      box.style.height = `${Math.round(g.footY + below)}px`;
      const tile = $('.gp-tile', box);
      Object.assign(tile.style, {
        width: `${g.tileW}px`,
        height: `${g.tileH}px`,
        top: `${g.footY - g.tileH / 2}px`,
      });
      const c = $('canvas', box);
      const px = Math.round(g.size * 1.5);
      if (c.width !== px) {
        c.width = px;
        c.height = px;
      }
      c.style.width = c.style.height = `${Math.round(g.size)}px`;
    });
    actors.forEach((a) => (a.dirty = true));
  }

  // ---------- 공용 입력 ----------
  const gradeOptions = (sel) => Store.GRADES.map((g) => `<option ${g === sel ? 'selected' : ''}>${g}</option>`).join('');

  function effectEditor(effect, withAbility) {
    const e = effect || { target: withAbility ? 'self' : 'enemy1', mod: Store.emptyMod(), duration: 1, cooldown: 2, name: '' };
    const targets = Object.entries(Store.TARGETS)
      .map(([k, v]) => `<option value="${k}" ${k === e.target ? 'selected' : ''}>${v}</option>`)
      .join('');
    const durs = Store.DURATIONS.map((d) => `<option value="${d.v}" ${String(d.v) === String(e.duration) ? 'selected' : ''}>${d.label}</option>`).join('');
    const cds = Store.COOLDOWNS.map((c) => `<option value="${c}" ${c === Number(e.cooldown) ? 'selected' : ''}>${c}턴</option>`).join('');
    const enemyTarget = e.target === 'enemy1' || e.target === 'enemyAll';
    const num = (k, label) => {
      const v = Math.trunc(Number(e.mod[k]) || 0);
      const sign = v < 0 ? '-' : v > 0 ? '+' : enemyTarget ? '-' : '+';
      return `
        <div class="fx-num" data-mod="${k}" data-sign="${sign}" data-auto="${v === 0 ? 1 : 0}">
          <span class="fx-label">${label}</span>
          <div class="sign-btns">
            <button type="button" class="sign-btn plus ${sign === '+' ? 'on' : ''}" data-set-sign="+">+ 상승</button>
            <button type="button" class="sign-btn minus ${sign === '-' ? 'on' : ''}" data-set-sign="-">− 감소</button>
          </div>
          <input type="text" inputmode="numeric" autocomplete="off" data-mag value="${Math.abs(v)}" />
        </div>`;
    };
    return `
      <div class="effect-editor">
        ${withAbility ? `<label class="wide">능력 이름<input type="text" data-f="name" value="${UI.esc(e.name || '')}" placeholder="예: 화염 포효" /></label>` : ''}
        <label>적용 대상<select data-f="target">${targets}</select></label>
        <div class="fx-mods">${num('atk', '공격')}${num('def', '방어')}${num('hp', '체력')}${num('move', '이동력')}</div>
        <label>효과 지속<select data-f="duration">${durs}</select></label>
        ${withAbility ? `<label>쿨링타임<select data-f="cooldown">${cds}</select></label>` : ''}
        <p class="hint">상승/감소 버튼으로 방향을 고르고 숫자는 크기만 입력하세요. 적에게 피해를 주려면 체력 [− 감소]를 선택합니다. 체력은 즉시 적용되며 최대 체력을 넘지 않습니다. 공격·방어·이동력은 지속 턴 동안 유지됩니다.</p>
      </div>`;
  }

  function readEffect(root, withAbility) {
    const f = (k) => $(`[data-f="${k}"]`, root);
    const mod = Store.emptyMod();
    $$('[data-mod]', root).forEach((box) => {
      const mag = Math.abs(Math.trunc(Number($('[data-mag]', box).value) || 0));
      mod[box.dataset.mod] = box.dataset.sign === '-' ? -mag : mag;
    });
    const out = {
      target: f('target').value,
      mod,
      duration: f('duration').value === 'perm' ? 'perm' : Number(f('duration').value),
    };
    if (withAbility) {
      out.name = f('name').value.trim() || '특수능력';
      out.cooldown = Number(f('cooldown').value);
    }
    return out;
  }

  async function mediaBlock(label, field, accept, kind) {
    const url = await Store.mediaUrl(draft[field]);
    let preview = '<div class="media-empty">없음</div>';
    if (url && kind === 'image') preview = `<img src="${url}" alt="" />`;
    if (url && kind === 'video') preview = `<video src="${url}" controls playsinline muted></video>`;
    return `
      <div class="media-block" data-field="${field}">
        <h4>${label}</h4>
        <div class="media-preview">${preview}</div>
        <div class="row">
          <label class="file-btn ghost-btn sm">파일 선택<input type="file" accept="${accept}" data-media="${field}" /></label>
          ${draft[field] ? `<button type="button" class="ghost-btn sm" data-clear="${field}">삭제</button>` : ''}
        </div>
      </div>`;
  }

  // ---------- 카드 목록 ----------
  function renderCardTab() {
    const isDragon = tab === 'dragons';
    body().innerHTML = `
      <div class="set-split">
        <div class="set-list">
          <div class="row">
            <input id="set-q" type="text" placeholder="이름 검색" value="${UI.esc(filter.q)}" />
            <select id="set-grade"><option value="">전체</option>${gradeOptions(filter.grade)}</select>
          </div>
          <button id="set-new" class="gold-btn sm full">+ 새 ${isDragon ? '드래곤' : '마법'} 카드</button>
          <ul id="set-items" class="set-items"></ul>
        </div>
        <div id="set-editor" class="set-editor"><p class="muted center-pad">왼쪽 목록에서 카드를 선택하거나 새 카드를 만드세요.</p></div>
      </div>`;
    $('#set-q').oninput = (e) => {
      filter.q = e.target.value;
      renderList();
    };
    $('#set-grade').onchange = (e) => {
      filter.grade = e.target.value;
      renderList();
    };
    $('#set-new').onclick = () => {
      const base = isDragon
        ? { id: Store.newId('d'), name: '새 드래곤', grade: '초급', atk: 30, def: 30, hp: 50, move: null, sprites: {}, ability: null }
        : { id: Store.newId('m'), name: '새 마법', grade: '초급', effect: { target: 'enemy1', mod: { ...Store.emptyMod(), hp: -30 }, duration: 1 } };
      editCard(base, true);
    };
    renderList();
  }

  async function renderList() {
    const isDragon = tab === 'dragons';
    const list = (isDragon ? Store.dragons() : Store.magics()).filter(
      (c) => (!filter.grade || c.grade === filter.grade) && (!filter.q || c.name.includes(filter.q.trim()))
    );
    const ul = $('#set-items');
    if (!ul) return;
    ul.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li');
      li.className = draft && draft.id === c.id ? 'active' : '';
      const tags = isDragon
        ? `${c.introVideo ? '🎬' : ''}${Object.keys(c.sprites).length ? '🧩' : ''}${c.ability ? '✦' : ''}`
        : c.introVideo
          ? '🎬'
          : '';
      li.innerHTML = `<img alt="" loading="lazy" /><div><b>${UI.esc(c.name)}</b><small>${UI.esc(c.grade)} ${tags}</small></div>`;
      li.onclick = () => editCard(JSON.parse(JSON.stringify(c)), false);
      ul.appendChild(li);
      Store.mediaUrl(c.image).then((u) => {
        const img = $('img', li);
        if (u) img.src = u;
        else img.classList.add('empty');
      });
    }
    if (!list.length) ul.innerHTML = '<li class="muted">카드가 없습니다</li>';
  }

  async function editCard(card, isNew) {
    draft = card;
    draft._new = isNew;
    draftType = tab === 'dragons' ? 'dragon' : 'magic';
    clearActors();
    $$('#set-items li').forEach((li) => li.classList.remove('active'));
    if (draftType === 'dragon') await renderDragonEditor();
    else await renderMagicEditor();
    renderList();
  }

  // ---------- 드래곤 편집 ----------
  async function renderDragonEditor() {
    const d = draft;
    const moveOpts = [`<option value="" ${d.move ? '' : 'selected'}>등급 기본 (${Store.settings().defaultMove[d.grade]})</option>`]
      .concat([1, 2, 3].map((n) => `<option value="${n}" ${Number(d.move) === n ? 'selected' : ''}>${n}</option>`))
      .join('');
    const qrUrl = d.qrCode ? await Store.mediaUrl(d.qrImage) : null;
    const ed = $('#set-editor');
    ed.innerHTML = `
      <div class="ed-head">
        <h3>${d._new ? '새 드래곤 카드' : UI.esc(d.name)}</h3>
        <div class="row">
          <button id="ed-save" class="gold-btn sm">저장</button>
          ${d._new ? '' : '<button id="ed-del" class="ghost-btn sm danger">삭제</button>'}
        </div>
      </div>
      <section class="ed-sec">
        <h4>기본 능력치</h4>
        <div class="grid-6">
          <label class="span-2">이름<input id="f-name" type="text" value="${UI.esc(d.name)}" /></label>
          <label>등급<select id="f-grade">${gradeOptions(d.grade)}</select></label>
          <label>공격<input id="f-atk" type="number" min="0" value="${d.atk}" /></label>
          <label>방어<input id="f-def" type="number" min="0" value="${d.def}" /></label>
          <label>체력<input id="f-hp" type="number" min="1" value="${d.hp}" /></label>
          <label>이동력<select id="f-move">${moveOpts}</select></label>
          <p class="hint span-5">소환 비용: 마나 <b id="f-cost">${Store.summonCost(d.grade)}</b> (등급별 비용은 '재생·비용' 탭에서 변경)</p>
        </div>
      </section>
      <section class="ed-sec media-row">
        ${await mediaBlock('카드 이미지', 'image', 'image/*', 'image')}
        ${await mediaBlock('소환 인트로 영상', 'introVideo', 'video/*', 'video')}
        <div class="media-block">
          <h4>소환용 QR</h4>
          <div class="media-preview">${qrUrl ? `<img src="${qrUrl}" alt="" />` : '<canvas id="f-qr" width="150" height="150"></canvas>'}</div>
          <p class="small mono">${UI.esc(dragonQRCode(d))}</p>
          <p class="hint">${d.qrCode ? '등록한 QR 사용 중' : '기본 QR (카드 ID로 자동 생성)'}</p>
          <div class="row wrap">
            <button id="f-qr-gen" type="button" class="ghost-btn sm">새 QR 생성</button>
            <label class="file-btn ghost-btn sm">QR 불러오기<input type="file" accept="image/*" id="f-qr-file" /></label>
            <button id="f-qr-dl" type="button" class="ghost-btn sm">QR 다운로드</button>
            ${d.qrCode ? '<button id="f-qr-del" type="button" class="ghost-btn sm danger">기본 QR로 되돌리기</button>' : ''}
          </div>
        </div>
      </section>
      <section class="ed-sec">
        <div class="ed-sec-head">
          <h4>기본 캐릭터 (스프라이트 시트가 없을 때)</h4>
          <span class="hint">캐릭터 이미지가 없으면 카드 이미지를 사용합니다</span>
        </div>
        <div class="token-row">
          ${previewBox('id="tk-prev"')}
          <div class="col grow">
            <div class="row">
              <label class="file-btn ghost-btn sm">캐릭터 이미지 선택<input type="file" accept="image/*" data-media="token" /></label>
              ${d.token ? '<button type="button" class="ghost-btn sm" data-clear="token">캐릭터 이미지 삭제</button>' : ''}
              <span class="hint">${d.token ? '전용 캐릭터 이미지 사용 중' : '카드 이미지 사용 중'}</span>
            </div>
            <label>크기 <b id="tk-scale-v">${Math.round((d.tokenScale || 1) * 100)}%</b><input id="tk-scale" type="range" min="40" max="200" value="${Math.round((d.tokenScale || 1) * 100)}" /></label>
            <label class="check"><input id="tk-flip" type="checkbox" ${d.tokenFlip ? 'checked' : ''} /> 좌우 반전 (원본 그림이 오른쪽을 볼 때 체크)</label>
            <label>세로 위치 <b id="tk-y-v">${Math.round((d.tokenOffsetY || 0) * 100)}</b><input id="tk-y" type="range" min="-40" max="40" value="${Math.round((d.tokenOffsetY || 0) * 100)}" /></label>
            <div class="row wrap">${Store.ACTIONS.map((a) => `<button type="button" class="ghost-btn sm" data-tkplay="${a}">${Store.ACTION_LABEL[a]}</button>`).join('')}
              <button type="button" id="tk-reset" class="ghost-btn sm">초기화</button></div>
            <p class="hint">'재생·비용' 탭의 전체 기본 캐릭터 크기(현재 ${Math.round(Store.settings().tokenScale * 100)}%)와 곱해져 적용됩니다.</p>
          </div>
        </div>
      </section>
      <section class="ed-sec">
        <div class="ed-sec-head">
          <h4>동작 스프라이트 시트</h4>
          <span class="hint">기본 방향: 왼쪽을 보도록 제작 · 격자(가로 칸 × 세로 줄)에서 왼쪽 위부터 순서대로 읽습니다</span>
        </div>
        <div class="sheet-grid">${Store.ACTIONS.map(sheetCard).join('')}</div>
        <div class="sheet-combined">
          ${previewBox('id="sp-big"')}
          <div class="col">
            <h4>전체 동작 미리보기</h4>
            <div class="row wrap">${Store.ACTIONS.map((a) => `<button type="button" class="ghost-btn sm" data-play="${a}">${Store.ACTION_LABEL[a]}</button>`).join('')}</div>
            <label class="check"><input id="sp-flip" type="checkbox" /> 게임에서 오른쪽을 볼 때 모습 보기</label>
            <p class="hint">시트가 없는 동작은 기본 캐릭터로 표시됩니다. 대기↔공격을 번갈아 눌러 크기와 발 위치가 맞는지 확인하세요.</p>
            <label>전체 재생 속도 <b id="sp-fps-v">${Store.settings().spriteFps}</b> 프레임/초
              <input id="sp-fps" type="range" min="4" max="24" value="${Store.settings().spriteFps}" /></label>
            <p class="hint">재생 속도는 모든 캐릭터에 공통 적용됩니다.</p>
          </div>
        </div>
      </section>
      <section class="ed-sec">
        <div class="ed-sec-head">
          <h4>특수능력</h4>
          <label class="check"><input id="f-ab-on" type="checkbox" ${d.ability ? 'checked' : ''} /> 특수능력 사용</label>
        </div>
        <div id="f-ab" class="${d.ability ? '' : 'hidden'}">${effectEditor(d.ability, true)}</div>
      </section>`;

    $('#f-grade').onchange = (e) => {
      $('#f-cost').textContent = Store.summonCost(e.target.value);
      $('#f-move').options[0].textContent = `등급 기본 (${Store.settings().defaultMove[e.target.value]})`;
      sizePreviews(ed, e.target.value);
    };
    sizePreviews(ed, d.grade);
    $('#f-ab-on').onchange = (e) => $('#f-ab').classList.toggle('hidden', !e.target.checked);
    $('#ed-save').onclick = saveDragon;
    if ($('#ed-del')) $('#ed-del').onclick = () => deleteCard('dragon');
    bindMedia(ed, renderDragonEditor);
    bindDragonQR();
    bindToken();
    bindSheets(ed);
  }

  function bindToken() {
    tokenListeners = [];
    const actor = new Sprite.Actor($('#tk-prev'));
    actors.push(actor);
    actor.setCard({ ...draft, sprites: {} }).then(() => actor.play('idle'));
    const apply = () => {
      draft.tokenScale = Number($('#tk-scale').value) / 100;
      draft.tokenOffsetY = Number($('#tk-y').value) / 100;
      draft.tokenFlip = $('#tk-flip').checked;
      $('#tk-scale-v').textContent = `${$('#tk-scale').value}%`;
      $('#tk-y-v').textContent = $('#tk-y').value;
      actor.setFallbackTransform(draft.tokenScale, draft.tokenOffsetY, draft.tokenFlip);
      tokenListeners.forEach((fn) => fn());
    };
    $('#tk-scale').oninput = apply;
    $('#tk-y').oninput = apply;
    $('#tk-flip').onchange = apply;
    $('#tk-reset').onclick = () => {
      $('#tk-scale').value = 100;
      $('#tk-y').value = 0;
      $('#tk-flip').checked = false;
      apply();
    };
    $$('[data-tkplay]').forEach((b) => (b.onclick = () => actor.play(b.dataset.tkplay, { loop: b.dataset.tkplay !== 'idle' })));
  }

  function collectDragon() {
    const d = draft;
    d.name = $('#f-name').value.trim();
    d.grade = $('#f-grade').value;
    d.atk = Number($('#f-atk').value) || 0;
    d.def = Number($('#f-def').value) || 0;
    d.hp = Number($('#f-hp').value) || 1;
    d.move = $('#f-move').value ? Number($('#f-move').value) : null;
    d.ability = $('#f-ab-on').checked ? readEffect($('#f-ab'), true) : null;
    return d;
  }

  async function saveDragon() {
    const d = collectDragon();
    if (!d.name) return UI.alert('이름을 입력하세요.');
    const saved = await Store.upsertDragon(d);
    Sprite.clearCache();
    UI.toast('저장했습니다');
    await editCard(JSON.parse(JSON.stringify(saved)), false);
  }

  async function deleteCard(type) {
    if (!(await UI.confirm(`「${draft.name}」 카드를 삭제할까요?`, { okText: '삭제' }))) return;
    if (type === 'dragon') await Store.deleteDragon(draft.id);
    else await Store.deleteMagic(draft.id);
    draft = null;
    clearActors();
    renderCardTab();
  }

  function bindMedia(root, rerender) {
    $$('[data-media]', root).forEach((inp) => {
      inp.onchange = async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (draftType === 'dragon') collectDragon();
        else collectMagic();
        draft[inp.dataset.media] = await Store.putFile(file);
        await rerender();
      };
    });
    $$('[data-clear]', root).forEach((b) => {
      b.onclick = async () => {
        if (draftType === 'dragon') collectDragon();
        else collectMagic();
        draft[b.dataset.clear] = null;
        await rerender();
      };
    });
  }

  const dragonQRCode = (d) => d.qrCode || Store.qrPayload('dragon', d);

  async function qrBlob(text) {
    const big = document.createElement('canvas');
    await CardQR.renderToCanvas(big, text, 512);
    return new Promise((resolve) => big.toBlob(resolve, 'image/png'));
  }

  /** 이 QR 문자열을 이미 쓰는 다른 카드 */
  function qrOwner(code) {
    const hit = Store.parseQR(code);
    if (hit && !(hit.type === 'dragon' && hit.card.id === draft.id)) return hit;
    const dup = Store.dragons().find((c) => c.id !== draft.id && c.qrCode === code);
    return dup ? { type: 'dragon', card: dup } : null;
  }

  function bindDragonQR() {
    const canvas = $('#f-qr');
    if (canvas) CardQR.renderToCanvas(canvas, dragonQRCode(draft), 150).catch((e) => console.warn(e));

    $('#f-qr-dl').onclick = async () => {
      const big = document.createElement('canvas');
      await CardQR.renderToCanvas(big, dragonQRCode(draft), 512);
      CardQR.downloadCanvas(big, `QR_${draft.name || draft.id}.png`);
    };

    $('#f-qr-gen').onclick = async () => {
      const msg = draft.qrCode
        ? '새 QR 을 만들면 지금 등록된 QR 은 더 이상 인식되지 않습니다. 새로 만들까요?'
        : '이 카드 전용 새 QR 을 만들까요? (기본 QR 도 계속 인식됩니다)';
      if (!(await UI.confirm(msg, { okText: '생성' }))) return;
      collectDragon();
      const code = Store.newDragonQR(draft);
      try {
        draft.qrImage = await Store.putFile(await qrBlob(code));
      } catch (err) {
        console.warn(err);
        return UI.alert('QR 을 만들지 못했습니다.');
      }
      draft.qrCode = code;
      await renderDragonEditor();
      UI.toast('새 QR 을 만들었습니다. 저장을 누른 뒤 QR 다운로드로 인쇄하세요.', 2600);
    };

    $('#f-qr-file').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      let code = null;
      try {
        code = await CardQR.decodeImage(url);
      } catch (err) {
        console.warn(err);
      } finally {
        URL.revokeObjectURL(url);
      }
      e.target.value = '';
      if (!code) return UI.alert('이미지에서 QR 코드를 읽지 못했습니다. QR 이 선명하게 보이는 이미지를 선택하세요.');
      const owner = qrOwner(code);
      if (owner) {
        const kind = owner.type === 'magic' ? '마법' : '드래곤';
        return UI.alert(`이 QR 은 이미 ${kind} 카드 「${owner.card.name}」 에 등록되어 있습니다.`);
      }
      collectDragon();
      draft.qrImage = await Store.putFile(file);
      draft.qrCode = code;
      await renderDragonEditor();
      UI.toast('QR 을 인식했습니다. 저장을 눌러 반영하세요.', 2400);
    };

    const del = $('#f-qr-del');
    if (del)
      del.onclick = async () => {
        collectDragon();
        draft.qrImage = null;
        draft.qrCode = null;
        await renderDragonEditor();
      };
  }

  // ---------- 스프라이트 ----------
  function sheetCard(action) {
    const s = draft.sprites[action];
    const n = Store.ACTION_FRAMES[action];
    const fallbackNote = action === 'special' && !s ? '<p class="hint">미등록 시 기본 캐릭터 효과(금빛)로 재생합니다</p>' : '';
    return `
      <div class="sheet-card" data-action="${action}">
        <div class="sheet-title"><b>${Store.ACTION_LABEL[action]}</b><small>${n}프레임</small></div>
        ${previewBox('class="sheet-anim"')}
        <canvas class="sheet-grid-view hidden" width="200" height="120"></canvas>
        ${fallbackNote}
        <label class="file-btn ghost-btn sm">PNG 업로드<input type="file" accept="image/png,image/webp,image/*" data-sheet="${action}" /></label>
        ${
          s
            ? `
          <div class="sheet-opts">
            <label>가로 칸<input type="number" min="1" max="16" data-sk="cols" value="${s.cols}" /></label>
            <label>세로 줄<input type="number" min="1" max="16" data-sk="rows" value="${s.rows}" /></label>
            <label class="wide">배경 제거<select data-sk="bg">
              <option value="none" ${s.bg === 'none' ? 'selected' : ''}>없음(투명 PNG)</option>
              <option value="white" ${s.bg === 'white' ? 'selected' : ''}>흰색 배경</option>
              <option value="black" ${s.bg === 'black' ? 'selected' : ''}>검은색 배경</option>
            </select></label>
            <label class="wide">크기 <b>${Math.round(s.scale * 100)}%</b><input type="range" min="40" max="200" data-sk="scale" value="${Math.round(s.scale * 100)}" /></label>
            <label class="wide">세로 위치 <b>${Math.round(s.offsetY * 100)}</b><input type="range" min="-40" max="40" data-sk="offsetY" value="${Math.round(s.offsetY * 100)}" /></label>
            <label class="check wide"><input type="checkbox" data-sk="flip" ${s.flip ? 'checked' : ''} /> 좌우 반전 (원본이 오른쪽을 볼 때 체크)</label>
            <button type="button" class="ghost-btn xs danger" data-sheet-del="${action}">시트 삭제</button>
          </div>`
            : '<p class="muted small">등록된 시트 없음</p>'
        }
      </div>`;
  }

  function guessGrid(w, h, frames) {
    const ratio = w / h;
    const options = [];
    for (let rows = 1; rows <= frames; rows++) {
      if (frames % rows) continue;
      const cols = frames / rows;
      options.push({ cols, rows, err: Math.abs(Math.log((ratio * rows) / cols)) });
    }
    options.sort((a, b) => a.err - b.err);
    return options[0];
  }

  async function guessBg(url) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(2, 2, 1, 1).data;
    let bg = 'none';
    if (px[3] > 200 && px[0] > 225 && px[1] > 225 && px[2] > 225) bg = 'white';
    else if (px[3] > 200 && px[0] < 30 && px[1] < 30 && px[2] < 30) bg = 'black';
    return { bg, w: img.naturalWidth, h: img.naturalHeight };
  }

  function bindSheets(root) {
    const big = new Sprite.Actor($('#sp-big'));
    actors.push(big);
    const previewCard = () => ({ ...draft, sprites: draft.sprites });
    big.setCard(previewCard()).then(() => big.play('idle'));
    $$('[data-play]', root).forEach((b) => (b.onclick = () => big.play(b.dataset.play, { loop: true })));
    $('#sp-flip').onchange = (e) => big.setFlip(e.target.checked);
    tokenListeners.push(() => big.setFallbackTransform(draft.tokenScale, draft.tokenOffsetY, draft.tokenFlip));
    $('#sp-fps').oninput = (e) => {
      const v = Number(e.target.value);
      $('#sp-fps-v').textContent = v;
      Sprite.setFps(v);
      clearTimeout(fpsSaveTimer);
      fpsSaveTimer = setTimeout(() => Store.updateSettings({ spriteFps: v }), 400);
    };

    $$('.sheet-card', root).forEach((card) => {
      const action = card.dataset.action;
      const actor = new Sprite.Actor($('.sheet-anim', card));
      actors.push(actor);
      const refreshPreview = async () => {
        const sheet = draft.sprites[action];
        if (!sheet) {
          const idle = draft.sprites.idle;
          await actor.setCard({ ...draft, sprites: idle && action !== 'idle' ? { idle } : {} });
          actor.play(action, { loop: true });
          return;
        }
        try {
          const loaded = await Sprite.loadSheet(sheet, Store.ACTION_FRAMES[action]);
          actor.sheets = {};
          actor.setSheet(action, loaded, sheet);
          actor.play(action, { loop: true });
          drawGridView(card, sheet);
        } catch (e) {
          console.warn(e);
        }
      };
      refreshPreview();
      tokenListeners.push(() => actor.setFallbackTransform(draft.tokenScale, draft.tokenOffsetY, draft.tokenFlip));

      $('[data-sheet]', card).onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        collectDragon();
        const ref = await Store.putFile(file);
        const url = await Store.mediaUrl(ref);
        const info = await guessBg(url);
        const grid = guessGrid(info.w, info.h, Store.ACTION_FRAMES[action]);
        const prev = draft.sprites[action];
        draft.sprites[action] = {
          src: ref,
          cols: grid.cols,
          rows: grid.rows,
          bg: info.bg,
          scale: prev ? prev.scale : 1,
          offsetY: prev ? prev.offsetY : 0,
          flip: prev ? !!prev.flip : false,
        };
        await renderDragonEditor();
        UI.toast(`${Store.ACTION_LABEL[action]}: ${grid.cols}×${grid.rows} 격자로 인식${info.bg !== 'none' ? `, ${info.bg === 'white' ? '흰색' : '검은색'} 배경 제거` : ''}`, 2600);
      };

      $$('[data-sk]', card).forEach((inp) => {
        const apply = async () => {
          const s = draft.sprites[action];
          const k = inp.dataset.sk;
          if (k === 'flip') s.flip = inp.checked;
          else if (k === 'scale') s.scale = Number(inp.value) / 100;
          else if (k === 'offsetY') s.offsetY = Number(inp.value) / 100;
          else if (k === 'bg') s.bg = inp.value;
          else s[k] = Math.max(1, Number(inp.value) || 1);
          const lbl = k === 'flip' ? null : inp.parentElement.querySelector('b');
          if (lbl) lbl.textContent = k === 'scale' ? `${inp.value}%` : inp.value;
          await refreshPreview();
          big.setCard(previewCard());
        };
        inp.oninput = inp.type === 'range' ? apply : null;
        inp.onchange = apply;
      });

      const del = $('[data-sheet-del]', card);
      if (del)
        del.onclick = async () => {
          collectDragon();
          delete draft.sprites[action];
          await renderDragonEditor();
        };
    });
  }

  async function drawGridView(card, sheet) {
    const canvas = $('.sheet-grid-view', card);
    const url = await Store.mediaUrl(sheet.src);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      const ox = (canvas.width - w) / 2;
      const oy = (canvas.height - h) / 2;
      g.drawImage(img, ox, oy, w, h);
      g.strokeStyle = 'rgba(255,200,60,0.9)';
      g.lineWidth = 1;
      for (let c = 0; c <= sheet.cols; c++) {
        g.beginPath();
        g.moveTo(ox + (w / sheet.cols) * c, oy);
        g.lineTo(ox + (w / sheet.cols) * c, oy + h);
        g.stroke();
      }
      for (let r = 0; r <= sheet.rows; r++) {
        g.beginPath();
        g.moveTo(ox, oy + (h / sheet.rows) * r);
        g.lineTo(ox + w, oy + (h / sheet.rows) * r);
        g.stroke();
      }
      canvas.classList.remove('hidden');
    };
    img.src = url;
  }

  // ---------- 마법 편집 ----------
  async function renderMagicEditor() {
    const m = draft;
    const qrUrl = await Store.mediaUrl(m.qrImage);
    const ed = $('#set-editor');
    ed.innerHTML = `
      <div class="ed-head">
        <h3>${m._new ? '새 마법 카드' : UI.esc(m.name)}</h3>
        <div class="row">
          <button id="ed-save" class="gold-btn sm">저장</button>
          ${m._new ? '' : '<button id="ed-del" class="ghost-btn sm danger">삭제</button>'}
        </div>
      </div>
      <section class="ed-sec">
        <h4>기본 정보</h4>
        <div class="grid-6">
          <label class="span-3">마법 이름<input id="f-name" type="text" value="${UI.esc(m.name)}" /></label>
          <label>등급<select id="f-grade">${gradeOptions(m.grade)}</select></label>
          <p class="hint span-2">시전 비용: 마나 <b id="f-cost">${Store.magicCost(m.grade)}</b></p>
        </div>
      </section>
      <section class="ed-sec media-row">
        ${await mediaBlock('카드 이미지', 'image', 'image/*', 'image')}
        ${await mediaBlock('인트로 영상', 'introVideo', 'video/*', 'video')}
        <div class="media-block">
          <h4>사용용 QR</h4>
          <div class="media-preview">${qrUrl ? `<img src="${qrUrl}" alt="" />` : '<div class="media-empty">없음</div>'}</div>
          <p class="small mono">${m.qrCode ? UI.esc(m.qrCode) : '등록된 QR 없음'}</p>
          <div class="row">
            <label class="file-btn ghost-btn sm">파일 선택<input type="file" accept="image/*" id="f-qr-file" /></label>
            ${m.qrImage || m.qrCode ? '<button type="button" class="ghost-btn sm" id="f-qr-del">삭제</button>' : ''}
          </div>
        </div>
      </section>
      <section class="ed-sec">
        <h4>마법 효과</h4>
        <div id="f-effect">${effectEditor(m.effect, false)}</div>
        <p class="hint">'본인' 대상은 마법에서는 지정 아군(1)과 같게 동작합니다.</p>
      </section>`;
    $('#f-grade').onchange = (e) => ($('#f-cost').textContent = Store.magicCost(e.target.value));
    $('#ed-save').onclick = saveMagic;
    if ($('#ed-del')) $('#ed-del').onclick = () => deleteCard('magic');
    bindMedia(ed, renderMagicEditor);
    bindMagicQR();
  }

  function bindMagicQR() {
    $('#f-qr-file').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      collectMagic();
      const url = URL.createObjectURL(file);
      let code = null;
      try {
        code = await CardQR.decodeImage(url);
      } catch (err) {
        console.warn(err);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!code) {
        e.target.value = '';
        return UI.alert('이미지에서 QR 코드를 읽지 못했습니다. QR 이 선명하게 보이는 이미지를 선택하세요.');
      }
      const dup = Store.magics().find((c) => c.id !== draft.id && c.qrCode === code);
      if (dup) {
        e.target.value = '';
        return UI.alert(`이 QR 은 이미 「${dup.name}」 마법 카드에 등록되어 있습니다.`);
      }
      const hit = Store.parseQR(code);
      if (hit && hit.type === 'dragon') {
        e.target.value = '';
        return UI.alert(`이 QR 은 드래곤 카드 「${hit.card.name}」 의 QR 입니다.`);
      }
      draft.qrImage = await Store.putFile(file);
      draft.qrCode = code;
      await renderMagicEditor();
      UI.toast('QR 을 인식했습니다. 저장을 눌러 반영하세요.', 2400);
    };
    const del = $('#f-qr-del');
    if (del)
      del.onclick = async () => {
        collectMagic();
        draft.qrImage = null;
        draft.qrCode = null;
        await renderMagicEditor();
      };
  }

  function collectMagic() {
    draft.name = $('#f-name').value.trim();
    draft.grade = $('#f-grade').value;
    draft.effect = readEffect($('#f-effect'), false);
    return draft;
  }

  async function saveMagic() {
    const m = collectMagic();
    if (!m.name) return UI.alert('이름을 입력하세요.');
    const saved = await Store.upsertMagic(m);
    UI.toast('저장했습니다');
    await editCard(JSON.parse(JSON.stringify(saved)), false);
  }

  // ---------- 재생·비용 ----------
  function renderGeneral() {
    const s = Store.settings();
    const rows = Store.GRADES.map(
      (g) => `
      <tr><th>${g}</th>
        <td><input type="number" min="0" max="10" data-cost="summonCost" data-g="${g}" value="${s.summonCost[g]}" /></td>
        <td><input type="number" min="0" max="10" data-cost="magicCost" data-g="${g}" value="${s.magicCost[g]}" /></td>
        <td><select data-cost="defaultMove" data-g="${g}">${[1, 2, 3].map((n) => `<option ${n === s.defaultMove[g] ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td>${g in s.summonLimit ? `<input type="number" min="0" max="10" data-cost="summonLimit" data-g="${g}" value="${s.summonLimit[g]}" />` : '<span class="muted">제한 없음</span>'}</td>
      </tr>`
    ).join('');
    const sample = Store.dragons().find((d) => Object.keys(d.sprites).length) || Store.dragons()[0];
    const tkSample = Store.dragons().find((d) => !Object.keys(d.sprites).length);
    body().innerHTML = `
      <div class="set-page">
        <section class="ed-sec">
          <h4>스프라이트 재생 속도 (모든 캐릭터 공통)</h4>
          <div class="row">
            <div data-grade="${sample ? UI.esc(sample.grade) : ''}">${previewBox('id="gen-prev"')}</div>
            <div class="col grow">
              <label>재생 속도 <b id="gen-fps-v">${s.spriteFps}</b> 프레임/초<input id="gen-fps" type="range" min="4" max="24" value="${s.spriteFps}" /></label>
              <div class="row wrap">${Store.ACTIONS.map((a) => `<button type="button" class="ghost-btn sm" data-gplay="${a}">${Store.ACTION_LABEL[a]}</button>`).join('')}</div>
              <p class="hint">미리보기: ${sample ? UI.esc(sample.name) : '-'} · 대기 4 / 공격 8 / 피격 6 / 특수능력 8 프레임</p>
            </div>
          </div>
        </section>
        <section class="ed-sec">
          <h4>기본 캐릭터 크기 (스프라이트 시트가 없는 모든 캐릭터 공통)</h4>
          <div class="row">
            <div data-grade="${tkSample ? UI.esc(tkSample.grade) : ''}">${previewBox('id="gen-tk"')}</div>
            <div class="col grow">
              <label>전체 크기 <b id="gen-tk-v">${Math.round(s.tokenScale * 100)}%</b><input id="gen-tk-scale" type="range" min="40" max="200" value="${Math.round(s.tokenScale * 100)}" /></label>
              <p class="hint">미리보기: ${tkSample ? UI.esc(tkSample.name) : '-'} · 캐릭터별 크기는 드래곤 카드 편집에서 따로 조절할 수 있고, 두 값이 곱해져 적용됩니다.</p>
            </div>
          </div>
        </section>
        <section class="ed-sec">
          <h4>전투 연출</h4>
          <div class="row">
            <label>공격 시 줌인 · 주변 어둡게 · 타격 멈춤
              <select id="gen-fx">${[
                ['off', '끄기'],
                ['weak', '약하게'],
                ['normal', '보통'],
                ['strong', '강하게'],
              ]
                .map(([v, t]) => `<option value="${v}" ${s.battleFx === v ? 'selected' : ''}>${t}</option>`)
                .join('')}</select></label>
          </div>
          <p class="hint">공격과 대상이 하나인 특수능력·마법에서 두 캐릭터를 확대해 보여 줍니다. 진행이 느리게 느껴지면 끄거나 약하게 설정하세요. (아래 저장 버튼으로 반영)</p>
        </section>
        <section class="ed-sec">
          <h4>등급별 비용 · 기본 이동력</h4>
          <table class="cost-table">
            <thead><tr><th>등급</th><th>소환 비용</th><th>마법 시전 비용</th><th>기본 이동력</th><th>최대 소환 횟수</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="hint">최대 소환 횟수: 플레이어 한 명이 한 게임에서 그 등급을 소환할 수 있는 횟수입니다. 격파되어도 횟수는 돌아오지 않습니다. 0 = 제한 없음</p>
          <button id="gen-save" class="gold-btn sm">저장</button>
        </section>
      </div>`;
    $$('[data-grade]', body()).forEach((w) => sizePreviews(w, w.dataset.grade));
    const actor = new Sprite.Actor($('#gen-prev'));
    actors.push(actor);
    if (sample) actor.setCard(sample).then(() => actor.play('idle'));
    $$('[data-gplay]').forEach((b) => (b.onclick = () => actor.play(b.dataset.gplay, { loop: true })));
    $('#gen-fps').oninput = (e) => {
      $('#gen-fps-v').textContent = e.target.value;
      Sprite.setFps(Number(e.target.value));
    };
    const tkActor = new Sprite.Actor($('#gen-tk'));
    actors.push(tkActor);
    if (tkSample) tkActor.setCard(tkSample).then(() => tkActor.play('idle'));
    $('#gen-tk-scale').oninput = (e) => {
      $('#gen-tk-v').textContent = `${e.target.value}%`;
      Sprite.setTokenScale(Number(e.target.value) / 100);
    };
    $('#gen-save').onclick = async () => {
      const patch = {
        spriteFps: Number($('#gen-fps').value),
        tokenScale: Number($('#gen-tk-scale').value) / 100,
        battleFx: $('#gen-fx').value,
        summonLimit: {},
        summonCost: {},
        magicCost: {},
        defaultMove: {},
      };
      $$('[data-cost]').forEach((i) => (patch[i.dataset.cost][i.dataset.g] = Number(i.value)));
      await Store.updateSettings(patch);
      UI.toast('저장했습니다');
    };
  }

  // ---------- 배포 ----------
  function renderDeploy() {
    const st = Store.status();
    body().innerHTML = `
      <div class="set-page">
        <section class="ed-sec">
          <h4>현재 상태</h4>
          <p>배포본 버전: <b>v${st.baseVersion}</b></p>
          <p>${st.usingLocal ? '이 기기에서 수정한 <b>로컬 편집본</b>을 사용 중입니다.' : '배포본을 그대로 사용 중입니다.'}</p>
          ${st.baseIsNewer ? '<p class="warn">서버에 더 새로운 배포본이 있습니다. 아래 "배포본으로 되돌리기"를 누르면 새 배포본을 사용합니다.</p>' : ''}
        </section>
        <section class="ed-sec">
          <h4>배포 데이터 내보내기 (ZIP)</h4>
          <p class="hint">이 기기에서 등록·수정한 카드, 이미지, 영상, 스프라이트를 ZIP 하나로 내보냅니다.<br/>
          ZIP 을 프로젝트 폴더(dragon-card-battle-s2)에 그대로 풀어 덮어쓴 뒤 GitHub 에 올리면 모든 태블릿에 반영됩니다.</p>
          <button id="dep-export" class="gold-btn">ZIP 내보내기</button>
        </section>
        <section class="ed-sec">
          <h4>content.json 가져오기</h4>
          <p class="hint">다른 기기에서 내보낸 content.json 을 불러와 로컬 편집본으로 사용합니다. (미디어 파일은 assets 폴더에 있어야 합니다)</p>
          <label class="file-btn ghost-btn">파일 선택<input id="dep-import" type="file" accept=".json,application/json" /></label>
        </section>
        <section class="ed-sec">
          <h4>배포본으로 되돌리기</h4>
          <p class="hint">이 기기의 로컬 편집본을 지우고 서버 배포본을 사용합니다. 내보내지 않은 변경은 사라집니다.</p>
          <button id="dep-reset" class="ghost-btn danger">배포본으로 되돌리기</button>
        </section>
      </div>`;
    $('#dep-export').onclick = async () => {
      $('#dep-export').disabled = true;
      $('#dep-export').textContent = '만드는 중…';
      try {
        const { blob, version, count } = await Store.exportZip();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dcb2-content-v${version}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        UI.toast(`v${version} · 파일 ${count}개 내보냄`, 2500);
      } catch (e) {
        console.error(e);
        UI.alert(`내보내기 실패: ${e.message}`);
      } finally {
        $('#dep-export').disabled = false;
        $('#dep-export').textContent = 'ZIP 내보내기';
      }
    };
    $('#dep-import').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        await Store.importContent(JSON.parse(await f.text()));
        UI.toast('가져왔습니다');
        renderDeploy();
      } catch (err) {
        UI.alert(`가져오기 실패: ${err.message}`);
      }
    };
    $('#dep-reset').onclick = async () => {
      if (!(await UI.confirm('로컬 편집본을 지우고 배포본으로 되돌릴까요?', { okText: '되돌리기' }))) return;
      await Store.resetToBase();
      Sprite.clearCache();
      UI.toast('배포본으로 되돌렸습니다');
      renderDeploy();
    };
  }

  return { init, open };
})();

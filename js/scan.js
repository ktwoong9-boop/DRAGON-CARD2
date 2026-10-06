/**
 * QR 스캔 오버레이 (게임 화면 위에 떠서 BGM 이 끊기지 않습니다)
 * Scan.open({ type: 'dragon'|'magic', title, validate(card) → 오류문구|null }) → card | null
 */
const Scan = (() => {
  const PLAY_ONLY = !!(window.DCB_BUILD && window.DCB_BUILD.playOnly);
  let stream = null;
  let timer = null;
  let resolver = null;
  let opts = null;
  let picked = null;
  let pickedSource = 'camera';
  let lastSource = null;
  let searchUnlocked = false;
  let camSession = 0;

  function cameraError(e) {
    const name = e && e.name;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return '이 주소에서는 카메라를 쓸 수 없습니다. (https 주소로 접속하세요)';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return '카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용한 뒤 다시 시도하세요.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return '카메라를 찾을 수 없습니다.';
    if (name === 'NotReadableError' || name === 'AbortError')
      return '다른 앱이 카메라를 사용 중입니다. 그 앱을 닫고 다시 시도하세요.';
    return '카메라를 사용할 수 없습니다. 다시 시도하세요.';
  }

  async function startCamera() {
    stopCamera();
    const my = ++camSession;
    const video = $('#scan-video');
    const status = $('#scan-cam-status');
    status.textContent = '카메라 준비 중…';
    status.classList.remove('hidden');
    $('#scan-retry').classList.add('hidden');
    let s = null;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no mediaDevices');
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (e && e.name === 'NotAllowedError') throw e;
        if (my !== camSession) return;
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (my !== camSession) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (my !== camSession) return;
      status.classList.add('hidden');
      timer = setInterval(tick, 250);
    } catch (e) {
      if (s) s.getTracks().forEach((t) => t.stop());
      if (my !== camSession) return;
      console.warn(e);
      status.textContent = cameraError(e) + (PLAY_ONLY ? '' : ' (이름 검색도 사용할 수 있습니다)');
      $('#scan-retry').classList.remove('hidden');
    }
  }

  function stopCamera() {
    camSession++;
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('#scan-video').srcObject = null;
  }

  function tick() {
    if (!resolver) return stopCamera();
    const res = CardQR.scanVideo($('#scan-video'), $('#scan-canvas'));
    if (!res) return;
    handleHit(res.hit, 'camera');
  }

  function handleHit(hit, source) {
    const loud = source !== 'camera';
    if (!hit) {
      if (loud) AudioKit.sfx('error');
      showResult(null, '등록되지 않은 QR코드입니다.');
      return;
    }
    if (hit.type !== opts.type) {
      if (loud) AudioKit.sfx('error');
      showResult(null, opts.type === 'magic' ? '마법 카드가 아닙니다.' : '드래곤 카드가 아닙니다.');
      return;
    }
    if (source === 'camera' && picked && picked.id === hit.card.id) return;
    choose(hit.card, source);
  }

  async function choose(card, source = 'camera') {
    const err = opts.validate ? opts.validate(card) : null;
    if (err) {
      AudioKit.sfx('error');
      showResult(card, err);
      picked = null;
      $('#scan-ok').disabled = true;
      return;
    }
    AudioKit.sfx('ui');
    picked = card;
    pickedSource = source;
    showResult(card, null, source === 'gallery');
    $('#scan-ok').disabled = false;
  }

  async function onGalleryFile() {
    const input = $('#scan-file');
    const file = input.files && input.files[0];
    input.value = '';
    const scan = resolver;
    if (!file || !scan) return;
    $('#scan-result').innerHTML = '<p class="small">사진에서 QR 코드를 찾는 중…</p>';
    const url = URL.createObjectURL(file);
    let raw = null;
    try {
      raw = await CardQR.decodeImage(url, { thorough: true });
    } catch (e) {
      console.warn(e);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (resolver !== scan) return;
    resumeCamera();
    if (!raw) {
      AudioKit.sfx('error');
      showResult(null, '사진에서 QR 코드를 찾지 못했습니다. QR 코드가 잘 보이는 사진을 고르세요.');
      return;
    }
    handleHit(Store.parseQR(raw), 'gallery');
  }

  /** 갤러리를 다녀오는 동안 안드로이드가 카메라를 끊었으면 다시 켬 */
  function resumeCamera() {
    if (!resolver || !stream) return;
    if (stream.getTracks().some((t) => t.readyState === 'ended')) startCamera();
  }

  async function showResult(card, error, fromGallery = false) {
    const box = $('#scan-result');
    if (!card) {
      box.innerHTML = `<p class="err">${UI.esc(error)}</p>`;
      return;
    }
    const img = await Store.mediaUrl(card.image);
    const cost = opts.type === 'magic' ? Store.magicCost(card.grade) : Store.summonCost(card.grade);
    const stats =
      opts.type === 'magic'
        ? `<p class="small">${UI.esc(UI.effectText(card.effect))}</p>`
        : `<p class="small">공격 ${card.atk} · 방어 ${card.def} · 체력 ${card.hp} · 이동 ${Store.moveOf(card)}</p>`;
    box.innerHTML = `
      ${img ? `<img src="${img}" alt="" />` : `<div class="gen-card mini">${UI.esc(card.name)}</div>`}
      <p class="name">${UI.esc(card.name)} <span class="grade">${UI.esc(card.grade)}</span></p>
      <p class="small">마나 ${cost}</p>
      ${stats}
      ${fromGallery ? '<p class="scan-from-gallery">갤러리에서 불러온 카드</p>' : ''}
      ${error ? `<p class="err">${UI.esc(error)}</p>` : ''}`;
  }

  async function onSearchFocus() {
    if (searchUnlocked) return;
    $('#scan-search').blur();
    if (await UI.askPassword('이름 검색 비밀번호')) {
      searchUnlocked = true;
      $('#scan-search').focus();
    }
  }

  function onSearchInput() {
    const list = $('#scan-list');
    list.innerHTML = '';
    if (!searchUnlocked) return;
    Store.search($('#scan-search').value, opts.type).forEach((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.name} (${c.grade})`;
      li.onclick = () => choose(c, 'search');
      list.appendChild(li);
    });
  }

  function close(result) {
    stopCamera();
    $('#scan').classList.add('hidden');
    const r = resolver;
    resolver = null;
    lastSource = result ? pickedSource : null;
    if (r) r(result);
  }

  function open(options) {
    if (resolver) close(null);
    opts = options;
    picked = null;
    pickedSource = 'camera';
    $('#scan-title').textContent = options.title || '카드 스캔';
    const kind = options.type === 'magic' ? '마법 카드' : '드래곤 카드';
    $('#scan-result').textContent = PLAY_ONLY ? `${kind}의 QR코드를 비추거나 갤러리에서 불러오세요` : `${kind}의 QR코드를 비추세요`;
    if ($('#scan-search')) $('#scan-search').value = '';
    if ($('#scan-list')) $('#scan-list').innerHTML = '';
    $('#scan-ok').disabled = true;
    $('#scan').classList.remove('hidden');
    const p = new Promise((resolve) => (resolver = resolve));
    startCamera();
    return p;
  }

  function bind() {
    $('#scan-ok').onclick = () => picked && close(picked);
    $('#scan-cancel').onclick = () => close(null);
    $('#scan-retry').onclick = () => resolver && startCamera();
    if (PLAY_ONLY) {
      $('#scan-search').remove();
      $('#scan-list').remove();
      $('#scan-gallery').onclick = () => resolver && $('#scan-file').click();
      $('#scan-file').addEventListener('change', onGalleryFile);
      window.addEventListener('focus', resumeCamera);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resumeCamera());
      return;
    }
    $('#scan-gallery').remove();
    $('#scan-file').remove();
    $('#scan-search').addEventListener('focus', onSearchFocus);
    $('#scan-search').addEventListener('input', onSearchInput);
  }

  return { open, bind, lastSource: () => lastSource };
})();

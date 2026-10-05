/** 공용 UI 도우미 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UI = (() => {
  const STAGE_W = 1280;
  const STAGE_H = 800;
  let scale = 1;

  function fitStage() {
    const stage = $('#stage');
    scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  function dialog(text, { cancel = false, okText = '확인', cancelText = '취소', input = false } = {}) {
    return new Promise((resolve) => {
      const modal = $('#modal');
      const inp = $('#modal-input');
      $('#modal-text').textContent = text;
      $('#modal-ok').textContent = okText;
      $('#modal-cancel').textContent = cancelText;
      $('#modal-cancel').classList.toggle('hidden', !cancel && !input);
      inp.classList.toggle('hidden', !input);
      inp.value = '';
      modal.classList.remove('hidden');
      if (input) setTimeout(() => inp.focus(), 50);
      const done = (ok) => {
        modal.classList.add('hidden');
        $('#modal-ok').onclick = null;
        $('#modal-cancel').onclick = null;
        inp.onkeydown = null;
        resolve(input ? (ok ? inp.value : null) : ok);
      };
      $('#modal-ok').onclick = () => done(true);
      $('#modal-cancel').onclick = () => done(false);
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') done(true);
      };
    });
  }

  const alert = (text) => dialog(text);
  const confirm = (text, opts) => dialog(text, { cancel: true, ...opts });

  async function askPassword(text = '비밀번호를 입력하세요') {
    const v = await dialog(text, { input: true });
    if (v == null) return false;
    if (v === Store.PASSWORD) return true;
    await alert('비밀번호가 올바르지 않습니다.');
    return false;
  }

  let toastTimer = null;
  function toast(text, ms = 1800) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function effectText(effect) {
    if (!effect) return '';
    const names = { atk: '공격', def: '방어', hp: '체력', move: '이동' };
    const parts = Object.entries(effect.mod)
      .filter(([, v]) => v)
      .map(([k, v]) => `${names[k]} ${v > 0 ? '+' : ''}${v}`);
    const dur = effect.duration === 'perm' ? '계속' : `${effect.duration}턴`;
    const lasting = ['atk', 'def', 'move'].some((k) => effect.mod[k]);
    return `${Store.TARGETS[effect.target]} · ${parts.join(', ') || '효과 없음'}${lasting ? ` · ${dur}` : ''}`;
  }

  window.addEventListener('resize', fitStage);

  return { fitStage, showScreen, dialog, alert, confirm, askPassword, toast, esc, effectText, getScale: () => scale };
})();

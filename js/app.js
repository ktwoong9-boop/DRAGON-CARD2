(() => {
  function goMenu() {
    UI.showScreen('screen-menu');
    AudioKit.playBgm('main');
    const st = Store.status();
    const tablet = window.DCB_BUILD && window.DCB_BUILD.playOnly ? ' · 태블릿용' : '';
    $('#menu-version').textContent = `콘텐츠 v${st.baseVersion}${tablet}${st.usingLocal ? ' · 로컬 편집본 사용 중' : ''} · 드래곤 ${Store.dragons().length} · 마법 ${Store.magics().length}`;
  }

  function playOpening() {
    return new Promise((resolve) => {
      const ov = $('#opening');
      const v = $('#opening-video');
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        v.pause();
        ov.classList.add('hidden');
        resolve();
      };
      ov.classList.remove('hidden');
      v.muted = true;
      v.currentTime = 0;
      AudioKit.playBgm('main');
      v.onended = done;
      v.onerror = done;
      $('#opening-skip').onclick = done;
      v.play().catch(done);
    });
  }

  /** 태블릿용: 화면을 누를 때마다 전체화면이 아니면 다시 전체화면 (브라우저는 터치 직후에만 허용) */
  function keepFullscreen() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return;
    const installed = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    document.addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement || installed()) return;
      try {
        const p = request.call(el, { navigationUI: 'hide' });
        if (p && p.then) {
          p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}))
            .catch(() => {});
        }
      } catch (e) {
        /* 전체화면 미지원 */
      }
    }, true);
  }

  async function boot() {
    UI.fitStage();
    if (window.DCB_BUILD && window.DCB_BUILD.playOnly) keepFullscreen();
    Scan.bind();
    Game.init({ onExit: goMenu });
    Settings.init({ onExit: goMenu });
    try {
      await Store.ready();
      Sprite.setFps(Store.settings().spriteFps);
      Sprite.setTokenScale(Store.settings().tokenScale);
    } catch (e) {
      console.error(e);
      $('#gate-msg').textContent = `카드 데이터를 불러오지 못했습니다: ${e.message}`;
    }

    $('#btn-gate').onclick = async () => {
      AudioKit.ensureCtx();
      await playOpening();
      goMenu();
    };
    $('#btn-play').onclick = () => {
      AudioKit.sfx('ui');
      AudioKit.stopBgm();
      Game.start({ intro: true });
    };
    if (window.DCB_BUILD && window.DCB_BUILD.playOnly) {
      $('#btn-settings').remove();
    } else {
      $('#btn-settings').onclick = () => {
        AudioKit.sfx('ui');
        Settings.open();
      };
    }
  }

  boot();
})();

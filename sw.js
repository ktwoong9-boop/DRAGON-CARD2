// 설치(홈 화면 추가)용 서비스워커 — 캐시하지 않고 항상 네트워크에서 받습니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

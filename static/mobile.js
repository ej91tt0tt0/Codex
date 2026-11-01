/* Mobile web install affordance. Native app builds are not needed yet. */
(() => {
  'use strict';
  const button = document.getElementById('mobile-install');
  const hint = document.getElementById('mobile-install-hint');
  let promptEvent = null;

  function instructions() {
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (iOS) return 'iPhoneはSafariでこのHTTPSページを開き、共有ボタンから「ホーム画面に追加」を選んでください。';
    if (/Android/i.test(navigator.userAgent))
      return 'AndroidはChromeのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。';
    return 'スマホのブラウザメニューから「ホーム画面に追加」を選んでください。';
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event;
    if (button) button.textContent = 'ASTERをホーム画面に追加';
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    if (hint) hint.textContent = 'ホーム画面に追加しました。';
    if (button) button.textContent = 'ホーム画面に追加する方法';
  });
  if (button) {
    button.addEventListener('click', async () => {
      if (!promptEvent) {
        if (hint) hint.textContent = instructions();
        return;
      }
      const current = promptEvent;
      promptEvent = null;
      try {
        await current.prompt();
        const choice = await current.userChoice;
        if (hint) hint.textContent = choice.outcome === 'accepted'
          ? '追加しました。ホーム画面からASTERを開けます。'
          : instructions();
      } catch {
        if (hint) hint.textContent = instructions();
      }
    });
  }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(() => {});
    }, { once: true });
  }
})();

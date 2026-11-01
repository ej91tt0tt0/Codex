/* ASTER conversation archive. Escapes all transcript content with textContent. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let items = [];
  let selected = null;
  let requestSerial = 0;
  const isID = (id) => /^[a-f0-9]{32}$/.test(id);
  const dateText = (date) => {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(date));
    } catch { return date || ''; }
  };
  async function api(path, body) {
    const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) } : {};
    const response = await fetch(path, opts);
    if (!response.ok) {
      let error = '記録を読み込めませんでした。';
      try { error = (await response.json()).error || error; } catch {}
      throw new Error(error);
    }
    return response.json();
  }
  function line(parent, className, value, tag = 'span') {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = value;
    parent.append(el);
    return el;
  }
  function statusText(item) {
    return item.status === 'ready' ? '要約済み'
      : item.status === 'failed' ? '要約に失敗（全文は保存済み）'
      : 'AI要約を生成中';
  }
  function renderList() {
    const list = $('archive-list');
    list.replaceChildren();
    if (!items.length) {
      line(list, 'hint', 'まだ会話記録がありません。Live通話の終了後に保存されます。', 'p');
      return;
    }
    for (const item of items) {
      const link = document.createElement('a');
      link.href = '#' + item.id;
      link.classList.toggle('active', item.id === selected);
      link.setAttribute('aria-current', item.id === selected ? 'true' : 'false');
      line(link, 'archive-item-date', dateText(item.started));
      line(link, 'archive-item-summary',
        item.status === 'ready' && item.summary ? item.summary
          : '音声会話の記録が保存されています。');
      line(link, 'archive-item-status', statusText(item));
      list.append(link);
    }
  }
  async function refreshList(choose = true) {
    try {
      const data = await api('/api/live/archives');
      items = data.archives || [];
      $('archive-list-status').textContent = items.length + '件の会話記録';
      if (choose) {
        const hash = location.hash.slice(1);
        selected = isID(hash) && items.some(x => x.id === hash) ? hash : (items[0]?.id || null);
      }
      renderList();
      if (selected) await loadDetail(selected);
      else {
        $('archive-detail-content').hidden = true;
        $('archive-detail-status').textContent = '会話記録を選んでください。';
      }
    } catch (error) {
      $('archive-list-status').textContent = error.message;
    }
  }
  async function loadDetail(id) {
    if (!isID(id)) return;
    selected = id;
    const serial = ++requestSerial;
    $('archive-detail-status').textContent = '会話を読み込み中…';
    $('archive-detail-content').hidden = true;
    renderList();
    try {
      const { archive } = await api('/api/live/archive?id=' + encodeURIComponent(id));
      if (serial !== requestSerial || selected !== id) return;
      $('archive-detail-status').textContent = '';
      $('archive-detail-content').hidden = false;
      $('archive-detail-title').textContent = '会話 ' + dateText(archive.started);
      $('archive-detail-date').textContent =
        '開始：' + dateText(archive.started) + '　終了：' + dateText(archive.ended);
      $('archive-summary').textContent =
        archive.status === 'ready' ? archive.summary
          : archive.status === 'failed'
            ? 'AI要約を作成できませんでした。下の会話全文は保存されています。'
            : 'AIが要約を生成しています。しばらくしてから更新してください。';
      const actions = $('archive-summary-actions');
      actions.replaceChildren();
      if (archive.status === 'failed') {
        const retry = document.createElement('button');
        retry.textContent = '要約を再試行';
        retry.className = 'secondary';
        retry.type = 'button';
        retry.onclick = async () => {
          retry.disabled = true;
          try { await api('/api/live/archive/retry', { id }); await refreshList(false); }
          catch (error) { $('archive-detail-status').textContent = error.message; retry.disabled = false; }
        };
        actions.append(retry);
      }
      const topics = $('archive-topics');
      topics.replaceChildren();
      if (archive.topics.length) {
        archive.topics.forEach(t => line(topics, '', t));
      } else {
        line(topics, 'hint', archive.status === 'ready' ? '特記するトピックなし' : '要約完了後に表示');
      }
      const transcript = $('archive-transcript');
      transcript.replaceChildren();
      for (const turn of archive.turns) {
        const p = document.createElement('p');
        p.className = 'archive-turn' + (turn.speaker === 'ASTER' ? ' aster-turn' : '');
        line(p, '', turn.speaker + '：', 'strong');
        line(p, '', turn.text);
        transcript.append(p);
      }
      $('archive-copy').onclick = async () => {
        const content = archive.turns.map(x => x.speaker + '：' + x.text).join('\n\n');
        try {
          await navigator.clipboard.writeText(content);
          $('archive-detail-status').textContent = '会話全文をコピーしました。';
        } catch { $('archive-detail-status').textContent = 'コピーできませんでした。ブラウザの権限を確認してください。'; }
      };
      $('archive-delete').onclick = async () => {
        if (!confirm('この会話の要約・重要トピック・全文を削除します。元に戻せません。よろしいですか？')) return;
        try {
          await api('/api/live/archive/delete', { id });
          if (location.hash === '#' + id) history.replaceState(null, '', '/archive');
          selected = null;
          await refreshList(true);
        } catch (error) { $('archive-detail-status').textContent = error.message; }
      };
    } catch (error) {
      if (serial === requestSerial) $('archive-detail-status').textContent = error.message;
    }
  }
  $('archive-refresh').addEventListener('click', () => refreshList(true));
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (isID(id)) loadDetail(id);
  });
  // Poll only while summaries are pending; no network requests while the tab is hidden.
  setInterval(() => {
    if (document.hidden || !items.some(item => item.status === 'pending')) return;
    refreshList(false);
  }, 7000);
  refreshList(true);
})();

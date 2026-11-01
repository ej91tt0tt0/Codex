const $ = (id) => document.getElementById(id);
const HOME_LIVE_DEFAULT = Boolean($('live-orb-action'));
if (HOME_LIVE_DEFAULT) document.body.classList.add('home-live-mode');
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
async function api(path, body) {
  companion?.checkRequest(path, body);
  const r = await fetch(
    '/api/' + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) {
    const error = Error(data.error || '通信に失敗しました');
    error.status = r.status;
    throw error;
  }
  return data;
}
let companion = null;
let latestSnapshotRevision = 0;
let currentRequests = [];
let latestReply = '';
const serverFieldValues = new Map();
function syncField(id, value) {
  const n = $(id),
    property = typeof value === 'boolean' ? 'checked' : 'value';
  value = typeof value === 'boolean' ? value : String(value ?? '');
  if (!serverFieldValues.has(id) || serverFieldValues.get(id) !== value) {
    n[property] = value;
    serverFieldValues.set(id, value);
  }
}
const collectionSignatures = new Map();
function changedCollection(id, value) {
  const signature = JSON.stringify(value);
  if (collectionSignatures.get(id) === signature) return false;
  collectionSignatures.set(id, signature);
  return true;
}
function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}
let memorySearchRows = null;
let memorySearchQuery = '';
let memorySearchSequence = 0;
function resetMemorySearch() {
  memorySearchRows = null;
  memorySearchQuery = '';
  memorySearchSequence++;
  $('memory-search').value = '';
  $('memory-search-status').textContent = '最新100件を表示。古い記憶は検索できます。';
  collectionSignatures.delete('memory-list');
}
let activeMapsUrl = '';
let researchRequestBusy = false;
$('notice-close').onclick = () => {
  $('notice').textContent = '';
};
new MutationObserver(() => {
  $('notice-box').hidden = !$('notice').textContent.trim();
}).observe($('notice'), { childList: true, characterData: true, subtree: true });
function empty(node, text) {
  if (!node.children.length) node.append(el('p', text, 'empty'));
}
function isMapsUrl(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.host === 'www.google.com' &&
      !u.hash &&
      (u.pathname === '/maps/' || u.pathname === '/maps/dir/')
    );
  } catch {
    return false;
  }
}
function jstTime(value) {
  if (!value) return '時刻不明';
  const text = String(value),
    date = new Date(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text,
    );
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '（日本時間）'
    : '時刻不明';
}
function sourceNotes(sources) {
  const methods = new Set((sources || []).map((s) => s.method)),
    notes = [];
  if (methods.has('public_news'))
    notes.push('公開ニュースの見出し・配信要約を参照。記事本文は未取得。');
  if (methods.has('jma_forecast'))
    notes.push('気象庁の愛知県西部の予報を参照。現在の実況ではない。');
  return notes;
}
function sourceLinks(run) {
  const node = el('div', null, 'source-links');
  node.append(
    el(
      'p',
      '調査: ' +
        new Date(run.fetched_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
        '（日本時間）・記事の発表時刻とは異なる',
      'hint',
    ),
  );
  for (const note of sourceNotes(run.sources)) node.append(el('p', note, 'hint'));
  for (const source of run.sources || []) {
    let url;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    const a = el('a', (source.cited ? '引用元: ' : '参考: ') + source.title + ' ↗');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.onclick = () => {
      if (!voice.handsFree) voice.stop();
    };
    node.append(a);
    if (source.published_at) node.append(el('p', '発表: ' + jstTime(source.published_at), 'hint'));
  }
  return node;
}
function render(s) {
  const revision = Number(s.snapshot_revision || 0);
  if (revision && revision < latestSnapshotRevision) return;
  if (revision) latestSnapshotRevision = revision;
  const persistent = s;
  s = companion ? companion.viewState(s) : s;
  $('status').title = 'ASTER ' + (s.version || '1.1.0') + ' · AI接続の確認はメニューから';
  $('status').textContent = s.ai_connected ? '● APIキー設定済み' : '○ 記録モード';
  const lastUser = s.messages.filter((m) => m.role === 'user').at(-1);
  const mapsAction = (s.external_actions || []).find((a) => a.user_message_id === lastUser?.id);
  activeMapsUrl = mapsAction && isMapsUrl(mapsAction.url) ? mapsAction.url : '';
  $('external-action').hidden = !activeMapsUrl;
  if (activeMapsUrl) {
    $('action-open').href = activeMapsUrl;
    $('action-open').textContent =
      mapsAction.kind === 'google_maps_driving'
        ? 'Googleマップで車ナビを開く ↗'
        : 'Googleマップを開く ↗';
    $('action-route').textContent =
      mapsAction.kind === 'google_maps_driving'
        ? (mapsAction.origin || '現在地（Googleマップで取得）') + ' → ' + mapsAction.destination
        : 'Googleマップ';
    $('action-status').textContent =
      mapsAction.status === 'sent'
        ? 'PCへ開く操作を送ったよ。開かなければ下のボタンを使ってね。'
        : mapsAction.status === 'retry'
          ? '自動で開けなかったよ。下のボタンから開けるよ。'
          : '下のボタンからGoogleマップを開けるよ。';
  }
  currentRequests = s.improvement_requests || [];
  if (changedCollection('improvement-list', currentRequests)) {
    $('improvement-list').replaceChildren();
    for (const req of currentRequests) {
      const row = el('div', null, 'card');
      row.append(el('small', req.status + ' · ' + jstTime(req.created)), el('p', req.content));
      $('improvement-list').append(row);
    }
    empty($('improvement-list'), '改善リクエストはまだないよ。');
  }
  const lastReply = s.messages.filter((m) => m.role === 'assistant').at(-1);
  latestReply = lastReply?.content || '';
  $('reply-actions').hidden = !latestReply;
  $('session-privacy').textContent = companion?.isTemporary
    ? '一時チャット · アプリに保存しない'
    : '通常の会話 · このPCに保存';
  setText('latest-reply', lastReply?.content || '');
  $('latest-reply').hidden = !lastReply;
  $('voice-greeting').hidden = Boolean(lastReply);
  const research = s.research_runs || [],
    latestResearch = research.find((r) => r.message_id === lastReply?.id && !r.error);
  $('research-sources').hidden = !latestResearch;
  if (changedCollection('latest-sources', latestResearch)) {
    $('latest-sources').replaceChildren();
    if (latestResearch) $('latest-sources').append(sourceLinks(latestResearch));
  }
  if (changedCollection('messages', [s.messages, research.filter((r) => r.message_id)])) {
    const historyNode = $('messages'),
      historyAtBottom =
        historyNode.scrollHeight - historyNode.scrollTop - historyNode.clientHeight < 60;
    $('messages').replaceChildren();
    for (const m of s.messages) {
      const n = el('div', null, 'bubble ' + m.role);
      n.append(
        el('small', m.role === 'user' ? 'YOU' : 'ASTER'),
        document.createTextNode(m.content),
      );
      const evidence = research.find((r) => r.message_id === m.id && !r.error);
      if (evidence) {
        const d = el('details');
        d.append(el('summary', '出典を確認'), sourceLinks(evidence));
        n.append(d);
      }
      $('messages').append(n);
    }
    empty($('messages'), 'ここは、あなたのための会話スペース。');
    if (historyAtBottom) $('messages').scrollTop = $('messages').scrollHeight;
  }
  if (
    changedCollection('research-list', research.filter((r) => r.kind === 'scheduled').slice(0, 5))
  ) {
    $('research-list').replaceChildren();
    for (const r of research.filter((r) => r.kind === 'scheduled').slice(0, 5)) {
      const n = el('div', null, 'card research-result');
      n.append(el('p', r.error || r.answer));
      if (r.error)
        n.append(
          el(
            'p',
            new Date(r.fetched_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
              '（日本時間）・取得失敗',
            'hint',
          ),
        );
      else n.append(sourceLinks(r));
      $('research-list').append(n);
    }
    empty($('research-list'), 'AIの定時調査はまだないよ。「AIで今すぐ調査」で確認できるよ。');
  }
  $('web-search').checked = s.settings.web_search === 'true';
  $('ai-collect').checked = s.settings.ai_collect === 'true';
  $('research-status').textContent = !s.ai_connected
    ? 'AIの調査には起動時にOpenAI APIキーを設定してね。'
    : s.settings.web_search !== 'true'
      ? 'Web検索はオフ。'
      : s.settings.ai_collect === 'true' && s.settings.automatic === 'true'
        ? '定時調査オン。最終試行: ' +
          (s.settings.last_research_attempt
            ? new Date(s.settings.last_research_attempt).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
              })
            : 'まだないよ')
        : '定時調査オフ。手動の調査は使えるよ。';
  if (changedCollection('health-list', s.health)) {
    $('health-list').replaceChildren();
    for (const h of s.health) {
      const n = el('div', null, 'card');
      n.append(
        el('small', jstTime(h.created)),
        el('h2', '体調 ' + h.mood + ' / 5'),
        el('p', h.note),
      );
      $('health-list').append(n);
    }
    empty($('health-list'), 'まだ記録がありません。');
  }
  $('memory-count').textContent = 'PCに保存済み：' + (s.memory_total ?? s.memories.length) + '件'
    + (s.settings.auto_memory === 'true' ? ' · 自動記憶オン' : ' · 自動記憶オフ');
  const displayedMemories = memorySearchRows ?? s.memories;
  if (changedCollection('memory-list', [displayedMemories, memorySearchQuery])) {
    $('memory-list').replaceChildren();
    for (const m of displayedMemories) {
      const n = el('div', null, 'card row memory-item');
      const details = el('div', null, 'memory-item-content');
      const origin = m.source === 'auto-live' ? 'Liveから自動記憶'
        : m.source === 'auto-chat' ? '通常チャットから自動記憶' : '手動記憶';
      const meta = el('small', origin + (m.updated || m.created ? ' · ' + jstTime(m.updated || m.created) : ''), 'memory-item-origin');
      details.append(el('span', m.content), meta);
      const controls = el('div', null, 'memory-item-actions');
      const edit = el('button', '編集', 'secondary');
      edit.type = 'button';
      edit.onclick = () => {
        const content = prompt('記憶を編集', m.content);
        if (content?.trim()) {
          resetMemorySearch();
          run(() => api('memory', { id: m.id, content }));
        }
      };
      const del = el('button', '削除', 'secondary');
      del.type = 'button';
      del.onclick = () => {
        if (!confirm('この長期記憶を削除しますか？')) return;
        resetMemorySearch();
        run(() => api('memory', { id: m.id, delete: true }));
      };
      controls.append(edit, del);
      n.append(details, controls);
      $('memory-list').append(n);
    }
    empty($('memory-list'), memorySearchQuery ? '一致する記憶がありません。' : 'まだ記憶がありません。');
  }
  if (changedCollection('news-list', s.news)) {
    $('news-list').replaceChildren();
    for (const item of s.news) {
      const n = el('div', null, 'card');
      const a = el('a', item.title);
      let newsUrl;
      try {
        newsUrl = new URL(item.url);
      } catch {
        continue;
      }
      if (newsUrl.protocol !== 'https:' || newsUrl.username || newsUrl.password) continue;
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      n.append(a, el('p', '記事の発表: ' + jstTime(item.published), 'hint'));
      $('news-list').append(n);
    }
    empty($('news-list'), 'テーマを設定してニュースを収集しましょう。');
  }
  if (
    changedCollection('weather-info', [
      s.weather,
      Boolean(s.weather?.fetched_at && Date.now() - Date.parse(s.weather.fetched_at) > 7200000),
    ])
  ) {
    $('weather-info').replaceChildren();
    const weather = s.weather;
    if (weather?.days?.length) {
      $('weather-info').append(
        el('h2', weather.area),
        el(
          'p',
          '発表: ' +
            new Date(weather.reported_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
            '（日本時間）',
          'hint',
        ),
        el(
          'p',
          '取得: ' +
            new Date(weather.fetched_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
            '（日本時間）',
          'hint',
        ),
      );
      for (const day of weather.days)
        $('weather-info').append(
          el(
            'p',
            new Date(day.time).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
              ' · ' +
              day.weather,
          ),
        );
      if (Date.now() - Date.parse(weather.fetched_at) > 7200000)
        $('weather-info').append(
          el('p', '取得から2時間以上経過しています。更新して確認してください。', 'hint'),
        );
    } else $('weather-info').append(el('p', '天気はまだ取得していません。', 'hint'));
    if (weather?.error) $('weather-info').append(el('p', weather.error, 'hint'));
  }
  if (typeof voice !== 'undefined') {
    const cfg = s.settings;
    voice.speechRate = Number(cfg.speech_speed || 1.12);
    $('speech-speed').value = cfg.speech_speed || '1.12';
    $('speech-register').value = cfg.speech_register || 'casual';
    $('reply-style').value = cfg.reply_style || 'normal';
    syncField('custom-preferences', cfg.custom_preferences || '');
    $('natural-voice').checked = cfg.natural_voice === 'true';
    voice.useNatural = s.ai_connected && cfg.natural_voice === 'true';
    const quality = s.ai_connected && cfg.high_quality_input !== 'false';
    if (voice.active && quality !== voice.highQualityEnabled) handsfree.stop();
    voice.highQualityEnabled = quality;
    $('high-quality-input').checked = cfg.high_quality_input !== 'false';
    $('hands-free').checked = cfg.hands_free === 'true';
    if (HOME_LIVE_DEFAULT && cfg.interaction_mode === 'text' &&
        window.AsterLiveHome?.isActive?.()) window.AsterLiveHome.stop();
    handsfree.configure(!HOME_LIVE_DEFAULT && cfg.hands_free === 'true' && cfg.interaction_mode !== 'text');
    const enabled = cfg.proactive_enabled === 'true',
      interval = Number(cfg.proactive_interval || 600) * 1000;
    if (voice.proactiveEnabled !== enabled || voice.idleMilliseconds !== interval) {
      voice.proactiveEnabled = enabled;
      voice.idleMilliseconds = interval;
      voice.armIdle();
    }
    $('proactive-enabled').checked = enabled;
    $('proactive-interval').value = String(interval / 1000);
    $('proactive-topics').checked = cfg.proactive_topics === 'true';
  }
  syncField('regional-topics', s.settings.regional_topics || '');
  syncField('topics', s.settings.topics);
  syncField('automatic', s.settings.automatic === 'true');
  $('remember').checked = s.settings.remember === 'true';
  $('last-collected').textContent = s.settings.last_collected
    ? '最終収集: ' +
      new Date(s.settings.last_collected).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) +
      '（日本時間）'
    : 'まだ収集していません。';
  companion?.render(persistent);
}
async function run(fn, button) {
  $('notice').textContent = '';
  if (button) button.disabled = true;
  try {
    render(await fn());
    if (
      button?.closest('form') &&
      ['health-form', 'memory-form', 'news-form', 'preferences-form'].includes(
        button.closest('form').id,
      )
    )
      $('notice').textContent = '保存したよ。';
    return true;
  } catch (e) {
    $('notice').textContent = e.message;
    try {
      render(await api('state'));
    } catch {}
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}
for (const b of document.querySelectorAll('[data-tab]'))
  b.onclick = () => {
    if (b.dataset.tab !== 'chat' && !voice.handsFree) voice.stop();
    document.querySelectorAll('.panel').forEach((n) => (n.hidden = n.id !== b.dataset.tab));
    document
      .querySelectorAll('[data-tab]')
      .forEach((n) =>
        n.classList.toggle(
          'active',
          n.dataset.tab === b.dataset.tab || (n.id === 'menu-button' && b.dataset.tab !== 'chat'),
        ),
      );
    voice.armIdle();
    window.scrollTo(0, 0);
  };
// The text workspace owns the message form; return to the Live cockpit
// without losing the user's saved voice/text mode or their draft.
$('text-workspace-to-voice').onclick = async (event) => {
  // Switch the saved preference without auto-starting the legacy microphone:
  // the main cockpit's TALK button remains the explicit Live start control.
  if ($('interaction-mode').value === 'text') {
    const ok = await companion.perform(
      () => companion.preferences({ interaction_mode: 'voice' }),
      event.currentTarget,
    );
    if (!ok) return;
  }
  document.querySelector('header [data-tab=chat]').click();
};
$('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const draft = $('message').value,
    content = draft.trim() || (companion.pendingImage ? 'この写真をきっかけに話そう。' : '');
  if (!content) return;
  if ((await voice.ask(content)) && $('message').value === draft) $('message').value = '';
};
$('health-form').onsubmit = async (e) => {
  e.preventDefault();
  if (
    await run(
      () => api('health', { mood: Number($('mood').value), note: $('health-note').value }),
      e.submitter,
    )
  )
    $('health-note').value = '';
};
$('memory-search-form').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('memory-search').value.trim().slice(0, 150);
  const sequence = ++memorySearchSequence;
  $('memory-search-status').textContent = '記憶を検索しています…';
  try {
    if (companion?.isTemporary) throw Error('一時チャット中は保存済みの記憶を検索できません。');
    const response = await fetch('/api/memories?q=' + encodeURIComponent(q), { cache: 'no-store' });
    if (!response.ok) throw Error('記憶を検索できませんでした。');
    const result = await response.json();
    if (sequence !== memorySearchSequence) return;
    memorySearchRows = result.memories;
    memorySearchQuery = q;
    $('memory-search-status').textContent = q
      ? '検索結果：' + result.memories.length + '件（最大50件）'
      : '最新50件を表示しています。';
    collectionSignatures.delete('memory-list');
    render(await api('state'));
  } catch (error) {
    if (sequence === memorySearchSequence) $('memory-search-status').textContent = error.message;
  }
};
$('memory-search-reset').onclick = async () => {
  resetMemorySearch();
  render(await api('state'));
};
$('memory-form').onsubmit = async (e) => {
  e.preventDefault();
  if (await run(() => api('memory', { content: $('memory-content').value }), e.submitter))
    $('memory-content').value = '';
};
$('news-form').onsubmit = (e) => {
  e.preventDefault();
  run(
    () =>
      api('settings', {
        topics: $('topics').value,
        regional_topics: $('regional-topics').value,
        automatic: String($('automatic').checked),
      }),
    e.submitter,
  );
};
$('remember').onchange = () =>
  run(() => api('settings', { remember: String($('remember').checked) }));
$('weather-refresh').onclick = (e) => run(() => api('weather', {}), e.target);
$('collect').onclick = (e) => run(() => api('collect', {}), e.target);
$('research-now').onclick = (e) => {
  const button = e.target;
  researchRequestBusy = true;
  button.textContent = 'AIが調査中…';
  $('research-status').textContent = '検索・出典の確認・要約をしているよ…';
  run(() => api('research', {}), button).finally(() => {
    button.textContent = 'AIで今すぐ調査';
    researchRequestBusy = false;
  });
};
for (const [id, key] of [
  ['web-search', 'web_search'],
  ['ai-collect', 'ai_collect'],
])
  $(id).onchange = () => run(() => api('settings', { [key]: String($(id).checked) }));
$('clear').onclick = () => {
  if (voice.busy) {
    $('notice').textContent = '応答が完了してから削除してください。';
    return;
  }
  if (
    confirm(
      '会話・会話記録・体調・記憶・記事・改善リクエスト・連携履歴・AI調査・日記・目標・通知・プロフィールをすべて削除します。元に戻せません。',
    )
  ) {
    handsfree.stop();
    run(() => api('clear', {}));
  }
};
$('route-form').onsubmit = async (e) => {
  e.preventDefault();
  if (
    await run(
      () => api('navigation', { destination: $('destination').value, origin: $('origin').value }),
      e.submitter,
    )
  )
    document.querySelector('header [data-tab=chat]').click();
};
$('action-open').onclick = () => {
  if (!voice.handsFree) voice.stop();
};
$('copy-route').onclick = async () => {
  if (!activeMapsUrl) return;
  try {
    await navigator.clipboard.writeText(activeMapsUrl);
    $('action-status').textContent = 'リンクをコピーしたよ。スマホで開けばGoogleマップへ渡せるよ。';
  } catch {
    prompt('このリンクをコピーしてスマホで開いてね', activeMapsUrl);
  }
};
$('search-form').onsubmit = async (e) => {
  e.preventDefault();
  const query = $('query').value.trim();
  if (!query) return;
  document.querySelector('header [data-tab=chat]').click();
  await voice.ask('Webで調べて：' + query);
};
const scope = new AsterScope.ScopeView($('voice-scope'), $('input-level'));
let selectedMicId = '';
try {
  selectedMicId = localStorage.getItem('aster.input.device') || '';
} catch {}
function saveMicChoice(value) {
  selectedMicId = value;
  try {
    if (value) localStorage.setItem('aster.input.device', value);
    else localStorage.removeItem('aster.input.device');
  } catch {}
}
const microphone = new AsterInput.DuplexInput({
  deviceId: selectedMicId,
  onDeviceFallback: () => {
    saveMicChoice('');
    $('input-device').value = '';
    $('input-device-status').textContent =
      '選んだマイクが見つからなかったので、システム既定のマイクへ戻したよ。';
  },
  onStart: () => voice.hearStart(),
  onText: (text) => {
    if (voice.active) {
      $('voice-transcript').textContent = '聞き取り: ' + text;
      void voice.ask(text);
    }
  },
  onVolume: (level, spectrum) => scope.draw(level, spectrum),
  onState: (state) => voice.inputState(state),
  onError: (message, { fatal = false } = {}) => {
    if (fatal || !voice.handsFree) handsfree.close();
    $('voice-status').textContent = message;
  },
});
const voice = new AsterVoice.VoiceController({
  duplexInput: microphone,
  naturalSpeaker: new AsterAudio.NaturalSpeaker({
    onPlaying: () => {
      $('voice-status').textContent = '話してるよ…';
    },
  }),
  proactive: async (kind) => {
    const s = await api('proactive', { kind });
    render(s);
    return s.messages[s.messages.length - 1].content;
  },
  Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  synth: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  send: async (content) => {
    $('notice').textContent = '';
    const answer = await companion.send(content);
    $('voice-transcript').textContent = '';
    return answer;
  },
  status: (text) => {
    $('voice-status').textContent = text;
  },
  greeting: (text) => {
    $('voice-greeting').textContent = text;
  },
  transcript: (text) => {
    $('voice-transcript').textContent = text ? '聞き取り: ' + text : '';
  },
  state: (s) => {
    handsfree.observe(s);
    $('input-device').disabled = s.busy || !voice.usingDuplex;
    $('refresh-devices').disabled = !voice.usingDuplex;
    $('voice-start').disabled = (!voice.Recognition && !voice.usingDuplex) || s.active || s.busy;
    $('voice-stop').disabled = !(s.active || s.speaking || s.busy);
    if (!s.listening && (!HOME_LIVE_DEFAULT || voice.active)) $('input-level').textContent = 'MIC OFF';
    $('voice-greet').disabled = s.busy;
    $('photo-input').disabled = s.busy || s.speaking;
    $('photo-clear').disabled = s.busy || s.speaking;
    const sendButton = $('chat-form').querySelector('button');
    sendButton.disabled = voice.pendingInputs.length >= 6;
    sendButton.textContent = s.busy ? '追加を送信' : '送信 ↗';
    $('temporary-chat').disabled = s.busy;
    $('voice-interrupt').disabled = !s.active || (s.busy && !s.speaking);
    if (!HOME_LIVE_DEFAULT || voice.active) {
    document.querySelector('.voice-orb').classList.toggle('speaking', s.speaking);
    document.querySelector('.voice-orb').classList.toggle('thinking', s.busy && !s.speaking);
    $('orb-state').textContent = voice.inputSpeaking
      ? 'LISTENING'
      : voice.inputPending
        ? 'RECOGNIZING'
        : s.speaking
          ? 'SPEAKING'
          : s.busy
            ? 'THINKING'
            : s.active
              ? 'LISTENING'
              : 'READY';
    $('replay-reply').disabled = s.busy || (s.speaking && !voice.replaying);
    $('replay-reply').textContent = voice.replaying ? '読み上げを止める' : 'もう一度聞く';
    $('replay-reply').setAttribute(
      'aria-label',
      voice.replaying ? '再読み上げを停止' : 'ASTERの直前の返答をもう一度聞く',
    );
    $('voice-start').textContent = s.active ? '● 従来方式で会話中' : '従来方式で開始';
    const live =
      s.listening &&
      (!voice.usingDuplex ||
        (microphone.context?.state === 'running' &&
          !microphone.stream?.getAudioTracks().some((t) => t.muted)));
    $('mic-toggle').textContent = s.active
      ? live
        ? voice.inputSpeaking
          ? '● 聞き取り中'
          : voice.handsFree
            ? '● 声を待ち受け中'
            : '● マイク使用中'
        : 'マイクを確認'
      : 'マイク停止中';
    $('mic-toggle').classList.toggle('mic-live', live);
    $('mic-toggle').setAttribute('aria-pressed', String(s.active));
    $('mic-toggle').setAttribute(
      'aria-label',
      s.active ? 'マイク待ち受けを停止' : 'マイク待ち受けを開始',
    );
    document.querySelector('.voice-orb').classList.toggle('listening', s.listening);
    }
  },
});
let sessionStorageForMic = null;
try {
  sessionStorageForMic = window.sessionStorage;
} catch {}
const handsfree = new AsterHandsFree.HandsFreeSession({
  voice,
  storage: sessionStorageForMic,
  status: (text) => {
    $('voice-status').textContent = text;
  },
});
if (HOME_LIVE_DEFAULT) {
  window.AsterClassic = {
    isActive: () => voice.active,
    stop: () => {
      handsfree.close();
      document.body.classList.remove('classic-home-active');
    },
  };
}
companion = new AsterCompanion.CompanionUI({
  api,
  voice,
  handsfree,
  render,
  goChat: () => document.querySelector('header [data-tab=chat]').click(),
});
voice.beforeInput = (text) => handsfree.handleCommand(text);
voice.canInitiate = () =>
  (!HOME_LIVE_DEFAULT || voice.active) && !document.hidden && !$('chat').hidden && !companion.isTemporary && companion.channel === 'voice';
async function refreshMicDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'audioinput',
    );
    const select = $('input-device');
    select.replaceChildren(new Option('システム既定のマイク', ''));
    for (const [index, device] of devices.entries()) {
      if (device.deviceId)
        select.append(new Option(device.label || 'マイク ' + (index + 1), device.deviceId));
    }
    if (selectedMicId && !devices.some((d) => d.deviceId === selectedMicId))
      select.append(new Option('保存したマイク（接続を確認してね）', selectedMicId));
    select.value = selectedMicId;
  } catch {
    $('input-device-status').textContent =
      'マイクの一覧を読み込めなかったよ。ブラウザの権限を確認してね。';
  }
}
$('refresh-devices').onclick = refreshMicDevices;
$('input-device').onchange = async () => {
  const wasActive = voice.active;
  if (voice.busy) {
    $('input-device').value = selectedMicId;
    return;
  }
  if (wasActive) handsfree.close();
  saveMicChoice($('input-device').value);
  microphone.deviceId = selectedMicId;
  if (wasActive) await handsfree.start();
  $('input-device-status').textContent = selectedMicId
    ? 'マイクの選択を変更したよ。音量メーターの反応を確認してね。'
    : 'システム既定のマイクを使うよ。音量メーターの反応を確認してね。';
};
navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicDevices);
$('voice-start').onclick = async () => {
  if (HOME_LIVE_DEFAULT && window.AsterLiveHome?.isActive?.()) {
    $('voice-status').textContent = 'Live音声を終了してから従来方式を開始してください。';
    return;
  }
  if (HOME_LIVE_DEFAULT) document.body.classList.add('classic-home-active');
  await companion.startVoice();
  await refreshMicDevices();
};
$('mic-toggle').onclick = async () => {
  if (HOME_LIVE_DEFAULT && !voice.active) {
    window.AsterLiveHome?.toggle?.();
    return;
  }
  if (voice.active) {
    if (voice.usingDuplex && microphone.context?.state === 'suspended') {
      try {
        await microphone.resume();
        return;
      } catch {}
    }
    handsfree.stop();
    if (HOME_LIVE_DEFAULT) {
      document.body.classList.remove('classic-home-active');
      window.AsterLiveHome?.refresh?.();
    }
  } else await companion.startVoice();
};
$('hands-free').onchange = async () => {
  const enabled = $('hands-free').checked;
  if (!enabled) handsfree.stop();
  if (await run(() => api('settings', { hands_free: String(enabled) }))) {
    if (enabled && !HOME_LIVE_DEFAULT) await handsfree.start();
  }
};
$('voice-interrupt').onclick = () => voice.interrupt();
$('message').addEventListener('input', () => voice.armIdle());
$('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    if (voice.pendingInputs.length < 6) $('chat-form').requestSubmit();
  }
});
$('copy-reply').onclick = async () => {
  if (!latestReply) return;
  try {
    await navigator.clipboard.writeText(latestReply);
    $('notice').textContent = '返答をコピーしたよ。';
  } catch {
    $('notice').textContent = 'コピーできなかったよ。返答の文字を選んでコピーしてね。';
  }
};
$('replay-reply').onclick = () =>
  voice.replaying ? voice.stopReplay() : voice.replay(latestReply);
function updateClock() {
  const now = new Date();
  $('local-clock').dateTime = now.toISOString();
  $('local-clock').textContent =
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now) + ' JST';
}
updateClock();
setInterval(updateClock, 30000);
for (const id of [
  'natural-voice',
  'proactive-enabled',
  'proactive-interval',
  'proactive-topics',
  'high-quality-input',
])
  $(id).onchange = () =>
    run(() =>
      api('settings', {
        high_quality_input: String($('high-quality-input').checked),
        natural_voice: String($('natural-voice').checked),
        proactive_enabled: String($('proactive-enabled').checked),
        proactive_interval: $('proactive-interval').value,
        proactive_topics: String($('proactive-topics').checked),
      }),
    );
for (const [id, key] of [
  ['speech-speed', 'speech_speed'],
  ['speech-register', 'speech_register'],
  ['reply-style', 'reply_style'],
])
  $(id).onchange = () => run(() => companion.preferences({ [key]: $(id).value }));
$('preferences-form').onsubmit = (e) => {
  e.preventDefault();
  run(() => api('settings', { custom_preferences: $('custom-preferences').value }), e.submitter);
};
$('export-requests').onclick = () => {
  const blob = new Blob(
    [
      currentRequests
        .map((r) => '[' + r.status + '] ' + jstTime(r.created) + '\n' + r.content)
        .join('\n\n') || '改善リクエストはまだないよ。',
    ],
    { type: 'text/plain;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aster-improvement-requests.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('voice-stop').onclick = () => {
  handsfree.stop();
  if (HOME_LIVE_DEFAULT) {
    document.body.classList.remove('classic-home-active');
    window.AsterLiveHome?.refresh?.();
  }
};
$('voice-greet').onclick = () => {
  document.querySelector('header [data-tab=chat]').click();
  voice.replayGreeting();
};
$('voice-read').onchange = () => {
  voice.readEnabled = $('voice-read').checked;
  if (!voice.readEnabled) voice.cancelSpeech();
};
if (!voice.Recognition && !voice.usingDuplex) {
  $('text-input').open = true;
  $('input-device').disabled = s.busy || !voice.usingDuplex;
  $('refresh-devices').disabled = !voice.usingDuplex;
  $('voice-start').disabled = true;
}
window.addEventListener('pagehide', () => {
  if (companion.isTemporary) handsfree.stop();
  else handsfree.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void handsfree.restore();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !voice.handsFree) voice.stop();
  voice.armIdle();
  if (!document.hidden && voice.active && voice.usingDuplex)
    microphone.resume().catch(() => {
      $('voice-status').textContent = 'マイクの再開には上部のマイクボタンを押してね。';
    });
});
// Refresh scheduled reports while the information page is visible, preserving in-progress form edits.
async function refreshResearch() {
  if (
    document.hidden ||
    $('news').hidden ||
    researchRequestBusy ||
    document.activeElement?.closest('input,textarea,select')
  )
    return;
  try {
    render(await api('state'));
  } catch {}
}
document.querySelector('[data-tab=news]').addEventListener('click', refreshResearch);
setInterval(refreshResearch, 30000);
// First-use permission still requires a click. Previously granted duplex capture can resume automatically.
run(() => api('state'))
  .then(async (ok) => {
    if (!ok) return;
    if (!HOME_LIVE_DEFAULT) {
      if (!(await handsfree.restore())) await voice.greet();
    }
    await refreshMicDevices();
  })
  .then(() => {
    if (companion.channel === 'text')
      $('voice-status').textContent = '文字で話せるよ。写真も添えられる。';
    if (!voice.Recognition && !voice.usingDuplex) {
      $('text-input').open = true;
      $('voice-status').textContent =
        'このブラウザでは音声認識を利用できません。Windows版ChromeまたはEdgeをお試しください。文字入力も利用できます。';
    }
  });

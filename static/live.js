/* ASTER GPT-Live WebRTC controller shared by the home orb and /live. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const startButton = $('live-start');
  const stopButton = $('live-stop');
  const muteButton = $('live-mute');
  const voiceSelector = $('live-voice');
  const homeOrb = $('live-orb-action');
  const isHome = Boolean(homeOrb);
  const meter = isHome && window.AsterScope
    ? new window.AsterScope.ScopeView($('voice-scope'), $('input-level'))
    : null;
  let audioContext = null;
  let meterFrame = 0;
  let meterAnalyser = null;
  let meterWave = null;
  let meterBands = null;
  function clearMeter() {
    if (meterFrame) cancelAnimationFrame(meterFrame);
    meterFrame = 0;
    meterAnalyser = null;
    meterWave = null;
    meterBands = null;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    meter?.draw(0, new Uint8Array(0));
    if (isHome) $('input-level').textContent = 'MIC OFF';
  }
  function connectMeter(stream) {
    if (!meter || !(window.AudioContext || window.webkitAudioContext)) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    try {
      audioContext = new Context();
      const input = audioContext.createMediaStreamSource(stream);
      meterAnalyser = audioContext.createAnalyser();
      meterAnalyser.fftSize = 256;
      meterAnalyser.smoothingTimeConstant = 0.65;
      input.connect(meterAnalyser); // Never connect this analyser to speakers.
      meterWave = new Uint8Array(meterAnalyser.fftSize);
      meterBands = new Uint8Array(meterAnalyser.frequencyBinCount);
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      let lastFrame = 0;
      const tick = (now) => {
        if (!meterAnalyser) return;
        meterFrame = requestAnimationFrame(tick);
        if (now - lastFrame < 32) return; // Cap canvas updates at about 30 fps.
        lastFrame = now;
        meterAnalyser.getByteTimeDomainData(meterWave);
        meterAnalyser.getByteFrequencyData(meterBands);
        let power = 0;
        for (const sample of meterWave) {
          const diff = (sample - 128) / 128;
          power += diff * diff;
        }
        const level = muted ? 0 : Math.min(1, Math.sqrt(power / meterWave.length) * 4.5);
        meter.draw(level, muted ? new Uint8Array(0) : meterBands);
      };
      meterFrame = requestAnimationFrame(tick);
    } catch {
      clearMeter(); // A visualizer error must not break live audio.
      diagnose('音量メーターを起動できませんでしたが、音声会話は続行できます。');
    }
  }
  function updateHomeVisual(state) {
    if (!isHome) return;
    const busy = state === 'CONNECTING' || state === 'LISTENING' ||
                 state === 'MUTED' || state === 'STOPPING';
    const listening = state === 'LISTENING';
    const orb = document.querySelector('.voice-orb');
    orb?.classList.toggle('listening', listening);
    orb?.classList.toggle('speaking', false);
    document.body.classList.toggle('home-live-active', busy);
    homeOrb.textContent = busy ? (state === 'CONNECTING' ? 'CANCEL' : state === 'STOPPING' ? 'WAIT' : 'END') : 'TALK';
    homeOrb.disabled = state === 'STOPPING';
    homeOrb.setAttribute('aria-label', busy ? 'リアルタイム音声通話を終了する' : 'リアルタイム音声会話を開始');
    homeOrb.setAttribute('aria-pressed', String(busy));
    const stateEl = $('orb-state');
    if (stateEl) stateEl.textContent = state;
    const topButton = $('mic-toggle');
    if (topButton) {
      topButton.textContent = state === 'LISTENING' ? '● Live会話中'
        : state === 'MUTED' ? '● Liveミュート中'
        : state === 'CONNECTING' ? 'Live接続中'
        : state === 'STOPPING' ? 'Live終了中'
        : 'Live待機中';
      topButton.classList.toggle('mic-live', listening);
      topButton.setAttribute('aria-pressed', String(busy));
      topButton.setAttribute('aria-label', busy ? 'Live音声通話を終了する' : 'Live音声会話を開始');
    }
    const label = $('link-mode');
    if (label) label.textContent = 'VOICE / LIVE';
  }
  const autoStart = $('live-auto-start');
  const AUTO_START_KEY = 'aster-live-auto-start-v1';
  let autoStartEnabled = false;
  try { autoStartEnabled = localStorage.getItem(AUTO_START_KEY) === 'true'; } catch {}
  autoStart.checked = autoStartEnabled;
  autoStart.addEventListener('change', () => {
    autoStartEnabled = autoStart.checked;
    try { localStorage.setItem(AUTO_START_KEY, String(autoStartEnabled)); } catch {}
    diagnose(autoStartEnabled ? '次回から画面を開くと音声接続します。API料金が発生します。' : '次回の自動音声接続を停止しました。');
  });
  const status = $('live-status');
  const diagnostics = $('live-diagnostics');
  const captions = $('live-captions');
  const output = $('live-audio');
  const usage = $('live-usage');
  const timeLabel = $('live-elapsed');
  let connection = null;
  let microphone = null;
  let channel = null;
  let generation = 0;
  let starting = false;
  let ready = false;
  let ending = false;
  let muted = false;
  let pendingMute = null;
  let releaseLock = null;
  let closeTimer = null;
  let networkTimer = null;
  let connectionAbort = null;
  let sessionStartedAt = 0;
  let clockTimer = null;
  let sessionId = null;
  let lastSpeaker = null;
  let lastTextAt = 0;

  const label = (message) => { status.textContent = message; };
  const diagnose = (message) => {
    const row = document.createElement('p');
    row.textContent = new Date().toLocaleTimeString('ja-JP') + '  ' + message;
    diagnostics.prepend(row);
    while (diagnostics.children.length > 25) diagnostics.lastElementChild.remove();
  };
  function caption(speaker, text) {
    if (!text) return;
    const now = performance.now();
    if (lastSpeaker !== speaker || now - lastTextAt > 5500 || !captions.lastElementChild) {
      const p = document.createElement('p');
      p.className = speaker === 'あなた' ? 'live-caption-user' : 'live-caption-assistant';
      const name = document.createElement('strong');
      name.textContent = speaker + '：';
      const span = document.createElement('span');
      p.append(name, span);
      captions.append(p);
      while (captions.children.length > 60) captions.firstElementChild.remove();
    }
    captions.lastElementChild.querySelector('span').append(document.createTextNode(text));
    lastSpeaker = speaker;
    lastTextAt = now;
  }
  function resetUI() {
    startButton.disabled = false;
    stopButton.disabled = true;
    muteButton.disabled = true;
    muteButton.textContent = 'マイクをミュート';
    voiceSelector.disabled = false;
    updateHomeVisual('READY');
  }
  function cleanup(message) {
    generation++;
    starting = false;
    ready = false;
    ending = false;
    muted = false;
    pendingMute = null;
    clearTimeout(closeTimer);
    clearTimeout(networkTimer);
    clearInterval(clockTimer);
    closeTimer = networkTimer = clockTimer = null;
    connectionAbort?.abort();
    connectionAbort = null;
    if (channel) {
      channel.onmessage = channel.onopen = channel.onclose = null;
      try { channel.close(); } catch {}
      channel = null;
    }
    clearMeter();
    if (microphone) {
      microphone.getTracks().forEach((track) => track.stop());
      microphone = null;
    }
    if (connection) {
      connection.ontrack = connection.onconnectionstatechange = null;
      try { connection.close(); } catch {}
      connection = null;
    }
    output.pause();
    output.srcObject = null;
    sessionId = null;
    sessionStartedAt = 0;
    const release = releaseLock;
    releaseLock = null;
    release?.();
    resetUI();
    label(message);
  }
  function onEvent(event) {
    switch (event.type) {
      case 'session.started':
        ready = true;
        starting = false;
        sessionId = event.session?.id || sessionId;
        sessionStartedAt = performance.now();
        clearInterval(clockTimer);
        clockTimer = setInterval(() => {
          timeLabel.textContent = Math.floor((performance.now() - sessionStartedAt) / 1000) + '秒';
        }, 1000);
        stopButton.disabled = false;
        muteButton.disabled = false;
        label('Live会話中です。あなたから話しかけてください。');
        updateHomeVisual(muted ? 'MUTED' : 'LISTENING');
        diagnose('GPT-Liveの音声会話が開始しました。');
        break;
      case 'session.input_transcript.delta':
        caption('あなた', event.delta || '');
        break;
      case 'session.output_transcript.delta':
        caption('ASTER', event.delta || '');
        break;
      case 'session.usage.updated':
        if (typeof event.usage?.seconds === 'number') {
          usage.textContent = 'API計測音声時間：約' + event.usage.seconds.toFixed(1) + '秒';
        }
        break;
      case 'session.delegation.created':
        label('調べもの・回答の処理中…（音声会話は継続できます）');
        break;
      case 'session.input_audio.muted':
      case 'session.input_audio.unmuted': {
        const next = event.type === 'session.input_audio.muted';
        if (!pendingMute ||
            (event.client_event_id && event.client_event_id !== pendingMute.id) ||
            pendingMute.next !== next) break;
        muted = next;
        pendingMute = null;
        muteButton.disabled = false;
        muteButton.textContent = muted ? 'マイクのミュート解除' : 'マイクをミュート';
        microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
        updateHomeVisual(muted ? 'MUTED' : 'LISTENING');
        label(muted ? 'マイクをミュート中です。' : '会話中。自然に話しかけてください。');
        break;
      }
      case 'session.closed':
        if (typeof event.usage?.seconds === 'number')
          usage.textContent = '確定した音声時間：' + event.usage.seconds.toFixed(1) + '秒';
        diagnose('正常終了: ' + (event.reason || 'close_requested'));
        cleanup('通話が終了しました。');
        break;
      case 'error':
        diagnose('音声APIエラー: ' + (event.error?.code || event.error?.type || 'unknown'));
        if (pendingMute &&
            (!event.error?.client_event_id ||
             event.error.client_event_id === pendingMute.id)) {
          pendingMute = null;
          microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
          muteButton.disabled = !ready || ending;
          diagnose('ミュート変更は受け付けられませんでした。');
        }
        label('音声APIでエラーが発生しました。診断情報を確認してください。');
        break;
    }
  }
  async function micLock(token) {
    if (!navigator.locks?.request) {
      diagnose('他のタブのマイクは自動的に排他制御できません。');
      return true;
    }
    return new Promise((resolve) => {
      navigator.locks.request('yorisoi-microphone', { ifAvailable: true }, async (lock) => {
        if (!lock || token !== generation) {
          resolve(false);
          return;
        }
        await new Promise((release) => {
          releaseLock = release;
          resolve(true);
        });
      }).catch(() => resolve(false));
    });
  }
  function waitForIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, 4000);
      pc.addEventListener('icegatheringstatechange', check);
      check();
    });
  }
  async function start() {
    if (connection || starting) return;
    if (isHome && $('interaction-mode')?.value === 'text') {
      label('文字入力モードです。「やり取り」を音声に切り替えてから開始してください。');
      return;
    }
    starting = true;
    const token = ++generation;
    startButton.disabled = true;
    voiceSelector.disabled = true;
    updateHomeVisual('CONNECTING');
    stopButton.disabled = false; // Cancel while connecting.
    label('マイクを準備しています…');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
        throw new Error('Chrome / Edge とマイクの利用許可が必要です。');
      if (isHome) window.AsterClassic?.stop?.();
      if (!(await micLock(token)))
        throw new Error('他のASTER画面がマイクを使用中です。そちらを停止してください。');
      if (token !== generation) return;
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (token !== generation) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      connectMeter(microphone);
      connection = new RTCPeerConnection();
      connection.ontrack = (event) => {
        if (token !== generation) return;
        output.srcObject = new MediaStream([event.track]);
        output.play().catch(() => {
          if (isHome && $('home-advanced')) $('home-advanced').open = true;
          label('音声の自動再生が制限されました。詳細設定内の再生ボタンを押してください。');
        });
      };
      connection.onconnectionstatechange = () => {
        if (!connection || token !== generation) return;
        diagnose('WebRTC: ' + connection.connectionState);
        clearTimeout(networkTimer);
        if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
          cleanup('音声接続が終了しました。もう一度開始してください。');
        } else if (connection.connectionState === 'disconnected') {
          label('ネットワークが不安定です。');
          networkTimer = setTimeout(() => {
            if (token === generation && connection?.connectionState === 'disconnected')
              cleanup('接続が切れました。ネットワークを確認してください。');
          }, 6000);
        }
      };
      for (const track of microphone.getAudioTracks()) connection.addTrack(track, microphone);
      channel = connection.createDataChannel('oai-events');
      channel.onmessage = ({ data }) => {
        if (token !== generation) return;
        try { onEvent(JSON.parse(data)); }
        catch { diagnose('制御イベントの読み取りに失敗しました。'); }
      };
      channel.onclose = () => {
        if (token === generation && !ending) diagnose('イベント通信が閉じられました。');
      };
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForIce(connection);
      if (token !== generation) return;
      const sdp = connection.localDescription?.sdp;
      if (!sdp) throw new Error('WebRTCの接続情報を生成できませんでした。');
      label('GPT-Liveに接続しています…');
      connectionAbort = new AbortController();
      const response = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, voice: voiceSelector.value }),
        signal: connectionAbort.signal,
      });
      if (token !== generation) return;
      if (!response.ok) {
        let message = '音声セッションを開始できませんでした。';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (token !== generation) return;
      if (!result?.transport?.sdp || !result?.session?.id)
        throw new Error('音声APIから接続情報が返りませんでした。');
      sessionId = result.session.id;
      await connection.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
      diagnose('音声接続の初期設定が完了しました。');
      // The HTTP creation request starts GPT-Live. Never send session.start here.
      label('音声セッションの開始を確認中…');
    } catch (error) {
      if (token !== generation) return;
      const message = error?.name === 'NotAllowedError'
        ? 'マイクの許可を確認してください。'
        : String(error?.message || '接続できませんでした。');
      diagnose('開始に失敗: ' + (error?.name || 'Error'));
      cleanup(message);
    }
  }
  function stop() {
    if (ending) return;
    if (!ready || channel?.readyState !== 'open') {
      cleanup('接続をキャンセルしました。');
      return;
    }
    ending = true;
    updateHomeVisual('STOPPING');
    stopButton.disabled = true;
    muteButton.disabled = true;
    label('通話を終了しています…');
    try {
      channel.send(JSON.stringify({ type: 'session.close', event_id: 'close_' + Date.now() }));
      closeTimer = setTimeout(() => {
        diagnose('正常終了の確認ができませんでした。');
        cleanup('通話を停止しました（API側の終了確認は未完了）。');
      }, 15000);
    } catch {
      cleanup('接続が切れたため終了確認はできませんでした。');
    }
  }
  function toggleMute() {
    if (!ready || ending || pendingMute || !channel || channel.readyState !== 'open') return;
    const next = !muted;
    const id = 'mic_' + Date.now();
    try {
      pendingMute = { id, next };
      muteButton.disabled = true;
      if (next) microphone?.getAudioTracks().forEach((track) => { track.enabled = false; });
      channel.send(JSON.stringify({
        type: next ? 'session.input_audio.mute' : 'session.input_audio.unmute',
        event_id: id,
      }));
      label('マイク設定の反映を確認しています…');
    } catch {
      pendingMute = null;
      microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
      muteButton.disabled = false;
      diagnose('ミュートの変更に失敗しました。');
    }
  }
  startButton.addEventListener('click', start);
  if (isHome) {
    window.AsterLiveHome = {
      isActive: () => starting || ready || ending || Boolean(connection),
      toggle: () => (starting || ready || ending || connection) ? stop() : start(),
      stop,
      refresh: () => updateHomeVisual('READY'),
    };
    homeOrb.addEventListener('click', () => window.AsterLiveHome.toggle());
    $('interaction-mode')?.addEventListener('change', () => {
      if ($('interaction-mode').value === 'text' && window.AsterLiveHome.isActive()) stop();
    });
    updateHomeVisual('READY');
  }
  // Wait for the opening sequence only on the home screen. On /live, start normally.
  // Opt-in only: never create a billable session on first visit.
  if (autoStartEnabled) {
    if (isHome && $('aster-intro')) {
      window.addEventListener('aster:boot-complete', () => { void start(); }, { once: true });
    } else void start();
  }
  stopButton.addEventListener('click', stop);
  muteButton.addEventListener('click', toggleMute);
  window.addEventListener('pagehide', () => {
    // Best effort: tell Live to close before the browser tears down WebRTC.
    if (ready && channel?.readyState === 'open' && !ending) {
      try {
        channel.send(JSON.stringify({ type: 'session.close', event_id: 'pagehide_' + Date.now() }));
      } catch {}
    }
    cleanup('画面が閉じられました。');
  });
})();

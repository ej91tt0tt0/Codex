/* ASTER Realtime voice preview: isolated from the classic voice and history. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const startButton = $('realtime-start');
  const stopButton = $('realtime-stop');
  const status = $('realtime-status');
  const log = $('realtime-log');
  const audio = $('realtime-audio');
  const diagnostics = $('realtime-diagnostics');
  let pc = null;
  let mic = null;
  let events = null;
  let generation = 0;
  let starting = false;
  let stopping = false;
  let transcriptLine = null;
  let activeResponse = false;
  let releaseMicLock = null;
  let disconnectTimer = null;
  let firstReplyAt = 0;

  const mark = (message) => { status.textContent = message; };
  const debug = (message) => {
    if (!diagnostics) return;
    const entry = document.createElement('p');
    entry.textContent = new Date().toLocaleTimeString('ja-JP') + ' ' + message;
    diagnostics.prepend(entry);
    while (diagnostics.childElementCount > 20) diagnostics.lastElementChild.remove();
  };
  const append = (who, content = '') => {
    const line = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = who + '：';
    line.append(name, document.createTextNode(content));
    log.append(line);
    while (log.childElementCount > 80) log.firstElementChild.remove();
    return line;
  };
  function shutdown(message = '通話を終了しました。') {
    generation++;
    starting = false;
    stopping = false;
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    if (events) {
      events.onmessage = events.onopen = events.onclose = null;
      try { events.close(); } catch {}
      events = null;
    }
    if (mic) {
      mic.getTracks().forEach(track => track.stop());
      mic = null;
    }
    if (pc) {
      pc.ontrack = pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
    audio.pause();
    audio.srcObject = null;
    transcriptLine = null;
    activeResponse = false;
    const release = releaseMicLock;
    releaseMicLock = null;
    release?.();
    startButton.disabled = false;
    stopButton.disabled = true;
    mark(message);
  }
  async function acquireMicLock(token) {
    if (!navigator.locks?.request) {
      debug('タブ間マイク排他機能が使用できません。他のASTER画面の音声を停止してください。');
      return true;
    }
    return new Promise(resolve => {
      navigator.locks.request('yorisoi-microphone', { ifAvailable: true }, async lock => {
        if (!lock) {
          resolve(false);
          return;
        }
        if (token !== generation) {
          resolve(false);
          return;
        }
        await new Promise(release => {
          releaseMicLock = release;
          resolve(true);
        });
      }).catch(() => resolve(false));
    });
  }
  function handleEvent(e) {
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        mark('聞き取り中…');
        break;
      case 'input_audio_buffer.speech_stopped':
        firstReplyAt = performance.now();
        mark('返答を準備中…');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (e.transcript) append('あなた', e.transcript);
        break;
      case 'conversation.item.input_audio_transcription.failed':
        debug('文字起こしに失敗。音声会話は続けられます。');
        break;
      case 'response.created':
        activeResponse = true;
        mark('ASTERが返答中…');
        break;
      case 'response.output_audio_transcript.delta':
        if (!transcriptLine) transcriptLine = append('ASTER');
        transcriptLine.append(document.createTextNode(e.delta || ''));
        break;
      case 'response.output_audio_transcript.done':
        if (!transcriptLine && e.transcript) append('ASTER', e.transcript);
        transcriptLine = null;
        break;
      case 'response.done':
        if (firstReplyAt) {
          debug('発話終了から応答完了まで約' + ((performance.now() - firstReplyAt) / 1000).toFixed(1) + '秒');
          firstReplyAt = 0;
        }
        activeResponse = false;
        transcriptLine = null;
        if (e.response?.status === 'failed') {
          const code = e.response.status_details?.error?.code || 'unknown';
          debug('応答エラー: ' + code);
          mark('応答でエラーが発生しました。診断表示を確認してください。');
        } else mark('接続中。話しかけてください。');
        break;
      case 'error':
        debug('APIエラー: ' + (e.error?.code || e.error?.type || 'unknown'));
        mark('音声APIのエラーです。診断表示を確認してください。');
        break;
    }
  }
  async function start() {
    if (pc || starting) return;
    starting = true;
    const token = ++generation;
    startButton.disabled = true;
    stopButton.disabled = false;
    mark('マイクを確認しています…');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
        throw Error('ChromeまたはEdgeでマイクとWebRTCを有効にしてください。');
      if (!(await acquireMicLock(token))) {
        throw Error('別のASTER画面がマイクを使用中です。そちらの音声会話を停止してください。');
      }
      if (token !== generation) return;
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (token !== generation) {
        mic.getTracks().forEach(track => track.stop());
        return;
      }
      pc = new RTCPeerConnection();
      pc.ontrack = event => {
        if (token !== generation) return;
        audio.srcObject = event.streams[0];
        audio.play().catch(() => {
          debug('音声自動再生がブロックされました。');
          mark('音が聞こえない場合はブラウザの再生許可・出力先を確認してください。');
        });
      };
      pc.onconnectionstatechange = () => {
        if (token !== generation || !pc) return;
        debug('接続状態: ' + pc.connectionState);
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          shutdown('接続が終了しました。開始ボタンから再接続できます。');
        } else if (pc.connectionState === 'disconnected') {
          mark('接続が不安定です。再接続を待っています…');
          disconnectTimer = setTimeout(() => {
            if (token === generation && pc?.connectionState === 'disconnected')
              shutdown('接続が途切れました。ネットワークを確認して再接続してください。');
          }, 6000);
        }
      };
      mic.getTracks().forEach(track => pc.addTrack(track, mic));
      events = pc.createDataChannel('oai-events');
      events.onmessage = message => {
        try { handleEvent(JSON.parse(message.data)); } catch { debug('イベントの解析に失敗'); }
      };
      events.onopen = () => {
        if (token === generation) {
          mark('接続中。話しかけてください。');
          debug('音声会話の接続が確立しました。');
        }
      };
      events.onclose = () => {
        if (token === generation && !stopping && pc?.connectionState !== 'closed')
          debug('イベント通信が閉じられました。');
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (token !== generation) return;
      mark('OpenAIへ接続しています…');
      const res = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });
      if (token !== generation) return;
      if (!res.ok) {
        let detail = '音声APIへの接続に失敗しました。';
        try { detail = (await res.json()).error || detail; } catch {}
        throw Error(detail);
      }
      const sdp = await res.text();
      if (token !== generation) return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      starting = false;
    } catch (error) {
      if (token !== generation) return;
      const message = error?.name === 'NotAllowedError'
        ? 'マイクが許可されていません。ブラウザのサイト設定を確認してください。'
        : String(error?.message || '接続に失敗しました。');
      debug('開始エラー: ' + (error?.name || 'Error'));
      shutdown(message);
    }
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    shutdown();
  }
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);
  window.addEventListener('pagehide', () => shutdown('通話を終了しました。'));
})();

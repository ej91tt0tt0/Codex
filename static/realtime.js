/* Isolated WebRTC preview. Does not share ASTER's classic microphone, history or storage. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const startButton = $('realtime-start');
  const stopButton = $('realtime-stop');
  const status = $('realtime-status');
  const log = $('realtime-log');
  const audio = $('realtime-audio');
  let peer = null;
  let microphone = null;
  let channel = null;
  let starting = false;
  let closing = false;
  let generation = 0;
  let replyLine = null;

  function setStatus(message) { status.textContent = message; }
  function addLine(label, content) {
    const line = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = label + ': ';
    line.append(strong, document.createTextNode(content));
    log.append(line);
    if (log.children.length > 80) log.firstElementChild.remove();
    return line;
  }
  function cleanUp() {
    generation += 1;
    starting = false;
    closing = false;
    if (channel) {
      channel.onmessage = channel.onclose = channel.onopen = null;
      try { channel.close(); } catch {}
      channel = null;
    }
    if (microphone) {
      microphone.getTracks().forEach((track) => track.stop());
      microphone = null;
    }
    if (peer) {
      peer.ontrack = peer.onconnectionstatechange = null;
      peer.close();
      peer = null;
    }
    audio.pause();
    audio.srcObject = null;
    replyLine = null;
    startButton.disabled = false;
    stopButton.disabled = true;
  }
  function handleEvent(event) {
    if (event.type === 'response.output_audio_transcript.delta') {
      if (!replyLine) replyLine = addLine('ASTER', '');
      replyLine.append(document.createTextNode(event.delta || ''));
    } else if (event.type === 'response.output_audio_transcript.done') {
      if (event.transcript && !replyLine) addLine('ASTER', event.transcript);
      replyLine = null;
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (event.transcript) addLine('あなた', event.transcript);
    } else if (event.type === 'input_audio_buffer.speech_started') {
      setStatus('聞き取り中…');
    } else if (event.type === 'response.created') {
      setStatus('ASTERが考えています…');
    } else if (event.type === 'response.done') {
      replyLine = null;
      setStatus('接続中。話しかけてください。');
    } else if (event.type === 'error') {
      setStatus('音声APIのエラーです。必要に応じて通話を終了し、再接続してください。');
    }
  }
  async function start() {
    if (peer || starting) return;
    starting = true;
    const token = ++generation;
    startButton.disabled = true;
    stopButton.disabled = false;
    setStatus('マイクを準備しています…');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
        throw Error('ChromeまたはEdgeでマイクとWebRTCを有効にしてください。');
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (token !== generation) return;
      peer = new RTCPeerConnection();
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        audio.play().catch(() => setStatus('音声を再生できません。ブラウザの音声設定を確認してください。'));
      };
      peer.onconnectionstatechange = () => {
        if (token !== generation) return;
        if (['failed', 'disconnected'].includes(peer?.connectionState)) {
          setStatus('音声接続が切れました。通話を終了してから再接続してください。');
        }
      };
      microphone.getTracks().forEach((track) => peer.addTrack(track, microphone));
      channel = peer.createDataChannel('oai-events');
      channel.onmessage = (message) => {
        try { handleEvent(JSON.parse(message.data)); } catch {}
      };
      channel.onopen = () => { if (token === generation) setStatus('接続中。話しかけてください。'); };
      channel.onclose = () => { if (token === generation && !closing) setStatus('音声接続が閉じられました。'); };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (token !== generation) return;
      setStatus('OpenAIへ接続しています…');
      const result = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: peer.localDescription.sdp,
      });
      if (token !== generation) return;
      if (!result.ok) {
        let message = '音声APIへの接続に失敗しました。';
        try { message = (await result.json()).error || message; } catch {}
        throw Error(message);
      }
      const sdp = await result.text();
      if (token !== generation) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
      starting = false;
    } catch (error) {
      if (token !== generation) return;
      const message = error.name === 'NotAllowedError'
        ? 'マイクの許可が必要です。ブラウザの設定を確認してください。'
        : error.message || '接続に失敗しました。';
      cleanUp();
      setStatus(message);
    }
  }
  async function stop() {
    if (closing) return;
    closing = true;
    stopButton.disabled = true;
    setStatus('通話を終了しています…');
    const current = channel;
    if (current?.readyState === 'open') {
      // End gracefully to let the service finalize usage; never wait indefinitely.
      await new Promise((resolve) => {
        let timer;
        const onMessage = (event) => {
          try {
            if (JSON.parse(event.data).type === 'session.closed') finish();
          } catch {}
        };
        const finish = () => {
          clearTimeout(timer);
          current.removeEventListener('message', onMessage);
          resolve();
        };
        current.addEventListener('message', onMessage);
        timer = setTimeout(finish, 1500);
        try { current.send(JSON.stringify({ type: 'session.close' })); }
        catch { finish(); }
      });
    }
    cleanUp();
    setStatus('通話を終了しました。');
  }
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);
  window.addEventListener('pagehide', () => {
    if (channel?.readyState === 'open') {
      try { channel.send(JSON.stringify({ type: 'session.close' })); } catch {}
    }
    cleanUp();
  });
})();

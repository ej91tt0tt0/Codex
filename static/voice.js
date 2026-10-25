/* Voice turn coordination. Duplex microphone capture is handled by input.js. */
(function (root) {
  'use strict';
  function greetingText(now = new Date()) {
    const hour = now.getHours();
    const hello =
      hour >= 5 && hour < 11 ? 'おはよう' : hour >= 11 && hour < 18 ? 'こんにちは' : 'こんばんは';
    return `${hello}、アスターだよ。何か話そう。`;
  }
  function splitSpeech(text) {
    text = text
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, '')
      .trim();
    if (!text) return [];
    // Normal replies form one conversational turn, including their commas and periods.
    if (text.length <= 280) return [text];
    const units = [];
    for (const paragraph of text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const previous = units.at(-1);
      // An example, reason, qualification or unfinished thought belongs with its setup.
      if (
        previous &&
        (/^(?:例えば|たとえば|つまり|だから|なので|そのため|というのも|ただし|ただ、|ただね|そして|それで)/.test(
          paragraph
        ) ||
          /(?:けど|から|ので|たり|なら|という|例えば)[、。]?\s*$/.test(previous)) &&
        previous.length + paragraph.length + 2 <= 1800
      ) {
        units[units.length - 1] += '\n\n' + paragraph;
      } else units.push(paragraph);
    }
    // API length guard for unusually long single paragraphs; ordinary turns never split here.
    return units.flatMap((unit) => (unit.length <= 1800 ? [unit] : unit.match(/[\s\S]{1,1800}/gu)));
  }
  class VoiceController {
    constructor({
      Recognition,
      synth,
      Utterance,
      send,
      status,
      state,
      transcript,
      greeting,
      naturalSpeaker = null,
      proactive = null,
      duplexInput = null,
    }) {
      Object.assign(this, {
        Recognition,
        synth,
        Utterance,
        send,
        status,
        state,
        transcript,
        greeting,
        naturalSpeaker,
        proactive,
        duplexInput,
      });
      this.highQualityEnabled = true;
      this.handsFree = false;
      this.textMode = false;
      this.canInitiate = () => true;
      this.beforeInput = null;
      this.inputSpeaking = false;
      this.inputPending = 0;
      this.pendingInputs = [];
      this.idleMilliseconds = 600000;
      this.proactiveEnabled = true;
      this.proactiveLimit = 1;
      this.proactiveCount = 0;
      this.idleTimer = null;
      this.useNatural = true;
      this.resumeAfterInterrupt = false;
      this.active = false;
      this.busy = false;
      this.rec = null;
      this.epoch = 0;
      this.readEnabled = true;
      this.greeted = false;
      this.replaying = false;
      this.replayCancelled = false;
      this.silences = 0;
      this.timer = null;
      this.finishSpeech = null;
      this.speechDone = null;
      this.boundaryRequested = false;
      this.segmentStarted = false;
      this.speechRate = 1.12;
    }
    get usingDuplex() {
      return Boolean(this.highQualityEnabled && this.duplexInput?.supported);
    }
    get canSpeak() {
      return Boolean((this.synth && this.Utterance) || this.naturalSpeaker);
    }
    update() {
      this.state({
        active: this.active,
        busy: this.busy,
        listening: Boolean(this.rec) || Boolean(this.duplexInput?.running),
        speaking: Boolean(this.finishSpeech),
      });
    }
    cancelSpeech() {
      this.boundaryRequested = false;
      this.segmentStarted = false;
      if (this.finishSpeech) this.finishSpeech(false);
      if (this.synth) this.synth.cancel();
      if (this.naturalSpeaker) this.naturalSpeaker.cancel();
    }
    pauseRecognition() {
      const rec = this.rec;
      this.rec = null;
      if (rec) {
        try {
          rec.abort();
        } catch {}
      }
    }
    stop() {
      this.active = false;
      this.epoch++;
      clearTimeout(this.timer);
      clearTimeout(this.idleTimer);
      this.resumeAfterInterrupt = false;
      this.pauseRecognition();
      this.duplexInput?.stop();
      this.inputSpeaking = false;
      this.inputPending = 0;
      this.pendingInputs = [];
      this.cancelSpeech();
      this.status('音声会話を停止しました。マイクは使用していません。');
      this.update();
    }
    requestBoundaryYield() {
      if (!this.finishSpeech) return;
      if (!this.segmentStarted) {
        this.cancelSpeech();
        return;
      }
      this.boundaryRequested = true;
      this.naturalSpeaker?.cancelPrefetch?.();
      this.status('今の話を言い終えたら、そっちの話に移るね。');
    }
    say(text, { force = false } = {}) {
      this.pauseRecognition();
      this.cancelSpeech();
      if (!this.canSpeak || (!this.readEnabled && !force)) return Promise.resolve(false);
      const pieces = splitSpeech(text);
      if (!pieces.length) return Promise.resolve(false);
      const donePromise = new Promise((resolve) => {
        let done = false,
          nativeFinish = null;
        const finish = (success) => {
          if (done) return;
          done = true;
          nativeFinish?.(false);
          nativeFinish = null;
          this.finishSpeech = null;
          this.segmentStarted = false;
          this.naturalSpeaker?.cancelPrefetch?.();
          this.update();
          resolve(success);
          queueMicrotask(() => {
            if (
              !this.busy &&
              !this.finishSpeech &&
              !this.inputSpeaking &&
              !this.inputPending &&
              this.pendingInputs.length
            )
              void this.ask(this.takePending());
          });
        };
        this.finishSpeech = finish;
        const native = (piece) =>
          new Promise((resolveNative) => {
            if (!this.synth || !this.Utterance) {
              resolveNative(false);
              return;
            }
            let settled = false;
            const finishNative = (success) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (nativeFinish === finishNative) nativeFinish = null;
              resolveNative(success);
            };
            const timer = setTimeout(
              () => {
                finishNative(false);
                this.synth.cancel();
              },
              Math.min(600000, Math.max(45000, piece.length * 500))
            );
            nativeFinish = finishNative;
            const utterance = new this.Utterance(piece);
            utterance.lang = 'ja-JP';
            utterance.rate = this.speechRate;
            utterance.pitch = 0.9;
            const voices = this.synth
              .getVoices()
              .filter((v) => v.lang.toLowerCase().startsWith('ja'));
            const chosen =
              voices.find((v) => /Keita|Ichiro|Naoki|一郎|圭太|直樹/i.test(v.name || '')) ||
              voices[0];
            if (chosen) utterance.voice = chosen;
            utterance.onstart = () => {
              this.segmentStarted = true;
            };
            utterance.onend = () => finishNative(true);
            utterance.onerror = () => finishNative(false);
            try {
              this.synth.speak(utterance);
            } catch {
              finishNative(false);
            }
          });
        this.status('話してるよ…');
        this.update();
        (async () => {
          for (let i = 0; i < pieces.length; i++) {
            if (done || this.boundaryRequested) {
              finish(false);
              return;
            }
            this.segmentStarted = false;
            let played = false;
            if (this.naturalSpeaker && this.useNatural) {
              this.status('声を準備中…');
              played = await this.naturalSpeaker.speak(pieces[i], {
                nextText: pieces[i + 1] || '',
                onPlaying: () => {
                  this.segmentStarted = true;
                },
              });
              if (done) return;
              if (!played && !this.boundaryRequested) {
                this.status('ブラウザの声に切り替えるね。');
                played = await native(pieces[i]);
              }
            } else played = await native(pieces[i]);
            if (done) return;
            if (!played) {
              this.status('読み上げできなかったよ。「挨拶を聞く」でもう一度試してね。');
              finish(false);
              return;
            }
            if (this.boundaryRequested) {
              finish(false);
              return;
            }
          }
          finish(true);
        })().catch(() => finish(false));
      });
      this.speechDone = donePromise;
      return donePromise;
    }
    async greet() {
      const text = greetingText();
      this.greeting(text);
      const token = this.epoch;
      const spoke = await this.say(text);
      if (spoke) this.greeted = true;
      if (token !== this.epoch) return;
      if (!spoke)
        this.status(
          '「音声会話を開始」を押すとマイクを使えます。挨拶が聞こえない場合は「挨拶を聞く」を押してください。'
        );
      else if (!this.active)
        this.status('挨拶しました。「音声会話を開始」を押すと、お話を聞きます。');
    }
    async start() {
      if (this.active || this.busy) return;
      if (!this.Recognition && !this.usingDuplex) {
        this.status(
          'このブラウザでは音声認識を利用できません。Windows版ChromeまたはEdgeをお試しください。文字入力も利用できます。'
        );
        return;
      }
      this.active = true;
      const token = ++this.epoch;
      this.silences = 0;
      this.update();
      if (this.usingDuplex) {
        this.status('マイクを接続中…');
        try {
          await this.duplexInput.start();
        } catch {
          this.stop();
          this.status('マイクを開始できなかったよ。Windowsとブラウザのマイク権限を確認してね。');
          return;
        }
        if (!this.active || token !== this.epoch) return;
      }
      if (!this.greeted && this.readEnabled) {
        if (this.finishSpeech) await this.speechDone;
        else await this.greet();
      }
      if (this.active && token === this.epoch) {
        this.listen();
        this.armIdle();
      }
    }
    listen() {
      if (this.active && this.usingDuplex) {
        this.update();
        if (!this.busy && !this.finishSpeech && !this.inputSpeaking && !this.inputPending)
          this.status('聞いてるよ。話している間も声をかけてね。');
        return;
      }
      if (!this.active || this.rec || this.busy || this.finishSpeech) return;
      const rec = new this.Recognition();
      this.rec = rec;
      rec.lang = 'ja-JP';
      rec.continuous = false;
      rec.interimResults = true;
      let final = '';
      rec.onstart = () => {
        if (this.rec === rec) this.status('聞いています… 話し終えると自動で送信します。');
      };
      rec.onresult = (event) => {
        if (this.rec !== rec || !this.active) return;
        let preview = '';
        final = '';
        for (let i = 0; i < event.results.length; i++) {
          const words = event.results[i][0].transcript;
          preview += words;
          if (event.results[i].isFinal) final += words;
        }
        this.transcript(preview);
        this.armIdle();
      };
      rec.onerror = (event) => {
        if (this.rec !== rec || !this.active) return;
        if (event.error === 'no-speech') return;
        const errors = {
          'not-allowed':
            'マイクが許可されていません。アドレス欄のサイト設定でマイクを許可し、もう一度開始してください。',
          'service-not-allowed':
            'ブラウザの音声認識サービスが許可されていません。ブラウザの設定や対応状況を確認してください。',
          'audio-capture':
            'マイクが見つかりません。Windowsの入力デバイスとマイクの権限を確認してください。',
          network:
            '音声認識サービスに接続できません。インターネット接続を確認し、もう一度開始してください。',
        };
        this.stop();
        this.status(
          errors[event.error] ||
            '音声認識を停止しました。もう一度開始するか、文字入力をご利用ください。'
        );
      };
      rec.onend = () => {
        if (this.rec !== rec) return;
        this.rec = null;
        this.update();
        if (!this.active) return;
        if (final.trim()) {
          this.silences = 0;
          void this.ask(final.trim());
        } else {
          this.silences++;
          this.status('聞いています。お好きなタイミングでお話しください。');
          this.timer = setTimeout(() => this.listen(), 800);
        }
      };
      this.status('マイクを準備しています…');
      this.update();
      try {
        rec.start();
      } catch {
        this.stop();
        this.status('マイクを開始できませんでした。権限を確認してもう一度開始してください。');
      }
    }
    async ask(content, { initiative = false, kind = 'thought' } = {}) {
      if (!initiative && !content.trim()) return false;
      if (!initiative && this.beforeInput?.(content)) return true;
      if (this.busy || this.finishSpeech) {
        if (!initiative) {
          if (this.pendingInputs.length >= 6) {
            this.status('追加の話を整理しているよ。返答が進んでから、もう一度送ってね。');
            return false;
          }
          this.pendingInputs.push(content.trim());
          this.epoch++;
          this.requestBoundaryYield();
          this.status('追加の話も受け取ったよ。まとめて考えるね。');
          this.update();
          return true;
        }
        return false;
      }
      clearTimeout(this.idleTimer);
      if (!initiative) this.proactiveCount = 0;
      this.busy = true;
      clearTimeout(this.timer);
      this.pauseRecognition();
      this.cancelSpeech();
      const token = this.epoch;
      this.status('ちょっと考え中…');
      this.update();
      let success = false;
      let failure = null;
      try {
        const answer = initiative ? await this.proactive(kind) : await this.send(content);
        if (initiative) this.proactiveCount++;
        success = true;
        if (
          token === this.epoch &&
          this.readEnabled &&
          !this.inputSpeaking &&
          !this.inputPending &&
          !this.pendingInputs.length
        )
          await this.say(answer);
      } catch (error) {
        if (initiative && error.status === 429) {
          this.proactiveCount = this.proactiveLimit;
        } else {
          if (!this.handsFree || !this.active) this.stop();
          failure = '応答を取得できませんでした。' + error.message;
          this.status(failure);
        }
      } finally {
        this.busy = false;
        this.update();
        if (!this.inputSpeaking && !this.inputPending && this.pendingInputs.length) {
          const queued = this.takePending();
          void this.ask(queued);
        } else if (
          this.active &&
          !this.inputSpeaking &&
          !this.inputPending &&
          (this.usingDuplex || token === this.epoch || this.resumeAfterInterrupt)
        ) {
          this.resumeAfterInterrupt = false;
          this.listen();
          this.armIdle();
          if (this.proactiveCount >= this.proactiveLimit)
            this.status('自動の声かけはここで休止するね。話しかけてくれたら、また聞くよ。');
        } else if (success && token === this.epoch)
          this.status(
            this.textMode
              ? '文字で続けて話せるよ。写真も添えられる。'
              : 'お返事しました。「音声会話を開始」で続けて話せます。'
          );
        if (failure && this.active) this.status(failure + ' 待ち受けは続けているよ。');
      }
      return success;
    }
    takePending() {
      const command = (text) =>
        /^(?:(?:よりそい|アスター|ASTER|aster)[、,\s]*)?(?:設定変更|設定を変更して|システム設定|改善リクエスト|システム改善|改善依頼)/.test(
          text.normalize('NFKC').trim()
        ) || /(?:ナビ(?:を開始)?して|案内して|マップ(?:を)?開いて|車の経路を開いて)/.test(text);
      const control = (text) =>
        command(text) ||
        /^(?:ただ聞いてほしい|一緒に考えたい|アドバイスがほしい|もっと短く|もっと詳しく|今は(?:助言|アドバイス)はいらない|質問(?:は|を)(?:少なめ|多め|しない)|目標を追加|目標\d+を|調査タスクを追加|(?:今日の)?(?:会話を)?日記|(?:毎日)?\d{1,2}時)/.test(
          text
            .normalize('NFKC')
            .trim()
            .replace(/^(?:よりそい|アスター|ASTER|aster)[、,\s]*/, '')
        );
      const first = this.pendingInputs.shift();
      if (control(first)) return first;
      const batch = [first];
      while (this.pendingInputs.length && !control(this.pendingInputs[0]))
        batch.push(this.pendingInputs.shift());
      return batch.join('\n');
    }
    armIdle() {
      clearTimeout(this.idleTimer);
      if (
        !this.active ||
        !this.canInitiate() ||
        this.inputSpeaking ||
        this.inputPending ||
        this.pendingInputs.length ||
        !this.proactiveEnabled ||
        !this.proactive ||
        this.proactiveCount >= this.proactiveLimit
      )
        return;
      this.idleTimer = setTimeout(() => this.initiate(), this.idleMilliseconds);
    }
    initiate() {
      if (
        !this.active ||
        !this.canInitiate() ||
        this.inputSpeaking ||
        this.inputPending ||
        this.pendingInputs.length ||
        !this.proactiveEnabled ||
        !this.proactive ||
        this.proactiveCount >= this.proactiveLimit
      )
        return;
      if (this.busy || this.finishSpeech) {
        this.armIdle();
        return;
      }
      return this.ask('', { initiative: true, kind: 'thought' });
    }
    hearStart() {
      if (!this.active) return;
      clearTimeout(this.idleTimer);
      this.inputSpeaking = true;
      if (this.busy || this.finishSpeech) this.epoch++;
      this.status('話を聞いてるよ…');
      this.update();
    }
    inputState(state) {
      this.inputSpeaking = state.speaking;
      this.inputPending = state.pending;
      this.update();
      if (this.active && state.paused) {
        this.status('マイクの待ち受けが中断しているよ。画面を開いてマイクの状態を確認してね。');
        return;
      }
      if (this.active && state.coolingDown) {
        this.status('音声認識の接続エラーで15秒待機中だよ。その後もう一度話してね。');
        return;
      }
      if (this.active && state.pending) this.status('話した内容を読み取ってるよ…');
      if (this.active && !state.speaking && !state.pending && !this.busy) {
        if (this.pendingInputs.length) {
          const queued = this.takePending();
          void this.ask(queued);
        } else this.armIdle();
      }
    }
    async interrupt() {
      if (!this.active) return;
      if (this.busy && !this.finishSpeech) {
        this.status('返答を準備しています。停止ボタンで音声会話を終了できます。');
        return;
      }
      this.epoch++;
      this.silences = 0;
      this.resumeAfterInterrupt = this.busy;
      this.pauseRecognition();
      if (this.finishSpeech) {
        const pending = this.speechDone;
        this.requestBoundaryYield();
        await pending;
      }
      if (!this.busy) {
        this.listen();
        this.armIdle();
      }
    }
    async replayGreeting() {
      if (this.busy) return;
      clearTimeout(this.timer);
      const token = this.epoch;
      await this.greet();
      if (token === this.epoch && this.active) this.listen();
    }
    async replay(text) {
      if (this.busy || this.finishSpeech || !text.trim()) return false;
      clearTimeout(this.timer);
      clearTimeout(this.idleTimer);
      const token = this.epoch;
      this.replaying = true;
      this.replayCancelled = false;
      let played;
      try {
        played = await this.say(text, { force: true });
      } finally {
        this.replaying = false;
        this.update();
      }
      if (token === this.epoch) {
        if (this.active) {
          this.listen();
          this.armIdle();
        } else
          this.status(
            this.replayCancelled
              ? '読み上げを止めたよ。'
              : played
                ? 'もう一度読み上げたよ。'
                : '読み上げできなかったよ。音声の設定を確認してね。'
          );
      }
      return played;
    }
    stopReplay() {
      if (!this.replaying) return;
      this.replayCancelled = true;
      this.cancelSpeech();
    }
  }
  const exports = { VoiceController, greetingText, splitSpeech };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.AsterVoice = exports;
})(typeof window === 'undefined' ? globalThis : window);

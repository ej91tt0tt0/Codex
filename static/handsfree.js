/* Microphone permission, user pause, and single-tab ownership for hands-free use. */
(function (root) {
  'use strict';
  class HandsFreeSession {
    constructor({
      voice,
      permissions = root.navigator?.permissions,
      locks = root.navigator?.locks,
      storage = null,
      status = () => {},
    }) {
      Object.assign(this, { voice, permissions, locks, storage, status });
      this.enabled = false;
      this.starting = false;
      this.generation = 0;
      this.release = null;
      try {
        this.paused = this.storage?.getItem('yorisoi.mic.paused') === 'true';
      } catch {
        this.paused = false;
      }
    }
    setPaused(value) {
      this.paused = value;
      try {
        this.storage?.setItem('yorisoi.mic.paused', String(value));
      } catch {}
    }
    configure(enabled) {
      const was = this.enabled;
      this.enabled = enabled;
      this.voice.handsFree = enabled;
      if (was && !enabled) this.stop();
      this.voice.update();
    }
    observe(state) {
      if (!state.active && this.release) {
        this.release();
        this.release = null;
      }
    }
    close() {
      this.generation++;
      this.voice.stop();
      if (this.release) {
        this.release();
        this.release = null;
      }
    }
    stop() {
      this.generation++;
      this.setPaused(true);
      this.voice.stop();
      if (this.release) {
        this.release();
        this.release = null;
      }
    }
    handleCommand(text) {
      if (
        !/^(?:(?:よりそい|アスター|ASTER|aster)[、,\s]*)?(?:待ち受け|マイク|音声会話)(?:を)?(?:停止して|止めて|オフにして)[。！!\s]*$/.test(
          text.normalize('NFKC').trim()
        )
      )
        return false;
      this.stop();
      this.status('待ち受けを停止したよ。再開するときはマイクのボタンを押してね。');
      return true;
    }
    async restore() {
      if (!this.enabled || this.paused || this.voice.active || this.starting) return false;
      // Browser speech recognition may require a gesture. Automatic restore uses duplex capture only.
      if (!this.voice.usingDuplex) {
        this.status(
          '待ち受けを始めるには「音声会話を開始」を押してね。自動再開には高精度認識とAPI設定が必要だよ。'
        );
        return false;
      }
      const token = this.generation;
      try {
        const permission = await this.permissions?.query({ name: 'microphone' });
        if (token !== this.generation || !this.enabled || this.paused) return false;
        if (permission?.state !== 'granted') {
          this.status(
            permission?.state === 'denied'
              ? 'ブラウザのサイト設定でマイクを許可し、音声会話を開始してね。'
              : '初回は「音声会話を開始」を押してマイクを許可してね。次回からは自動で待ち受けるよ。'
          );
          return false;
        }
        return this.start({ automatic: true });
      } catch {
        this.status('「音声会話を開始」を押してマイクを有効にしてね。');
        return false;
      }
    }
    async start({ automatic = false } = {}) {
      if (this.starting || this.voice.active || this.voice.busy) return false;
      if (automatic && (!this.enabled || this.paused)) return false;
      if (!automatic) this.setPaused(false);
      this.starting = true;
      const token = ++this.generation;
      const begin = async () => {
        if (token !== this.generation) return false;
        await this.voice.start();
        if (token !== this.generation) {
          this.voice.stop();
          return false;
        }
        return this.voice.active;
      };
      try {
        if (!this.locks?.request) return await begin();
        return await new Promise((resolve, reject) => {
          this.locks
            .request('yorisoi-microphone', { ifAvailable: true }, async (lock) => {
              if (!lock) {
                this.status('別のASTER画面がマイクを使用中だよ。そちらを停止してから開始してね。');
                resolve(false);
                return;
              }
              let release;
              const held = new Promise((r) => {
                release = r;
              });
              this.release = release;
              try {
                const active = await begin();
                resolve(active);
                if (active) await held;
              } catch (error) {
                reject(error);
              } finally {
                if (this.release === release) this.release = null;
              }
            })
            .catch(reject);
        });
      } catch {
        this.voice.stop();
        this.status('マイクの待ち受けを開始できなかったよ。もう一度開始してね。');
        return false;
      } finally {
        this.starting = false;
      }
    }
  }
  const exports = { HandsFreeSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.AsterHandsFree = exports;
})(typeof window === 'undefined' ? globalThis : window);

// Continuous real-time use. Synthetic content, a real AudioWorklet and no external API requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const minutes = Number(process.env.ASTER_ENDURANCE_MINUTES || 5);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + process.env.TEST_SILENT_AUDIO,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  let transcriptions = 0,
    initiatives = 0,
    cycle = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().endsWith('/api/transcribe')) transcriptions++;
    if (r.url().endsWith('/api/proactive')) initiatives++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        cancel() {},
        speak(u) {
          u.onstart?.();
          setTimeout(() => u.onend?.(), 5);
        },
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    window.__liveUrls = new Set();
    URL.createObjectURL = (value) => {
      const url = create(value);
      window.__liveUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__liveUrls.delete(url);
      revoke(url);
    };
  });
  const start = Date.now(),
    samples = [];
  let lastMinute = 0,
    backups = 0,
    privateChecks = 0;
  try {
    await page.goto(process.env.TEST_BASE_URL);
    await page.waitForFunction(() => voice.active && microphone.running && voice.greeted);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    while (Date.now() - start < minutes * 60000) {
      cycle++;
      const result = await page.evaluate(async (cycle) => {
        const post = async (path, body) => {
          const s = await api(path, body);
          if (s.settings) render(s);
          return s;
        };
        await post('settings', { conversation_mode: ['listen', 'think', 'advice'][cycle % 3] });
        if (cycle % 7 === 0) {
          const c = document.createElement('canvas');
          c.width = 64;
          c.height = 64;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#445544';
          ctx.fillRect(0, 0, 64, 64);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          await companion.preparePhoto(new File([blob], 'test.png', { type: 'image/png' }));
        }
        if (!(await voice.ask('耐久試験の会話 ' + cycle + '。今日は自分のペースで読書を進めた。')))
          throw Error('Conversation did not finish');
        const goal = (await post('goals', { title: '試験用の読書', target: 10, unit: 'ページ' }))
          .goals[0];
        const progress = await post('goals', { id: goal.id, increment: 1 });
        if (progress.goals.find((g) => g.id === goal.id)?.progress !== 1)
          throw Error('Goal progress incorrect');
        await post('goals', { id: goal.id, delete: true });
        const reminder = (
          await post('reminders', {
            title: '試験用の振り返り',
            schedule: new Date(Date.now() + 9 * 3600000 - 60000).toISOString().slice(0, 16),
            repeat: 'once',
          })
        ).reminders[0];
        await post('reminders/due', {});
        let s = await api('state');
        render(s);
        for (const delivery of s.reminder_deliveries.filter((d) => d.reminder_id === reminder.id))
          await post('reminders', { ack: delivery.id });
        await post('reminders', { id: reminder.id, delete: true });
        if (cycle % 3 === 0) {
          const task = (
            await post('tasks', {
              title: '試験用の公式情報',
              instruction: '公式情報を確認して変化を整理する',
              interval_hours: 6,
              enabled: true,
            })
          ).agent_tasks[0];
          s = await post('tasks/run', { id: task.id });
          const run = s.agent_runs.find((r) => r.task_id === task.id);
          if (!run?.finished || run.error || run.searches !== 1)
            throw Error('Fixture research task did not complete');
          await post('tasks', { id: task.id, delete: true });
        }
        let privateChecked = false;
        if (cycle % 5 === 0) {
          const before = companion.lastState.messages.at(-1)?.id,
            tracks = microphone.stream.getTracks();
          companion.toggleTemporary(true);
          if (!tracks.every((t) => t.readyState === 'ended'))
            throw Error('Old microphone tracks stayed live');
          await voice.ask('この一時チャットだけの試験 ' + cycle);
          if ((await api('state')).messages.at(-1)?.id !== before)
            throw Error('Temporary chat changed saved messages');
          companion.toggleTemporary(false);
          await companion.startVoice();
          privateChecked = true;
        }
        if (cycle % 10 === 0)
          await post('navigation', { destination: '名古屋駅', origin: '碧南駅' });
        document.querySelector('header [data-tab=chat]').click();
        return {
          active: voice.active,
          running: microphone.running,
          context: microphone.context?.state,
          queue: microphone.queue.length,
          tracks: microphone.stream.getTracks().every((t) => t.readyState === 'live'),
          urls: window.__liveUrls.size,
          pending: voice.pendingInputs.length,
          privateChecked,
        };
      }, cycle);
      privateChecks += Number(result.privateChecked);
      assert.equal(result.active, true);
      assert.equal(result.running, true);
      assert.equal(result.context, 'running');
      assert.equal(result.tracks, true);
      assert.equal(result.urls, 0);
      assert.equal(result.queue, 0);
      assert.equal(result.pending, 0);
      assert.equal(transcriptions, 0);
      assert.deepEqual(errors, []);
      if (cycle % 20 === 0) {
        const r = await context.request.get(process.env.TEST_BASE_URL + '/api/backup');
        assert.equal(r.ok(), true);
        assert.match((await r.body()).subarray(0, 16).toString(), /^SQLite format 3/);
        backups++;
      }
      const minute = Math.floor((Date.now() - start) / 60000);
      if (minute > lastMinute) {
        lastMinute = minute;
        const collected = minute % 5 === 0;
        if (collected) await cdp.send('HeapProfiler.collectGarbage');
        const m = Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])
        );
        assert.ok(m.JSHeapUsedSize < (collected ? 40 : 200) * 1048576);
        if (collected) assert.ok(m.Nodes < 10000);
        const sample = {
          minute,
          cycle,
          jsHeapMB: Math.round(m.JSHeapUsedSize / 1048576),
          nodes: m.Nodes,
          gc: collected,
          privateChecks,
          backups,
          transcriptions,
          initiatives,
        };
        samples.push(sample);
        console.log(JSON.stringify(sample));
      }
      await new Promise((r) => setTimeout(r, 15000));
    }
    const released = await page.evaluate(() => {
      const tracks = microphone.stream.getTracks();
      handsfree.stop();
      return {
        ended: tracks.every((t) => t.readyState === 'ended'),
        level: Number(document.getElementById('voice-scope').dataset.level),
      };
    });
    assert.equal(released.ended, true);
    assert.equal(released.level, 0);
    assert.equal(initiatives, 0);
    const report = {
      ok: true,
      elapsed_seconds: Math.round((Date.now() - start) / 1000),
      minutes,
      cycles: cycle,
      privateChecks,
      backups,
      transcriptions,
      initiatives,
      errors,
      samples,
    };
    fs.writeFileSync(
      process.env.ASTER_TEST_RESULT || '/tmp/aster-endurance.json',
      JSON.stringify(report, null, 2)
    );
    console.log(
      'ASTER interactive endurance PASS: conversation, photo preprocessing, goals, reminders, bounded research, private mode, maps links, backup and microphone restart. Model and voice outputs are fixtures; timers are real.'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

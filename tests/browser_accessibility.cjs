// Dynamic, fixture-backed screens. The audit library is a development dependency only.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ bypassCSP: true, timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage(),
    reports = [];
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
  });
  try {
    await page.goto(process.env.TEST_BASE_URL);
    await page.waitForFunction(() => companion?.lastState);
    await page.evaluate(async () => {
      const post = async (path, body) => {
        const s = await api(path, body);
        if (s.settings) render(s);
        return s;
      };
      await post('chat', { content: 'Webで調べて：試験用のニュースを確認して' });
      await post('memory', { content: '本人が選んだ試験用の記憶' });
      await post('health', { mood: 3, note: '試験用のメモ' });
      await post('goals', { title: '試験用の読書', target: 10, unit: 'ページ' });
      await post('diary', {
        day: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
        content: '試験用の日記',
      });
      await post('reminders', {
        title: '試験用の通知',
        schedule: new Date(Date.now() + 9 * 3600000 + 24 * 3600000).toISOString().slice(0, 16),
        repeat: 'daily',
      });
      const s = await post('tasks', {
        title: '試験用の調査',
        instruction: '公開情報を確認する',
        interval_hours: 6,
        enabled: true,
      });
      await post('tasks/run', { id: s.agent_tasks[0].id });
      document.getElementById('notice').textContent = '保存したよ。';
    });
    await page.addScriptTag({
      path: process.env.AXE_CORE_PATH || require.resolve('axe-core/axe.min.js'),
    });
    for (const width of [1280, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of [
        'chat',
        'tools',
        'health',
        'news',
        'navigate',
        'memory',
        'diary',
        'planner',
        'agent',
      ]) {
        await page.locator('#menu-button').click();
        if (tab === 'chat') await page.locator('header [data-tab=chat]').click();
        else if (tab !== 'tools') await page.locator('.tool-grid [data-tab=' + tab + ']').click();
        await page
          .locator('.panel:not([hidden]) details')
          .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
        const result = await page.evaluate(() =>
          axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] },
          }),
        );
        const geometry = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
          };
        });
        const report = {
          width,
          tab,
          ...geometry,
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
          })),
        };
        reports.push(report);
        console.log(
          JSON.stringify({
            width,
            tab,
            violations: report.violations.length,
            overflow: report.overflow,
            duplicateIds: report.duplicateIds.length,
          }),
        );
      }
    }
    fs.writeFileSync(
      process.env.ASTER_TEST_RESULT || '/tmp/aster-accessibility.json',
      JSON.stringify(reports, null, 2),
    );
    assert.ok(
      reports.every((r) => !r.overflow && !r.duplicateIds.length && !r.violations.length),
      'Review the accessibility report',
    );
    console.log(
      'ASTER accessibility PASS: 36 populated screens, 4 viewport widths, expanded controls, no tested-rule violations, no horizontal overflow or duplicate IDs.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

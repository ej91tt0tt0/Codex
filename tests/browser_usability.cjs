// Regression checks for user drafts, private-mode isolation, replay and asynchronous photos.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    timezoneId: 'Asia/Tokyo',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    class Rec {
      start() {
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Rec });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        cancel() {},
        speak(u) {
          window.__spoken = u;
          u.onstart?.();
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
    await page.waitForFunction(() => companion?.channel === 'text');
    // Settings polling must not discard work in progress in another form.
    await page.locator('#menu-button').click();
    await page.locator('#custom-preferences').fill('まだ保存していない会話ルール');
    await page.evaluate(async () => render(await api('state')));
    assert.equal(
      await page.locator('#custom-preferences').inputValue(),
      'まだ保存していない会話ルール',
    );
    await page.locator('.tool-grid [data-tab=news]').click();
    await page.locator('#topics').fill('まだ保存していない収集テーマ');
    await page.evaluate(async () => render(await api('state')));
    assert.equal(await page.locator('#topics').inputValue(), 'まだ保存していない収集テーマ');
    // An unchanged periodic refresh preserves focus and unsaved bulk-form controls.
    await page.locator('#automatic').uncheck();
    await page.evaluate(async () => render(await api('state')));
    assert.equal(await page.locator('#automatic').isChecked(), false);
    await page.locator('#menu-button').click();
    await page.locator('.tool-grid [data-tab=agent]').click();
    await page.locator('#agent-enabled').uncheck();
    await page.locator('#agent-daily-limit').selectOption('12');
    await page.evaluate(async () => render(await api('state')));
    assert.equal(await page.locator('#agent-enabled').isChecked(), false);
    assert.equal(await page.locator('#agent-daily-limit').inputValue(), '12');
    await page.locator('#menu-button').click();
    await page.locator('.tool-grid [data-tab=memory]').click();
    await page.evaluate(async () =>
      render(await api('memory', { content: 'テスト用に選んだ記憶' })),
    );
    await page.locator('#memory-list button').first().focus();
    await page.evaluate(async () => render(await api('state')));
    assert.equal(
      await page
        .locator('#memory-list button')
        .first()
        .evaluate((n) => n === document.activeElement),
      true,
    );
    // An older HTTP snapshot must not roll back a newer saved setting.
    await page.evaluate(async () => {
      const oldState = await api('state');
      render(await api('settings', { reply_style: 'short' }));
      render(oldState);
    });
    assert.equal(await page.locator('#reply-style').inputValue(), 'short');
    // A response arriving while the next draft is being typed must preserve that draft.
    await page.locator('header [data-tab=chat]').click();
    let release;
    await page.route('**/api/chat', async (route) => {
      await new Promise((r) => (release = r));
      await route.continue();
    });
    await page.locator('#message').fill('最初の質問');
    await page.locator('#message').press('Control+Enter');
    await page.waitForFunction(() => voice.busy);
    await page.locator('#message').fill('まだ送信しない次の発言');
    release();
    await page.waitForFunction(() => !voice.busy);
    assert.equal(await page.locator('#message').inputValue(), 'まだ送信しない次の発言');
    await page.unroute('**/api/chat');
    // Replaying in text mode is explicit, stoppable, and creates no conversation or microphone.
    const before = await page.evaluate(() => companion.lastState.messages.length);
    await page.locator('#replay-reply').click();
    await page.waitForFunction(() => voice.replaying && voice.segmentStarted);
    assert.equal(await page.evaluate(() => voice.active), false);
    await page.locator('#replay-reply').click();
    await page.waitForFunction(() => !voice.replaying);
    assert.equal(await page.evaluate(() => companion.lastState.messages.length), before);
    // Switching private mode while a photo is decoding must discard the late image.
    await page.evaluate(() => {
      const Original = window.Image;
      window.__originalImage = Original;
      window.Image = class extends Original {
        decode() {
          return new Promise((resolve) => {
            window.__photoDecoded = resolve;
          });
        }
      };
      window.__photoTask = companion.preparePhoto(
        new File([new Uint8Array(20)], 'late.png', { type: 'image/png' }),
      );
    });
    await page.locator('#temporary-chat').check();
    await page.evaluate(async () => {
      window.__photoDecoded();
      await window.__photoTask;
      window.Image = window.__originalImage;
    });
    assert.equal(await page.evaluate(() => companion.pendingImage), null);
    assert.equal(await page.locator('#photo-preview').isVisible(), false);
    // Failed temporary sends must not duplicate the user's turn when retried.
    await page.route('**/api/temporary', (r) =>
      r.fulfill({ status: 502, json: { error: 'テスト用の一時エラー' } }),
    );
    await page.locator('#message').fill('一時的な質問');
    await page.locator('#message').press('Control+Enter');
    await page.waitForFunction(() => !voice.busy);
    assert.equal(await page.evaluate(() => companion.messages.length), 0);
    assert.equal(await page.locator('#message').inputValue(), '一時的な質問');
    await page.unroute('**/api/temporary');
    await page.locator('#message').press('Control+Enter');
    await page.waitForFunction(() => !voice.busy);
    assert.equal(
      await page.evaluate(() => companion.messages.filter((m) => m.role === 'user').length),
      1,
    );
    await page.locator('#temporary-chat').uncheck();
    // Tiny images are enlarged for image-token coverage, then metadata is removed through JPEG encoding.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const c = canvas.getContext('2d');
      c.fillStyle = '#ff0000';
      c.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await companion.preparePhoto(new File([blob], 'red.png', { type: 'image/png' }));
      const image = new window.Image();
      image.src = companion.pendingImage;
      await image.decode();
      window.__imageDimensions = [image.width, image.height];
    });
    assert.deepEqual(await page.evaluate(() => window.__imageDimensions), [256, 256]);
    assert.match(await page.evaluate(() => companion.pendingImage), /^data:image\/jpeg;base64,/);
    // A just-selected image must finish loading before an older preview can be sent.
    let sentPhoto = '';
    page.on('request', (request) => {
      if (request.url().endsWith('/api/chat')) sentPhoto = request.postDataJSON().image || '';
    });
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const c = canvas.getContext('2d');
      c.fillStyle = '#0000ff';
      c.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      window.__originalImage = window.Image;
      window.Image = class extends window.__originalImage {
        async decode() {
          await super.decode();
          await new Promise((resolve) => {
            window.__releasePhoto = resolve;
          });
        }
      };
      window.__loadingPhoto = companion.preparePhoto(
        new File([blob], 'blue.png', { type: 'image/png' }),
      );
    });
    await page.waitForFunction(() => Boolean(window.__releasePhoto));
    await page.locator('#message').fill('新しく選んだ写真について話したい');
    await page.locator('#message').press('Control+Enter');
    await page.waitForFunction(() => voice.busy);
    assert.equal(await page.locator('#photo-input').isDisabled(), true);
    assert.equal(sentPhoto, '');
    await page.evaluate(() => {
      window.Image = window.__originalImage;
      window.__releasePhoto();
    });
    await page.waitForFunction(() => !voice.busy);
    const pixel = await page.evaluate(async (data) => {
      const photo = new Image();
      photo.src = data;
      await photo.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const c = canvas.getContext('2d');
      c.drawImage(photo, 0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data];
    }, sentPhoto);
    assert.ok(
      pixel[2] > 240 && pixel[0] < 15,
      'The new blue image must be sent, not the old red preview',
    );
    assert.deepEqual(errors, []);
    console.log(
      'ASTER usability PASS: draft preservation, keyboard submit, stoppable replay, late photo isolation, private retry without duplication, small-photo preprocessing, waiting for the newly selected image. Model and speech outputs are fixtures.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

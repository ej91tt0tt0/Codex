const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];let uploadedPhoto='';
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/chat')){const b=r.postDataJSON();if(b.image)uploadedPhoto=b.image;}});
 await page.addInitScript(()=>{
  class Rec{start(){this.onstart?.();}abort(){this.onend?.();}}
  Object.defineProperty(window,'SpeechRecognition',{value:Rec});Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
  window.__notifications=0;class Notice{constructor(){window.__notifications++;}static permission='default';static async requestPermission(){this.permission='granted';return 'granted';}}Object.defineProperty(window,'Notification',{value:Notice});
 });
 const state=()=>page.evaluate(()=>api('state'));
 async function tab(name){await page.locator('#menu-button').click();await page.locator('[data-tab='+name+']').click();}
 async function send(text){await page.locator('header [data-tab=chat]').click();await page.locator('#text-input').evaluate(n=>n.open=true);await page.locator('#message').fill(text);const response=page.waitForResponse(r=>r.url().endsWith(companionPath));await page.locator('#chat-form button').first().click();await response;await page.waitForFunction(()=>!voice.busy);}
 let companionPath='/api/chat';
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>companion.lastState&&companion.channel);assert.match(await page.title(),/ASTER/);
  const changed=page.waitForResponse(r=>r.url().endsWith('/api/settings'));await page.locator('#conversation-mode').selectOption('listen');await changed;assert.equal((await state()).settings.conversation_mode,'listen');
  await page.locator('#menu-button').click();await page.locator('#preferred-name').fill('ユウ');await page.locator('#hobbies').fill('映画、読書');await page.locator('#blocked-topics').fill('政治');await page.locator('#emoji-level').selectOption('few');await page.locator('#question-frequency').selectOption('none');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings'));await page.locator('#persona-form button').click();await saved;
  let s=await state();assert.equal(s.settings.preferred_name,'ユウ');assert.equal(s.settings.blocked_topics,'政治');
  await send('もっと短く');assert.equal((await state()).settings.reply_style,'short');
  await send('今日は読書と散歩ができたよ。');const count=(await state()).messages.length;
  const channel=page.waitForResponse(r=>r.url().endsWith('/api/settings'));await page.locator('#interaction-mode').selectOption('voice');await channel;await page.waitForFunction(()=>voice.active);const textMode=page.waitForResponse(r=>r.url().endsWith('/api/settings'));await page.locator('#interaction-mode').selectOption('text');await textMode;await page.waitForFunction(()=>!voice.active);assert.equal((await state()).messages.length,count);
  await page.locator('#temporary-chat').check();companionPath='/api/temporary';await send('覚えて：ここだけの秘密');s=await state();assert.equal(s.messages.length,count);assert.equal(s.memories.length,0);assert.equal(await page.locator('#temporary-note').isVisible(),true);
  await send('ただ聞いてほしい');assert.equal((await state()).settings.conversation_mode,'listen');
  await send('一時的な相談だけをする');assert.equal((await state()).messages.length,count);
  await page.locator('#temporary-chat').uncheck();companionPath='/api/chat';assert.doesNotMatch(await page.locator('#messages').textContent(),/ここだけの秘密|一時的な相談/);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await page.locator('#photo-input').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>Boolean(companion.pendingImage));await page.locator('#message').fill('');const photoSent=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.locator('#chat-form button').first().click();await photoSent;await page.waitForFunction(()=>!voice.busy);
  assert.match(uploadedPhoto,/^data:image\/jpeg;base64,/);assert.equal(await page.locator('#photo-preview').isVisible(),false);assert.ok(!(JSON.stringify(await state()).includes(uploadedPhoto)));
  await tab('diary');await page.locator('#diary-draft').click();await page.waitForFunction(()=>document.getElementById('diary-content').value.length>0);assert.equal((await state()).diaries.length,0);
  await page.locator('#diary-content').fill('自分で直した日記。読書と散歩ができた。');const diarySaved=page.waitForResponse(r=>r.url().endsWith('/api/diary'));await page.locator('#diary-form button').last().click();await diarySaved;assert.equal((await state()).diaries.length,1);
  await tab('planner');await page.locator('#goal-title').fill('読書');await page.locator('#goal-target').fill('5');await page.locator('#goal-unit').fill('ページ');const goalSaved=page.waitForResponse(r=>r.url().endsWith('/api/goals'));await page.locator('#goal-form button[type=submit]').click();await goalSaved;
  const goalUpdated=page.waitForResponse(r=>r.url().endsWith('/api/goals'));await page.locator('#goal-list button').first().click();await goalUpdated;assert.equal((await state()).goals[0].progress,1);
  await page.locator('#reminder-title').fill('今日の振り返り');await page.locator('#reminder-schedule').fill(await page.evaluate(()=>new Date(Date.now()+9*3600000-60000).toISOString().slice(0,16)));const reminderSaved=page.waitForResponse(r=>r.url().endsWith('/api/reminders'));await page.locator('#reminder-form button[type=submit]').click();await reminderSaved;await page.evaluate(()=>companion.pollReminders());assert.equal(await page.locator('#reminder-alert').isVisible(),true);assert.equal(await page.evaluate(()=>window.__notifications),0);
  const acked=page.waitForResponse(r=>r.url().endsWith('/api/reminders'));await page.locator('#reminder-alert button').first().click();await acked;await page.waitForFunction(()=>document.getElementById('reminder-alert').hidden);
  await page.locator('#notification-permission').click();assert.match(await page.locator('#notification-status').textContent(),/有効/);
  await tab('agent');await page.locator('#agent-title').fill('外出の準備');await page.locator('#agent-instruction').fill('天気と交通の公式情報を確認して変化をまとめる');const taskAdded=page.waitForResponse(r=>r.url().endsWith('/api/tasks'));await page.locator('#agent-form button[type=submit]').click();await taskAdded;
  const taskRun=page.waitForResponse(r=>r.url().endsWith('/api/tasks/run'));await page.locator('#agent-list button').first().click();await taskRun;await page.waitForFunction(()=>document.getElementById('agent-list').textContent.includes('調査方針'));assert.match(await page.locator('#agent-list a').first().getAttribute('href'),/^https:/);
  await page.locator('#menu-button').click();const game=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.locator('[data-prompt]').filter({hasText:'クイズ'}).click();await game;await page.waitForFunction(()=>!voice.busy);assert.match((await state()).messages.filter(m=>m.role==='user').at(-1).content,/クイズ/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('ASTER companion browser PASS: persona, feedback, same conversation voice/text, private non-persistence, photo re-encoding, diary review/save, goals, reminders and opt-in notifications, autonomous task/source, games, mobile layout. Model and audio outputs are fixtures.');
 }catch(error){console.log('ASTER diagnostics',await page.evaluate(()=>({notice:document.getElementById('notice').textContent,status:document.getElementById('voice-status').textContent,temporary:companion?.isTemporary,channel:companion?.channel,busy:voice?.busy})));throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

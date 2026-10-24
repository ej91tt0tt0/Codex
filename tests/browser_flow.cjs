const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];
 const thought='明日の予定は、買い物を済ませてから帰ろう。家で少し休めるから、その方が余裕を持てるよ。';let chats=0,initiatives=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/proactive'))initiatives++;});
 await page.addInitScript(thought=>{
  window.__spoken=[];window.__held=null;window.__midCut=false;window.__holding=false;window.recognizers=[];
  class Rec{constructor(){window.recognizers.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
  Object.defineProperty(window,'SpeechRecognition',{value:Rec});
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){if(window.__holding)window.__midCut=true;},speak(u){window.__spoken.push(u.text);u.onstart?.();if(u.text===thought){window.__held=u;window.__holding=true;}else setTimeout(()=>u.onend?.(),5);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 },thought);
 await page.route('**/api/chat',async route=>{const response=await route.fetch();const s=await response.json();s.messages.at(-1).content=++chats===1?thought:'午後に変更だね。追加の話も合わせて整理したよ。';await route.fulfill({json:s});});
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);
  await page.locator('#voice-start').click();await page.waitForFunction(()=>voice.rec);
  await page.evaluate(()=>{const r=voice.rec;r.onresult({results:[Object.assign([{transcript:'明日の予定を決めたい'}],{isFinal:true})]});r.onend();});
  await page.waitForFunction(()=>window.__holding);assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),thought);
  await page.evaluate(()=>{voice.hearStart();voice.inputState({speaking:false,pending:0});void voice.ask('やっぱり午後に変更したい');});
  await page.locator('#voice-interrupt').click();assert.equal(chats,1);assert.equal(await page.evaluate(()=>window.__holding&&!window.__midCut),true);
  await page.evaluate(()=>{window.__holding=false;window.__held.onend();});
  await page.waitForFunction(()=>!voice.busy&&document.getElementById('latest-reply').textContent.includes('午後に変更'));
  assert.equal(chats,2);assert.equal(await page.evaluate(()=>window.__midCut),false);assert.match(await page.locator('#messages').textContent(),/やっぱり午後に変更/);
  await page.evaluate(()=>{voice.idleMilliseconds=15;voice.armIdle();});await page.waitForFunction(()=>voice.proactiveCount===1&&!voice.busy);
  await page.waitForTimeout(100);assert.equal(initiatives,1);assert.equal(await page.evaluate(()=>voice.active),true);
  await page.locator('#menu-button').click();assert.equal(await page.locator('#proactive-interval').inputValue(),'600');assert.equal(await page.locator('#proactive-topics').isChecked(),false);
  await page.locator('.companion-settings > summary').click();const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings'));await page.locator('#proactive-topics').check();await saved;
  await page.reload();await page.waitForFunction(()=>voice.greeted);await page.locator('#menu-button').click();assert.equal(await page.locator('#proactive-topics').isChecked(),true);
  assert.deepEqual(errors,[]);console.log('Conversation flow browser PASS: a full thought spanning commas and periods is spoken intact, new speech and handoff wait, queued correction is answered, a single proactive utterance then silence, 10-minute default and topic opt-in persisted. Speech and model outputs are simulated.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

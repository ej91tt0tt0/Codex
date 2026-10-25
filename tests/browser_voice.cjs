// Run against an isolated record-mode server, never against a user's database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.testRecognizers=[];window.testSpeech=[];
  class Recognizer {
   constructor(){window.testRecognizers.push(this);}
   start(){this.onstart?.();}
   abort(){this.aborted=true;this.onend?.();}
  }
  Object.defineProperty(window,'SpeechRecognition',{value:Recognizer});
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'ja-JP'}],cancel(){},speak(u){window.testSpeech.push(u.text);u.onstart?.();setTimeout(()=>u.onend?.(),10);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 try {
  await page.goto(process.env.TEST_BASE_URL);
  await page.waitForFunction(()=>document.getElementById('voice-status').textContent.includes('挨拶しました'));
  assert.equal(await page.evaluate(()=>window.testRecognizers.length),0);
  assert.match(await page.locator('#voice-greeting').textContent(),/アスター/);
  await page.locator('#voice-start').click();
  await page.waitForFunction(()=>window.testRecognizers.length===1);
  await page.evaluate(()=>{
   const r=window.testRecognizers[0];
   r.onresult({results:[Object.assign([{transcript:'音声画面の接続確認'}],{isFinal:true})]});r.onend();
  });
  await page.waitForFunction(()=>window.testRecognizers.length===2);
  assert.match(await page.locator('#messages').textContent(),/音声画面の接続確認/);
  assert.match(await page.evaluate(()=>window.testSpeech.join('')),/記録モード/);
  await page.locator('#voice-stop').click();
  assert.equal(await page.locator('#voice-start').isEnabled(),true);
  assert.equal(await page.locator('#voice-stop').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.testRecognizers.at(-1).aborted),true);
  await page.locator('#voice-start').click();
  await page.evaluate(()=>{voice.idleMilliseconds=20;voice.armIdle();});
  await page.waitForFunction(()=>voice.proactiveCount===1&&!voice.busy);
  assert.match(await page.locator('#messages').textContent(),/少し静かな時間/);
  await page.locator('#voice-stop').click();
  assert.equal(await page.evaluate(()=>voice.active),false);
  assert.equal(await page.locator('#chat-form').isVisible(),false);
  await page.locator('#text-input summary').click();
  assert.equal(await page.locator('#chat-form').isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#text-input summary').click();
  assert.equal(await page.locator('aside').count(),0);
  assert.equal(await page.locator('.voice-buttons button:visible').count(),3);
  await page.locator('#voice-start').click();
  await page.locator('#menu-button').click();
  assert.equal(await page.evaluate(()=>voice.active),false);
  assert.equal(await page.locator('#tools').isVisible(),true);
  await page.locator('[data-tab="health"]').click();
  assert.equal(await page.locator('#health').isVisible(),true);
  await page.locator('header [data-tab="chat"]').click();
  assert.equal(await page.locator('#chat').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Browser UI: greeting, no startup mic, voice turn, speech reply, stop, text fallback, idle initiative, mobile layout PASS (mock speech APIs; actual local server).');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

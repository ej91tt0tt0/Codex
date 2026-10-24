const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({acceptDownloads:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.recognizers=[];class Rec{constructor(){window.recognizers.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
  Object.defineProperty(window,'SpeechRecognition',{value:Rec});Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices:()=>[],speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);await page.locator('#voice-start').click();
  async function say(text){await page.waitForFunction(()=>voice.rec);await page.evaluate(text=>{const r=window.recognizers.at(-1);r.onresult({results:[Object.assign([{transcript:text}],{isFinal:true})]});r.onend();},text);await page.waitForFunction(()=>!voice.busy&&voice.rec);}
  await say('設定変更、返答を短くして');assert.equal(await page.locator('#reply-style').inputValue(),'short');
  await say('設定変更、会話ルール、話題を変えたら前の話に戻さないで');assert.match(await page.locator('#custom-preferences').inputValue(),/前の話に戻さない/);
  await say('改善リクエスト、音声の認識をもっと速くして');assert.match(await page.locator('#latest-reply').textContent(),/コードはまだ変更していない/);
  await page.locator('#menu-button').click();
  const group=page.locator('#tools details').filter({has:page.locator('#improvement-list')});await group.locator('summary').click();
  assert.match(await page.locator('#improvement-list').textContent(),/未実装/);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-requests').click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'aster-improvement-requests.txt');const text=fs.readFileSync(await download.path(),'utf8');assert.match(text,/音声の認識をもっと速くして/);
  assert.deepEqual(errors,[]);
  console.log('Voice-command browser PASS: spoken preference updates, rule persistence, unimplemented request status, request export (mock speech recognition; actual server).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

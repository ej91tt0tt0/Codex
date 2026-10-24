const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+process.env.TEST_AUDIO_FILE,'--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];const texts=['明日、買い物に行きたい','やっぱり明後日に変更したい'];let transcribed=0,turns=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__spoken=[];window.__cancelled=0;window.__peak=0;window.__cutMidClause=false;window.__clauseActive=false;
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'ja-JP'}],cancel(){window.__cancelled++;if(window.__clauseActive)window.__cutMidClause=true;},speak(u){window.__spoken.push(u);u.onstart?.();const held=u.text.includes('明日の買い物');if(held)window.__clauseActive=true;setTimeout(()=>{if(held)window.__clauseActive=false;u.onend?.();},held?1100:20);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 await page.route('**/api/state',async route=>{const response=await route.fetch();const s=await response.json();s.ai_connected=true;await route.fulfill({json:s});});
 await page.route('**/api/transcribe',async route=>{
  const bytes=route.request().postDataBuffer();assert.equal(bytes.subarray(0,4).toString(),'RIFF');
  await route.fulfill({json:{text:texts[Math.min(transcribed++,1)]}});
 });
 await page.route('**/api/chat',async route=>{
  turns++;const response=await route.fetch();const s=await response.json();s.ai_connected=true;
  s.messages.at(-1).content=turns===1?'明日の買い物の話を続けよう。':'買い物は明後日に変更だね。追加の話も合わせて整理したよ。';await route.fulfill({json:s});
 });
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);
  assert.equal(await page.evaluate(()=>microphone.running),false);
  await page.evaluate(()=>{const n=document.getElementById('voice-scope');new MutationObserver(()=>window.__peak=Math.max(window.__peak,Number(n.dataset.level))).observe(n,{attributes:true,attributeFilter:['data-level']});});
  await page.locator('#voice-start').click();
  await page.waitForFunction(()=>window.__peak>.1,null,{timeout:10000});
  await page.screenshot({path:'/workspace/yorisoi-duplex/volume-preview.png'});
  await page.waitForFunction(()=>voice.busy&&Boolean(voice.finishSpeech),null,{timeout:20000});
  assert.equal(await page.evaluate(()=>microphone.running),true);
  const before=await page.evaluate(()=>window.__cancelled);
  await page.waitForFunction(()=>document.getElementById('latest-reply').textContent.includes('明後日')&&!voice.busy,null,{timeout:25000});
  assert.equal(await page.evaluate(()=>window.__cutMidClause),false);
  assert.ok(transcribed>=2);assert.ok(turns>=2);
  assert.ok(await page.evaluate(()=>window.__peak)>.1);
  assert.ok(await page.evaluate(()=>window.__cancelled)>before);
  const heard=await page.evaluate(()=>document.getElementById('messages').textContent);
  assert.match(heard,/明日、買い物/);assert.match(heard,/明後日に変更/);
  assert.equal(await page.evaluate(()=>microphone.running),true);
  await page.screenshot({path:process.env.TEST_SCREENSHOT||'/workspace/yorisoi-duplex/preview.png'});
  await page.evaluate(()=>window.__savedTracks=microphone.stream.getTracks());await page.locator('#voice-stop').click();
  assert.equal(await page.evaluate(()=>window.__savedTracks.every(t=>t.readyState==='ended')),true);
  assert.equal(await page.evaluate(()=>Number(document.getElementById('voice-scope').dataset.level)),0);
  assert.deepEqual(errors,[]);
  console.log('Duplex browser PASS: real AudioWorklet + synthetic mic audio, volume response, yield after the active clause, added input, all tracks released. Transcription and AI replies are mocked.');
 }catch(error){console.log('Page errors:',errors);console.log('Browser diagnostics:',await page.evaluate(()=>typeof voice==='undefined'?{app:'not initialized'}:({status:document.getElementById('voice-status').textContent,active:voice.active,usingDuplex:voice.usingDuplex,running:microphone.running,speaking:microphone.speaking,queue:microphone.queue.length,peak:window.__peak,spoken:window.__spoken.map(u=>u.text),context:microphone.context?.state,recorderError:document.getElementById('notice').textContent,segment:microphone.segmenter?{noise:microphone.segmenter.noise,attack:microphone.segmenter.attack,length:microphone.segmenter.length}:null})));console.log('Page errors:',errors);await page.screenshot({path:'/workspace/yorisoi-duplex/failure.png'});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

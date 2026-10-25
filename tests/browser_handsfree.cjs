const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+process.env.TEST_SILENT_AUDIO,'--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];let transcriptions=0,chats=0,initiatives=0,nextText='待ち受けの会話テスト';
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{
  const query=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=descriptor=>descriptor.name==='microphone'?Promise.resolve({state:localStorage.getItem('test.mic.allowed')==='true'?'granted':'prompt'}):query(descriptor);
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 for(const name of ['state','chat','settings'])await context.route('**/api/'+name,async route=>{const response=await route.fetch();const s=await response.json();s.ai_connected=true;if(name==='chat'){chats++;s.messages.at(-1).content='聞こえたよ。'}await route.fulfill({json:s});});
 await context.route('**/api/transcribe',async route=>{transcriptions++;const raw=route.request().postDataBuffer();assert.equal(raw.subarray(0,4).toString(),'RIFF');await route.fulfill({json:{text:nextText}});});
 context.on('request',r=>{if(r.url().endsWith('/api/proactive'))initiatives++;});
 async function talk(){await page.evaluate(()=>{const packet=amplitude=>{const p=new Float32Array(1024);for(let i=0;i<p.length;i++)p[i]=Math.sin(i*.13)*amplitude;return p;};for(let i=0;i<15;i++)microphone.node.port.onmessage({data:packet(.1)});for(let i=0;i<26;i++)microphone.node.port.onmessage({data:packet(0)});});}
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);
  assert.equal(await page.evaluate(()=>microphone.running),false);assert.equal(transcriptions,0);
  await page.locator('#voice-start').click();await page.waitForFunction(()=>microphone.running&&voice.active);assert.match(await page.locator('#mic-toggle').textContent(),/待ち受け/);await page.waitForFunction(()=>document.getElementById('input-level').textContent==='MIC · 0%');
  await page.evaluate(()=>localStorage.setItem('test.mic.allowed','true'));
  await page.locator('#menu-button').click();assert.equal(await page.evaluate(()=>microphone.running),true);
  await page.locator('[data-tab=health]').click();await talk();await page.waitForFunction(()=>!voice.busy&&document.getElementById('latest-reply').textContent==='聞こえたよ。');assert.equal(chats,1);assert.equal(await page.evaluate(()=>microphone.running),true);
  await page.reload();await page.waitForFunction(()=>microphone.running&&voice.active&&voice.greeted);assert.equal(chats,1);
  const second=await context.newPage();await second.goto(process.env.TEST_BASE_URL);await second.waitForFunction(()=>voice.greeted);
  assert.equal(await second.evaluate(()=>microphone.running),false);assert.equal(await page.evaluate(()=>microphone.running),true);await second.close();
  const background=await context.newPage();await background.goto('about:blank');await background.bringToFront();
  // Headless Chromium keeps its targets visible; simulate visibility events without suspending audio.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.evaluate(()=>microphone.stream.getTracks().every(t=>t.readyState==='live')),true);
  const before=chats,response=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await talk();await response;
  await page.waitForFunction(()=>!voice.busy&&!microphone.working);assert.equal(chats,before+1);assert.equal(await page.evaluate(()=>voice.active&&microphone.running),true);
  await page.evaluate(()=>voice.initiate());assert.equal(initiatives,0);await background.close();await page.bringToFront();
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  const oldCount=transcriptions;await page.evaluate(()=>{for(let i=0;i<200;i++)microphone.node.port.onmessage({data:new Float32Array(1024)});});await page.waitForTimeout(100);assert.equal(transcriptions,oldCount);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>window.__oldTracks=microphone.stream.getTracks());nextText='マイクを止めて';const beforeStop=chats;await talk();
  await page.waitForFunction(()=>!voice.active&&!microphone.running);assert.equal(chats,beforeStop);assert.equal(await page.evaluate(()=>window.__oldTracks.every(t=>t.readyState==='ended')),true);
  await page.reload();await page.waitForFunction(()=>voice.greeted);assert.equal(await page.evaluate(()=>microphone.running),false);
  await page.locator('#mic-toggle').click();await page.waitForFunction(()=>voice.active&&microphone.running);
  await page.locator('#menu-button').click();await page.locator('#hands-free').uncheck();await page.waitForFunction(()=>!voice.handsFree&&!voice.active);
  await page.reload();await page.waitForFunction(()=>voice.greeted);assert.equal(await page.evaluate(()=>voice.handsFree||microphone.running),false);
  assert.deepEqual(errors,[]);
  console.log('Hands-free browser PASS: first-use gesture, menu conversation, automatic reload restore, one-tab microphone lease, simulated background conversation, no silence uploads, spoken local stop, ended tracks, reload pause, manual resume, persisted opt-out, mobile layout. Permission/visibility/STT/replies and speech packets are simulated; actual AudioWorklet and microphone tracks run in Chromium.');
 }catch(error){console.log('Hands-free diagnostics',await page.evaluate(()=>({status:document.getElementById('voice-status').textContent,active:voice.active,busy:voice.busy,running:microphone.running,context:microphone.context?.state,paused:handsfree.paused,errors:document.getElementById('notice').textContent})));throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

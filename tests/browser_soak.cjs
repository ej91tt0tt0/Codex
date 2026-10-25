// Real-time endurance check. Inputs and speech are simulated; timers are not accelerated.
const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const minutes=Number(process.env.ASTER_SOAK_MINUTES||11);const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+process.env.TEST_SILENT_AUDIO,'--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({permissions:['microphone']});const page=await context.newPage();const errors=[];let transcriptions=0,initiatives=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/transcribe'))transcriptions++;if(r.url().endsWith('/api/proactive'))initiatives++;});
 await page.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});});
 for(const path of ['state','proactive'])await page.route('**/api/'+path,async route=>{const response=await route.fetch();const s=await response.json();s.ai_connected=true;await route.fulfill({json:s});});
 const samples=[];const start=Date.now();
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.active&&microphone.running&&voice.greeted,null,{timeout:15000});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  for(let i=0;i<minutes;i++){
   await new Promise(resolve=>setTimeout(resolve,60000));
   const s=await page.evaluate(()=>({active:voice.active,running:microphone.running,queue:microphone.queue.length,context:microphone.context?.state,tracks:microphone.stream?.getTracks().every(t=>t.readyState==='live'),proactive:voice.proactiveCount}));
   const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   assert.equal(s.active,true);assert.equal(s.running,true);assert.equal(s.tracks,true);assert.equal(s.queue,0);assert.equal(transcriptions,0);assert.ok(metrics.JSHeapUsedSize<200_000_000);
   samples.push({minute:i+1,...s,jsHeapMB:Math.round(metrics.JSHeapUsedSize/1048576),nodes:metrics.Nodes});console.log(JSON.stringify(samples.at(-1)));
  }
  assert.equal(initiatives,1);assert.equal(await page.evaluate(()=>voice.proactiveCount),1);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.savedTracks=microphone.stream.getTracks());await page.locator('#voice-stop').click();assert.equal(await page.evaluate(()=>window.savedTracks.every(t=>t.readyState==='ended')),true);assert.equal(await page.evaluate(()=>Number(document.getElementById('voice-scope').dataset.level)),0);
  const result={elapsed_seconds:Math.round((Date.now()-start)/1000),minutes,transcriptions,initiatives,errors,samples};fs.writeFileSync(process.env.ASTER_TEST_RESULT||'/tmp/aster-soak.json',JSON.stringify(result,null,2));console.log('ASTER endurance PASS: real-time 10-minute quiet period, one proactive utterance, no silence uploads, live capture, bounded heap and complete track release.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

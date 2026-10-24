const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext();await context.grantPermissions(['clipboard-read','clipboard-write']);const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://www.google.com/maps/**',route=>route.fulfill({contentType:'text/html',body:'<title>Maps integration test</title><p>Google Maps request intercepted for testing.</p>'}));
 await page.addInitScript(()=>{
  window.recognizers=[];class Rec{constructor(){window.recognizers.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
  Object.defineProperty(window,'SpeechRecognition',{value:Rec});Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices:()=>[],speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);assert.equal(await page.locator('#external-action').isVisible(),false);
  await page.locator('#voice-start').click();
  async function say(text){await page.waitForFunction(()=>voice.rec);await page.evaluate(text=>{const r=window.recognizers.at(-1);r.onresult({results:[Object.assign([{transcript:text}],{isFinal:true})]});r.onend();},text);await page.waitForFunction(()=>!voice.busy&&voice.rec);}
  await say('車で碧南駅から名古屋駅までナビして');
  assert.equal(await page.locator('#external-action').isVisible(),true);assert.equal(context.pages().length,1);
  assert.equal(await page.locator('#action-open').evaluate(n=>n.getBoundingClientRect().bottom<innerHeight),true);
  await page.screenshot({path:'/workspace/yorisoi-maps/preview.png'});
  let url=new URL(await page.locator('#action-open').getAttribute('href'));
  assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('travelmode'),'driving');assert.equal(url.searchParams.get('dir_action'),'navigate');assert.equal(url.searchParams.get('destination'),'名古屋駅');assert.equal(url.searchParams.get('origin'),'碧南駅');
  const popupPromise=page.waitForEvent('popup');await page.locator('#action-open').click();const popup=await popupPromise;await popup.waitForLoadState();assert.match(popup.url(),/google\.com\/maps\/dir/);assert.equal(await page.evaluate(()=>voice.active),false);await popup.close();await page.bringToFront();
  await page.locator('#menu-button').click();await page.locator('[data-tab=navigate]').click();await page.locator('#origin').fill('現在地');await page.locator('#destination').fill('名古屋城');await page.locator('#route-form button').click();await page.waitForFunction(()=>!document.getElementById('external-action').hidden&&document.getElementById('action-route').textContent.includes('名古屋城'));
  url=new URL(await page.locator('#action-open').getAttribute('href'));assert.equal(url.searchParams.get('origin'),null);assert.equal(url.searchParams.get('destination'),'名古屋城');
  await page.locator('#copy-route').click();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(copied).searchParams.get('destination'),'名古屋城');
  await page.locator('#voice-start').click();await say('車のナビを開いて');assert.equal(await page.locator('#external-action').isVisible(),false);await say('目的地は名古屋駅');assert.match(await page.locator('#action-route').textContent(),/名古屋駅/);
  await page.locator('#voice-stop').click();assert.deepEqual(errors,[]);
  console.log('Maps browser PASS: spoken driving intent, explicit origin, current location omission, user-clicked external popup, destination form, copied mobile URL, follow-up destination. Google Maps page is intercepted; actual navigation is not tested.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

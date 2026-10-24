const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];let requests=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/research'))requests++;});
 await page.addInitScript(()=>{
  window.recognizers=[];class Rec{constructor(){window.recognizers.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
  Object.defineProperty(window,'SpeechRecognition',{value:Rec});
  Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices:()=>[],speak(u){u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 });
 try{
  await page.goto(process.env.TEST_BASE_URL);await page.waitForFunction(()=>voice.greeted);
  assert.equal(await page.locator('#research-sources').isVisible(),false);
  await page.locator('#menu-button').click();await page.locator('[data-tab=navigate]').click();
  await page.locator('#query').fill('今日の公式発表を調べて');await page.locator('#search-form button').click();
  await page.waitForFunction(()=>!voice.busy&&document.getElementById('latest-reply').textContent.includes('テスト用の公式発表'));
  assert.equal(context.pages().length,1);assert.equal(await page.locator('#research-sources').isVisible(),true);
  assert.equal(await page.locator('#latest-sources a').count(),1);
  assert.equal(await page.locator('#latest-sources a').first().getAttribute('href'),'https://example.com/research');
  assert.match(await page.locator('#latest-sources').textContent(),/調査:.*日本時間/);
  assert.equal(await page.locator('#latest-reply').textContent().then(x=>x.includes('\ue200')),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#menu-button').click();await page.locator('[data-tab=news]').click();
  await page.locator('#research-now').click();await page.waitForFunction(()=>!document.getElementById('research-now').disabled);
  assert.equal(requests,1);assert.match(await page.locator('#research-list').textContent(),/定時調査のテスト/);
  assert.equal(await page.locator('#research-list a').first().getAttribute('href'),'https://example.com/research');
  await page.reload();await page.waitForFunction(()=>voice.greeted);await page.locator('#menu-button').click();await page.locator('[data-tab=news]').click();
  assert.match(await page.locator('#research-list').textContent(),/定時調査のテスト/);
  await page.locator('#web-search').uncheck();await page.waitForFunction(()=>!document.getElementById('web-search').checked);
  await page.locator('#research-now').click();await page.waitForFunction(()=>!document.getElementById('research-now').disabled);
  assert.match(await page.locator('#notice').textContent(),/オフ/);
  await page.locator('#web-search').check();await page.waitForFunction(()=>document.getElementById('web-search').checked);
  await page.locator('#research-now').click();await page.waitForFunction(()=>!document.getElementById('research-now').disabled);
  assert.match(await page.locator('#research-list').textContent(),/テスト用の取得失敗/);
  await page.locator('#ai-collect').uncheck();await page.waitForFunction(()=>document.getElementById('research-status').textContent.includes('定時調査オフ'));
  assert.deepEqual(errors,[]);
  console.log('Research browser PASS: in-app search, spoken answer text, visible citation links, mobile width, scheduled report, retained report, search toggle, failed collection and opt-out. AI outputs are fixtures; no live API verification.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

const test=require('node:test');const assert=require('node:assert/strict');
const {HandsFreeSession}=require('../static/handsfree.js');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(permission='granted',sharedStorage=new Map(),locks=null){
 const statuses=[];let starts=0,stops=0,queries=0;
 const voice={active:false,busy:false,usingDuplex:true,handsFree:false,async start(){starts++;this.active=true;session.observe({active:true});},stop(){stops++;this.active=false;session.observe({active:false});},update(){}};
 const session=new HandsFreeSession({voice,locks,permissions:{async query(){queries++;return{state:permission};}},storage:{getItem:k=>sharedStorage.get(k),setItem:(k,v)=>sharedStorage.set(k,v)},status:s=>statuses.push(s)});
 return{session,voice,statuses,counts:()=>({starts,stops,queries}),sharedStorage};
}
test('saved microphone permission automatically starts duplex capture without a click',async()=>{
 const {session,voice,counts}=setup();session.configure(true);assert.equal(await session.restore(),true);assert.equal(voice.active,true);assert.equal(counts().starts,1);await session.restore();assert.equal(counts().starts,1);session.close();
});
test('first use and denied permission never trigger a microphone request automatically',async()=>{
 for(const permission of ['prompt','denied']){const {session,counts,statuses}=setup(permission);session.configure(true);assert.equal(await session.restore(),false);assert.equal(counts().starts,0);assert.match(statuses.at(-1),/マイク|許可/);}
});
test('user stop persists across reload and only a deliberate start clears it',async()=>{
 const first=setup();first.session.configure(true);await first.session.restore();first.session.stop();
 const reloaded=setup('granted',first.sharedStorage);reloaded.session.configure(true);await reloaded.session.restore();assert.equal(reloaded.counts().starts,0);
 await reloaded.session.start();assert.equal(reloaded.voice.active,true);assert.equal(reloaded.sharedStorage.get('yorisoi.mic.paused'),'false');reloaded.session.close();
});
test('closing the page releases capture but allows automatic restoration on next launch',async()=>{
 const first=setup();first.session.configure(true);await first.session.restore();first.session.close();
 const second=setup('granted',first.sharedStorage);second.session.configure(true);assert.equal(await second.session.restore(),true);second.session.close();
});
test('disabled hands-free and fallback recognition do not start automatically',async()=>{
 const {session,voice,counts}=setup();await session.restore();assert.equal(counts().queries,0);
 session.configure(true);voice.usingDuplex=false;await session.restore();assert.equal(counts().starts,0);await session.start();assert.equal(counts().starts,1);session.configure(false);assert.equal(voice.active,false);
});
test('permission results arriving after a stop cannot restart the microphone',async()=>{
 const {session,voice}=setup();let resolve;session.permissions={query:()=>new Promise(r=>resolve=r)};session.configure(true);const pending=session.restore();session.stop();resolve({state:'granted'});await pending;assert.equal(voice.active,false);
});
test('local spoken microphone stop bypasses the API and ignores quoted stop requests',async()=>{
 const {session,voice}=setup();session.configure(true);await session.restore();assert.equal(session.handleCommand('「マイクを止めて」と言えばいい？'),false);assert.equal(session.handleCommand('よりそい、マイクを止めて。'),true);assert.equal(voice.active,false);
});
test('single-tab microphone lease is released on stop and prevents duplicate capture',async()=>{
 let occupied=false;const locks={async request(name,options,callback){assert.equal(name,'yorisoi-microphone');if(occupied)return callback(null);occupied=true;try{return await callback({name});}finally{occupied=false;}}};
 const a=setup('granted',new Map(),locks),b=setup('granted',new Map(),locks);a.session.configure(true);b.session.configure(true);
 assert.equal(await a.session.restore(),true);assert.equal(await b.session.restore(),false);assert.equal(b.counts().starts,0);assert.match(b.statuses.at(-1),/別のASTER/);
 a.session.stop();await tick();assert.equal(await b.session.start(),true);b.session.stop();await tick();assert.equal(occupied,false);
});
test('in-flight microphone start cannot survive a user stop',async()=>{
 const {session,voice}=setup();let resolve;voice.start=async()=>{await new Promise(r=>resolve=r);voice.active=true;};session.configure(true);const pending=session.start();session.stop();resolve();assert.equal(await pending,false);assert.equal(voice.active,false);
});

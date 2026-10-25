const test=require('node:test');const assert=require('node:assert/strict');const {NaturalSpeaker}=require('../static/audio.js');
const tick=()=>new Promise(r=>setImmediate(r));
test('natural playback releases object URLs after completion',async()=>{
 const players=[],revoked=[];
 class Player{constructor(url){this.url=url;players.push(this);}async play(){}pause(){}removeAttribute(){}load(){}}
 const speaker=new NaturalSpeaker({fetcher:async()=>({ok:true,blob:async()=>({})}),AudioClass:Player,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)}});
 const pending=speaker.speak('こんにちは');await tick();players[0].onended();assert.equal(await pending,true);assert.deepEqual(revoked,['blob:test']);
});
test('cancel during fetch prevents late audio playback',async()=>{
 let release;let played=0;
 const speaker=new NaturalSpeaker({fetcher:()=>new Promise(r=>release=r),AudioClass:class{constructor(){played++;}},urls:{createObjectURL:()=> 'blob:test'}});
 const pending=speaker.speak('停止');speaker.cancel();assert.equal(await pending,false);release({ok:true,blob:async()=>({})});await tick();assert.equal(played,0);
});
test('default browser fetch is invoked with its global receiver',async()=>{
 const original=globalThis.fetch;let receiver;let player;
 class Player{constructor(){player=this;}async play(){}pause(){}removeAttribute(){}load(){}}
 globalThis.fetch=function(){receiver=this;return Promise.resolve({ok:true,blob:async()=>({})});};
 try{const speaker=new NaturalSpeaker({AudioClass:Player,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}});const pending=speaker.speak('確認');await tick();player.onended();assert.equal(await pending,true);assert.equal(receiver,globalThis);}
 finally{globalThis.fetch=original;}
});
test('only the next clause is prefetched and reused for playback',async()=>{
 const requests=[],players=[];class Player{constructor(){players.push(this);}async play(){}pause(){}removeAttribute(){}load(){}}
 const s=new NaturalSpeaker({fetcher:async(url,opts)=>{requests.push(JSON.parse(opts.body).text);return{ok:true,blob:async()=>({})};},AudioClass:Player,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}});
 const first=s.speak('最初、',{nextText:'次。'});await tick();players[0].onplaying();await tick();assert.deepEqual(requests,['最初、','次。']);players[0].onended();await first;
 const next=s.speak('次。');await tick();assert.deepEqual(requests,['最初、','次。']);players[1].onended();assert.equal(await next,true);
});
test('a stalled speech fetch settles and aborts without leaving playback stuck',async()=>{
 const pendingTimers=new Map();let seq=0,signal;
 const timers={setTimeout(fn){pendingTimers.set(++seq,fn);return seq;},clearTimeout(id){pendingTimers.delete(id);}};
 const speaker=new NaturalSpeaker({fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{});},AudioClass:class{},urls:{},timers});
 const pending=speaker.speak('接続が止まってしまった声');assert.equal(pendingTimers.size,1);
 [...pendingTimers.values()][0]();assert.equal(await pending,false);assert.equal(signal.aborted,true);assert.equal(speaker.current,null);assert.equal(pendingTimers.size,0);
});
test('a player without an ended event is released by the playback deadline',async()=>{
 const pendingTimers=new Map();let seq=0,player,paused=false;const revoked=[];
 const timers={setTimeout(fn){pendingTimers.set(++seq,fn);return seq;},clearTimeout(id){pendingTimers.delete(id);}};
 class Player{constructor(){player=this;}async play(){this.onplaying();}pause(){paused=true;}removeAttribute(){}load(){}}
 const speaker=new NaturalSpeaker({fetcher:async()=>({ok:true,blob:async()=>({})}),AudioClass:Player,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)},timers});
 const pending=speaker.speak('声を確認');await tick();assert.ok(player);assert.equal(pendingTimers.size,1);
 [...pendingTimers.values()][0]();assert.equal(await pending,false);assert.equal(paused,true);assert.deepEqual(revoked,['blob:test']);assert.equal(pendingTimers.size,0);
});

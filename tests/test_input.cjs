const test=require('node:test');const assert=require('node:assert/strict');
const {SpeechSegmenter,DuplexInput,encodeWav}=require('../static/input.js');
const tick=()=>new Promise(r=>setImmediate(r));
function packet(amp,size=1024){const p=new Float32Array(size);for(let i=0;i<size;i++)p[i]=Math.sin(i*.13)*amp;return p;}
test('silence alone never creates a paid transcription request',()=>{
 let starts=0,ends=0;const vad=new SpeechSegmenter({sampleRate:24000,onStart:()=>starts++,onEnd:()=>ends++});
 for(let i=0;i<300;i++)vad.push(packet(.0005));assert.equal(starts,0);assert.equal(ends,0);
});
test('speech includes preroll and waits through brief pauses before emitting valid PCM WAV',async()=>{
 let starts=0;const clips=[];const vad=new SpeechSegmenter({sampleRate:24000,onStart:()=>starts++,onEnd:b=>clips.push(b)});
 for(let i=0;i<8;i++)vad.push(packet(0));for(let i=0;i<16;i++)vad.push(packet(.1));
 for(let i=0;i<10;i++)vad.push(packet(0));assert.equal(clips.length,0);
 for(let i=0;i<10;i++)vad.push(packet(.1));for(let i=0;i<25;i++)vad.push(packet(0));
 assert.equal(starts,1);assert.equal(clips.length,1);assert.ok(clips[0]);
 const bytes=await clips[0].arrayBuffer(),view=new DataView(bytes);
 assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(view.getUint32(24,true),24000);assert.ok(bytes.byteLength>24000*2);
});
test('very short transient noises do not trigger a turn',()=>{
 let starts=0;const vad=new SpeechSegmenter({sampleRate:24000,onStart:()=>starts++});
 vad.push(packet(.5));for(let i=0;i<100;i++)vad.push(packet(0));assert.equal(starts,0);
});
test('long speech is segmented to bounded clips instead of growing without limit',()=>{
 const clips=[];const vad=new SpeechSegmenter({sampleRate:24000,onEnd:b=>clips.push(b)});
 for(let i=0;i<500;i++)vad.push(packet(.1));assert.equal(clips.length,1);assert.ok(clips[0].size<1_000_000);
});
test('stopping cancels pending transcription and ignores late results',async()=>{
 let resolve;const texts=[];const input=new DuplexInput({onText:t=>texts.push(t),fetcher:()=>new Promise(r=>resolve=r)});
 input.running=true;input.session=1;input.queue=[encodeWav([packet(.1)],24000)];const pending=input.drain(1);input.stop();resolve({ok:true,json:async()=>({text:'遅れた結果'})});await pending;assert.deepEqual(texts,[]);
});
test('transcription failure keeps capture available and enforces a retry cooldown',async()=>{
 let calls=0;const errors=[],texts=[];const input=new DuplexInput({onText:t=>texts.push(t),onError:(message,detail)=>errors.push({message,detail}),fetcher:async()=>{calls++;if(calls===1)throw Error('一時的な接続エラー');return{ok:true,json:async()=>({text:'再接続後の発言'})};}});
 input.running=true;input.session=1;input.queue=[encodeWav([packet(.1)],24000),encodeWav([packet(.1)],24000)];await input.drain(1);
 assert.equal(input.running,true);assert.equal(input.queue.length,0);assert.equal(errors[0].detail.fatal,false);assert.match(errors[0].message,/15秒/);
 input.queue.push(encodeWav([packet(.1)],24000));await input.drain(1);assert.equal(calls,1);
 input.retryAt=0;input.queue.push(encodeWav([packet(.1)],24000));await input.drain(1);assert.deepEqual(texts,['再接続後の発言']);input.stop();
});
test('late microphone permission cannot revive capture after stop or kill a newer session',async()=>{
 const saved={navigator:globalThis.navigator,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};let first;let calls=0;
 const stream=()=>({stopped:false,getTracks(){return[{stop:()=>this.stopped=true}]}});const old=stream(),current=stream();
 const node=()=>({connect(){},disconnect(){}});
 class Context{constructor(){this.sampleRate=24000;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}async resume(){}async close(){this.state='closed';}createAnalyser(){return{...node(),frequencyBinCount:128,getByteFrequencyData(){}};}createMediaStreamSource(){return node();}createGain(){return{...node(),gain:{value:1}};}}
 class Worklet{constructor(){this.port={};}connect(){}disconnect(){}}
 Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>++calls===1?new Promise(r=>first=r):Promise.resolve(current)}},configurable:true});globalThis.AudioContext=Context;globalThis.AudioWorkletNode=Worklet;
 try{const input=new DuplexInput();const pending=input.start();input.stop();await input.start();assert.equal(input.running,true);first(old);await pending;assert.equal(old.stopped,true);assert.equal(current.stopped,false);assert.equal(input.running,true);input.stop();assert.equal(current.stopped,true);}
 finally{Object.defineProperty(globalThis,'navigator',{value:saved.navigator,configurable:true});globalThis.AudioContext=saved.AudioContext;globalThis.AudioWorkletNode=saved.AudioWorkletNode;}
});

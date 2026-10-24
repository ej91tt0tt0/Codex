(function(root){
 'use strict';
 async function resumeAudio(context){
  let timer;
  try{await Promise.race([context.resume(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('マイクの開始には画面の操作が必要です。')),2500);})]);}
  finally{clearTimeout(timer);}
 }
 function encodeWav(chunks,sampleRate){
  const count=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const text=(pos,s)=>{for(let i=0;i<s.length;i++)view.setUint8(pos+i,s.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
  let p=44;for(const chunk of chunks)for(const sample of chunk){view.setInt16(p,Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767),true);p+=2;}
  return new Blob([buffer],{type:'audio/wav'});
 }
 class SpeechSegmenter {
  constructor({sampleRate,onStart=()=>{},onEnd=()=>{}}){Object.assign(this,{sampleRate,onStart,onEnd});this.pre=[];this.preSamples=0;this.attack=0;this.voiced=0;this.silence=0;this.frames=null;this.length=0;this.noise=0.003;}
  push(packet){
   const ms=packet.length/this.sampleRate*1000;
   let sum=0;for(const n of packet)sum+=n*n;const rms=Math.sqrt(sum/packet.length);
   const threshold=Math.max(0.009,this.noise*3);
   const loud=rms>threshold;
   if(!this.frames){
    this.pre.push(packet);this.preSamples+=packet.length;
    while(this.preSamples>this.sampleRate*0.35&&this.pre.length>1)this.preSamples-=this.pre.shift().length;
    if(loud)this.attack+=ms;else{this.attack=0;this.noise=Math.min(0.02,this.noise*0.98+rms*0.02);}
    if(this.attack>=120){this.frames=this.pre.slice();this.length=this.preSamples;this.voiced=this.attack;this.silence=0;this.onStart();}
   }else{
    this.frames.push(packet);this.length+=packet.length;if(loud){this.voiced+=ms;this.silence=0;}else this.silence+=ms;
    if(this.silence>=1000||this.length>=this.sampleRate*20){
     const frames=this.frames;const valid=this.voiced>=160;
     this.frames=null;this.pre=[];this.preSamples=0;this.attack=0;this.length=0;this.voiced=0;this.silence=0;
     this.onEnd(valid?encodeWav(frames,this.sampleRate):null);
    }
   }
   return rms;
  }
 }
 class DuplexInput {
  constructor({onStart=()=>{},onText=()=>{},onVolume=()=>{},onState=()=>{},onError=()=>{},fetcher=(...args)=>root.fetch(...args)}={}){
   Object.assign(this,{onStart,onText,onVolume,onState,onError,fetcher});this.running=false;this.starting=false;this.session=0;this.queue=[];this.working=false;this.speaking=false;this.controller=null;this.retryAt=0;
  }
  get supported(){return Boolean(root.navigator?.mediaDevices?.getUserMedia&&root.AudioContext&&root.AudioWorkletNode);}
  notify(){this.onState({speaking:this.speaking,pending:this.queue.length+(this.working?1:0),running:this.running,paused:this.running&&(this.context?.state!=='running'||Boolean(this.stream?.getAudioTracks?.().some(t=>t.muted))),coolingDown:Date.now()<this.retryAt});}
  async resume(){if(this.running&&this.context?.state==='suspended'){await resumeAudio(this.context);this.notify();}}
  async start(){
   if(this.running||this.starting)return;this.starting=true;const token=++this.session;let stream=null,context=null;
   const cleanup=()=>{stream?.getTracks().forEach(t=>t.stop());if(context&&context.state!=='closed')context.close().catch(()=>{});};
   try{
    stream=await root.navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(token!==this.session){cleanup();return;}
    context=new root.AudioContext({sampleRate:24000});this.pendingCapture={stream,context,token};await resumeAudio(context);
    await context.audioWorklet.addModule('/mic-worklet.js');if(token!==this.session){cleanup();return;}
    this.stream=stream;this.context=context;this.pendingCapture=null;
    this.analyser=context.createAnalyser();this.analyser.fftSize=256;this.analyser.smoothingTimeConstant=0.6;
    this.source=context.createMediaStreamSource(stream);this.node=new root.AudioWorkletNode(context,'yorisoi-microphone');this.mute=context.createGain();this.mute.gain.value=0;
    this.source.connect(this.analyser);this.source.connect(this.node);this.node.connect(this.mute);this.mute.connect(context.destination);
    this.segmenter=new SpeechSegmenter({sampleRate:context.sampleRate,onStart:()=>{this.speaking=true;this.onStart();this.notify();},onEnd:blob=>{this.speaking=false;if(blob&&Date.now()>=this.retryAt)this.queue.push(blob);this.notify();if(this.queue.length>6){this.onError('認識処理が追いつかなくなったため停止したよ。少し待って再開してね。',{fatal:true});return;}void this.drain(token);}});
    const spectrum=new Uint8Array(this.analyser.frequencyBinCount);this.running=true;
    context.onstatechange=()=>{if(token===this.session)this.notify();};
    for(const track of stream.getTracks()){
     track.onended=()=>{if(this.running&&token===this.session)this.onError('マイクとの接続が切れたよ。接続してからもう一度開始してね。',{fatal:true});};
     track.onmute=track.onunmute=()=>{if(token===this.session)this.notify();};
    }
    this.node.onprocessorerror=()=>{if(this.running&&token===this.session)this.onError('マイク処理が停止したよ。もう一度開始してね。',{fatal:true});};
    this.node.port.onmessage=event=>{if(!this.running||token!==this.session)return;const rms=this.segmenter.push(event.data);this.analyser.getByteFrequencyData(spectrum);this.onVolume(Math.min(1,rms*10),spectrum);};
    this.notify();
   }catch(error){cleanup();if(token===this.session){this.release();this.pendingCapture=null;throw error;}}
   finally{if(token===this.session)this.starting=false;}
  }
  async drain(token){
   if(this.working)return;
   if(Date.now()<this.retryAt){this.queue=[];this.notify();return;}
   this.working=true;this.notify();
   try{
    while(this.running&&token===this.session&&this.queue.length){
     const blob=this.queue.shift();this.controller=new AbortController();this.notify();
     const response=await this.fetcher('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:blob,signal:this.controller.signal});
     if(!response.ok)throw Error('音声認識に接続できなかったよ。APIの利用枠と接続を確認してね。');
     const result=await response.json();if(token!==this.session||!this.running)return;
     if(result.text?.trim())this.onText(result.text.trim());
    }
   }catch(error){if(token===this.session&&this.running){this.queue=[];this.retryAt=Date.now()+15000;this.onError(error.message+' 15秒待ってから、もう一度話してね。',{fatal:false});}}
   finally{if(token===this.session){this.working=false;this.controller=null;this.notify();}}
  }
  release(){
   this.running=false;this.node?.disconnect();this.source?.disconnect();this.mute?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());
   if(this.context&&this.context.state!=='closed')this.context.close().catch(()=>{});
   this.node=null;this.source=null;this.stream=null;this.context=null;this.onVolume(0,new Uint8Array(0));
  }
  stop(){this.session++;this.starting=false;this.retryAt=0;if(this.pendingCapture){this.pendingCapture.stream.getTracks().forEach(t=>t.stop());if(this.pendingCapture.context.state!=='closed')this.pendingCapture.context.close().catch(()=>{});this.pendingCapture=null;}this.controller?.abort();this.controller=null;this.queue=[];this.working=false;this.speaking=false;this.release();this.notify();}
 }
 const exports={encodeWav,SpeechSegmenter,DuplexInput};if(typeof module!=='undefined'&&module.exports)module.exports=exports;else root.YorisoiInput=exports;
})(typeof window==='undefined'?globalThis:window);

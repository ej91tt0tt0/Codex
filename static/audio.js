(function(root){
 'use strict';
 class NaturalSpeaker {
  constructor({fetcher=(...args)=>root.fetch(...args),AudioClass=Audio,urls=URL,onPlaying=()=>{}}={}){Object.assign(this,{fetcher,AudioClass,urls,onPlaying});this.current=null;this.prefetched=null;}
  cancelPrefetch(){if(this.prefetched){this.prefetched.controller.abort();this.prefetched=null;}}
  cancel(){this.cancelPrefetch();if(this.current)this.current();}
  async request(text,signal){const response=await this.fetcher('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal});if(!response.ok)throw Error('Speech API unavailable');return response.blob();}
  prefetch(text){
   if(!text||this.prefetched?.text===text)return;
   this.cancelPrefetch();const controller=new AbortController();
   this.prefetched={text,controller,promise:this.request(text,controller.signal).catch(()=>null)};
  }
  speak(text,{nextText='',onPlaying=()=>{}}={}){
   const ready=this.prefetched?.text===text?this.prefetched:null;if(ready)this.prefetched=null;
   this.cancel();
   return new Promise(resolve=>{
    const controller=ready?.controller||new AbortController();let player=null,url=null,done=false;
    const finish=success=>{if(done)return;done=true;controller.abort();if(player){player.pause();player.removeAttribute('src');player.load();}if(url)this.urls.revokeObjectURL(url);this.current=null;resolve(success);};
    this.current=()=>finish(false);
    (async()=>{
     try{
      const blob=ready?await ready.promise:await this.request(text,controller.signal);if(done)return;if(!blob)throw Error('Speech preparation failed');
      url=this.urls.createObjectURL(blob);player=new this.AudioClass(url);
      player.onplaying=()=>{this.onPlaying();onPlaying();if(nextText)this.prefetch(nextText);};player.onended=()=>finish(true);player.onerror=()=>finish(false);
      await player.play();
     }catch{finish(false);}
    })();
   });
  }
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={NaturalSpeaker};else root.YorisoiAudio={NaturalSpeaker};
})(typeof window==='undefined'?globalThis:window);

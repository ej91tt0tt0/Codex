const test = require('node:test');
const assert = require('node:assert/strict');
const {VoiceController,greetingText,splitSpeech} = require('../static/voice.js');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function setup(send=async text=>'返答:'+text,{synthesis=true,recognition=true}={}) {
 const recognizers=[],spoken=[],statuses=[],states=[],greetings=[],transcripts=[];
 class Recognition {
  constructor(){recognizers.push(this);}
  start(){this.onstart?.();}
  abort(){this.aborted=true;this.onend?.();}
  result(text){this.onresult({results:[Object.assign([{transcript:text}],{isFinal:true})]});this.onend();}
 }
 const synth={cancel(){},getVoices(){return[{lang:'ja-JP',name:'Japanese'}];},speak(u){spoken.push(u);}};
 const v=new VoiceController({Recognition:recognition?Recognition:null,synth:synthesis?synth:null,Utterance:class{constructor(text){this.text=text;}},send,status:t=>statuses.push(t),state:s=>states.push(s),transcript:t=>transcripts.push(t),greeting:t=>greetings.push(t)});
 return {v,recognizers,spoken,statuses,states,greetings,transcripts};
}
test('startup greeting never opens a microphone or sends an API call',async()=>{
 let sent=0;const {v,recognizers,spoken,greetings}=setup(async()=>{sent++;});
 const pending=v.greet();assert.equal(recognizers.length,0);assert.equal(sent,0);assert.match(greetings[0],/アスター/);
 for(let i=0;v.finishSpeech&&i<10;i++){spoken.at(-1).onend();await tick();}await pending;assert.equal(v.greeted,true);assert.equal(recognizers.length,0);
});
test('blocked autoplay presents a user-action fallback',async()=>{
 const {v,spoken,statuses}=setup();const pending=v.greet();spoken[0].onerror({error:'not-allowed'});await pending;
 assert.equal(v.greeted,false);assert.match(statuses.at(-1),/押す/);assert.equal(v.active,false);
});
test('text mode gives a text continuation status and does not request a microphone',async()=>{
 const {v,statuses,recognizers}=setup();v.textMode=true;v.readEnabled=false;await v.ask('文字で話す');assert.match(statuses.at(-1),/文字で続けて/);assert.equal(recognizers.length,0);v.stop();
});
test('starting the microphone during a greeting does not cancel or repeat the greeting',async()=>{
 const {v,spoken,recognizers}=setup();const greeting=v.greet();spoken[0].onstart();const start=v.start();assert.equal(spoken.length,1);
 spoken[0].onend();await greeting;await start;assert.equal(spoken.length,1);assert.equal(recognizers.length,1);v.stop();
});
test('voice turn sends once, suspends microphone during reply, then listens again',async()=>{
 const sent=[];const {v,recognizers,spoken,transcripts}=setup(async t=>{sent.push(t);return 'こんにちは';});
 v.greeted=true;await v.start();assert.equal(recognizers.length,1);
 recognizers[0].result('おはよう');await tick();
 assert.deepEqual(sent,['おはよう']);assert.equal(v.rec,null);assert.equal(spoken.length,1);assert.equal(recognizers.length,1);assert.equal(transcripts[0],'おはよう');
 spoken[0].onend();await tick();assert.equal(recognizers.length,2);assert.equal(v.busy,false);v.stop();
});
test('stop during an API request prevents speech and microphone restart',async()=>{
 let release;const {v,spoken,recognizers}=setup(()=>new Promise(r=>release=r));v.greeted=true;await v.start();
 recognizers[0].result('質問');v.stop();release('遅れた返答');await tick();
 assert.equal(spoken.length,0);assert.equal(recognizers.length,1);assert.equal(v.active,false);assert.equal(v.busy,false);
});
test('microphone permission error stops without automatically retrying',async()=>{
 const {v,recognizers,statuses}=setup();v.greeted=true;await v.start();
 recognizers[0].onerror({error:'not-allowed'});assert.equal(v.active,false);assert.equal(v.rec,null);assert.equal(recognizers[0].aborted,true);assert.match(statuses.at(-1),/許可/);
});
test('stop during speech cancels the turn without restarting recognition',async()=>{
 const {v,recognizers,spoken}=setup();v.greeted=true;await v.start();recognizers[0].result('質問');await tick();
 const u=spoken[0];v.stop();u.onend();await tick();assert.equal(recognizers.length,1);assert.equal(v.active,false);assert.equal(v.busy,false);
});
test('unsupported recognition explains text fallback and never records',async()=>{
 const {v,statuses,recognizers}=setup(undefined,{recognition:false});await v.start();assert.equal(v.active,false);assert.equal(recognizers.length,0);assert.match(statuses.at(-1),/文字入力/);
});
test('API failure pauses voice mode',async()=>{
 const {v,recognizers,statuses}=setup(async()=>{throw Error('通信エラー');});v.greeted=true;await v.start();recognizers[0].result('質問');await tick();
 assert.equal(v.active,false);assert.equal(v.busy,false);assert.match(statuses.at(-1),/通信エラー/);assert.equal(recognizers.length,1);
});
test('hands-free capture remains available after a failed AI response',async()=>{
 const {v,recognizers,statuses}=setup(async()=>{throw Error('一時的な通信エラー');});v.handsFree=true;v.greeted=true;await v.start();recognizers[0].result('質問');await tick();
 assert.equal(v.active,true);assert.equal(v.busy,false);assert.equal(recognizers.length,2);assert.match(statuses.at(-1),/待ち受けは続けて/);v.stop();
});
test('spoken microphone stop is handled locally even while an AI reply is pending',async()=>{
 let resolve,calls=0;const {v}=setup(()=>{calls++;return new Promise(r=>resolve=r);});v.active=true;v.beforeInput=text=>{if(text!=='マイクを止めて')return false;v.stop();return true;};
 const pending=v.ask('質問');await v.ask('マイクを止めて');assert.equal(v.active,false);assert.equal(calls,1);resolve('遅れた回答');await pending;assert.equal(v.active,false);
});
test('idle monologues are suppressed when the conversation page is not visible',async()=>{
 const {v}=setup();let calls=0;v.active=true;v.proactive=async()=>{calls++;};v.canInitiate=()=>false;v.armIdle();assert.equal(v.idleTimer,null);await v.initiate();assert.equal(calls,0);v.stop();
});
test('greeting follows local time of day',()=>{
 assert.match(greetingText(new Date(2026,0,1,8)),/^おはよう/);
 assert.match(greetingText(new Date(2026,0,1,13)),/^こんにちは/);
 assert.match(greetingText(new Date(2026,0,1,20)),/^こんばんは/);
});
test('initiative speaks once without a topic question and resets only on user turn',async()=>{
 const {v}=setup();const kinds=[];v.readEnabled=false;v.greeted=true;
 v.proactive=async k=>{kinds.push(k);return '声かけ';};
 await v.start();await v.initiate();await v.initiate();await v.initiate();await v.initiate();
 assert.deepEqual(kinds,['thought']);assert.equal(v.proactiveCount,1);
 await v.ask('返事');assert.equal(v.proactiveCount,0);await v.initiate();assert.equal(kinds.length,2);v.stop();
});
test('idle timeout fires only while active and is cancelled by stop',async()=>{
 const {v}=setup();let calls=0;v.proactive=async()=>{calls++;return '一言';};v.idleMilliseconds=10;v.readEnabled=false;v.greeted=true;
 await v.start();await new Promise(r=>setTimeout(r,18));v.stop();const count=calls;
 assert.ok(count>=1);await new Promise(r=>setTimeout(r,20));assert.equal(calls,count);
});
test('disabled initiative never sends',async()=>{
 const {v}=setup();let calls=0;v.proactive=async()=>{calls++;};v.proactiveEnabled=false;v.greeted=true;
 await v.start();await v.initiate();assert.equal(calls,0);v.stop();
});
test('the handoff button finishes the spoken thought before resuming recognition',async()=>{
 const {v,recognizers,spoken}=setup();v.greeted=true;await v.start();recognizers[0].result('質問');await tick();spoken[0].onstart();
 const handoff=v.interrupt();await tick();assert.equal(recognizers.length,1);assert.ok(v.finishSpeech);
 spoken[0].onend();await handoff;await tick();assert.equal(recognizers.length,2);assert.equal(v.busy,false);assert.equal(v.active,true);v.stop();
});
test('natural speech failure falls back to native speech',async()=>{
 const {v,spoken}=setup();v.naturalSpeaker={cancel(){},async speak(){return false;}};
 const pending=v.say('確認');await tick();assert.equal(spoken.length,1);spoken[0].onend();assert.equal(await pending,true);
});
test('quiet recognition keeps conversation active rather than stopping after three silent turns', t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {v,recognizers}=setup();v.greeted=true;v.active=true;v.listen();
 for(let i=0;i<3;i++){recognizers.at(-1).onend();t.mock.timers.tick(800);}
 assert.equal(recognizers.length,4);assert.equal(v.active,true);v.stop();
});
test('input received during a pending reply is queued, merged, and never dropped',async()=>{
 let resolve;const sent=[];const {v}=setup(text=>{sent.push(text);return sent.length===1?new Promise(r=>resolve=r):Promise.resolve('整理した返答');});
 v.active=true;v.readEnabled=false;const first=v.ask('最初の話');await v.ask('追加の話');await v.ask('訂正もある');resolve('古い返答');await first;await tick();
 assert.deepEqual(sent,['最初の話','追加の話\n訂正もある']);assert.deepEqual(v.pendingInputs,[]);v.stop();
});
test('duplex onset keeps the current clause audible and yields at its boundary',async()=>{
 const {v,spoken}=setup();let stopped=0;v.duplexInput={supported:true,running:true,start:async()=>{},stop(){stopped++;this.running=false;}};v.active=true;
 const pending=v.ask('質問');await tick();assert.equal(v.duplexInput.running,true);spoken[0].onstart();v.hearStart();assert.ok(v.finishSpeech);spoken[0].onend();await pending;
 assert.equal(v.finishSpeech,null);assert.equal(v.inputSpeaking,true);assert.equal(stopped,0);v.stop();assert.equal(stopped,1);
});
test('no stale reply is spoken while another input is still being transcribed',async()=>{
 let resolve;const {v,spoken}=setup(()=>new Promise(r=>resolve=r));v.active=true;const pending=v.ask('先の話');v.inputPending=1;resolve('古い返答');await pending;assert.equal(spoken.length,0);v.stop();
});

test('commas, periods, single line breaks and decimals do not split a conversational turn',()=>{
 assert.deepEqual(splitSpeech('最初の節、次の文。最後！'),['最初の節、次の文。最後！']);
 assert.deepEqual(splitSpeech('1.12倍だよ。\nほんと！？'),['1.12倍だよ。\nほんと！？']);
 assert.deepEqual(splitSpeech('結論だよ。\n\n短い理由も伝えるね。'),['結論だよ。\n\n短い理由も伝えるね。']);
 assert.deepEqual(splitSpeech('それはうれしいね🙂。一緒に楽しもう。'),['それはうれしいね。一緒に楽しもう。']);
});
test('long replies separate complete paragraphs and keep explanations with their setup',()=>{
 const first='明日の予定はこの順番で進められるよ。'.repeat(18),next='別の話はあとで整理できるよ。';
 assert.deepEqual(splitSpeech(first+'\n\n'+next),[first,next]);
 assert.deepEqual(splitSpeech(first+'\n\n例えば、午前は買い物にすると楽だよ。'),[first+'\n\n例えば、午前は買い物にすると楽だよ。']);
 assert.ok(splitSpeech('長'.repeat(3900)).every(piece=>piece.length<=1800));
});
test('handoff finishes the entire current paragraph and skips the next thought',async()=>{
 const first='まず予定の全体を伝えるね。買い物を済ませてから、一度家に戻ると余裕ができるよ。'.repeat(8);
 const {v,spoken}=setup();v.active=true;const pending=v.say(first+'\n\n次の話はあとで伝えるね。');spoken[0].onstart();v.requestBoundaryYield();
 assert.equal(spoken[0].text,first);assert.equal(spoken.length,1);assert.ok(v.finishSpeech);assert.equal(v.boundaryRequested,true);
 spoken[0].onend();assert.equal(await pending,false);assert.equal(spoken.length,1);v.stop();
});
test('new input stays queued while a clause finishes',async()=>{
 const sent=[];const {v,spoken}=setup(async text=>{sent.push(text);return sent.length===1?'元の節、後半の節。':'整理したよ';});v.active=true;
 const first=v.ask('元の話');await tick();spoken[0].onstart();await v.ask('追加の話');assert.ok(v.finishSpeech);assert.deepEqual(sent,['元の話']);
 assert.equal(spoken[0].text,'元の節、後半の節。');
 spoken[0].onend();await first;await tick();assert.deepEqual(sent,['元の話','追加の話']);
 spoken.at(-1).onend();await tick();v.stop();
});
test('speech onset alone does not cancel or commit a handoff before transcription',async()=>{
 const {v,spoken}=setup();v.active=true;const pending=v.say('結論を伝えるね。理由も一緒に話すよ。');spoken[0].onstart();v.hearStart();
 assert.equal(v.boundaryRequested,false);assert.ok(v.finishSpeech);spoken[0].onend();assert.equal(await pending,true);v.stop();
});
test('text entered during the greeting waits for the whole greeting and is not lost',async()=>{
 const sent=[];const {v,spoken}=setup(async text=>{sent.push(text);return '返答';});const greeting=v.greet();spoken[0].onstart();await v.ask('ちょっといい？');assert.deepEqual(sent,[]);
 spoken[0].onend();await greeting;await tick();assert.deepEqual(sent,['ちょっといい？']);spoken.at(-1).onend();await tick();v.stop();
});
test('server initiative limit after a reload pauses proactive calls without stopping the mic',async()=>{
 const {v}=setup();v.active=true;v.handsFree=true;v.readEnabled=false;v.proactive=async()=>{const error=Error('休止中');error.status=429;throw error;};
 await v.initiate();assert.equal(v.proactiveCount,1);assert.equal(v.active,true);assert.equal(v.idleTimer,null);v.stop();
});

test('queued commands and ordinary speech are delivered separately in order',async()=>{
 const sent=[];let release;const {v}=setup(text=>{sent.push(text);return sent.length===1?new Promise(r=>release=r):Promise.resolve('返答');});v.active=true;v.readEnabled=false;
 const first=v.ask('最初の質問');await v.ask('設定変更、返答を短くして');await v.ask('今日の予定も教えて');release('元の返答');await first;await tick();await tick();
 assert.deepEqual(sent,['最初の質問','設定変更、返答を短くして','今日の予定も教えて']);v.stop();
});

test('queued navigation stays separate from later conversation',async()=>{
 const sent=[];let release;const {v}=setup(text=>{sent.push(text);return sent.length===1?new Promise(r=>release=r):Promise.resolve('返答');});v.active=true;v.readEnabled=false;
 const first=v.ask('先の質問');await v.ask('車で名古屋駅までナビして');await v.ask('別の話もある');release('元の返答');await first;await tick();await tick();
 assert.deepEqual(sent,['先の質問','車で名古屋駅までナビして','別の話もある']);v.stop();
});
test('named feedback and local tool requests stay separate from later conversation',async()=>{
 const sent=[];let release;const {v}=setup(text=>{sent.push(text);return sent.length===1?new Promise(r=>release=r):Promise.resolve('返答');});v.active=true;v.readEnabled=false;
 const first=v.ask('先の質問');await v.ask('アスター、もっと短く');await v.ask('アスター、目標を追加、読書を10ページ');await v.ask('映画のことも話したい');release('先の返答');await first;await tick();await tick();
 assert.deepEqual(sent,['先の質問','アスター、もっと短く','アスター、目標を追加、読書を10ページ','映画のことも話したい']);v.stop();
});
test('explicit replay works in text mode without recording a new turn or starting a microphone',async()=>{
 let sent=0;const {v,spoken,recognizers}=setup(async()=>{sent++;});v.textMode=true;v.readEnabled=false;
 const pending=v.replay('保存済みの返答');assert.equal(spoken.length,1);spoken[0].onend();assert.equal(await pending,true);
 assert.equal(sent,0);assert.equal(recognizers.length,0);assert.equal(v.active,false);assert.equal(v.readEnabled,false);v.stop();
});
test('replay declines to replace an ongoing reply',async()=>{
 const {v,spoken}=setup();const first=v.say('話している途中');assert.equal(await v.replay('割り込み'),false);assert.equal(spoken.length,1);spoken[0].onend();await first;v.stop();
});
test('replayed speech can be stopped in text mode without changing microphone preference',async()=>{
 const {v,statuses}=setup();v.textMode=true;v.readEnabled=false;const pending=v.replay('もう一度聞く返答');assert.equal(v.replaying,true);
 v.stopReplay();assert.equal(await pending,false);assert.equal(v.replaying,false);assert.equal(v.active,false);assert.equal(v.readEnabled,false);assert.match(statuses.at(-1),/止めた/);v.stop();
});
test('typed additions during a text response are drained even with the microphone off',async()=>{
 const sent=[];let release;const {v}=setup(text=>{sent.push(text);return sent.length===1?new Promise(r=>release=r):Promise.resolve('まとめた返答');});
 v.textMode=true;v.readEnabled=false;const first=v.ask('最初の相談');await v.ask('追記したいこと');await v.ask('さっきの内容の訂正');
 release('最初の返答');await first;await tick();assert.deepEqual(sent,['最初の相談','追記したいこと\nさっきの内容の訂正']);assert.equal(v.active,false);assert.equal(v.pendingInputs.length,0);v.stop();
});
test('the additional-input queue is bounded and refuses rather than discarding new text',async()=>{
 let release;const {v}=setup(()=>new Promise(r=>release=r));v.readEnabled=false;const first=v.ask('最初');
 for(let i=0;i<6;i++)assert.equal(await v.ask('追加'+i),true);
 assert.equal(await v.ask('まだ送らない内容'),false);assert.equal(v.pendingInputs.length,6);v.stop();release('停止後の応答');await first;assert.equal(v.pendingInputs.length,0);
});

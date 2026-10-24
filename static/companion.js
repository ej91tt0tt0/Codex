(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const styles=['conversation_mode','emoji_level','question_frequency','mood_preference','reply_style','speech_register','speech_speed','preferred_name'];
 const fields={'display-name':'display_name','preferred-name':'preferred_name',hobbies:'hobbies','favorite-foods':'favorite_foods','blocked-topics':'blocked_topics','emoji-level':'emoji_level','question-frequency':'question_frequency','mood-preference':'mood_preference'};
 const jstLocal=date=>new Date(date.getTime()+9*3600000).toISOString().slice(0,16);
 class CompanionUI {
  constructor({api,voice,handsfree,render,goChat}){
   Object.assign(this,{api,voice,handsfree,renderMain:render,goChat});this.isTemporary=false;this.messages=[];this.sequence=0;this.evidence=[];this.temporaryPrefs={};this.lastState=null;this.loaded={};this.pendingImage=null;this.channel=null;this.deliverySignature='';this.goalEdit=null;this.reminderEdit=null;this.taskEdit=null;this.busyButtons=new Set();
   $('diary-day').value=jstLocal(new Date()).slice(0,10);$('reminder-schedule').value=jstLocal(new Date(Date.now()+3600000));
   $('connection-check').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const result=await this.api('connection',{});$('connection-status').textContent=result.message;}catch(error){$('connection-status').textContent=error.message;}finally{b.disabled=false;}};
   $('conversation-mode').onchange=()=>this.perform(()=>this.preferences({conversation_mode:$('conversation-mode').value}));
   $('interaction-mode').onchange=()=>this.chooseChannel($('interaction-mode').value);
   $('temporary-chat').onchange=()=>this.toggleTemporary($('temporary-chat').checked);
   $('persona-form').onsubmit=e=>{e.preventDefault();const values={};for(const [id,key] of Object.entries(fields))values[key]=$(id).value;this.perform(()=>this.preferences(values),e.submitter);};
   $('auto-memory').onchange=()=>this.perform(()=>this.preferences({auto_memory:String($('auto-memory').checked)}));
   for(const button of document.querySelectorAll('[data-prompt]'))button.onclick=()=>{this.goChat();void this.voice.ask(button.dataset.prompt);};
   $('photo-input').onchange=()=>this.preparePhoto($('photo-input').files[0]);$('photo-clear').onclick=()=>this.clearPhoto();
   $('diary-draft').onclick=async e=>{e.preventDefault();const b=e.currentTarget;b.disabled=true;this.busyButtons.add(b);try{const r=await this.api('diary/draft',{day:$('diary-day').value});$('diary-content').value=r.draft;$('notice').textContent='下書きを作ったよ。内容を確認して「日記を保存」を押してね。';}catch(error){$('notice').textContent=error.message;}finally{this.busyButtons.delete(b);b.disabled=this.isTemporary;}};
   $('diary-form').onsubmit=e=>{e.preventDefault();this.perform(()=>this.api('diary',{day:$('diary-day').value,content:$('diary-content').value}),e.submitter);};
   $('goal-form').onsubmit=async e=>{e.preventDefault();if(await this.perform(()=>this.api('goals',{...(this.goalEdit?{id:this.goalEdit}:{}),title:$('goal-title').value,target:Number($('goal-target').value),unit:$('goal-unit').value}),e.submitter)){this.goalEdit=null;$('goal-cancel-edit').hidden=true;$('goal-title').value='';$('goal-form').querySelector('button[type=submit]').textContent='目標を追加';}};
   $('reminder-form').onsubmit=async e=>{e.preventDefault();if(await this.perform(()=>this.api('reminders',{...(this.reminderEdit?{id:this.reminderEdit}:{}),title:$('reminder-title').value,schedule:$('reminder-schedule').value,repeat:$('reminder-repeat').value}),e.submitter)){this.reminderEdit=null;$('reminder-cancel-edit').hidden=true;$('reminder-title').value='';$('reminder-form').querySelector('button[type=submit]').textContent='通知を登録';}};
   $('notification-permission').onclick=async()=>{try{if(!root.Notification){$('notification-status').textContent='この環境ではアプリ内の通知を使うよ。';return;}const p=await root.Notification.requestPermission();$('notification-status').textContent=p==='granted'?'ブラウザ通知を有効にしたよ。':'アプリ内の通知を使うよ。';}catch{$('notification-status').textContent='アプリ内の通知を使うよ。';}};
   $('agent-form').onsubmit=async e=>{e.preventDefault();if(await this.perform(()=>this.api('tasks',{...(this.taskEdit?{id:this.taskEdit}:{}),title:$('agent-title').value,instruction:$('agent-instruction').value,interval_hours:Number($('agent-interval').value),enabled:$('agent-task-enabled').checked}),e.submitter)){this.taskEdit=null;$('agent-cancel-edit').hidden=true;$('agent-title').value='';$('agent-instruction').value='';$('agent-form').querySelector('button[type=submit]').textContent='調査タスクを登録';}};
   $('agent-settings').onsubmit=e=>{e.preventDefault();this.perform(()=>this.api('settings',{agent_enabled:String($('agent-enabled').checked),agent_daily_limit:$('agent-daily-limit').value}),e.submitter);};
   for(const [kind,key,label] of [['goal','goalEdit','目標を追加'],['reminder','reminderEdit','通知を登録'],['agent','taskEdit','調査タスクを登録']])$(kind+'-cancel-edit').onclick=()=>{this[key]=null;$(kind+'-form').reset();$(kind+'-form').querySelector('button[type=submit]').textContent=label;$(kind+'-cancel-edit').hidden=true;if(kind==='reminder')$('reminder-schedule').value=jstLocal(new Date(Date.now()+3600000));};
   this.pollTimer=setInterval(()=>{this.pollReminders();if(!this.isTemporary&&!$('agent').hidden)this.api('state').then(s=>this.renderMain(s)).catch(()=>{});},15000);
  }
  checkRequest(path,body){
   if(this.isTemporary&&body!==undefined&&!['temporary','speech','transcribe'].includes(path))throw Error('一時チャット中は記憶・日記・目標・通知などを保存しないよ。通常の会話へ戻してから操作してね。');
  }
  viewState(state){
   this.lastState=state;
   if(!this.isTemporary)return state;
   return{...state,messages:this.messages,external_actions:[],research_runs:this.evidence,settings:{...state.settings,...this.temporaryPrefs,proactive_enabled:'false'}};
  }
  async preferences(changes){
   if(!this.isTemporary)return this.api('settings',changes);
   for(const key of Object.keys(changes))if(![...styles,'interaction_mode'].includes(key))throw Error('一時チャットではプロフィールや長期記憶を保存しないよ。');
   Object.assign(this.temporaryPrefs,changes);return this.lastState;
  }
  async perform(fn,button){
   if(button){button.disabled=true;this.busyButtons.add(button);}$('notice').textContent='';
   try{this.renderMain(await fn());return true;}catch(error){$('notice').textContent=error.message;return false;}finally{if(button){this.busyButtons.delete(button);button.disabled=this.isTemporary;}}
  }
  toggleTemporary(enabled){
   if(this.voice.busy){$('temporary-chat').checked=this.isTemporary;$('notice').textContent='返答が完了してから切り替えてね。';return;}
   this.handsfree.stop();this.clearPhoto();this.isTemporary=enabled;this.messages=[];this.sequence=0;this.evidence=[];this.temporaryPrefs={};this.loaded={};this.renderMain(this.lastState);
   $('notice').textContent=enabled?'一時チャットに切り替えたよ。この会話はアプリの履歴や記憶へ保存しない。':'通常の会話に戻したよ。一時チャットの内容は消したよ。';
  }
  async chooseChannel(channel){
   if(channel==='text')this.handsfree.stop();
   if(await this.perform(()=>this.preferences({interaction_mode:channel}))){if(channel==='voice')await this.handsfree.start();}
  }
  async startVoice(){
   if(this.channel==='text'){if(!await this.perform(()=>this.preferences({interaction_mode:'voice'})))return;}
   await this.handsfree.start();
  }
  clearPhoto(){this.pendingImage=null;$('message').required=true;$('photo-input').value='';$('photo-preview').removeAttribute('src');$('photo-preview').hidden=true;$('photo-clear').hidden=true;$('photo-status').textContent='写真は次の発言と一緒にOpenAIへ送るよ。画像ファイルは履歴に保存しない。';}
  async preparePhoto(file){
   if(!file)return;
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000){this.clearPhoto();$('notice').textContent='写真はJPEG・PNG・WebP、10MB以内を選んでね。';return;}
   const url=URL.createObjectURL(file);
   try{
    const photo=new Image();photo.src=url;await photo.decode();const scale=Math.min(1,1280/Math.max(photo.width,photo.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(photo.width*scale));canvas.height=Math.max(1,Math.round(photo.height*scale));canvas.getContext('2d').drawImage(photo,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',.85);if(data.length>5_300_000)throw Error('写真を小さくしてね。');
    this.pendingImage=data;$('message').required=false;$('photo-preview').src=data;$('photo-preview').hidden=false;$('photo-clear').hidden=false;$('photo-status').textContent='次の発言と一緒に送信するよ。縮小して位置情報などの画像メタデータを除いたよ。';
   }catch(error){this.clearPhoto();$('notice').textContent='写真を読み込めなかったよ。別の写真を選んでね。';}finally{URL.revokeObjectURL(url);}
  }
  async send(content){
   const image=this.pendingImage;
   if(!this.isTemporary){const s=await this.api('chat',{content,...(image?{image}:{})});if(image)this.clearPhoto();this.renderMain(s);return s.messages.at(-1).content;}
   const message={id:'temporary-'+(++this.sequence),role:'user',content:content+(image?'\n[写真を共有：画像は保存しない]':'')};this.messages.push(message);this.messages=this.messages.slice(-200);this.renderMain(this.lastState);
   const preferences=Object.fromEntries(Object.entries(this.temporaryPrefs).filter(([key])=>styles.includes(key)));
   const result=await this.api('temporary',{messages:this.messages.slice(-19).map(m=>({role:m.role,content:m.content})),preferences,...(image?{image}:{})});
   Object.assign(this.temporaryPrefs,result.preferences||{});const answer={id:'temporary-'+(++this.sequence),role:'assistant',content:result.answer};this.messages.push(answer);this.messages=this.messages.slice(-200);
   if(result.sources?.length)this.evidence.unshift({message_id:answer.id,fetched_at:result.fetched_at,sources:result.sources});
   if(image)this.clearPhoto();this.renderMain(this.lastState);return result.answer;
  }
  render(state){
   const cfg=this.isTemporary?{...state.settings,...this.temporaryPrefs}:state.settings;
   $('temporary-chat').checked=this.isTemporary;$('temporary-note').hidden=!this.isTemporary;document.body.classList.toggle('temporary-active',this.isTemporary);
   $('conversation-mode').value=cfg.conversation_mode||'think';$('interaction-mode').value=cfg.interaction_mode||'voice';
   const channel=cfg.interaction_mode||'voice';
   this.voice.textMode=channel==='text';$('link-mode').textContent=channel==='text'?'TEXT LINK':'VOICE LINK';
   document.body.classList.toggle('text-mode',channel==='text');
   if(this.channel!==channel){this.channel=channel;this.voice.readEnabled=channel==='voice';$('voice-read').checked=this.voice.readEnabled;if(channel==='text'){this.handsfree.stop();$('text-input').open=true;}}
   for(const [id,key] of Object.entries(fields)){if(this.loaded[key]!==cfg[key])$(id).value=cfg[key]||'';this.loaded[key]=cfg[key];}
   $('auto-memory').checked=cfg.auto_memory==='true';
   for(const form of ['persona-form','diary-form','goal-form','reminder-form','agent-form','agent-settings'])for(const button of $(form).querySelectorAll('button'))button.disabled=this.isTemporary||this.busyButtons.has(button);
   $('goal-cancel-edit').hidden=!this.goalEdit;$('reminder-cancel-edit').hidden=!this.reminderEdit;$('agent-cancel-edit').hidden=!this.taskEdit;
   this.renderDiaries(state.diaries||[]);this.renderGoals(state.goals||[]);this.renderReminders(state.reminders||[]);this.renderDeliveries(state.reminder_deliveries||[]);
   $('agent-enabled').checked=cfg.agent_enabled==='true';$('agent-daily-limit').value=cfg.agent_daily_limit||'3';this.renderTasks(state.agent_tasks||[],state.agent_runs||[]);
  }
  renderTasks(tasks,runs){
   const list=$('agent-list');list.replaceChildren();for(const task of tasks){const card=node('div',null,'card'),run=node('button','今すぐ調査','secondary'),toggle=node('button',task.enabled?'停止':'再開','secondary'),edit=node('button','編集','secondary'),remove=node('button','削除','secondary');
    run.disabled=task.status==='調査中'||!task.enabled||this.isTemporary;run.onclick=()=>this.perform(()=>this.api('tasks/run',{id:task.id}),run);
    toggle.onclick=()=>this.perform(()=>this.api('tasks',{id:task.id,enabled:!task.enabled}));remove.onclick=()=>this.perform(()=>this.api('tasks',{id:task.id,delete:true}));
    edit.onclick=()=>{this.taskEdit=task.id;$('agent-cancel-edit').hidden=false;$('agent-title').value=task.title;$('agent-instruction').value=task.instruction;$('agent-interval').value=String(task.interval_hours);$('agent-task-enabled').checked=Boolean(task.enabled);$('agent-form').querySelector('button[type=submit]').textContent='タスクの変更を保存';$('agent-form').scrollIntoView();};
    card.append(node('h2',task.title),node('p',task.instruction),node('p',(task.enabled?task.status:'停止中')+' · '+task.interval_hours+'時間間隔 · 次回予定: '+new Date(task.next_run).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),'hint'));const actions=node('div',null,'action-buttons');actions.append(run,toggle,edit,remove);card.append(actions);
    const latest=runs.find(r=>r.task_id===task.id&&r.finished);if(latest){card.append(node('p',latest.error||latest.answer,'saved-text'),node('p','最終実行: '+new Date(latest.started).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）・検索ツール '+latest.searches+'回','hint'));
     for(const source of latest.sources||[]){try{const url=new URL(source.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;const a=node('a',(source.title||url.hostname)+' ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';card.append(a,node('br'));}catch{}}
    }list.append(card);
   }if(!tasks.length)list.append(node('p','まだタスクはないよ。目的を登録したものだけ自律的に調べるよ。','hint'));
  }
  renderDiaries(diaries){
   const list=$('diary-list');list.replaceChildren();for(const diary of diaries){const card=node('div',null,'card'),edit=node('button','編集','secondary'),remove=node('button','削除','secondary'),download=node('button','書き出す','secondary');
    edit.onclick=()=>{$('diary-day').value=diary.day;$('diary-content').value=diary.content;$('diary-form').scrollIntoView();};
    remove.onclick=()=>this.perform(()=>this.api('diary',{id:diary.id,delete:true}));download.onclick=()=>{const url=URL.createObjectURL(new Blob([diary.day+'\n\n'+diary.content],{type:'text/plain;charset=utf-8'}));const a=node('a');a.href=url;a.download='aster-diary-'+diary.day+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    card.append(node('h2',diary.day),node('p',diary.content,'saved-text'));const actions=node('div',null,'action-buttons');actions.append(edit,download,remove);card.append(actions);list.append(card);}
   if(!diaries.length)list.append(node('p','日記はまだないよ。希望した日にだけ保存できるよ。','hint'));
  }
  renderGoals(goals){
   const list=$('goal-list');list.replaceChildren();for(const goal of goals){const card=node('div',null,'card'),plus=node('button','1'+goal.unit+'進める','secondary'),edit=node('button','進捗を修正','secondary'),change=node('button','目標を編集','secondary'),remove=node('button','削除','secondary');
    plus.onclick=()=>this.perform(()=>this.api('goals',{id:goal.id,increment:1}));edit.onclick=()=>{const value=prompt('現在の進み具合（'+goal.unit+'）',String(goal.progress));if(value!==null)this.perform(()=>this.api('goals',{id:goal.id,progress:Number(value)}));};remove.onclick=()=>this.perform(()=>this.api('goals',{id:goal.id,delete:true}));
    change.onclick=()=>{this.goalEdit=goal.id;$('goal-cancel-edit').hidden=false;$('goal-title').value=goal.title;$('goal-target').value=String(goal.target);$('goal-unit').value=goal.unit;$('goal-form').querySelector('button[type=submit]').textContent='目標の変更を保存';$('goal-form').scrollIntoView();};
    card.append(node('h2','#'+goal.id+' '+goal.title),node('p',goal.progress+' / '+goal.target+' '+goal.unit+(goal.progress>=goal.target?' · 達成したね。自分のペースを大切に。':'')));const bar=node('progress');bar.max=goal.target;bar.value=Math.min(goal.progress,goal.target);bar.setAttribute('aria-label',goal.title+'の進捗');card.append(bar);const actions=node('div',null,'action-buttons');actions.append(plus,edit,change,remove);card.append(actions);list.append(card);}
   if(!goals.length)list.append(node('p','目標はまだないよ。決めたものだけ登録しよう。','hint'));
  }
  renderReminders(reminders){
   const list=$('reminder-list');list.replaceChildren();for(const reminder of reminders){const card=node('div',null,'card'),toggle=node('button',reminder.enabled?'無効にする':'有効にする','secondary'),edit=node('button','日時・内容を編集','secondary'),remove=node('button','削除','secondary');
    toggle.onclick=()=>this.perform(()=>this.api('reminders',{id:reminder.id,enabled:!reminder.enabled}));remove.onclick=()=>this.perform(()=>this.api('reminders',{id:reminder.id,delete:true}));
    edit.onclick=()=>{this.reminderEdit=reminder.id;$('reminder-cancel-edit').hidden=false;$('reminder-title').value=reminder.title;$('reminder-schedule').value=jstLocal(new Date(reminder.schedule));$('reminder-repeat').value=reminder.repeat;$('reminder-form').querySelector('button[type=submit]').textContent='通知の変更を保存';$('reminder-form').scrollIntoView();};
    card.append(node('h2',reminder.title),node('p',new Date(reminder.schedule).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）・'+({once:'一度だけ',daily:'毎日',weekly:'毎週'}[reminder.repeat])+'・'+(reminder.enabled?'有効':'無効')));const actions=node('div',null,'action-buttons');actions.append(toggle,edit,remove);card.append(actions);list.append(card);}
   if(!reminders.length)list.append(node('p','通知はまだ登録していないよ。必要なものだけ追加できるよ。','hint'));
  }
  renderDeliveries(deliveries){
   if(this.isTemporary)deliveries=[];const signature=deliveries.map(d=>d.id+':'+d.title+':'+d.occurrence).join(',');if(signature===this.deliverySignature)return;this.deliverySignature=signature;
   const list=$('reminder-alert');list.replaceChildren();list.hidden=!deliveries.length;for(const delivery of deliveries){const row=node('div'),dismiss=node('button','確認した','secondary');dismiss.onclick=()=>this.perform(()=>this.api('reminders',{ack:delivery.id}));row.append(node('strong',delivery.title),node('p','予定: '+new Date(delivery.occurrence).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）','hint'),dismiss);list.append(row);}
  }
  async pollReminders(){
   if(!this.lastState||this.isTemporary||this.polling)return;this.polling=true;
   try{const result=await this.api('reminders/due',{});if(!result.deliveries.length)return;
    for(const delivery of result.deliveries){if(root.Notification?.permission==='granted'){try{new root.Notification('ASTER · '+delivery.title,{body:'予定: '+new Date(delivery.occurrence).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),tag:'aster-reminder-'+delivery.id});}catch{}}}
    this.renderMain(await this.api('state'));
   }catch{$('notification-status').textContent='通知の確認に接続できないよ。アプリのサーバーを確認してね。';}finally{this.polling=false;}
  }
 }
 root.YorisoiCompanion={CompanionUI};
})(window);

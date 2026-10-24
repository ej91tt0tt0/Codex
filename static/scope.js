(function(root){
 class ScopeView{
  constructor(canvas,label){this.canvas=canvas;this.label=label;this.smoothed=0;this.draw(0,new Uint8Array(0));}
  draw(level,spectrum){
   this.smoothed=level===0?0:this.smoothed*0.55+level*0.45;const value=this.smoothed;
   const c=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height,center=w/2;
   c.clearRect(0,0,w,h);c.save();c.translate(center,h/2);
   const radius=w*.29,glow=c.createRadialGradient(0,0,radius*.35,0,0,radius*1.55);
   glow.addColorStop(0,'#00eaff0a');glow.addColorStop(.65,`rgba(0,234,255,${.07+value*.18})`);glow.addColorStop(1,'#00eaff00');c.fillStyle=glow;c.beginPath();c.arc(0,0,radius*1.55,0,Math.PI*2);c.fill();
   for(let ring=0;ring<3;ring++){c.beginPath();c.strokeStyle=ring===1?'#ff43d680':'#00ecff80';c.lineWidth=ring===0?2.5:1;c.arc(0,0,radius+ring*18+value*(8-ring*2),0,Math.PI*2);c.stroke();}
   for(let i=0;i<72;i++){
    const angle=i/72*Math.PI*2-Math.PI/2,bin=spectrum?.length?spectrum[Math.floor(i/72*spectrum.length)]/255:0;
    const inner=radius-11,outer=inner+5+bin*38+value*22;
    c.strokeStyle=i%6===0?'#fcf66f':'#00eaff';c.lineWidth=i%6===0?2.5:1.5;c.beginPath();c.moveTo(Math.cos(angle)*inner,Math.sin(angle)*inner);c.lineTo(Math.cos(angle)*outer,Math.sin(angle)*outer);c.stroke();
   }
   c.strokeStyle='#5bd7e740';c.lineWidth=1;c.beginPath();c.moveTo(-22,0);c.lineTo(22,0);c.moveTo(0,-22);c.lineTo(0,22);c.stroke();
   c.fillStyle='#00efff';c.beginPath();c.arc(0,0,3+value*7,0,Math.PI*2);c.fill();c.restore();
   this.canvas.dataset.level=value.toFixed(3);this.canvas.setAttribute('aria-label','マイク入力音量 '+Math.round(level*100)+'パーセント');
   if(this.label)this.label.textContent=level===0?'MIC · 0%':'MIC · '+Math.round(level*100)+'%';
  }
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={ScopeView};else root.YorisoiScope={ScopeView};
})(typeof window==='undefined'?globalThis:window);

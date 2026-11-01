/* ASTER ASTRAL / original interactive deep-space HUD.
   Decorative motion only; Live audio and assistant state remain authoritative.
   A single 2D canvas, bounded star pool, no textures, tracking, libraries or API calls. */
(() => {
  'use strict';
  const stage = document.querySelector('.cosmos-background');
  if (!stage) return;
  const root = document.documentElement;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const isReduced = () => reduced?.matches === true;
  const canvas = document.createElement('canvas');
  canvas.className = 'astral-starfield';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  stage.append(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  const nebula = document.createElement('div');
  nebula.className = 'astral-nebula';
  nebula.setAttribute('aria-hidden', 'true');
  const grid = document.createElement('div');
  grid.className = 'astral-orbit-grid';
  grid.setAttribute('aria-hidden', 'true');
  stage.append(grid, nebula);
  const atmosphere = document.createElement('div');
  atmosphere.className = 'astral-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  document.body.append(atmosphere);
  const telemetry = document.createElement('div');
  telemetry.className = 'astral-telemetry';
  telemetry.setAttribute('aria-hidden', 'true');
  for (const value of ['DEEP SPACE / 01', 'ASTRAL // NAVIGATION', 'SIGNAL : ONLINE', 'PERSONAL AI  ·  ASTER']) {
    const part = document.createElement('span');
    part.textContent = value;
    telemetry.append(part);
  }
  stage.append(telemetry);

  // The original microphone display remains a genuine input-level visualizer.
  // These are decorative gyroscopes, not synthetic microphone readings.
  const orb = document.querySelector('.voice-orb');
  if (orb) {
    for (const className of ['astral-reactor', 'astral-arc']) {
      if (!orb.querySelector('.' + className)) {
        const ring = document.createElement('span');
        ring.className = className;
        ring.setAttribute('aria-hidden', 'true');
        orb.append(ring);
      }
    }
  }
  if (!orb && document.body.classList.contains('cosmos-page') && !document.body.classList.contains('archive-page')) {
    const host = document.querySelector('.live-panel, #realtime-heading');
    if (host) {
      const banner = document.createElement('div');
      banner.className = 'astral-stage-banner';
      banner.setAttribute('aria-hidden', 'true');
      const mark = document.createElement('span');
      mark.className = 'astral-stage-mark';
      mark.textContent = 'ASTER';
      banner.append(mark);
      if (host.classList?.contains('live-panel')) host.insertBefore(banner,host.firstChild);
      else host.parentElement.insertBefore(banner,host);
    }
  }

  let width = 0, height = 0, scale = 1, stars = [];
  let frame = 0, last = 0, lastPaint = 0, sceneTime = 0;
  let streak = null, nextStreak = 8;
  let targetX = 0, targetY = 0, floatX = 0, floatY = 0;
  const seed = { value: 0xA57E2026 };
  const random = () => {
    // Reproducible layout; no random personal identifiers or external assets.
    seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
    return seed.value / 4294967296;
  };
  const star = (fresh = false) => ({
    x: (random() - .5) * 2.6,
    y: (random() - .5) * 2.2,
    z: fresh ? .96 + random() * .04 : .12 + random() * .9,
    size: .45 + random() * 1.3,
    tint: random() > .78 ? '#83ccff' : '#d2f3ff',
  });
  function resize() {
    if (!context) return;
    width = Math.max(1,window.innerWidth);
    height = Math.max(1,window.innerHeight);
    scale = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(scale,0,0,scale,0,0);
    const mobile = width < 768;
    const lowMemory = Number(navigator.deviceMemory || 8) <= 2;
    const count = isReduced() ? 60 : (mobile ? 95 : 155);
    stars = Array.from({length: lowMemory ? Math.ceil(count * .6) : count},() => star());
  }
  function drawStar(s, power, speed, dt) {
    const centerX = width * .5 + floatX * .52;
    const centerY = height * .48 + floatY * .46;
    const spanX = Math.max(width, height) * .44;
    const spanY = Math.max(width, height) * .37;
    const oldZ = s.z;
    if (!isReduced()) s.z -= speed * dt * (s.size > 1.3 ? 1.18 : .84);
    if (s.z < .12 || s.z > 1.08) Object.assign(s, star(true));
    const x = centerX + s.x * spanX / (s.z + .25);
    const y = centerY + s.y * spanY / (s.z + .25);
    if (x < -20 || x > width + 20 || y < -20 || y > height + 20) {
      Object.assign(s,star(true));
      return;
    }
    const near = Math.min(1,1.1 - s.z);
    const radius = Math.max(.3,s.size * (1.55 - s.z * .65));
    context.globalAlpha = .25 + near * .68;
    context.fillStyle = s.tint;
    context.beginPath();
    context.arc(x,y,radius,0,Math.PI*2);
    context.fill();
    if (near > .48 && s.size > 1.1) {
      context.globalAlpha = Math.min(.43, near * .43);
      context.strokeStyle = '#97dcff';
      context.lineWidth = Math.max(.4,near * .9);
      context.beginPath();
      context.moveTo(x,y);
      const oldX = centerX + s.x * spanX / (oldZ + .25);
      const oldY = centerY + s.y * spanY / (oldZ + .25);
      context.lineTo(oldX,oldY);
      context.stroke();
    }
    if (power > .55 && near > .7 && s.size > 1.5) {
      context.globalAlpha = .09;
      context.strokeStyle = '#b4ecff';
      context.beginPath();context.moveTo(x-4,y);context.lineTo(x+4,y);
      context.moveTo(x,y-4);context.lineTo(x,y+4);context.stroke();
    }
  }
  function drawShootingStar(dt) {
    nextStreak -= dt;
    if (!streak && nextStreak <= 0 && !isReduced()) {
      streak = {
        x: width * (.12 + random() * .74),
        y: height * (.02 + random() * .35),
        vx: width * (.2 + random() * .22),
        vy: height * (.18 + random() * .23),
        life: 0,
        max: .55 + random() * .45,
      };
      nextStreak = 11 + random() * 15;
    }
    if (!streak) return;
    streak.life += dt;
    const t = Math.min(1,streak.life / streak.max);
    const x = streak.x + streak.vx * t;
    const y = streak.y + streak.vy * t;
    const tail = Math.max(26,Math.min(160,width * .16));
    const g = context.createLinearGradient(x-tail,y-tail*.7,x,y);
    g.addColorStop(0,'rgba(122,198,255,0)');
    g.addColorStop(.72,'rgba(133,214,255,.32)');
    g.addColorStop(1,'rgba(218,251,255,.8)');
    context.globalAlpha = Math.sin(Math.PI * t) * .87;
    context.strokeStyle = g;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x-tail,y-tail*.7);
    context.lineTo(x,y);
    context.stroke();
    if (t >= 1) streak = null;
  }
  function paint(time) {
    if (!context || document.hidden) {frame = 0;return;}
    frame = requestAnimationFrame(paint);
    if (time - lastPaint < (width < 768 ? 32 : 25)) return;
    const dt = Math.min(.065,Math.max(0,(time - (last || time)) / 1000));
    last = time;lastPaint = time;sceneTime += dt;
    floatX += (targetX - floatX) * .035;
    floatY += (targetY - floatY) * .035;
    root.style.setProperty('--astral-x',Math.round(floatX * .25) + 'px');
    root.style.setProperty('--astral-y',Math.round(floatY * .25) + 'px');
    const active = document.body.classList.contains('home-live-active') ||
      /会話中|接続中/.test(document.getElementById('live-status')?.textContent || '') ||
      /会話中/.test(document.getElementById('realtime-status')?.textContent || '');
    const meterLevel = Number(orb?.querySelector('canvas')?.dataset.level || 0);
    const actualLevel = active && Number.isFinite(meterLevel) ? Math.max(0,Math.min(1,meterLevel)) : 0;
    root.style.setProperty('--astral-voice',actualLevel.toFixed(3));
    root.style.setProperty('--astral-glow',Math.round(32 + actualLevel * 22) + 'px');
    const velocity = active ? .185 + actualLevel * .34 : .056;
    context.clearRect(0,0,width,height);
    for (const s of stars) drawStar(s,actualLevel,velocity,dt);
    drawShootingStar(dt);
    context.globalAlpha = 1;
  }
  function start() {
    if (!context || frame || isReduced() || document.hidden) return;
    last = performance.now();lastPaint = 0;
    frame = requestAnimationFrame(paint);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;last = 0;
  }
  function staticFrame() {
    if (!context) return;
    context.clearRect(0,0,width,height);
    for (const s of stars) drawStar(s,0,0,0);
    context.globalAlpha = 1;
  }
  function onMotion() {
    stop();
    resize();
    if (isReduced()) {
      root.style.setProperty('--astral-x','0px');
      root.style.setProperty('--astral-y','0px');
      staticFrame();
    } else start();
  }
  resize();
  onMotion();
  window.addEventListener('resize',resize,{passive:true});
  window.addEventListener('orientationchange',resize,{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) stop();
    else if (isReduced()) staticFrame();
    else start();
  });
  reduced?.addEventListener?.('change',onMotion);
  window.addEventListener('pointermove',(event)=>{
    if (isReduced() || event.pointerType === 'touch') return;
    targetX = ((event.clientX / Math.max(1,width)) - .5) * 40;
    targetY = ((event.clientY / Math.max(1,height)) - .5) * 30;
  },{passive:true});

  // Project UI panels into place after navigation. Navigation logic remains
  // owned by the existing app.js, so no click behaviour or history is replaced.
  function entrance() {
    const panel = Array.from(document.querySelectorAll('.panel')).find(node=>!node.hidden);
    if (!panel || isReduced()) return;
    panel.classList.remove('astral-panel-enter');
    // Restart CSS animation without reparenting controls.
    void panel.offsetWidth;
    panel.classList.add('astral-panel-enter');
  }
  document.addEventListener('click', (event)=>{
    const control = event.target.closest?.('button,a,summary');
    if (!control || control.disabled || isReduced()) return;
    if (control.matches('[data-tab]')) requestAnimationFrame(entrance);
    const box = control.getBoundingClientRect();
    const flash = document.createElement('span');
    flash.className = 'astral-interaction-flash';
    flash.setAttribute('aria-hidden','true');
    flash.style.setProperty('--flash-x',Math.round(box.left+box.width/2)+'px');
    flash.style.setProperty('--flash-y',Math.round(box.top+box.height/2)+'px');
    document.body.append(flash);
    flash.addEventListener('animationend',()=>flash.remove(),{once:true});
    setTimeout(()=>flash.remove(),800); // Fail-safe for background tabs.
  },{passive:true});
  window.addEventListener('hashchange',()=>{
    const detail = document.querySelector('.archive-detail-panel');
    if (!detail || isReduced()) return;
    detail.classList.remove('astral-panel-enter');
    void detail.offsetWidth;
    detail.classList.add('astral-panel-enter');
  });
  const captions = document.getElementById('live-captions');
  if (captions) {
    const observer = new MutationObserver((mutations)=>{
      if (isReduced()) return;
      for (const change of mutations) {
        for (const node of change.addedNodes) {
          if (node.nodeType === 1 && node.matches?.('p')) {
            node.classList.add('astral-caption-new');
          }
        }
      }
    });
    observer.observe(captions,{childList:true});
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }
  window.addEventListener('pagehide',stop,{once:true});
})();

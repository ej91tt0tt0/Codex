/* ASTER original startup motion and restrained interface feedback.
   Sound uses locally synthesized Web Audio oscillators, no external assets. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const soundToggle = $('interface-sounds');
  const SOUND_KEY = 'aster.ui.sounds';
  const INTRO_KEY = 'aster.intro.seen';
  let enabled = true;
  try { enabled = localStorage.getItem(SOUND_KEY) !== 'false'; } catch {}
  if (soundToggle) soundToggle.checked = enabled;
  let context = null;
  let lastSoundAt = 0;

  function playUI(kind = 'tap') {
    if (!enabled) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      if (!context) context = new AudioContextCtor();
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
      if (context.state === 'closed') return;
      const now = context.currentTime;
      const note = context.createOscillator();
      const volume = context.createGain();
      note.type = 'sine';
      const critical = kind === 'confirm';
      const end = kind === 'end';
      const start = critical ? 720 : end ? 510 : 880;
      const finish = critical ? 990 : end ? 350 : 1160;
      const length = critical ? 0.14 : end ? 0.14 : 0.07;
      const gain = (document.body.classList.contains('home-live-active') ? 0.008 : 0.018);
      note.frequency.setValueAtTime(start, now);
      note.frequency.exponentialRampToValueAtTime(finish, now + length);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(gain, now + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + length);
      note.connect(volume);
      volume.connect(context.destination);
      note.start(now);
      note.stop(now + length + .01);
      note.onended = () => { note.disconnect(); volume.disconnect(); };
    } catch {
      // Effects must never block ordinary UI or speech.
    }
  }

  if (soundToggle) {
    soundToggle.addEventListener('change', () => {
      enabled = soundToggle.checked;
      try { localStorage.setItem(SOUND_KEY, String(enabled)); } catch {}
      if (enabled) playUI('confirm');
    });
  }

  function handleAction(event) {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target.closest('button, summary, a[href], input[type="checkbox"]') : null;
    if (!target || target.disabled || target.closest('#aster-intro') && target.id !== 'intro-skip') return;
    if (target.id === 'interface-sounds') return;
    // During an active call, suppress nonessential UI tones to avoid microphone echo.
    if (document.body.classList.contains('home-live-active') &&
        !['live-orb-action', 'live-stop', 'live-mute'].includes(target.id)) return;
    const now = performance.now();
    if (now - lastSoundAt < 65) return;
    lastSoundAt = now;
    const kind = ['live-orb-action','live-start'].includes(target.id) ? 'confirm'
      : ['live-stop','voice-stop'].includes(target.id) ? 'end'
      : 'tap';
    playUI(kind);
  }
  document.addEventListener('click', handleAction, { capture: true });
  document.addEventListener('change', (event) => {
    if (!event.isTrusted || event.target === soundToggle) return;
    if (event.target?.matches?.('select, input[type="range"]')) playUI('tap');
  });

  function prepareHome() {
    const intro = $('aster-intro');
    if (!intro) return;
    const orb = $('live-orb-action');
    const textMode = $('interaction-mode');
    const extra = $('home-extra-panel');
    textMode?.addEventListener('change', () => {
      if (textMode.value === 'text' && extra) {
        extra.open = true;
        const details = $('text-input');
        if (details) details.open = true;
        // Text controls were moved out of the home voice cockpit.
        document.querySelector('[data-tab="text-workspace"]')?.click();
      }
    });
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    let seen = false;
    try { seen = sessionStorage.getItem(INTRO_KEY) === 'true'; } catch {}
    let completed = false;
    let displayed = false;
    const app = document.querySelector('main');
    let timer = null;
    let fadeTimer = null;
    const finish = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      clearTimeout(fadeTimer);
      try { sessionStorage.setItem(INTRO_KEY, 'true'); } catch {}
      if (app) app.inert = false;
      document.body.classList.remove('intro-playing');
      intro.setAttribute('aria-modal', 'false');
      intro.inert = true;
      if (displayed) {
        intro.classList.add('intro-fading');
        fadeTimer = setTimeout(() => {
          intro.hidden = true;
          orb?.focus({ preventScroll: true });
        }, 280);
      } else {
        intro.hidden = true;
      }
      // Delay any opt-in auto-connect until the cinematic intro finishes.
      window.dispatchEvent(new Event('aster:boot-complete'));
    };
    if (reduced || seen || document.visibilityState === 'hidden') {
      intro.hidden = true;
      finish();
      return;
    }
    intro.hidden = false;
    displayed = true;
    intro.inert = false;
    if (app) app.inert = true;
    document.body.classList.add('intro-playing');
    $('intro-skip')?.focus({ preventScroll: true });
    const skip = () => finish();
    $('intro-skip')?.addEventListener('click', skip, { once: true });
    intro.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'Enter' && event.target === intro) {
        event.preventDefault();
        finish();
      }
    });
    timer = setTimeout(finish, 2400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepareHome, { once: true });
  } else prepareHome();
})();

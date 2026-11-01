/* A monochrome listening instrument; no simulated microphone activity. */
(function (root) {
  'use strict';
  class ScopeView {
    constructor(canvas, label) {
      this.canvas = canvas;
      this.label = label;
      this.smoothed = 0;
      this.lastPercent = null;
      this.draw(0, new Uint8Array(0));
    }
    draw(level, spectrum) {
      level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
      this.smoothed = level === 0 ? 0 : this.smoothed * 0.55 + level * 0.45;
      const value = this.smoothed;
      const c = this.canvas.getContext('2d');
      if (!c) return;
      const w = this.canvas.width,
        h = this.canvas.height,
        radius = Math.min(w, h) * 0.32;
      c.clearRect(0, 0, w, h);
      c.save();
      c.translate(w / 2, h / 2);
      const ink = '#9cdeff',
        faint = '#3a7aa8';
      c.fillStyle = `rgba(43,121,187,${0.025 + value * 0.06})`;
      c.beginPath();
      c.arc(0, 0, radius * 0.86, 0, Math.PI * 2);
      c.fill();
      for (let ring = 0; ring < 3; ring++) {
        c.beginPath();
        c.strokeStyle = ring === 1 ? faint : ink;
        c.lineWidth = ring === 0 ? 1.8 : 0.9;
        c.arc(0, 0, radius + ring * 16 + value * (6 - ring), 0, Math.PI * 2);
        c.stroke();
      }
      for (let i = 0; i < 96; i++) {
        const angle = (i / 96) * Math.PI * 2 - Math.PI / 2;
        const raw = spectrum?.length ? spectrum[Math.floor((i / 96) * spectrum.length)] / 255 : 0;
        const bin = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
        const major = i % 8 === 0;
        const inner = radius - 13,
          outer = inner + (major ? 8 : 4) + bin * 28 + value * 15;
        c.strokeStyle = major ? ink : '#4c9ac6';
        c.lineWidth = major ? 2 : 1;
        c.beginPath();
        c.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        c.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
        c.stroke();
      }
      const tip = 17 + value * 4,
        stem = 4 + value;
      c.fillStyle = ink;
      c.beginPath();
      c.moveTo(0, -tip);
      c.lineTo(stem, -stem);
      c.lineTo(tip, 0);
      c.lineTo(stem, stem);
      c.lineTo(0, tip);
      c.lineTo(-stem, stem);
      c.lineTo(-tip, 0);
      c.lineTo(-stem, -stem);
      c.closePath();
      c.fill();
      c.fillStyle = '#071627';
      c.beginPath();
      c.arc(0, 0, 2.5, 0, Math.PI * 2);
      c.fill();
      for (const direction of [-1, 1]) {
        const x = direction * (radius + 47);
        c.strokeStyle = faint;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, -6);
        c.lineTo(x, 6);
        c.moveTo(x - 6, 0);
        c.lineTo(x + 6, 0);
        c.stroke();
      }
      c.restore();
      this.canvas.dataset.level = value.toFixed(3);
      const percent = Math.round(level * 100);
      const label = 'MIC · ' + percent + '%';
      if (this.label && this.label.textContent !== label) this.label.textContent = label;
      // Screen-reader attributes change only when the displayed percentage changes.
      if (percent !== this.lastPercent) {
        this.lastPercent = percent;
        this.canvas.setAttribute('aria-label', 'マイク入力音量 ' + percent + 'パーセント');
      }
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { ScopeView };
  else root.AsterScope = { ScopeView };
})(typeof window === 'undefined' ? globalThis : window);

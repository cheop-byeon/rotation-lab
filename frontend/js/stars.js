// Subtle animated starfield; respects prefers-reduced-motion.
export function startStars(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], w = 0, h = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr;
    const n = Math.round((innerWidth * innerHeight) / 5200);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: (Math.random() ** 3 * 1.4 + 0.25) * dpr,
      a: Math.random() * 0.6 + 0.2, t: Math.random() * Math.PI * 2, s: Math.random() * 0.015 + 0.004,
      v: (Math.random() * 0.04 + 0.01) * dpr,
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      if (!still) { s.t += s.s; s.x -= s.v; if (s.x < 0) s.x = w; }
      ctx.globalAlpha = s.a * (0.65 + 0.35 * Math.sin(s.t));
      ctx.fillStyle = s.r > 1.2 * dpr ? '#cfe9ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    if (!still) requestAnimationFrame(frame);
  }
  addEventListener('resize', () => { resize(); if (still) frame(); });
  resize(); frame();
}

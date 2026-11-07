/* ℂ𝕆ℝ𝕍𝕌𝕊 — subtle floating dust */

(function () {
  'use strict';

  var canvas = document.getElementById('dust');
  if (!canvas || !canvas.getContext) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var particles = [];
  var width = 0;
  var height = 0;
  var running = true;
  var raf;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    var count = Math.min(70, Math.round((width * height) / 22000));
    particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.5 + Math.random() * 1.6,
        a: 0.15 + Math.random() * 0.45,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.05 - Math.random() * 0.16,
        hue: Math.random() < 0.5 ? '190, 235, 255' : '170, 150, 255'
      });
    }
  }

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -6) { p.y = height + 6; p.x = Math.random() * width; }
      if (p.x < -6) p.x = width + 6;
      if (p.x > width + 6) p.x = -6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + p.hue + ',' + p.a + ')';
      ctx.shadowBlur = 6;
      ctx.shadowColor = 'rgba(' + p.hue + ',' + p.a + ')';
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      frame();
    }
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 200);
  });

  resize();
  frame();
})();

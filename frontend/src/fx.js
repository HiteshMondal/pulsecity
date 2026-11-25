// Live "pulse city" animation for the login / sign-up hero. Pure canvas, no dependencies, no changes to pages.jsx.
// Aurora ribbons + glowing constellation that reacts to the cursor + a heartbeat line whose beats send out ripples.
// Colours follow the selected role (reads --t1/--t2 from the hero). Honors prefers-reduced-motion (one still frame).

const parse = s => {
  s = String(s).trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).replace(/./g, '$&$&') : s.slice(1), v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const n = s.match(/-?[\d.]+/g);
  if (!n || n.length < 3) return null;
  const k = s.startsWith('color(') ? 255 : 1;
  return n.slice(0, 3).map(x => Number(x) * k);
};
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const g = (u, c, w, a) => a * Math.exp(-(((u - c) / w) ** 2));
const ecg = u => g(u, .18, .04, .18) + g(u, .40, .012, -.25) + g(u, .45, .010, 1.2) + g(u, .50, .014, -.45) + g(u, .72, .06, .32);
const TAU = Math.PI * 2;

function start(hero) {
  const cv = document.createElement('canvas');
  cv.className = 'fx';
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;mix-blend-mode:screen;opacity:.95';
  hero.prepend(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) return () => cv.remove();

  // OS "reduce motion" gets a still frame. Open the site with ?motion=1 (e.g. http://localhost:5173/?motion=1) to force the animation.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches && !/[?&]motion=1/.test(location.search);
  let w = 0, h = 0, raf = 0, last = performance.now(), t = reduce ? 4000 : 0, frame = 0, prevU = 0;
  let c1 = [47, 196, 166], c2 = [159, 240, 220];
  const mouse = { x: 0, y: 0, on: false }, par = { x: 0, y: 0 };
  const P = [], R = [];

  const spawn = () => ({ x: Math.random() * w, y: Math.random() * h * .85, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .3 - .06,
    r: 1 + Math.random() * 2.2, z: .35 + Math.random() * .65, k: Math.random() < .5 ? 0 : 1, ph: Math.random() * TAU, dx: 0, dy: 0 });
  const size = () => {
    const b = hero.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    w = b.width; h = b.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(90, Math.round(w * h / 14000));
    while (P.length < n) P.push(spawn());
    P.length = n;
  };
  const ripple = (x, y, max, c) => R.push({ x, y, r: 0, max, c });

  function draw(dt) {
    t += dt;
    if (frame++ % 8 === 0) {
      const cs = getComputedStyle(hero);
      c1 = parse(cs.getPropertyValue('--t1')) || c1;
      c2 = parse(cs.getPropertyValue('--t2')) || c2;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const f = dt / 16;

    // 1. aurora ribbons
    for (let i = 0; i < 3; i++) {
      const gr = ctx.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, rgba(i % 2 ? c2 : c1, 1)); gr.addColorStop(.5, rgba(i % 2 ? c1 : c2, 1)); gr.addColorStop(1, rgba(i % 2 ? c2 : c1, 1));
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 14) {
        const y = h * (.2 + .1 * i) + Math.sin(x * .0035 + t * .00035 * (1 + i * .4) + i * 2) * h * .07 + Math.sin(x * .009 - t * .0006 + i) * h * .025;
        x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = gr;
      for (const [lw, a] of [[110, .035], [56, .05], [18, .09], [2.5, .4]]) { ctx.lineWidth = lw; ctx.globalAlpha = a; ctx.stroke(); }
    }

    // 2. constellation that leans toward the cursor
    par.x += ((mouse.on ? mouse.x / w - .5 : 0) - par.x) * .05; par.y += ((mouse.on ? mouse.y / h - .5 : 0) - par.y) * .05;
    for (const p of P) {
      p.x += p.vx * f * p.z; p.y += p.vy * f * p.z;
      if (mouse.on) {
        const ax = mouse.x - p.x, ay = mouse.y - p.y, d = Math.hypot(ax, ay);
        if (d < 170 && d > 1) { p.x += ax / d * (1 - d / 170) * .9 * f; p.y += ay / d * (1 - d / 170) * .9 * f; }
      }
      if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h * .9; else if (p.y > h) p.y = -10;
      p.dx = p.x - par.x * 40 * p.z; p.dy = p.y - par.y * 40 * p.z;
    }
    ctx.lineWidth = .8; ctx.strokeStyle = rgba(c2, 1);
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const d = Math.hypot(P[i].dx - P[j].dx, P[i].dy - P[j].dy);
      if (d < 125) { ctx.globalAlpha = (1 - d / 125) * .3; ctx.beginPath(); ctx.moveTo(P[i].dx, P[i].dy); ctx.lineTo(P[j].dx, P[j].dy); ctx.stroke(); }
    }
    for (const p of P) {
      const a = .45 + .45 * Math.sin(t * .002 + p.ph), c = p.k ? c2 : c1;
      ctx.fillStyle = rgba(c, 1);
      for (const [m, k] of [[5, .06], [3, .12], [1.6, .25]]) { ctx.globalAlpha = a * k * 2; ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r * m, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r * .7, 0, TAU); ctx.fill();
    }

    // 3. heartbeat line: the PulseCity signature
    const base = h * .42, amp = Math.min(110, h * .16), period = Math.max(300, w * .42), L = 360;
    const yAt = x => base - ecg((((x % period) + period) % period) / period) * amp;
    ctx.strokeStyle = rgba(c2, 1); ctx.lineWidth = 1; ctx.globalAlpha = .07; ctx.beginPath();
    for (let x = 0; x <= w; x += 6) x ? ctx.lineTo(x, yAt(x)) : ctx.moveTo(x, yAt(x));
    ctx.stroke();
    const hx = (t * .32) % (w + 400) - 50, u = (((hx % period) + period) % period) / period;
    if (prevU < .45 && u >= .45) ripple(hx, yAt(hx), 220 + Math.random() * 80, c2);
    prevU = u;
    for (let x = hx - L; x < hx; x += 4) {
      const k = ((x - (hx - L)) / L) ** 2;
      ctx.beginPath(); ctx.moveTo(x, yAt(x)); ctx.lineTo(x + 4, yAt(x + 4));
      ctx.strokeStyle = rgba(c1, 1); ctx.lineWidth = 8; ctx.globalAlpha = k * .12; ctx.stroke();
      ctx.strokeStyle = rgba(c2, 1); ctx.lineWidth = 3; ctx.globalAlpha = k * .4; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.globalAlpha = k * .95; ctx.stroke();
    }
    const hy = yAt(hx);
    ctx.fillStyle = rgba(c2, 1);
    for (const [r, a] of [[26, .08], [14, .18], [6, .5]]) { ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(hx, hy, r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill();

    // 4. ripples (from beats and clicks)
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i]; r.r += .1 * dt;
      if (r.r > r.max) { R.splice(i, 1); continue; }
      const a = (1 - r.r / r.max) ** 1.5;
      ctx.strokeStyle = rgba(r.c, 1);
      ctx.lineWidth = 2; ctx.globalAlpha = a * .5; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 1; ctx.globalAlpha = a * .3; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * .7, 0, TAU); ctx.stroke();
    }

    // 5. cursor glow
    if (mouse.on) {
      ctx.fillStyle = rgba(c1, 1);
      for (const [r, a] of [[90, .05], [46, .09], [18, .16]]) { ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  size();
  const ro = new ResizeObserver(() => { size(); if (reduce) draw(16); }); // resizing clears a canvas, so a still frame must be redrawn
  ro.observe(hero);
  if (reduce) { draw(16); return () => { ro.disconnect(); cv.remove(); }; }

  const pos = e => { const b = hero.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; };
  const move = e => { pos(e); mouse.on = true; };
  const leave = () => { mouse.on = false; };
  const down = e => { pos(e); ripple(mouse.x, mouse.y, 280, c1); ripple(mouse.x, mouse.y, 190, c2); };
  hero.addEventListener('pointermove', move); hero.addEventListener('pointerleave', leave); hero.addEventListener('pointerdown', down);

  const loop = now => { const dt = Math.min(50, now - last); last = now; draw(dt); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf); ro.disconnect();
    hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); hero.removeEventListener('pointerdown', down);
    cv.remove();
  };
}

// Starts the animation whenever the login hero is on screen, stops it when the user signs in.
export function mountLoginFx() {
  const root = document.getElementById('root');
  let stop = null;
  const check = () => {
    const hero = document.querySelector('.login .hero');
    if (hero && !hero.querySelector(':scope > canvas.fx')) { if (stop) stop(); stop = start(hero); }
    else if (!hero && stop) { stop(); stop = null; }
  };
  new MutationObserver(check).observe(root, { childList: true, subtree: true });
  check();
}
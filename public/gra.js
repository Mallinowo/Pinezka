// Pinezka – klient gry (jasna mapa wektorowa)
(() => {
'use strict';
const POZ = ['Pudło', 'Oczywisty', 'Znany', 'Rzadki', 'Egzotyczny', 'Biały kruk'];
const PKT = [0, 40, 55, 70, 85, 100];
const KOL = ['#b03a2e', '#a07c4f', '#5b8c3e', '#2e6f9e', '#7d4e9e', '#d49a12'];
const EMOJI = ['⬛', '⬜', '🟩', '🟦', '🟪', '🟧'];
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// ---------- kraje ----------
const KRAJE = window.KRAJE; // {c,n,a3,a:[lon,lat],s,t?}
const PO_KODZIE = {}; KRAJE.forEach(k => PO_KODZIE[k.c] = k);
const PANSTWA = KRAJE.filter(k => !k.t);
const nazwa = c => c ? ((PO_KODZIE[c] || {}).n || c) : 'Brak czasu';

// ---------- projekcja Millera ----------
const RAD = Math.PI / 180;
const prX = lon => lon * RAD;
const prY = lat => -1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * Math.max(-85, Math.min(85, lat)) * RAD));
const MAPA = { x0: -Math.PI, x1: Math.PI, y0: prY(84), y1: prY(-57) };

// ---------- stan ----------
let dzien = null, stan = null, wyniki = null;
let pin = null, wybrany = null, najechany = null, radar = null, podglad = null;
let tryb = 'ladowanie';
const ust = store.get('pz-ust', { dzwiek: true });

// ---------- płótno ----------
const cv = $('#cv'), ctx = cv.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
const V = { k: 100, tx: 0, ty: 0 }; // ekran = proj * k + t
let geo = []; // {c, path, bb:[x0,y0,x1,y1]}
let brudne = true, wynikT0 = 0, koniecT0 = 0;
const MORZE = '#a9c4c8';
const fale = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d');
  for (let i = 0; i < 70; i++) { x.fillStyle = Math.random() < .5 ? '#ffffff26' : '#3d6a7414'; x.fillRect(Math.random() * 64, Math.random() * 48, 1.2, 1.2); }
  return ctx.createPattern(c, 'repeat'); })();

function rozmiar() {
  const r = cv.getBoundingClientRect(); cw = r.width; ch = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); ogranicz(); brudne = true;
}
const kFit = () => Math.min(cw / (MAPA.x1 - MAPA.x0), ch / (MAPA.y1 - MAPA.y0));
function ogranicz() {
  const kmin = kFit() * 0.98; V.k = Math.min(Math.max(V.k, kmin), kmin * 80);
  const w = (MAPA.x1 - MAPA.x0) * V.k, h = (MAPA.y1 - MAPA.y0) * V.k;
  V.tx = w <= cw ? (cw - w) / 2 - MAPA.x0 * V.k : Math.min(-MAPA.x0 * V.k, Math.max(cw - MAPA.x1 * V.k, V.tx));
  V.ty = h <= ch ? (ch - h) / 2 - MAPA.y0 * V.k : Math.min(-MAPA.y0 * V.k, Math.max(ch - MAPA.y1 * V.k, V.ty));
}
function wysrodkuj(lon, lat, k) { if (k) V.k = k; ogranicz(); V.tx = cw / 2 - prX(lon) * V.k; V.ty = ch / 2 - prY(lat) * V.k; ogranicz(); brudne = true; }
function dopasuj() {
  if (cw < 600) { V.k = ch / (MAPA.y1 - MAPA.y0) * 1.15; wysrodkuj(25, 30, V.k); }
  else { V.k = kFit(); V.tx = 0; V.ty = 0; ogranicz(); }
  brudne = true;
}
let kamera = null, ruchDo = 0;
const ruszam = () => { ruchDo = performance.now() + 160; };
function plynnie(fn, ms = 750) {
  const a = { ...V }; fn(); const b = { ...V }; Object.assign(V, a);
  const c = v => [(cw / 2 - v.tx) / v.k, (ch / 2 - v.ty) / v.k];
  kamera = { a: c(a), b: c(b), ka: a.k, kb: b.k, t0: performance.now(), ms }; brudne = true;
}
function krokKamery(t) {
  if (!kamera) return; const q = Math.min(1, (t - kamera.t0) / kamera.ms), e = q < .5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
  // lekkie oddalenie w połowie lotu, jak kamera nad mapą
  const k = Math.exp(Math.log(kamera.ka) + (Math.log(kamera.kb) - Math.log(kamera.ka)) * e) * (1 - .18 * Math.sin(Math.PI * e) * (kamera.ka === kamera.kb ? 0 : 1));
  const x = kamera.a[0] + (kamera.b[0] - kamera.a[0]) * e, y = kamera.a[1] + (kamera.b[1] - kamera.a[1]) * e;
  V.k = k; V.tx = cw / 2 - x * k; V.ty = ch / 2 - y * k; if (q >= 1) { ogranicz(); kamera = null; } brudne = true;
}
const naEkran = (lon, lat) => [prX(lon) * V.k + V.tx, prY(lat) * V.k + V.ty];
const naProj = (x, y) => [(x - V.tx) / V.k, (y - V.ty) / V.k];

async function wczytajMape() {
  const topo = await (await fetch('/geo.json')).json();
  const fc = topojson.feature(topo, topo.objects.countries);
  const byC = {};
  for (const f of fc.features) {
    const c = f.id; if (!PO_KODZIE[c]) continue;
    const g = byC[c] || (byC[c] = { c, path: new Path2D(), bb: [1e9, 1e9, -1e9, -1e9] });
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      // rozwiń długości (antypołudnik), w razie potrzeby narysuj też kopię przesuniętą o 360°
      const rings = poly.map(r => { let o = 0, pv = null; return r.map(([x, y]) => { if (pv !== null) { if (x + o - pv > 180) o -= 360; else if (x + o - pv < -180) o += 360; } pv = x + o; return [x + o, y]; }); });
      let mx = -1e9, mn = 1e9; for (const r of rings) for (const [x] of r) { mx = Math.max(mx, x); mn = Math.min(mn, x); }
      const przes = [0]; if (mx > 180) przes.push(-360); if (mn < -180) przes.push(360);
      for (const d of przes) for (const r of rings) {
        r.forEach(([x, y], i) => {
          const px = prX(x + d), py = prY(y);
          if (i) g.path.lineTo(px, py); else g.path.moveTo(px, py);
          if (x + d >= -180 && x + d <= 180) { g.bb[0] = Math.min(g.bb[0], px); g.bb[1] = Math.min(g.bb[1], py); g.bb[2] = Math.max(g.bb[2], px); g.bb[3] = Math.max(g.bb[3], py); }
        });
        g.path.closePath();
      }
    }
  }
  geo = Object.values(byC);
  // lista małych krajów: znaczniki
  for (const g of geo) { const k = PO_KODZIE[g.c]; g.maly = !k.t && (g.bb[2] - g.bb[0]) * (g.bb[3] - g.bb[1]) < 0.0009; }
  brudne = true;
}

// ---------- rysowanie ----------
function kolorKraju(g) {
  const k = PO_KODZIE[g.c];
  if (wybrany === g.c) return '#f0c27a';
  if (tryb === 'wynik' && stan.odp.length && stan.odp[stan.odp.length - 1].kraj === g.c) { const q = Math.min(1, (performance.now() - (wynikT0 || 0)) / 500); if (q < 1) brudne = true; return lerpKol('#efe2c2', KOL[stan.odp[stan.odp.length - 1].poziom], .55 * q); }
  if (podglad) {
    const p = podglad.kody[g.c], dt = performance.now() - (podglad.t0 || 0);
    if (p) { const q = Math.min(1, Math.max(0, (dt - (5 - p) * 220) / 300)); if (q < 1) brudne = true; return q >= 1 ? KOL[p] : lerpKol('#efe2c2', KOL[p], q); }
    if (podglad.ty === g.c) return KOL[0];
    return k.t ? '#e2d3ae' : '#efe2c2';
  }
  if (najechany === g.c && !k.t) return '#f5dca6';
  return k.t ? '#e2d3ae' : '#efe2c2';
}
function lerpKol(a, b, q) { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), f = (s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * q); return `rgb(${f(16)},${f(8)},${f(0)})`; }
function mieszaj(hex, a) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return `rgb(${Math.round(255 - (255 - r) * a)},${Math.round(255 - (255 - g) * a)},${Math.round(255 - (255 - b) * a)})`; }

function rysuj(szybko) {
  const t = performance.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = MORZE; ctx.fillRect(0, 0, cw, ch);
  if (fale) { ctx.save(); ctx.translate(V.tx % 64, V.ty % 48); ctx.fillStyle = fale; ctx.fillRect(-64, -48, cw + 128, ch + 96); ctx.restore(); }
  // siatka geograficzna
  ctx.strokeStyle = '#5f859066'; ctx.lineWidth = .8; ctx.setLineDash([4, 4]); ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) { const [x] = naEkran(lon, 0); ctx.moveTo(x, naEkran(0, 84)[1]); ctx.lineTo(x, naEkran(0, -57)[1]); }
  for (let lat = -45; lat <= 75; lat += 15) { const [, y] = naEkran(0, lat); ctx.moveTo(naEkran(-180, 0)[0], y); ctx.lineTo(naEkran(180, 0)[0], y); }
  ctx.stroke(); ctx.setLineDash([]);
  // kraje
  ctx.setTransform(dpr * V.k, 0, 0, dpr * V.k, dpr * V.tx, dpr * V.ty);
  ctx.lineJoin = 'round';
  const [vx0, vy0] = naProj(0, 0), [vx1, vy1] = naProj(cw, ch);
  for (const g of geo) g.ukryty = g.bb[2] < vx0 || g.bb[0] > vx1 || g.bb[3] < vy0 || g.bb[1] > vy1;
  // płycizna przy brzegach
  for (const [w, kol] of szybko ? [[6, '#bcd3d2']] : [[22, '#7f9fa6'], [20.6, MORZE], [14, '#7f9fa6'], [12.6, MORZE], [6, '#bcd3d2']]) { ctx.strokeStyle = kol; ctx.lineWidth = w / V.k; for (const g of geo) if (!g.ukryty) ctx.stroke(g.path); }
  // cień lądu
  if (!szybko) { ctx.save(); ctx.translate(1.5 / V.k, 2.5 / V.k); ctx.fillStyle = '#5a462a40'; for (const g of geo) if (!g.ukryty) ctx.fill(g.path); ctx.restore(); }
  for (const g of geo) if (!g.ukryty) { ctx.fillStyle = kolorKraju(g); ctx.fill(g.path); }
  ctx.strokeStyle = '#7a6142'; ctx.lineWidth = 1 / V.k;
  for (const g of geo) if (!g.ukryty) ctx.stroke(g.path);
  // obrys wybranego / najechanego
  const obrys = (c, kol, w) => { const g = geo.find(g => g.c === c); if (g) { ctx.strokeStyle = kol; ctx.lineWidth = w / V.k; ctx.stroke(g.path); } };
  if (najechany && najechany !== wybrany && !PO_KODZIE[najechany].t) obrys(najechany, '#a8742a', 1.8);
  if (wybrany) obrys(wybrany, '#8a3b1c', 2.4);
  if (tryb === 'wynik' && stan.odp.length && stan.odp[stan.odp.length - 1].kraj) { const o = stan.odp[stan.odp.length - 1]; ctx.globalAlpha = .35; obrys(o.kraj, KOL[o.poziom], 9); ctx.globalAlpha = 1; obrys(o.kraj, KOL[o.poziom], 2.6); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // podpisy dużych krajów przy zbliżeniu
  if (!szybko) podpisy();
  // znaczniki małych krajów
  for (const g of geo) if (g.maly) {
    const k = PO_KODZIE[g.c], [x, y] = naEkran(k.a[0], k.a[1]); if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
    const szer = (g.bb[2] - g.bb[0]) * V.k; if (szer > 14) continue;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 7);
    ctx.fillStyle = kolorKraju(g); ctx.fill();
    ctx.lineWidth = wybrany === g.c ? 2.5 : 1.5; ctx.strokeStyle = wybrany === g.c ? '#8a3b1c' : (najechany === g.c ? '#a8742a' : '#7a6142'); ctx.stroke();
  }
  // radar
  if (radar && tryb === 'pytanie') {
    const [x1, y1] = naEkran(radar.lon - radar.w / 2, radar.lat + radar.h / 2), [x2, y2] = naEkran(radar.lon + radar.w / 2, radar.lat - radar.h / 2);
    ctx.fillStyle = '#2e6f9e18'; ctx.strokeStyle = '#2e6f9e'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t / 40;
    zaokr(x1, y1, x2 - x1, y2 - y1, 14); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#2e6f9e'; ctx.font = '600 11px "IBM Plex Mono"'; ctx.fillText('RADAR: TU JEST COŚ RZADKIEGO', x1 + 10, y1 + 20);
  }
  // trasa
  const pk = trasaPunkty();
  if (tryb === 'koniec') { ctx.lineWidth = 2; ctx.strokeStyle = '#8a3b1ccc'; ctx.setLineDash([6, 5]);
    for (let i = 1; i < pk.length; i++) { const e = Math.min(1, Math.max(0, (t - koniecT0 - 350 - (i - 1) * 300) / 300)); if (e < 1) brudne = true; if (e > 0) luk(pk[i - 1], pk[i], e); }
    ctx.setLineDash([]); }
  let ruch = false;
  pk.forEach(p => { const [x, y] = naEkran(p.lon, p.lat); let dy = 0;
    if (p.t0 && t < p.t0) { brudne = true; return; }
    if (p.t0) { const q = Math.min(1, (t - p.t0) / 450); if (q < 1) ruch = true; dy = -60 * (1 - q) * (1 - q) + (q > .7 ? Math.sin((q - .7) / .3 * Math.PI) * -6 : 0); }
    if (p.t0 && dy) { ctx.beginPath(); ctx.ellipse(x, y, 6, 2.5, 0, 0, 7); ctx.fillStyle = '#16324f33'; ctx.fill(); }
    pinezka(x, y + dy, p.kol, p.n); });
  if (ruch) brudne = true;
  if (tryb === 'menu') rysujMenuLoty(t);
  if (tryb === 'wynik' && pk.length && t - wynikT0 < 1100) {
    const [x, y] = naEkran(pk[0].lon, pk[0].lat);
    for (const op of [0, 250]) { const q = Math.max(0, Math.min(1, (t - wynikT0 - op) / 800)); if (q <= 0 || q >= 1) continue;
      ctx.beginPath(); ctx.arc(x, y, 8 + q * 60, 0, 7); ctx.lineWidth = 2.5 * (1 - q); ctx.strokeStyle = pk[0].kol; ctx.globalAlpha = 1 - q; ctx.stroke(); ctx.globalAlpha = 1; }
    brudne = true;
  }
}
function zaokr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function podpisy() {
  if (V.k < kFit() * 1.6) return;
  ctx.font = '500 10px "IBM Plex Mono"'; ctx.letterSpacing = '1.5px'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const g of geo) {
    if (g.ukryty) continue; const k = PO_KODZIE[g.c]; if (k.t) continue;
    const sz = (g.bb[2] - g.bb[0]) * V.k; const tw = ctx.measureText(k.n.toUpperCase()).width; if (sz < tw + 16) continue;
    const [x, y] = naEkran(k.a[0], k.a[1]);
    const tx = k.n.toUpperCase(); ctx.lineWidth = 3; ctx.strokeStyle = '#efe2c2cc'; ctx.strokeText(tx, x, y); ctx.fillStyle = '#6d5636'; ctx.fillText(tx, x, y);
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
}
function ctrl(a, b) {
  const [x1, y1] = naEkran(a.lon, a.lat), [x2, y2] = naEkran(b.lon, b.lat);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d; if (ny > 0) { nx = -nx; ny = -ny; } // łuk zawsze ku górze
  return [x1, y1, mx + nx * d * .22, my + ny * d * .22, x2, y2];
}
function luk(a, b, e) {
  const [x1, y1, cx, cy, x2, y2] = ctrl(a, b); ctx.beginPath(); ctx.moveTo(x1, y1);
  if (e >= 1) { ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke(); return; }
  const N = 40; for (let i = 1; i <= N * e; i++) { const s = i / N; ctx.lineTo((1 - s) ** 2 * x1 + 2 * (1 - s) * s * cx + s * s * x2, (1 - s) ** 2 * y1 + 2 * (1 - s) * s * cy + s * s * y2); }
  ctx.stroke();
}
function punktLuku(a, b, s) {
  const [x1, y1, cx, cy, x2, y2] = ctrl(a, b);
  const x = (1 - s) ** 2 * x1 + 2 * (1 - s) * s * cx + s * s * x2, y = (1 - s) ** 2 * y1 + 2 * (1 - s) * s * cy + s * s * y2;
  const dx = 2 * (1 - s) * (cx - x1) + 2 * s * (x2 - cx), dy = 2 * (1 - s) * (cy - y1) + 2 * s * (y2 - cy);
  return [x, y, Math.atan2(dy, dx)];
}
const SAMOLOT = new Path2D('M12 0 L5 -2 L0 -10 L-2 -10 L1 -2 L-6 -1.5 L-8 -4 L-10 -4 L-8.5 0 L-10 4 L-8 4 L-6 1.5 L1 2 L-2 10 L0 10 L5 2 Z');
function samolot(x, y, kat) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(kat); ctx.scale(1.4, 1.4);
  ctx.shadowColor = '#16324f55'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#3b2a1a'; ctx.fill(SAMOLOT); ctx.shadowColor = '#0000';
  ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke(SAMOLOT); ctx.restore();
}
function pinezka(x, y, kol, n) {
  ctx.save(); ctx.translate(x, y);
  ctx.shadowColor = '#16324f55'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-3, -8, -10, -12, -10, -20); ctx.arc(0, -20, 10, Math.PI, 0); ctx.bezierCurveTo(10, -12, 3, -8, 0, 0);
  ctx.fillStyle = kol; ctx.fill(); ctx.shadowColor = '#0000'; ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '600 11px "IBM Plex Mono"'; ctx.textAlign = 'center'; ctx.fillText(n, 0, -16);
  ctx.restore();
}
function baza(x, y) { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#16324f'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
function pinOf(o) { const k = PO_KODZIE[o.kraj]; return o.pin || (k ? { lon: k.a[0], lat: k.a[1] } : null); }
function trasaPunkty() {
  if (!stan) return [];
  if (tryb === 'koniec') return stan.odp.map((o, i) => pinOf(o) && ({ ...pinOf(o), kol: KOL[o.poziom], n: i + 1, t0: koniecT0 + i * 300 })).filter(Boolean);
  if (tryb === 'wynik' && stan.odp.length && pinOf(stan.odp[stan.odp.length - 1])) { const o = stan.odp[stan.odp.length - 1]; return [{ ...pinOf(o), kol: KOL[o.poziom], n: stan.odp.length }]; }
  if ((tryb === 'pytanie' || tryb === 'odslona') && wybrany && pin) return [{ ...pin, kol: '#c0392b', n: stan.i + 1 }];
  return [];
}
function zoomKraj(c) {
  const g = geo.find(g => g.c === c); if (!g) return;
  const w = g.bb[2] - g.bb[0], h = g.bb[3] - g.bb[1];
  V.k = Math.max(kFit(), Math.min(cw / (w * 1.7 + .06), ch / (h * 2 + .06), kFit() * 14)); ogranicz();
  V.tx = cw / 2 - (g.bb[0] + g.bb[2]) / 2 * V.k; V.ty = ch / 2 - (g.bb[1] + g.bb[3]) / 2 * V.k; ogranicz(); odswiez();
}
const odwrocY = py => 2.5 * (Math.atan(Math.exp(-0.8 * py)) - Math.PI / 4) / RAD;
let bylSzybki = false, klatka = 0;
// tło menu: mapa powoli dryfuje, a samoloty latają między krajami
const menuLoty = []; let menuNast = 0;
const DUZE = KRAJE.filter(k => !k.t && k.s > 250);
function krokMenu(t) {
  if (tryb !== 'menu') return;
  const k0 = kFit() * (cw < 600 ? 2.2 : 1.35);
  V.k = k0; const cx = prX(20 + 75 * Math.sin(t / 26000)), cy = prY(25 + 12 * Math.sin(t / 17000));
  V.tx = cw / 2 - cx * V.k; V.ty = ch / 2 - cy * V.k; ogranicz();
  if (t > menuNast) {
    const a = DUZE[Math.floor(Math.random() * DUZE.length)]; let b; do { b = DUZE[Math.floor(Math.random() * DUZE.length)]; } while (b === a);
    menuLoty.push({ a: { lon: a.a[0], lat: a.a[1] }, b: { lon: b.a[0], lat: b.a[1] }, t0: t, kol: KOL[1 + Math.floor(Math.random() * 5)] });
    menuNast = t + 1600 + Math.random() * 1200; while (menuLoty.length > 4) menuLoty.shift();
  }
  brudne = true;
}
function rysujMenuLoty(t) {
  for (const L of menuLoty) {
    const p = Math.min(1, (t - L.t0) / 2600), e = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, zanik = Math.max(0, Math.min(1, 1 - (t - L.t0 - 4500) / 1500));
    if (zanik <= 0) continue;
    ctx.globalAlpha = zanik; ctx.lineWidth = 2; ctx.strokeStyle = '#8a3b1ccc'; ctx.setLineDash([6, 5]); luk(L.a, L.b, e); ctx.setLineDash([]);
    const [ax, ay] = naEkran(L.a.lon, L.a.lat); ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7); ctx.fillStyle = '#3b2a1a'; ctx.fill();
    if (p < 1) { const [x, y, kat] = punktLuku(L.a, L.b, e); samolot(x, y, kat); }
    else { const [x, y] = naEkran(L.b.lon, L.b.lat), q = Math.min(1, (t - L.t0 - 2600) / 400), dy = -40 * (1 - q) * (1 - q); pinezka(x, y + dy, L.kol, '✓'); }
    ctx.globalAlpha = 1;
  }
}
function petla(t) { krokMenu(t); krokKamery(t); const szb = !!kamera || t < ruchDo; if (tryb === 'menu' && (klatka++ & 1)) { requestAnimationFrame(petla); return; } if (bylSzybki && !szb) brudne = true; bylSzybki = szb; if (brudne || radar) { brudne = false; rysuj(szb); } requestAnimationFrame(petla); }
const odswiez = () => { brudne = true; };

// ---------- mysz / dotyk ----------
const wsk = new Map(); let ciag = null, pinch = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); wsk.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); kamera = null;
  if (wsk.size === 1) ciag = { x: e.offsetX, y: e.offsetY, tx: V.tx, ty: V.ty, ruch: 0 };
  if (wsk.size === 2) { const [a, b] = [...wsk.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: V.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; ciag = null; }
});
cv.addEventListener('pointermove', e => {
  if (wsk.has(e.pointerId)) wsk.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && wsk.size === 2) { ruszam(); const [a, b] = [...wsk.values()]; zoomW(pinch.cx, pinch.cy, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(20, pinch.d) / V.k); return; }
  if (ciag) {
    const dx = e.offsetX - ciag.x, dy = e.offsetY - ciag.y; ciag.ruch = Math.max(ciag.ruch, Math.abs(dx) + Math.abs(dy));
    if (ciag.ruch > 5) { ruszam(); V.tx = ciag.tx + dx; V.ty = ciag.ty + dy; ogranicz(); odswiez(); cv.style.cursor = 'grabbing'; }
  }
  if (e.pointerType === 'mouse' && !ciag) najedz(e.offsetX, e.offsetY);
});
cv.addEventListener('pointerup', e => {
  const klikniecie = ciag && ciag.ruch <= 5 && wsk.size === 1;
  wsk.delete(e.pointerId); if (wsk.size < 2) pinch = null; cv.style.cursor = '';
  if (klikniecie) klik(e.offsetX, e.offsetY);
  if (!wsk.size) ciag = null;
});
cv.addEventListener('pointercancel', e => { wsk.delete(e.pointerId); ciag = null; pinch = null; });
cv.addEventListener('pointerleave', () => { najechany = null; $('#dymek').hidden = true; odswiez(); });
function zoomW(x, y, f) {
  const [px, py] = naProj(x, y); V.k *= f; ogranicz(); V.tx = x - px * V.k; V.ty = y - py * V.k; ogranicz(); odswiez();
}
cv.addEventListener('wheel', e => {
  e.preventDefault(); kamera = null; ruszam();
  const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // linie → piksele
  zoomW(e.offsetX, e.offsetY, Math.exp(-d * (e.ctrlKey ? 0.012 : 0.004)));
}, { passive: false });
cv.addEventListener('dblclick', e => { if (tryb === 'menu') return; plynnie(() => zoomW(e.offsetX, e.offsetY, 2.2), 350); });
$('#zIn').onclick = () => plynnie(() => zoomW(cw / 2, ch / 2, 2), 350); $('#zOut').onclick = () => plynnie(() => zoomW(cw / 2, ch / 2, 1 / 2), 350); $('#zFit').onclick = () => plynnie(dopasuj);

const tester = document.createElement('canvas').getContext('2d');
function krajWPunkcie(x, y) {
  const [px, py] = naProj(x, y);
  for (const g of geo) if (!g.ukryty && px >= g.bb[0] && px <= g.bb[2] && py >= g.bb[1] && py <= g.bb[3] && tester.isPointInPath(g.path, px, py)) return g.c;
  return null;
}
function trafienie(x, y) {
  for (const g of geo) if (g.maly) { const k = PO_KODZIE[g.c], [sx, sy] = naEkran(k.a[0], k.a[1]); if (Math.hypot(sx - x, sy - y) < 10 && (g.bb[2] - g.bb[0]) * V.k <= 14) return g.c; }
  let c = krajWPunkcie(x, y); if (c) return c;
  for (const r of [4, 8]) for (let a = 0; a < 8; a++) { c = krajWPunkcie(x + r * Math.cos(a * Math.PI / 4), y + r * Math.sin(a * Math.PI / 4)); if (c) return c; }
  return null;
}
function najedz(x, y) {
  const c = trafienie(x, y), d = $('#dymek');
  if (c !== najechany) { najechany = c; odswiez(); }
  if (c) { const k = PO_KODZIE[c]; d.hidden = false; d.textContent = k.n + (k.t ? ' · terytorium' : ''); d.style.left = x + 'px'; d.style.top = y + 'px'; }
  else d.hidden = true;
}
function klik(x, y) {
  const c = trafienie(x, y);
  if (tryb === 'koniec') { if (podglad && c) pokazKrajWPodgladzie(c); return; }
  if (tryb !== 'pytanie' || !c) return;
  if (PO_KODZIE[c].t) { podpowiedz(PO_KODZIE[c].n + ' to terytorium zależne, a nie państwo.'); return; }
  const g = geo.find(g => g.c === c), [px, py] = naProj(x, y);
  wybierz(c, g && g.maly && (g.bb[2] - g.bb[0]) * V.k <= 14 ? null : { lon: px / RAD, lat: odwrocY(py) });
}
function wybierz(c, p) { const k = PO_KODZIE[c]; wybrany = c; pin = p || { lon: k.a[0], lat: k.a[1] }; pin.t0 = performance.now(); dzwiek('wyb'); odswiez(); rysujPanel(); }
let infoT = null;
function podpowiedz(t) { const e = $('#wskaz'); if (!e) return; e.innerHTML = `<span style="color:#e5534b">${esc(t)}</span>`; clearTimeout(infoT); infoT = setTimeout(() => tryb === 'pytanie' && rysujPanel(), 2500); }

$('#krajeLista').innerHTML = PANSTWA.slice().sort((a, b) => a.n.localeCompare(b.n, 'pl')).map(k => `<option value="${esc(k.n)}">`).join('');
$('#szukaj').addEventListener('change', e => {
  const k = PANSTWA.find(k => k.n.toLowerCase() === e.target.value.trim().toLowerCase()); if (!k) return;
  const g = geo.find(g => g.c === k.c), roz = g ? Math.max(g.bb[2] - g.bb[0], g.bb[3] - g.bb[1]) : .1;
  plynnie(() => wysrodkuj(k.a[0], k.a[1], Math.max(V.k, Math.min(cw, ch) / Math.max(roz * 3, .35))));
  if (tryb === 'pytanie') wybierz(k.c); else if (tryb === 'koniec') pokazKrajWPodgladzie(k.c);
  e.target.value = ''; e.target.blur();
});
document.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') zamknijOkno(); return; }
  if (!$('#okno').hidden && e.key !== 'Escape') return;
  if ((e.key === 'Enter' || e.key === ' ') && tryb === 'pytanie' && wybrany) { e.preventDefault(); laduj(); }
  else if ((e.key === 'Enter' || e.key === ' ') && tryb === 'wynik') { e.preventDefault(); $('#bDalej') && $('#bDalej').click(); }
  else if (e.key === 'Escape') zamknijOkno();
});

// ---------- dźwięk ----------
let ac = null;
function ton(f, t0, dl, typ = 'sine', g = .08) {
  const o = ac.createOscillator(), v = ac.createGain(); o.type = typ; o.frequency.value = f;
  v.gain.setValueAtTime(.0001, ac.currentTime + t0); v.gain.exponentialRampToValueAtTime(g, ac.currentTime + t0 + .02); v.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + t0 + dl);
  o.connect(v).connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dl + .05);
}
function dzwiek(r, poz) {
  if (!ust.dzwiek) return;
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  if (r === 'wyb') ton(880, 0, .08, 'sine', .05);
  if (r === 'tik') ton(1500, 0, .025, 'square', .015);
  if (r === 'ding') { ton(660, 0, .5); ton(880, .18, .6); } // gong lotniskowy
  if (r === 'ok') { const n = [523, 659, 784, 988, 1175]; for (let i = 0; i < poz; i++) ton(n[i], i * .09, .25, 'triangle'); }
  if (r === 'pudlo') { ton(220, 0, .25, 'triangle'); ton(165, .18, .35, 'triangle'); }
}
$('#bDzwiek').onclick = () => { ust.dzwiek = !ust.dzwiek; store.set('pz-ust', ust); $('#bDzwiek').classList.toggle('wyl', !ust.dzwiek); };
$('#bDzwiek').classList.toggle('wyl', !ust.dzwiek);

// ---------- API ----------
async function api(url, dane) {
  const r = await fetch(url, dane ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane) } : {});
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).blad || m; } catch {} throw new Error(m); } return r.json();
}

// ---------- gra ----------
const klucz = nr => 'pz-lot-' + nr;
const nowyStan = () => ({ odp: [], i: 0, paliwo: 1, radar: [], koniec: false, druga: false, drugaAktywna: -1 });
const suma = () => stan.odp.reduce((s, o) => s + o.pkt, 0);
const zapisz = () => store.set(klucz(dzien.nr), stan);
const nrLotu = () => 'PZ ' + String(dzien.nr).padStart(3, '0');
function animujMile(od, doo) {
  const t0 = performance.now(), krok = t => { const p = Math.min(1, (t - t0) / 700); $('#mile').textContent = Math.round(od + (doo - od) * p); if (p < 1) requestAnimationFrame(krok); };
  requestAnimationFrame(krok);
}

let dzis = null;
if (/[?&]reset\b/.test(location.search)) { try { Object.keys(localStorage).filter(k => k.startsWith('pz-')).forEach(k => localStorage.removeItem(k)); } catch {} history.replaceState(null, '', location.pathname); }
async function start() {
  rozmiar(); dopasuj(); requestAnimationFrame(petla);
  try { [dzis] = await Promise.all([api('/api/dzien'), wczytajMape()]); }
  catch { $('#menu').innerHTML = '<div class="menu-karta"><h1>Brak połączenia</h1><p>Nie udało się połączyć z wieżą kontroli lotów. Odśwież stronę.</p></div>'; return; }
  pokazMenu();
}
const wynikLotu = nr => { const s = store.get(klucz(nr), null); return s && s.koniec ? s.odp.reduce((a, o) => a + o.pkt, 0) : null; };
const dataPL = (d, opc = { day: 'numeric', month: 'long' }) => new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', opc);
const IK = {
  arch: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg>',
  pasz: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="12" cy="10" r="3.2"/><path d="M8.8 10h6.4M12 6.8c1.3 1 1.3 5.4 0 6.4M12 6.8c-1.3 1-1.3 5.4 0 6.4M9 17h6"/></svg>',
  stat: '<svg viewBox="0 0 24 24"><path d="M4 20h16M7 20v-6M12 20V7M17 20v-10"/></svg>',
  jak: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.6v.4"/></svg>',
  sam: '<svg viewBox="-12 -12 24 24"><path d="M12 0 L5 -2 L0 -10 L-2 -10 L1 -2 L-6 -1.5 L-8 -4 L-10 -4 L-8.5 0 L-10 4 L-8 4 L-6 1.5 L1 2 L-2 10 L0 10 L5 2 Z"/></svg>'
};
let kDnia = null, menuInt = null;
const dataNr = nr => new Date(Date.parse(dzis.data) - (dzis.nr - nr) * 864e5).toISOString().slice(0, 10);
function kolorySt(st) { return st && st.odp ? st.odp.map(o => `<i style="background:${KOL[o.poziom]}"></i>`).join('') : ''; }
function pokazMenu() {
  tryb = 'menu'; podglad = null; wybrany = null; pin = null; stan = null; $('#wynikMapa').hidden = true; stopZegar(true);
  document.body.classList.add('w-menu'); rozmiar(); dopasuj();
  if (kDnia === null) kDnia = Date.now() + dzis.doNastepnego;
  const w = wynikLotu(dzis.nr), s = store.get('pz-seria', { n: 0, ost: 0 }), seria = s.ost >= dzis.nr - 1 ? s.n : 0, wTrakcie = store.get(klucz(dzis.nr), null);
  $('#lotInfo').textContent = ''; $('#mile').textContent = w ?? 0;
  const tytul = 'PINEZKA'.split('').map((l, i) => `<span style="--i:${i}">${l}</span>`).join('');
  // ostatnie 7 dni jako pieczątki
  let tydz = '';
  for (let nr = dzis.nr - 6; nr <= dzis.nr; nr++) {
    const d = new Date(Date.parse(dzis.data) - (dzis.nr - nr) * 864e5), dzn = d.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '');
    const wl = nr >= 1 ? wynikLotu(nr) : null, st = nr >= 1 ? store.get(klucz(nr), null) : null;
    tydz += `<div class="tdz ${nr < 1 ? 'brak' : wl !== null ? 'ok' : st ? 'pol' : ''} ${nr === dzis.nr ? 'dzis' : ''}" style="--i:${nr - dzis.nr + 6}"><small>${dzn}</small><b>${nr < 1 ? '·' : wl !== null ? wl : nr === dzis.nr ? '?' : '–'}</b></div>`;
  }
  const status = w !== null ? 'WYLĄDOWAŁ' : wTrakcie ? 'W POWIETRZU' : 'BOARDING';
  $('#menu').innerHTML = `<div class="menu-karta">
    <div class="menu-glowna">
      <div class="menu-nag"><span>LOT PZ ${String(dzis.nr).padStart(3, '0')}</span><span>${dataPL(dzis.data, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <h1 aria-label="Pinezka">${tytul}</h1>
      <div class="menu-tor"><span class="tor-lin"></span><span class="tor-sam">${IK.sam}</span></div>
      <div class="menu-pod">codzienny lot dookoła świata</div>
      <div class="tablo"><div><small>ODLOT</small><b>00:00</b></div><div><small>BRAMKA</small><b>${N}</b></div><div><small>KLASA</small><b>PZ</b></div><div class="st"><small>STATUS</small><b id="tabloSt" data-t="${status}">${status}</b></div></div>
      <button class="btn glowny duzy" id="mGraj"><span>${w === null ? (wTrakcie ? 'Kontynuuj lot' : 'Wejdź na pokład') : 'Twój wynik · ' + w + ' mil'}</span> <span class="lec">✈</span></button>
      <div class="menu-sieg">${N} pytań · ${CZAS} s na każde · im rzadsza odpowiedź, tym dalej</div>
    </div>
    <div class="menu-odcinek">
      <div class="stempel"><svg viewBox="0 0 120 120"><defs><path id="kr" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0"/></defs><circle cx="60" cy="60" r="54" /><circle cx="60" cy="60" r="34"/><text><textPath href="#kr" textLength="272" lengthAdjust="spacingAndGlyphs">PAR AVION · PINEZKA · PAR AVION · PINEZKA ·</textPath></text></svg>
        <div class="st-in"><small>${dataPL(dzis.data, { month: 'short' }).replace('.', '').toUpperCase()}</small><b>${new Date(dzis.data + 'T12:00:00').getDate()}</b><small>PZ ${String(dzis.nr).padStart(3, '0')}</small></div></div>
      <div class="seria"><b>${seria}</b><span>${seria === 1 ? 'dzień' : 'dni'} z rzędu</span></div>
      <div class="tydzien">${tydz}</div>
      <div class="nast">następny lot za <b id="menuOdl">--:--:--</b></div>
    </div>
    <div class="menu-przyc">
      <button id="mArch" style="--i:0">${IK.arch}<span>Archiwum</span></button><button id="mPasz" style="--i:1">${IK.pasz}<span>Paszport</span></button><button id="mStat" style="--i:2">${IK.stat}<span>Statystyki</span></button><button id="mJak" style="--i:3">${IK.jak}<span>Jak grać</span></button>
    </div>
  </div>`;
  $('#menu').querySelector('.menu-karta').insertAdjacentHTML('beforeend', `<div class="menu-stopka"><button id="mBlad">Zgłoś błąd</button><a href="/regulamin">Regulamin</a><a href="/prywatnosc">Prywatność</a><span>Granice: Natural Earth</span></div>`);
  $('#mBlad').onclick = () => zglosForm({ typ: 'blad', gdzie: 'menu' });
  $('#mGraj').onclick = () => wejdz(dzis.nr); $('#mArch').onclick = archiwum; $('#mPasz').onclick = paszport; $('#mStat').onclick = statystyki; $('#mJak').onclick = jakGrac;
  $('#menu').hidden = false;
  clearInterval(menuInt);
  const odl = () => { const e = $('#menuOdl'); if (!e || tryb !== 'menu') return clearInterval(menuInt); const ms = Math.max(0, kDnia - Date.now()), h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, sek = Math.floor(ms / 1000) % 60;
    e.textContent = [h, m, sek].map(x => String(x).padStart(2, '0')).join(':'); };
  odl(); menuInt = setInterval(odl, 1000);
  klapkiTekst($('#tabloSt'), status, 700);
  if (!store.get('pz-byl', false)) { setTimeout(jakGrac, 900); store.set('pz-byl', true); }
}
// litery przeskakują jak na tablicy odlotów
function klapkiTekst(el, cel, od = 0) {
  if (!el) return; const Z = 'ABCDEFGHIJKLMNOPRSTUWYZĄĘŁ0123456789', n = cel.length; let k = 0;
  el.textContent = cel.replace(/\S/g, '·');
  const t0 = performance.now() + od, czas = n * 70 + 300;
  const t = setInterval(() => { const q = (performance.now() - t0) / czas; if (q < 0) return; if (q >= 1 || !el.isConnected) { clearInterval(t); el.textContent = cel; return; }
    el.textContent = cel.split('').map((c, i) => c === ' ' ? ' ' : i < q * n ? c : Z[Math.floor(Math.random() * Z.length)]).join(''); }, 45);
}
async function wejdz(nr) {
  zamknijOkno();
  try { dzien = nr === dzis.nr ? dzis : await api('/api/dzien?nr=' + nr); } catch { return; }
  document.body.classList.remove('w-menu'); $('#menu').hidden = true; rozmiar(); dopasuj();
  $('#lotInfo').textContent = `LOT ${nrLotu()} · ` + dataPL(dzien.data) + (nr !== dzis.nr ? ' · ARCHIWUM' : '');
  stan = Object.assign(nowyStan(), store.get(klucz(dzien.nr), {}));
  $('#mile').textContent = suma();
  if (stan.koniec) return pokazKoniec();
  tryb = stan.i < stan.odp.length ? 'wynik' : 'pytanie';
  if (tryb === 'wynik' && stan.odp[stan.odp.length - 1].kraj) zoomKraj(stan.odp[stan.odp.length - 1].kraj);
  if (tryb === 'pytanie' && !stan.odp.length) dzwiek('ding');
  rysujPanel();
}
function naglowek(ik, t, pod) { return `<div class="ok-nag"><span class="ok-ik">${ik}</span><div><h2>${t}</h2>${pod ? `<p>${pod}</p>` : ''}</div></div>`; }
function archiwum() {
  let h = '';
  for (let nr = dzis.nr; nr >= 1; nr--) {
    const d = dataNr(nr), w = wynikLotu(nr), s = store.get(klucz(nr), null), dz = new Date(d + 'T12:00:00');
    const stat = w !== null ? 'ok' : s ? 'pol' : 'nie';
    h += `<button class="arch ${stat} ${nr === dzis.nr ? 'dzis' : ''}" data-nr="${nr}" style="--i:${dzis.nr - nr}">
      <div class="a-l"><small>${dz.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '').toUpperCase()}</small><b>${dz.getDate()}</b><small>${dz.toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '').toUpperCase()}</small></div>
      <div class="a-p"><b>LOT PZ ${String(nr).padStart(3, '0')}</b>${nr === dzis.nr ? '<span class="a-dzis">DZIŚ</span>' : ''}
        <div class="a-kol">${s ? kolorySt(s) + '<i class="pusty"></i>'.repeat(Math.max(0, N - s.odp.length)) : '<i class="pusty"></i>'.repeat(N)}</div></div>
      <div class="a-w">${w !== null ? `<b>${w}</b><small>mil</small>` : s ? `<em>w trakcie<br>${s.odp.length}/${N}</em>` : `<em>leć ✈</em>`}</div>
      ${w !== null ? `<span class="a-piecz">WYLĄDOWAŁ</span>` : ''}</button>`;
  }
  okno(naglowek(IK.arch, 'Archiwum lotów', 'Każdy wcześniejszy lot możesz przelecieć. Archiwalne loty nie liczą się do serii.') + `<div class="archiwum">${h}</div>`, 'szer');
  document.querySelectorAll('.arch').forEach(b => b.onclick = () => wejdz(+b.dataset.nr));
}
function licz(root) {
  root.querySelectorAll('[data-licz]').forEach((e, j) => {
    const cel = +e.dataset.licz, t0 = performance.now() + j * 90;
    const k = t => { const q = Math.max(0, Math.min(1, (t - t0) / 900)); e.textContent = Math.round(cel * (1 - (1 - q) ** 3)); if (q < 1) requestAnimationFrame(k); };
    e.textContent = 0; requestAnimationFrame(k);
  });
}
function statystyki() {
  const loty = []; for (let nr = 1; nr <= dzis.nr; nr++) { const s = store.get(klucz(nr), null); if (s && s.koniec) loty.push({ nr, s }); }
  const sumy = loty.map(l => l.s.odp.reduce((a, o) => a + o.pkt, 0)), poz = [0, 0, 0, 0, 0, 0];
  loty.forEach(l => l.s.odp.forEach(o => poz[o.poziom]++)); const maxP = Math.max(1, ...poz);
  const sr = store.get('pz-seria', { n: 0, max: 0, ost: 0 }), ost = loty.slice(-10), maxS = Math.max(MAKS / 2, ...sumy);
  const kafel = (v, t) => `<div><b data-licz="${v}">${v}</b>${t}</div>`;
  okno(naglowek(IK.stat, 'Statystyki', 'Dziennik pokładowy wszystkich Twoich lotów.') + `<div class="statyst duze">${kafel(loty.length, 'lotów')}${kafel(loty.length ? Math.round(sumy.reduce((a, b) => a + b, 0) / loty.length) : 0, 'średnio mil')}${kafel(loty.length ? Math.max(...sumy) : 0, 'rekord')}
    ${kafel(sr.ost >= dzis.nr - 1 ? sr.n : 0, 'seria')}${kafel(sr.max || 0, 'najdłuższa seria')}${kafel(Object.keys(store.get('pz-paszport', {})).length, 'pieczątek')}</div>
    <h4 class="ok-h4">OSTATNIE LOTY</h4>
    <div class="wykres">${ost.length ? ost.map((l, i) => `<div class="kol" style="--i:${i}"><span style="--h:${Math.max(4, 100 * sumy[loty.length - ost.length + i] / maxS)}%"><em>${sumy[loty.length - ost.length + i]}</em></span><small>${l.nr}</small></div>`).join('') : '<div class="pusto">Tu pojawią się Twoje loty. Zagraj pierwszy!</div>'}</div>
    <h4 class="ok-h4">TWOJE PINEZKI</h4>
    ${[5, 4, 3, 2, 1, 0].map((p, i) => `<div class="slupek" style="--i:${i}"><span class="znacz z${p}">${POZ[p]}</span><i style="--w:${Math.max(2, 100 * poz[p] / maxP)}%;background:${KOL[p]}"></i><b data-licz="${poz[p]}">${poz[p]}</b></div>`).join('')}`);
  licz($('#oknoTresc'));
}
const IKONA_SAMOLOTU = '<svg width="20" height="20" viewBox="-12 -12 24 24"><path d="M12 0 L5 -2 L0 -10 L-2 -10 L1 -2 L-6 -1.5 L-8 -4 L-10 -4 L-8.5 0 L-10 4 L-8 4 L-6 1.5 L1 2 L-2 10 L0 10 L5 2 Z" fill="#3b2a1a"/></svg>';
function skad() { const ost = [...stan.odp].reverse().find(o => o.poziom); return ost ? PO_KODZIE[ost.kraj] : { a3: 'WAW', n: 'Warszawa' }; }
function kartaGora(prawa) { return `<div class="bp-gora"><span>KARTA POKŁADOWA</span><span>${prawa}</span></div>`; }
function trasaKarty(doK) {
  const z = skad();
  return `<div class="bp-trasa"><div class="m"><small>Z</small><b>${esc(z.a3)}</b><span>${esc(z.n)}</span></div>
    <div class="lin">${IKONA_SAMOLOTU}</div>
    <div class="m p"><small>DO</small>${doK ? `<b>${esc(doK.a3)}</b><span>${esc(doK.n)}</span>` : '<b class="puste">???</b><span>wybierz kraj</span>'}</div></div>`;
}
const N = 7, MAKS = N * 100;
function kartaMapy() {
  const el = $('#wynikMapa'); if (tryb !== 'wynik' || !stan.odp.length) { if (tryb !== 'odslona') el.hidden = true; return; }
  const o = stan.odp[stan.odp.length - 1];
  el.innerHTML = `<small>PINEZKA ${stan.odp.length} Z ${N}</small><b>${esc(nazwa(o.kraj))}</b><span class="znacz z${o.poziom}">${POZ[o.poziom]}</span> <span class="mi">${o.poziom ? '+' + o.pkt + ' mil' : '0 mil'}</span>${o.nowa ? '<i>NOWE MIEJSCE</i>' : ''}`;
  el.hidden = false;
}
// szlak lotu: samolot posuwa się z każdą milą przez kolejne strefy
const STREFY = ['Warszawa', 'Nad chmurami', 'Nad Alpami', 'Nad oceanem', 'Nad dżunglą', 'Nad pustynią', 'Za kołem polarnym', 'Kraniec świata'];
const SZ_PKT = [[34, 214], [240, 210], [306, 176], [50, 150], [40, 112], [296, 98], [300, 56], [60, 26]];
const SZ_SEG = SZ_PKT.slice(1).map((q, i) => { const p = SZ_PKT[i], mx = (p[0] + q[0]) / 2; return `M${p[0]} ${p[1]} C${mx} ${p[1]} ${mx} ${q[1]} ${q[0]} ${q[1]}`; });
const mileSzlaku = () => tryb === 'odslona' && stan.odp.length ? suma() - stan.odp[stan.odp.length - 1].pkt : suma();
function szlak() {
  const m = mileSzlaku();
  return `<div class="szlak"><h4>TRASA LOTU <span id="szlakMile">${m} / ${MAKS} mil</span></h4>
    <svg viewBox="0 0 340 232">${SZ_SEG.map(d => `<path d="${d}" fill="none" stroke="#bfa877" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>`).join('')}
    ${SZ_SEG.map(d => `<path class="szp" d="${d}" fill="none" stroke="#b03a2e" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 999"/>`).join('')}
    ${SZ_PKT.map((q, i) => { const lewo = q[0] > 170; return `<circle class="szk" cx="${q[0]}" cy="${q[1]}" r="5" fill="#f3e8cf" stroke="#3b2a1a" stroke-width="1.5"/><text x="${q[0] + (lewo ? -10 : 10)}" y="${q[1] + 4}" text-anchor="${lewo ? 'end' : 'start'}" font-size="10.5" font-family="IBM Plex Mono" fill="#8a7658" stroke="#f3e8cf" stroke-width="4" paint-order="stroke" class="szt">${STREFY[i]}</text>`; }).join('')}
    <g id="szlakSam"><path d="M12 0 L5 -2 L0 -10 L-2 -10 L1 -2 L-6 -1.5 L-8 -4 L-10 -4 L-8.5 0 L-10 4 L-8 4 L-6 1.5 L1 2 L-2 10 L0 10 L5 2 Z" fill="#3b2a1a" stroke="#f3e8cf" stroke-width="1"/></g></svg></div>`;
}
function rysujSzlak(od) {
  const segs = document.querySelectorAll('.szp'); if (!segs.length) return;
  const L = [...segs].map(p => p.getTotalLength()), kola = document.querySelectorAll('.szk'), teksty = document.querySelectorAll('.szt');
  const ustaw = m => {
    m = Math.max(0, Math.min(MAKS, m)); const si = Math.min(N - 1, Math.floor(m / 100)), f = m >= MAKS ? 1 : (m - si * 100) / 100;
    segs.forEach((p, i) => p.style.strokeDasharray = i < si ? `${L[i]} 999` : i === si ? `${L[i] * f} 999` : `0 999`);
    kola.forEach((c, i) => c.setAttribute('fill', m >= i * 100 && (i > 0 || true) && m >= i * 100 ? (i * 100 <= m ? '#b03a2e' : '#f3e8cf') : '#f3e8cf'));
    teksty.forEach((t, i) => t.setAttribute('fill', m >= i * 100 ? '#3b2a1a' : '#8a7658'));
    const p = segs[si], a = p.getPointAtLength(L[si] * f), b = p.getPointAtLength(Math.min(L[si], L[si] * f + 1)), c = p.getPointAtLength(Math.max(0, L[si] * f - 1));
    const kat = Math.atan2(b.y - c.y, b.x - c.x);
    document.getElementById('szlakSam').setAttribute('transform', `translate(${a.x} ${a.y}) rotate(${kat * 180 / Math.PI})`);
    const e = document.getElementById('szlakMile'); if (e) e.textContent = `${Math.round(m)} / ${MAKS} mil`;
  };
  const doo = mileSzlaku(); if (od === undefined || od === doo) return ustaw(doo);
  const t0 = performance.now(), krok = t => { const q = Math.min(1, (t - t0) / 1400), e = 1 - (1 - q) ** 3; ustaw(od + (doo - od) * e); if (q < 1) requestAnimationFrame(krok); };
  ustaw(od); requestAnimationFrame(krok);
}
function rysujPanel(odMil) {
  const pn = $('#panel'); kartaMapy();
  if (tryb === 'start') {
    pn.innerHTML = `<div class="bp">${kartaGora('LOT <b>' + nrLotu() + '</b>')}${trasaKarty(null)}<div class="perf"></div>
      <div class="start"><h2>Dzisiejszy lot</h2><p>${N} pytań, ${N} pinezek. Wbij pinezkę w kraj, który pasuje do pytania. Im rzadsza trafna odpowiedź, tym dalej polecisz.</p>
      <button class="btn glowny" id="bStart" style="width:100%">Wejdź na pokład ✈</button></div></div>${szlak()}${stopka()}`;
    $('#bStart').onclick = () => { tryb = 'pytanie'; dzwiek('ding'); rysujPanel(); };
    return rysujSzlak();
  }
  if (tryb === 'pytanie' || tryb === 'odslona') {
    const q = dzien.pytania[stan.i], k = wybrany ? PO_KODZIE[wybrany] : null;
    pn.innerHTML = `<div class="bp">${kartaGora(`PYTANIE <b>${stan.i + 1}/${N}</b>`)}
      <div class="bp-pyt"><small>PYTANIE ${stan.i + 1} Z ${N}</small><p>${esc(q.q)}</p>${q.u ? `<em>${esc(q.u)}</em>` : ''}</div>
      <div class="perf"></div>
      <div class="zegar" id="zegar"><span class="zs">⏱ <b id="zegarS">${CZAS}</b> s</span><span class="zp"><i id="zegarP"></i></span></div>
      <div class="wskaz" id="wskaz">${k ? 'Pinezka: <b>' + esc(k.n) + '</b>' : 'Kliknij na mapie, żeby wbić pinezkę.'}</div>
      <div class="akcje"><button class="btn glowny${k ? ' gotowy' : ''}" id="bLaduj" ${k && tryb === 'pytanie' ? '' : 'disabled'}>Wbij pinezkę</button></div></div>${szlak()}`;
    $('#bLaduj').onclick = laduj;
    if (tryb === 'pytanie') startZegar(); else stopZegar(true);
    return rysujSzlak();
  }
  if (tryb === 'wynik') {
    const o = stan.odp[stan.odp.length - 1], q = dzien.pytania[stan.odp.length - 1], k = PO_KODZIE[o.kraj] || { n: 'Nie zdążyłeś' }, trafil = o.poziom > 0;
    pn.innerHTML = `<div class="bp">${kartaGora(`PYTANIE <b>${stan.odp.length}/${N}</b>`)}
      <div class="wynik"><div class="uw">${esc(q.q)}</div>
      <div class="piecz k${o.poziom}">${trafil ? 'TRAFIONE' : o.kraj ? 'PUDŁO' : 'BRAK CZASU'}<span>${POZ[o.poziom]} · +${o.pkt}</span></div>
      <h3>${esc(k.n)}</h3>${!o.kraj ? '<div class="uw">Minęło ' + CZAS + ' sekund. Poprawne odpowiedzi zobaczysz na końcu lotu.</div>' : !trafil ? '<div class="uw">Ten kraj nie pasuje do pytania.</div>' : ''}</div>
      ${o.fakt ? `<div class="fakt"><b>CIEKAWOSTKA</b>${esc(o.fakt)}</div>` : ''}
      <div class="perf"></div>
      <button class="zglos" id="bZglosWyn">Zgłoś błąd w tym pytaniu</button>
      <div class="akcje"><button class="btn glowny" id="bDalej">${stan.odp.length >= N ? 'Zakończ lot' : 'Następne pytanie ›'}</button></div></div>${szlak()}`;
    $('#bZglosWyn').onclick = () => zglosForm({ typ: 'blad', nr: dzien.nr, i: stan.odp.length - 1, gdzie: 'wynik' });
    $('#bDalej').onclick = () => { stan.i = stan.odp.length; zapisz(); wybrany = null; plynnie(dopasuj); if (stan.odp.length >= N) zakoncz(); else { tryb = 'pytanie'; rysujPanel(); odswiez(); } };
    return rysujSzlak(odMil);
  }
}
const stopka = () => '<div class="stopka">Granice państw: Natural Earth. Nowy lot codziennie o północy.</div>';
// formularz zgłoszeń: błąd w grze/pytaniu albo brakujący kraj
function zglosForm(o) {
  const brak = o.typ === 'brak', q = o.nr && o.i != null && dzien && dzien.nr === o.nr ? dzien.pytania[o.i] : null;
  const pod = brak ? 'Napisz, jaki kraj powinien się liczyć i dlaczego. Sprawdzimy i dopiszemy go do odpowiedzi.' : 'Coś nie działa, odpowiedź jest błędna albo ciekawostka się nie zgadza? Daj znać.';
  okno(naglowek(IK.jak, brak ? 'Brakujący kraj' : 'Zgłoś błąd', pod) + `<form class="zg-form" id="zgForm">
    ${q ? `<div class="zg-q">PYTANIE: <b>${esc(q.q)}</b></div>` : ''}
    ${brak ? `<label>Kraj<input id="zgKraj" list="krajeLista" placeholder="Wpisz nazwę kraju" autocomplete="off"></label>` : ''}
    <label>${brak ? 'Dlaczego? (opcjonalnie źródło)' : 'Co się stało?'}<textarea id="zgTekst" maxlength="1000" rows="5" required placeholder="${brak ? 'Np. przez ten kraj też przepływa ta rzeka…' : 'Opisz krótko, co poszło nie tak…'}"></textarea></label>
    <div class="zg-dol"><small>Nie podawaj danych osobowych. Zgłoszenie jest anonimowe.</small><button class="btn glowny" type="submit">Wyślij ✉</button></div></form>`);
  $('#zgForm').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('button'), t = $('#zgTekst').value.trim(), kn = brak ? $('#zgKraj').value.trim().toLowerCase() : '';
    const k = kn ? PANSTWA.find(k => k.n.toLowerCase() === kn) : null;
    if (!t && !k) return; b.disabled = true; b.textContent = 'Wysyłam…';
    try { await api('/api/zgloszenie', { typ: o.typ, nr: o.nr, i: o.i, gdzie: o.gdzie || '', kraj: k ? k.c : null, tekst: (kn && !k ? '[kraj: ' + kn + '] ' : '') + (t || '(bez opisu)') });
      $('#oknoTresc').innerHTML = `<div class="zg-ok"><div class="zg-st">WYSŁANO</div><p>Dzięki! Każde zgłoszenie czytamy i poprawiamy grę.</p><button class="btn glowny" id="zgZam">Zamknij</button></div>`; $('#zgZam').onclick = zamknijOkno; dzwiek('ok', 3);
    } catch (er) { b.disabled = false; b.textContent = 'Wyślij ✉'; alert(er && er.message ? er.message : 'Nie udało się wysłać. Spróbuj za chwilę.'); }
  };
  setTimeout(() => (brak ? $('#zgKraj') : $('#zgTekst')).focus(), 350);
}

// ---------- zegar: 45 s na pytanie, termin zapisany w stanie (odświeżenie strony go nie zeruje) ----------
const CZAS = 45;
let zegarInt = null, zegarOst = null;
function startZegar() {
  if (!stan.czas || stan.czas.i !== stan.i) { stan.czas = { i: stan.i, do: Date.now() + CZAS * 1000 }; zapisz(); }
  clearInterval(zegarInt); zegarOst = null; zegarInt = setInterval(krokZegara, 100); krokZegara();
}
function stopZegar(zostaw) { clearInterval(zegarInt); zegarInt = null; if (!zostaw) { const z = $('#zegar'); if (z) z.classList.add('stop'); } }
function krokZegara() {
  if (tryb !== 'pytanie' || !stan.czas) return stopZegar(true);
  const ms = Math.max(0, stan.czas.do - Date.now()), s = Math.ceil(ms / 1000), z = $('#zegar');
  if (z) {
    $('#zegarS').textContent = s; $('#zegarP').style.width = (100 * ms / (CZAS * 1000)) + '%';
    z.classList.toggle('malo', s <= 10); z.classList.toggle('bardzo', s <= 5);
  }
  if (s !== zegarOst && s <= 10 && s > 0 && zegarOst !== null) dzwiek('tik');
  zegarOst = s;
  if (ms <= 0) koniecCzasu();
}
function koniecCzasu() {
  stopZegar();
  if (wybrany) return laduj(true);
  if (wysyla) return;
  const przed = suma(); stan.odp.push({ kraj: null, poziom: 0, pkt: 0, fakt: '', pin: null, czas: true }); pin = null; zapisz();
  wybrany = null; tryb = 'wynik'; wynikT0 = performance.now(); dzwiek('pudlo', 0); rysujPanel(przed); odswiez();
  const wm = $('#wynikMapa'); wm.classList.remove('zmiana'); void wm.offsetWidth; wm.classList.add('zmiana');
}

let wysyla = false;
async function laduj(poCzasie) {
  if (!wybrany || wysyla || tryb !== 'pytanie') return;
  wysyla = true; stopZegar(); const k = PO_KODZIE[wybrany];
  let r; try { r = await api('/api/odp', { nr: dzien.nr, i: stan.i, kraj: k.c }); } catch { wysyla = false; if (poCzasie === true) { wybrany = null; return koniecCzasu(); } startZegar(); podpowiedz('Brak połączenia – spróbuj jeszcze raz.'); return; }
  wysyla = false;
  const o = { kraj: k.c, poziom: r.poziom, pkt: r.pkt, fakt: r.fakt, pin };
  const przed = suma(); stan.odp.push(o); pin = null;
  if (r.poziom) { const pasz = store.get('pz-paszport', {}); if (!pasz[k.c]) { pasz[k.c] = dzien.data; store.set('pz-paszport', pasz); o.nowa = true; } }
  zapisz();
  // odsłona: zbliżenie na kraj, pod spodem kręcą się poziomy rzadkości, potem wynik
  tryb = 'odslona'; plynnie(() => zoomKraj(k.c), 900); rysujPanel();
  const el = $('#wynikMapa');
  el.innerHTML = `<small>PINEZKA ${stan.odp.length} Z ${N}</small><b>${esc(k.n)}</b><span class="znacz" id="los"></span> <span class="mi">··· mil</span>`; el.hidden = false;
  const kolej = [1, 2, 3, 4, 5, 0]; let i = 0;
  const tik = setInterval(() => { const p = kolej[i++ % kolej.length], l = $('#los'); if (!l) return; l.className = 'znacz z' + p; l.textContent = POZ[p]; dzwiek('tik'); }, 85);
  setTimeout(() => {
    clearInterval(tik); wybrany = null; tryb = 'wynik'; wynikT0 = performance.now();
    dzwiek(r.poziom ? 'ok' : 'pudlo', r.poziom); animujMile(przed, suma()); rysujPanel(przed); odswiez(); const wm = $('#wynikMapa'); wm.classList.remove('zmiana'); void wm.offsetWidth; wm.classList.add('zmiana');
  }, 1500);
}
async function zakoncz() {
  stan.koniec = true; zapisz();
  const s = store.get('pz-seria', { ost: 0, n: 0, max: 0 });
  if (dzien.nr === dzis.nr && s.ost !== dzien.nr) { s.n = s.ost === dzien.nr - 1 ? s.n + 1 : 1; s.ost = dzien.nr; s.max = Math.max(s.max, s.n); store.set('pz-seria', s); }
  try { stan.ranking = await api('/api/koniec', { nr: dzien.nr, pkt: suma() }); zapisz(); } catch {}
  dzwiek('ding'); pokazKoniec();
}

let aktywne = -1;
async function pokazKoniec() {
  tryb = 'koniec'; radar = null; wybrany = null; koniecT0 = performance.now() + 300; $('#wynikMapa').hidden = true;
  try { wyniki = await api('/api/wyniki?nr=' + dzien.nr); } catch { wyniki = null; }
  dopasuj();
  const s = store.get('pz-seria', { n: 1 }), pasz = Object.keys(store.get('pz-paszport', {})).length, rk = stan.ranking;
  $('#panel').innerHTML = `<div class="tablica"><div class="nag"><span>PRZYLOTY · ${nrLotu()}</span><span>${new Date(dzien.data + 'T12:00:00').toLocaleDateString('pl-PL')}</span></div>
    ${stan.odp.map((o, i) => `<div class="wiersz" style="--d:${i}"><span>${i + 1}</span><span class="kr"><span class="fl">${o.kraj ? esc(PO_KODZIE[o.kraj].a3) : '⏱'}</span> ${esc(nazwa(o.kraj))}</span><span class="st k${o.poziom}">${o.kraj ? POZ[o.poziom].toUpperCase() : 'CZAS!'}</span><span class="mi">${o.pkt}</span></div>`).join('')}
    <div class="suma"><span class="kolory">${stan.odp.map(o => `<i style="background:${KOL[o.poziom]}"></i>`).join('')}</span><span><b>${suma()}</b> mil</span></div></div>
    <div class="sekcja">${rk && rk.graczy > 1 ? `<div class="uw" style="text-align:center;margin-bottom:10px">Lepiej niż <b>${rk.lepszyNiz}%</b> z ${rk.graczy} pilotów dzisiaj</div>` : ''}
    <div class="akcje" style="padding:0"><button class="btn glowny" id="bUdostepnij">Udostępnij wynik</button><button class="btn" id="bMenu">Menu</button></div>
    <div class="statyst"><div><b>${s.n}</b>dni z rzędu</div><div><b>${pasz}</b>pieczątek</div><div><b id="odliczanie">–</b>do lotu ${dzis.nr + 1}</div></div></div>
    <div class="sekcja"><h4>ODPOWIEDZI · KLIKNIJ, ŻEBY ZOBACZYĆ NA MAPIE</h4>${stan.odp.map((o, i) => `<div class="odp" data-i="${i}"><div class="q">${i + 1}. ${esc(dzien.pytania[i].q)}</div>
      <span class="znacz z${o.poziom}">${POZ[o.poziom]}</span> ${esc(nazwa(o.kraj))} <b>+${o.pkt}</b><br>
      <button data-i="${i}">Pokaż wszystkie odpowiedzi ›</button><div class="lista-poz"></div></div>`).join('')}</div>${stopka()}`;
  $('#bUdostepnij').onclick = udostepnij; $('#bMenu').onclick = pokazMenu;
  $('#panel').querySelectorAll('.odp>button').forEach(b => b.onclick = () => pokazOdpowiedzi(+b.dataset.i));
  odliczaj(); odswiez();
}
function pokazOdpowiedzi(i) {
  if (!wyniki) return;
  const P = wyniki.pytania[i], o = stan.odp[i];
  document.querySelectorAll('.lista-poz').forEach(l => l.classList.remove('otw'));
  document.querySelectorAll('.odp>button').forEach(b => b.classList.remove('otw'));
  if (aktywne === i) { aktywne = -1; podglad = null; odswiez(); return; }
  aktywne = i; podglad = { kody: P.o, ty: o.kraj, i, t0: performance.now() };
  const l = document.querySelector(`.odp[data-i="${i}"] .lista-poz`); document.querySelector(`.odp>button[data-i="${i}"]`).classList.add('otw');
  let h = '', d = 0;
  for (let p = 5; p >= 1; p--) {
    const ks = Object.keys(P.o).filter(c => P.o[c] === p).sort((a, b) => nazwa(a).localeCompare(nazwa(b), 'pl')); if (!ks.length) continue;
    h += `<div class="rzad" style="--d:${d++}"><span class="znacz z${p}">${POZ[p]} +${PKT[p]}</span><br>${ks.map((c, j) => `<span class="kk ${c === o.kraj ? 'ty' : ''}" data-c="${c}" style="--e:${j}">${esc(nazwa(c))}</span>`).join(' · ')}</div>`;
  }
  if (P.u) h += `<div class="uw rzad" style="--d:${d++}">${esc(P.u)}</div>`;
  h += `<button class="zglos rzad" style="--d:${d++}" data-i="${i}">Czy coś jeszcze powinno się liczyć?</button>`;
  h += `<div class="fakt rzad" style="--d:${d++};margin:8px 0" id="faktPod"><b>CIEKAWOSTKA</b>${esc(P.f['*'] || '')}</div>`;
  l.innerHTML = `<div class="lista-in">${h}</div>`; void l.offsetHeight; l.classList.add('otw');
  setTimeout(() => { if (aktywne === i) l.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 420);
  l.querySelector('.zglos').onclick = () => zglosForm({ typ: 'brak', nr: dzien.nr, i });
  l.querySelectorAll('.kk').forEach(x => x.onclick = () => { const k = PO_KODZIE[x.dataset.c]; plynnie(() => wysrodkuj(k.a[0], k.a[1], Math.max(V.k, kFit() * 3))); pokazKrajWPodgladzie(k.c); });
  plynnie(dopasuj); odswiez();
}
function pokazKrajWPodgladzie(c) {
  if (!podglad || !wyniki) return;
  const P = wyniki.pytania[podglad.i], k = PO_KODZIE[c], p = P.o[c] || 0;
  const razem = Object.values(P.wybory).reduce((a, b) => a + b, 0), ile = P.wybory[c] || 0, el = $('#faktPod'); if (!el) return;
  el.innerHTML = `<b>${esc(k.n.toUpperCase())}</b><span class="znacz z${p}">${POZ[p]}</span>${razem ? ` <span class="uw">· wybrało ${Math.round(100 * ile / razem)}% graczy</span>` : ''}<br>${esc(p ? (P.f[c] || P.f['*'] || '') : 'Ten kraj nie pasuje do pytania.')}`;
}
function odliczaj() {
  const kon = Date.now() + dzis.doNastepnego;
  const t = () => { const e = $('#odliczanie'); if (!e) return; const ms = kon - Date.now(); if (ms <= 0) { e.textContent = 'już!'; return; }
    e.textContent = Math.floor(ms / 36e5) + ':' + String(Math.floor(ms / 6e4) % 60).padStart(2, '0'); setTimeout(t, 30000); };
  t();
}
async function udostepnij() {
  const txt = `Pinezka ${nrLotu()} ✈ ${suma()} mil\n${stan.odp.map(o => EMOJI[o.poziom]).join('')}\n${location.origin}`;
  try { if (navigator.share && matchMedia('(pointer:coarse)').matches) { await navigator.share({ text: txt }); return; } } catch {}
  try { await navigator.clipboard.writeText(txt); $('#bUdostepnij').textContent = 'Skopiowano ✓'; setTimeout(() => { const b = $('#bUdostepnij'); if (b) b.textContent = 'Udostępnij wynik'; }, 2000); }
  catch { prompt('Skopiuj wynik:', txt); }
}

// ---------- okna ----------
let oknoT = null;
function okno(html, kl = '') { clearTimeout(oknoT); const o = $('#okno'); $('#oknoTresc').innerHTML = html; o.querySelector('.okno-in').className = 'okno-in ' + kl; o.classList.remove('zamyka'); o.hidden = false; o.querySelector('.okno-in').scrollTop = 0; dzwiek('wyb'); }
function zamknijOkno() { const o = $('#okno'); if (o.hidden || o.classList.contains('zamyka')) return; o.classList.add('zamyka'); oknoT = setTimeout(() => { o.hidden = true; o.classList.remove('zamyka'); }, 220); }
$('#oknoX').onclick = zamknijOkno; $('#okno').onclick = e => { if (e.target.id === 'okno') zamknijOkno(); };
function jakGrac() {
  const krok = (n, t, d) => `<div class="krok" style="--i:${n}"><span class="k-nr">${n}</span><div><b>${t}</b><p>${d}</p></div></div>`;
  okno(naglowek(IK.jak, 'Jak grać', `Codziennie o północy startuje nowy lot: ${N} pytań.`) +
    krok(1, 'Przeczytaj pytanie', 'Każde pytanie ma wiele dobrych odpowiedzi, na przykład „kraj, przez który płynie Dunaj”.') +
    krok(2, 'Wbij pinezkę', `Kliknij kraj na mapie albo wpisz go w wyszukiwarkę na dole i zatwierdź przyciskiem <b>Wbij pinezkę</b> (albo Enter). Masz <b>${CZAS} sekund</b>. Gdy czas minie, wbita pinezka ląduje sama, a bez pinezki pytanie przepada.`) +
    krok(3, 'Leć dalej za rzadkie odpowiedzi', 'Im mniej oczywisty kraj, tym więcej mil:') +
    `<div class="poz-lista">${[1, 2, 3, 4, 5].map(p => `<div style="--i:${p}"><span class="znacz z${p}">${POZ[p]}</span><b>+${PKT[p]}</b></div>`).join('')}</div>` +
    krok(4, 'Zbieraj pieczątki', 'Mile przesuwają samolot po trasie lotu. Za każdy trafiony nowy kraj dostajesz pieczątkę w paszporcie. Na koniec zobaczysz wszystkie poprawne odpowiedzi i ciekawostki.') +
    `<p class="ok-mini">Mapę przesuwasz myszką lub palcem i przybliżasz kółkiem, szczypaniem, dwuklikiem albo przyciskami. Małe państwa mają kółka.</p>`);
}
$('#bJak').onclick = jakGrac;
document.querySelector('.logo').onclick = () => { if (tryb !== 'odslona') pokazMenu(); };
function paszport() {
  const p = store.get('pz-paszport', {}), lista = PANSTWA.slice().sort((a, b) => a.n.localeCompare(b.n, 'pl')), ma = lista.filter(k => p[k.c]), ile = ma.length;
  const kol = ['#b03a2e', '#2e5c8a', '#5b8c3e', '#7d4e9e', '#a0682a'];
  const piecz = ma.map((k, i) => `<div class="pcz" style="--i:${i};--k:${kol[i % kol.length]};--r:${(((i * 37) % 17) - 8)}deg"><small>${esc(k.a3)}</small><b>${esc(k.n)}</b><small>${esc(dataPL(p[k.c], { day: 'numeric', month: 'short' }))}</small></div>`).join('');
  okno(`<div class="pasz-okl"><div>${IK.pasz}</div><b>PASZPORT</b><small>DZIENNIK PODRÓŻNIKA · LINIE PINEZKA</small></div>
    <div class="pasz-pasek"><span>Pieczątki</span><b data-licz="${ile}">${ile}</b><span>z ${lista.length}</span><i><em style="--w:${Math.max(1, 100 * ile / lista.length)}%"></em></i></div>
    <div class="pasz-str">${ile ? piecz : '<div class="pusto">Paszport jest jeszcze czysty. Trafna odpowiedź w nowym kraju = pierwsza pieczątka.</div>'}</div>
    <h4 class="ok-h4">JESZCZE NIE ODWIEDZONE · ${lista.length - ile}</h4>
    <div class="nieodw">${lista.filter(k => !p[k.c]).map(k => `<span>${esc(k.n)}</span>`).join('')}</div>`, 'pasz');
  licz($('#oknoTresc'));
}
$('#bPaszport').onclick = paszport;
window.addEventListener('resize', () => { rozmiar(); });
start();
window.__pz = { get stan() { return stan; } };
})();

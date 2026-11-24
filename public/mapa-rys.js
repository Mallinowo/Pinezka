// Pinezka – rysowanie podkładu mapy. Ten sam plik działa na stronie i w wątku w tle (Worker),
// żeby rysowanie dużej mapy nie zamrażało gry.
(function (G) {
'use strict';
const RAD = Math.PI / 180;
const prX = lon => lon * RAD;
const prY = lat => -1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * Math.max(-85, Math.min(85, lat)) * RAD));
const MORZE = '#a9c4c8';
const plotno = (w, h) => { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
let faleC = null;
function fale(c) {
  if (!faleC) { faleC = plotno(64, 48); const x = faleC.getContext('2d');
    for (let i = 0; i < 70; i++) { x.fillStyle = Math.random() < .5 ? '#ffffff26' : '#3d6a7414'; x.fillRect(Math.random() * 64, Math.random() * 48, 1.2, 1.2); } }
  return c.createPattern(faleC, 'repeat');
}
// uproszczone kontury: przy oddaleniu tysiące punktów wybrzeża wpadają w jeden piksel, a ich rysowanie
// (zwłaszcza grubych linii płycizn) było główną przyczyną lagów na słabszych komputerach
function uprosc(a, tol) {
  const n = a.length / 2; if (n < 5) return a;
  const keep = new Uint8Array(n), st = [0, n - 1], t2 = tol * tol; keep[0] = keep[n - 1] = 1;
  while (st.length) {
    const j = st.pop(), i = st.pop(), ax = a[2 * i], ay = a[2 * i + 1], dx = a[2 * j] - ax, dy = a[2 * j + 1] - ay, L = dx * dx + dy * dy;
    let mx = -1, mi = -1;
    for (let m = i + 1; m < j; m++) {
      const px = a[2 * m] - ax, py = a[2 * m + 1] - ay; let d;
      if (L) { const u = (px * dx + py * dy) / L; d = u <= 0 ? px * px + py * py : u >= 1 ? (px - dx) ** 2 + (py - dy) ** 2 : (px - u * dx) ** 2 + (py - u * dy) ** 2; } else d = px * px + py * py;
      if (d > mx) { mx = d; mi = m; }
    }
    if (mx > t2) { keep[mi] = 1; st.push(i, mi, mi, j); }
  }
  const o = []; for (let m = 0; m < n; m++) if (keep[m]) o.push(a[2 * m], a[2 * m + 1]); return o;
}
// ścieżka kraju z dokładnością tolPx pikseli przy skali k (piksele urządzenia na jednostkę mapy); poziomy co 2×, w pamięci
const TOL0 = 2e-5;
function sciezka(g, tolPx, k) {
  const tol = tolPx / k; if (tol < TOL0 * 2) return g.path || (g.path = pelna(g));
  const poz = Math.min(14, Math.floor(Math.log2(tol / TOL0))), L = g.lod || (g.lod = []);
  if (L[poz]) return L[poz];
  const t = TOL0 * 2 ** poz, p = new Path2D();
  for (const r of g.pk) {
    // małe wyspy zostają dokładne (mają mało punktów, a uproszczone robią się trójkątami)
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    let s = Math.max(x1 - x0, y1 - y0) < t * 12 ? r : uprosc(r, t); if (s.length < 8) s = r; p.moveTo(s[0], s[1]); for (let i = 2; i < s.length; i += 2) p.lineTo(s[i], s[i + 1]); p.closePath(); }
  return L[poz] = p;
}
function pelna(g) { const p = new Path2D(); for (const r of g.pk) { p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); } return p; }
// rysuje morze, siatkę, płycizny, cień i kraje; c = kontekst, k/tx/ty = widok, w/h = rozmiar w px CSS, s = skala pikseli
function rysujMape(c, geo, k, tx, ty, w, h, s, szybko, kolor, kl = k) { // kl: skala, do której dobrane są grubości linii
  const ek = (lon, lat) => [prX(lon) * k + tx, prY(lat) * k + ty];
  c.setTransform(s, 0, 0, s, 0, 0);
  c.fillStyle = MORZE; c.fillRect(0, 0, w, h);
  c.save(); c.translate(tx % 64, ty % 48); c.fillStyle = fale(c); c.fillRect(-64, -48, w + 128, h + 96); c.restore();
  c.strokeStyle = '#5f859066'; c.lineWidth = .8; c.setLineDash([4, 4]); c.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) { const [x] = ek(lon, 0); c.moveTo(x, ek(0, 84)[1]); c.lineTo(x, ek(0, -57)[1]); }
  for (let lat = -45; lat <= 75; lat += 15) { const [, y] = ek(0, lat); c.moveTo(ek(-180, 0)[0], y); c.lineTo(ek(180, 0)[0], y); }
  c.stroke(); c.setLineDash([]);
  c.setTransform(s * k, 0, 0, s * k, s * tx, s * ty); c.lineJoin = 'round';
  const m = 12 / kl, x0 = -tx / k - m, y0 = -ty / k - m, x1 = (w - tx) / k + m, y1 = (h - ty) / k + m;
  const wid = geo.filter(g => !(g.bb[2] < x0 || g.bb[0] > x1 || g.bb[3] < y0 || g.bb[1] > y1));
  const P = wid.map(g => sciezka(g, .3, k * s)), Pg = wid.map(g => sciezka(g, 3, k * s)); // płycizny i cień nie potrzebują pełnej dokładności
  for (const [lw, kol] of szybko ? [[6, '#bcd3d2']] : [[22, '#7f9fa6'], [20.6, MORZE], [14, '#7f9fa6'], [12.6, MORZE], [6, '#bcd3d2']]) { c.strokeStyle = kol; c.lineWidth = lw / kl; for (const p of Pg) c.stroke(p); }
  if (!szybko) { c.save(); c.translate(1.5 / kl, 2.5 / kl); c.fillStyle = '#5a462a40'; for (const p of Pg) c.fill(p); c.restore(); }
  wid.forEach((g, i) => { c.fillStyle = kolor(g); c.fill(P[i]); });
  c.strokeStyle = '#7a6142'; c.lineWidth = 1 / kl; for (const p of P) c.stroke(p);
}
G.PZRYS = { prX, prY, MORZE, sciezka, rysujMape, fale };
// wątek w tle: dostaje kontury raz, potem zlecenia „narysuj ten fragment w tej skali” i odsyła gotowy obraz
if (typeof document === 'undefined' && typeof G.postMessage === 'function') {
  let geo = [];
  G.onmessage = e => {
    const m = e.data;
    if (m.typ === 'geo') { geo = m.geo; return; }
    if (m.typ === 'rys') {
      const c = new OffscreenCanvas(m.W, m.H);
      rysujMape(c.getContext('2d'), geo, m.k, m.tx, m.ty, m.w, m.h, m.s, false, g => g.t ? '#e2d3ae' : '#efe2c2', m.kl);
      const bmp = c.transferToImageBitmap(); G.postMessage({ id: m.id, bmp }, [bmp]);
    }
  };
}
})(self);

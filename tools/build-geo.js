// Buduje public/geo.json (uproszczone granice, TopoJSON) i public/kraje.js (nazwy, kotwice) z public/map.js.
// node tools/build-geo.js  (NM=ścieżka do node_modules z world-atlas, topojson-client, topojson-simplify)
const path = require('path'), fs = require('fs');
const NM = process.env.NM || path.join(__dirname, 'node_modules');
const topo = JSON.parse(fs.readFileSync(path.join(NM, 'world-atlas/countries-50m.json')));
const simp = require(path.join(NM, 'topojson-simplify'));
const iso = require(path.join(NM, 'i18n-iso-countries'));
const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, 'siatka.js'), 'utf8'))(w);
const M = w.MAPA, KOD = new Set(M.kraje.map(k => k.c));
function codeOf(g) {
  const n = g.properties.name;
  if (n === 'Kosovo') return 'XK'; if (n === 'N. Cyprus') return 'CY'; if (n === 'Somaliland') return 'SO';
  return g.id ? iso.numericToAlpha2(g.id) : null;
}
const geoms = topo.objects.countries.geometries;
for (const g of geoms) { g.id = codeOf(g); g.properties = {}; }
topo.objects.countries.geometries = geoms.filter(g => g.id && KOD.has(g.id));
let t = simp.presimplify(topo);
t = simp.simplify(t, simp.quantile(t, 0.55));
t = simp.filter(t, simp.filterWeight(t, 0.0005));
t.arcs = t.arcs.map(a => a.map(p => [p[0], p[1]]));
t = require(path.join(NM, 'topojson-client')).quantize(t, 1e5);
fs.writeFileSync(path.join(__dirname, '../public/geo.json'), JSON.stringify(t));
// punkt na podpis: komórka kraju najdalej od granicy/brzegu (transformata odległości na siatce)
const W = M.W, H = M.H, grid = new Uint8Array(W * H);
{ const b = Buffer.from(M.rle, 'base64'); let o = 0; for (let i = 0; i < b.length; i += 2) { grid.fill(b[i], o, o + b[i + 1]); o += b[i + 1]; } }
const dist = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, v = grid[i];
  dist[i] = (!v || x === 0 || y === 0 || x === W - 1 || y === H - 1 || grid[i - 1] !== v || grid[i + 1] !== v || grid[i - W] !== v || grid[i + W] !== v) ? 0 : 1e9; }
for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (dist[i]) dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - W] + 1, dist[i - W - 1] + 1.414, dist[i - W + 1] + 1.414); }
for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x > 0; x--) { const i = y * W + x; if (dist[i]) dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + W] + 1, dist[i + W + 1] + 1.414, dist[i + W - 1] + 1.414); }
const best = {};
for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (!v) continue; const y = (i / W) | 0, lat = M.LAT0 - y / M.RES, d = dist[i] * Math.cos(lat * Math.PI / 180) ** .5; if (!best[v] || d > best[v][0]) best[v] = [d, i % W, y]; }
M.kraje.forEach((k, j) => { const b = best[j + 1]; if (b && b[0] > 0) k.a = [b[1], b[2]]; });
const kraje = M.kraje.map(k => ({ c: k.c, n: k.n, a3: k.c === 'XK' ? 'XKX' : iso.alpha2ToAlpha3(k.c), a: [+(k.a[0] / M.RES + M.LON0 + .5 / M.RES).toFixed(2), +(M.LAT0 - k.a[1] / M.RES - .5 / M.RES).toFixed(2)], s: k.s, ...(k.t ? { t: 1 } : {}) }));
fs.writeFileSync(path.join(__dirname, '../public/kraje.js'), '// wygenerowane przez tools/build-geo.js\nwindow.KRAJE=' + JSON.stringify(kraje) + ';\n');
console.log('geo KB', (fs.statSync(path.join(__dirname, '../public/geo.json')).size / 1024).toFixed(0));

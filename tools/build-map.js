// Buduje public/map.js: siatka krajów 0.25° (RLE) + polskie nazwy.
// Uruchom: node tools/build-map.js (potrzebuje world-atlas, topojson-client, i18n-iso-countries – tylko przy budowaniu)
const path = require('path'), fs = require('fs');
const NM = process.env.NM || path.join(__dirname, 'node_modules');
const topo = require(path.join(NM, 'world-atlas/countries-50m.json'));
const { feature } = require(path.join(NM, 'topojson-client'));
const iso = require(path.join(NM, 'i18n-iso-countries'));
iso.registerLocale(require(path.join(NM, 'i18n-iso-countries/langs/pl.json')));
const RES = 4, LON0 = -180, LAT0 = 84, LAT1 = -57;
const W = 360 * RES, H = (LAT0 - LAT1) * RES;
const fixName = { BA: 'Bośnia i Hercegowina', US: 'Stany Zjednoczone', GB: 'Wielka Brytania', KR: 'Korea Południowa', KP: 'Korea Północna', CD: 'Demokratyczna Republika Konga', CG: 'Kongo', CZ: 'Czechy', RU: 'Rosja', MK: 'Macedonia Północna', TW: 'Tajwan', VN: 'Wietnam', LA: 'Laos', SY: 'Syria', IR: 'Iran', BO: 'Boliwia', VE: 'Wenezuela', TZ: 'Tanzania', MD: 'Mołdawia', PS: 'Palestyna', XK: 'Kosowo', CI: 'Wybrzeże Kości Słoniowej', FM: 'Mikronezja', BN: 'Brunei', SZ: 'Eswatini', CV: 'Republika Zielonego Przylądka', VA: 'Watykan', TR: 'Turcja', MM: 'Mjanma', TL: 'Timor Wschodni', EH: 'Sahara Zachodnia' };
const TERR = new Set('IO SH PN AI FK KY BM VG TC MS JE GG IM PM WF MF BL PF NC AX GL FO MO HK AW CW SX NF MP VI GU AS PR NU CK EH'.split(' '));
const fc = feature(topo, topo.objects.countries);
const codes = [], names = {}, grid = new Uint8Array(W * H);
function codeOf(f) {
  const n = f.properties.name;
  if (n === 'Kosovo') return 'XK'; if (n === 'N. Cyprus') return 'CY'; if (n === 'Somaliland') return 'SO';
  if (!f.id) return null; return iso.numericToAlpha2(f.id) || null;
}
const late = [];
const skip = new Set(['AQ', 'TF', 'HM', 'GS', 'BV']);
for (const f of fc.features) {
  const c = codeOf(f); if (!c || skip.has(c)) { continue; }
  let idx = codes.indexOf(c); if (idx < 0) { codes.push(c); idx = codes.length - 1; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly0 of polys) {
    const poly = poly0.map(ring => { let o = 0, pv = null; return ring.map(([x, y]) => { if (pv !== null) { if (x + o - pv > 180) o -= 360; else if (x + o - pv < -180) o += 360; } pv = x + o; return [x + o, y]; }); });
    let minY = 1e9, maxY = -1e9;
    for (const ring of poly) for (const [, la] of ring) { minY = Math.min(minY, la); maxY = Math.max(maxY, la); }
    const r0 = Math.max(0, Math.floor((LAT0 - maxY) * RES)), r1 = Math.min(H - 1, Math.ceil((LAT0 - minY) * RES));
    let filled = 0;
    for (let r = r0; r <= r1; r++) {
      const lat = LAT0 - (r + 0.5) / RES, xs = [];
      for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[j];
        if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.ceil((xs[k] - LON0) * RES - 0.5), c1 = Math.floor((xs[k + 1] - LON0) * RES - 0.5);
        for (let c = c0; c <= c1; c++) { grid[r * W + ((c % W) + W) % W] = idx + 1; filled++; }
      }
    }
    if (!filled) { // małe wyspy: zaznacz chociaż środek
      const [lo, la] = poly[0][0]; const r = Math.floor((LAT0 - la) * RES), c = Math.floor((lo - LON0) * RES);
      if (r >= 0 && r < H && c >= 0 && c < W) late.push([r * W + c, idx + 1]);
    }
  }
}
for (const [i, v] of late) grid[i] = v;
// statystyki: liczba komórek, środek ciężkości
const cnt = new Array(codes.length).fill(0), sx = new Array(codes.length).fill(0), sy = new Array(codes.length).fill(0);
for (let i = 0; i < grid.length; i++) if (grid[i]) { const k = grid[i] - 1; cnt[k]++; sx[k] += i % W; sy[k] += Math.floor(i / W); }
const countries = codes.map((c, k) => {
  // punkt kotwicy: komórka kraju najbliższa środkowi ciężkości
  let cx = sx[k] / cnt[k], cy = sy[k] / cnt[k], best = 1e18, bx = 0, by = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === k + 1) { const x = i % W, y = (i / W) | 0, d = (x - cx) ** 2 + (y - cy) ** 2; if (d < best) { best = d; bx = x; by = y; } }
  return { c, n: fixName[c] || iso.getName(c, 'pl'), a: [bx, by], s: cnt[k], ...(TERR.has(c) ? { t: 1 } : {}) };
});
// RLE: pary (wartość, długość<=255)
const out = [];
for (let i = 0; i < grid.length;) { let v = grid[i], n = 0; while (i < grid.length && grid[i] === v && n < 255) { i++; n++; } out.push(v, n); }
const b64 = Buffer.from(out).toString('base64');
const js = `// wygenerowane przez tools/build-map.js – dane granic: Natural Earth (domena publiczna)\nwindow.MAPA={W:${W},H:${H},RES:${RES},LON0:${LON0},LAT0:${LAT0},kraje:${JSON.stringify(countries)},rle:"${b64}"};\n`;
fs.writeFileSync(path.join(__dirname, 'siatka.js'), js);
console.log('kraje', codes.length, 'KB', (js.length / 1024).toFixed(0));
console.log(countries.filter(x => x.s < 40).map(x => x.c + ':' + x.s).join(' '));


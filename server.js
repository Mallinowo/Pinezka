// Pinezka – dzienna gra geograficzna. Serwer bez zależności.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const PYT = require('./shared/pytania.js');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const START = '2026-11-09', NA_DZIEN = 7, PKT = [0, 40, 55, 70, 85, 100], SLEPA = 1.25; // ślepa mapa: +25% mil
fs.mkdirSync(DATA, { recursive: true });

// mapa: kotwice krajów (do radaru)
const KRAJE = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(PUB, 'kraje.js'), 'utf8'))(w); return w.KRAJE; })();
const KOTWICA = Object.fromEntries(KRAJE.map(k => [k.c, k.a]));
const ADMIN_KEY = process.env.ADMIN_KEY || '', ADMIN_PATH = process.env.ADMIN_PATH || '';
// poprawki z panelu autora (dodane kraje) – DATA_DIR/poprawki.json { "treść pytania": { KOD: poziom } }
const PLIK_POP = path.join(DATA, 'poprawki.json');
let poprawki = {}; try { poprawki = JSON.parse(fs.readFileSync(PLIK_POP, 'utf8')); } catch {}
const pytania = PYT.map(p => {
  const o = {}; for (const t of p.o.split(/\s+/)) o[t.slice(0, 2)] = +t.slice(2);
  Object.assign(o, poprawki[p.q] || {}); for (const c in o) if (!o[c]) delete o[c];
  return { q: p.q, u: p.u || '', o, f: p.f || {} };
});

// dzień w strefie Europe/Warsaw
function dzisiaj() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date()); }
function nrDnia(d = dzisiaj()) { return Math.round((Date.parse(d) - Date.parse(START)) / 864e5) + 1; }
function dataNr(nr) { return new Date(Date.parse(START) + (nr - 1) * 864e5).toISOString().slice(0, 10); }
function los(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
function kolejnosc(cykl) {
  const r = los(7919 * (cykl + 1)), a = pytania.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Dni już rozegrane mają przypięte pytania (stara pula 42), żeby dopisywanie pytań nie zmieniało historii.
const STARA_PULA = 42, PRZYPIETE_DNI = 2;
function staraKolejnosc(cykl) {
  const r = los(7919 * (cykl + 1)), a = [...Array(STARA_PULA).keys()];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const PRZYPIETE = []; for (let nr = 1; nr <= PRZYPIETE_DNI; nr++) for (let k = 0; k < NA_DZIEN; k++) { const g = (nr - 1) * NA_DZIEN + k; PRZYPIETE.push(staraKolejnosc(Math.floor(g / STARA_PULA))[g % STARA_PULA]); }
// cykl 0: pytania jeszcze niegrane (losowo), potem kolejne cykle po całej puli
const RESZTA = (() => { const uzyte = new Set(PRZYPIETE), a = kolejnosc(0).filter(i => !uzyte.has(i)); return a; })();
function pytaniaDnia(nr) {
  if (nr <= PRZYPIETE_DNI) return PRZYPIETE.slice((nr - 1) * NA_DZIEN, nr * NA_DZIEN);
  const L = pytania.length, out = [];
  for (let k = 0; k < NA_DZIEN; k++) {
    let g = (nr - 1 - PRZYPIETE_DNI) * NA_DZIEN + k;
    if (g < RESZTA.length) { out.push(RESZTA[g]); continue; }
    g -= RESZTA.length; out.push(kolejnosc(1 + Math.floor(g / L))[g % L]);
  }
  return out;
}
const dniZPytaniami = () => PRZYPIETE_DNI + Math.floor(RESZTA.length / NA_DZIEN);

// statystyki
const PLIK = path.join(DATA, 'stats.json');
let st = { dni: {} }; try { st = JSON.parse(fs.readFileSync(PLIK, 'utf8')); } catch {}
let brudne = false;
setInterval(() => { if (brudne) { brudne = false; fs.writeFile(PLIK + '.tmp', JSON.stringify(st), e => { if (!e) fs.rename(PLIK + '.tmp', PLIK, () => {}); }); } }, 10000);
function dzienSt(nr) { return st.dni[nr] || (st.dni[nr] = { wybory: {}, wyniki: [] }); }

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise(ok => { let s = '', ko = false; req.on('data', c => { if (ko) return; s += c; if (s.length > 8192) { ko = true; ok({}); req.destroy(); } }); req.on('end', () => { if (ko) return; try { const v = JSON.parse(s || '{}'); ok(v && typeof v === 'object' ? v : {}); } catch { ok({}); } }); req.on('error', () => ok({})); }); }

// --- bezpieczeństwo: limit zapytań na IP, jeden głos na IP, nagłówki ---
// za Cloudflare: CF-Connecting-IP (nie da się podrobić), inaczej ostatni wpis X-Forwarded-For dodany przez proxy Railway
const ipOf = req => String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop() || req.socket.remoteAddress || '').trim();
let SOL = crypto.randomBytes(16).toString('hex'), solDzien = dzisiaj();
const hashIp = ip => { if (solDzien !== dzisiaj()) { SOL = crypto.randomBytes(16).toString('hex'); solDzien = dzisiaj(); glosy.clear(); } return crypto.createHash('sha256').update(SOL + ip).digest('hex').slice(0, 16); };
const kubly = new Map(), glosy = new Set();
function limit(req, klucz, ile, okno) { // ile zapytań na okno (ms)
  const k = klucz + ':' + ipOf(req), t = Date.now(), b = kubly.get(k);
  if (!b || t - b.t > okno) { kubly.set(k, { t, n: 1 }); return true; }
  return ++b.n <= ile;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of kubly) if (t - b.t > 36e5) kubly.delete(k); }, 6e5).unref();
const raz = (req, k) => { const h = hashIp(ipOf(req)) + ':' + k; if (glosy.has(h)) return false; glosy.add(h); return true; };
const tajne = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const NAGLOWKI = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };
function zgloszenie(z) { try { if (fs.existsSync(PLIK_ZG) && fs.statSync(PLIK_ZG).size > 5e6) return; } catch {} fs.appendFile(PLIK_ZG, JSON.stringify(z) + '\n', () => {}); }
const PLIK_ZG = path.join(DATA, 'zgloszenia.jsonl'), PLIK_ZG_ST = path.join(DATA, 'zgloszenia-stan.json');
let zgStan = {}; try { zgStan = JSON.parse(fs.readFileSync(PLIK_ZG_ST, 'utf8')); } catch {}
const zapiszJson = (plik, v) => fs.writeFile(plik + '.tmp', JSON.stringify(v), e => { if (!e) fs.rename(plik + '.tmp', plik, () => {}); });
function nrOk(nr) { nr = +nr; return Number.isInteger(nr) && nr >= 1 && nr <= nrDnia() ? nr : null; }

const TYPY = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  for (const k in NAGLOWKI) res.setHeader(k, NAGLOWKI[k]);
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  let u; try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  const CH = process.env.CANONICAL_HOST, host = String(req.headers.host || '').toLowerCase();
  if (CH && host && host !== CH && !host.startsWith('localhost') && !host.startsWith('127.') && !host.endsWith('.railway.internal')) { res.writeHead(301, { Location: 'https://' + CH + req.url }); return res.end(); }
  const p = u.pathname;
  try {
    if (p.startsWith('/api/') && !limit(req, 'api', 300, 6e4)) return json(res, 429, { blad: 'Za dużo zapytań – zwolnij trochę.' });
    if (p.startsWith('/api/admin/')) return admin(req, res, p, u);
    if (ADMIN_PATH && p === '/' + ADMIN_PATH) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); return res.end(fs.readFileSync(path.join(__dirname, 'admin', 'panel.html'), 'utf8').replace('ADMIN_JS', '/' + ADMIN_PATH + '.js')); }
    if (ADMIN_PATH && p === '/' + ADMIN_PATH + '.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); return fs.createReadStream(path.join(__dirname, 'admin', 'panel.js')).pipe(res); }
    if (p === '/api/dzien') {
      const nr = nrOk(u.searchParams.get('nr') || nrDnia());
      if (!nr) return json(res, 404, { blad: 'Brak takiego lotu' });
      const dzis = dzisiaj(), jutro = new Date(Date.parse(dzis) + 864e5);
      return json(res, 200, { nr, data: dataNr(nr), dzisiejszy: nrDnia(), pytania: pytaniaDnia(nr).map(i => ({ q: pytania[i].q, u: pytania[i].u })),
        doNastepnego: msDoPolnocy() });
    }
    if (p === '/api/odp' && req.method === 'POST') {
      const b = await body(req), nr = nrOk(b.nr), i = +b.i, kraj = String(b.kraj || '').slice(0, 2);
      if (!nr || !(i >= 0 && i < NA_DZIEN) || !KOTWICA[kraj]) return json(res, 400, { blad: 'Złe dane' });
      const P = pytania[pytaniaDnia(nr)[i]], poz = P.o[kraj] || 0;
      if (raz(req, 'o' + nr + ':' + i)) { const w = dzienSt(nr).wybory, k = w[i] || (w[i] = {}); k[kraj] = (k[kraj] || 0) + 1; brudne = true; }
      return json(res, 200, { poziom: poz, pkt: Math.round(PKT[poz] * (b.slepa ? SLEPA : 1)), fakt: poz ? (P.f[kraj] || P.f['*'] || '') : '' });
    }
    if (p === '/api/wyniki') {
      const nr = nrOk(u.searchParams.get('nr'));
      if (!nr) return json(res, 404, { blad: 'Brak' });
      const d = dzienSt(nr);
      return json(res, 200, { pytania: pytaniaDnia(nr).map((ix, i) => ({ ...pytania[ix], wybory: d.wybory[i] || {} })), graczy: d.wyniki.length });
    }
    if (p === '/api/zgloszenie' && req.method === 'POST') {
      if (!limit(req, 'zg', 10, 36e5)) return json(res, 429, { blad: 'Za dużo zgłoszeń – spróbuj za godzinę.' });
      const b = await body(req), typ = b.typ === 'blad' ? 'blad' : 'brak', tekst = String(b.tekst || '').trim().slice(0, 1000);
      const nr = b.nr == null ? null : nrOk(b.nr), i = Number.isInteger(+b.i) && +b.i >= 0 && +b.i < NA_DZIEN ? +b.i : null;
      if (!tekst || (typ === 'brak' && (!nr || i === null))) return json(res, 400, { blad: 'Złe dane' });
      zgloszenie({ id: crypto.randomBytes(6).toString('hex'), t: new Date().toISOString(), typ, nr, i, pytanie: nr && i !== null ? pytania[pytaniaDnia(nr)[i]].q : null,
        kraj: /^[A-Z]{2}$/.test(b.kraj) && KOTWICA[b.kraj] ? b.kraj : null, gdzie: String(b.gdzie || '').slice(0, 40), ua: String(req.headers['user-agent'] || '').slice(0, 160), tekst });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/koniec' && req.method === 'POST') {
      const b = await body(req), nr = nrOk(b.nr), pkt = Math.max(0, Math.min(Math.round(NA_DZIEN * 100 * SLEPA), +b.pkt || 0));
      if (!nr) return json(res, 400, { blad: 'Złe dane' });
      const W = dzienSt(nr).wyniki; if (raz(req, 'k' + nr)) { W.push(pkt); brudne = true; }
      const gorsi = W.filter(x => x < pkt).length;
      return json(res, 200, { graczy: W.length, lepszyNiz: W.length > 1 ? Math.round(100 * gorsi / (W.length - 1)) : 100 });
    }
    // pliki
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let f = p === '/' ? '/index.html' : decodeURIComponent(p);
    if (!path.extname(f) && fs.existsSync(path.join(PUB, f + '.html'))) f += '.html';
    const full = path.join(PUB, path.normalize(f));
    if (!full.startsWith(PUB + path.sep) || /[\\/]\./.test(f) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nie ma takiej strony'); }
    const ext = path.extname(full);
    const nag = { 'Content-Type': TYPY[ext] || 'application/octet-stream', 'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000' : 'no-cache' };
    if (/\.(js|json|css|html)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      nag['Content-Encoding'] = 'gzip'; res.writeHead(200, nag); return fs.createReadStream(full).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, nag); fs.createReadStream(full).pipe(res);
  } catch (e) { console.error(e); json(res, 500, { blad: 'Błąd serwera' }); }
}).listen(PORT, () => console.log('Pinezka na porcie ' + PORT));

// ---------- panel autora ----------
async function admin(req, res, p, u) {
  if (!ADMIN_KEY || !ADMIN_PATH) return json(res, 404, { blad: 'Panel wyłączony' });
  if (!limit(req, 'adm', 60, 6e4)) return json(res, 429, { blad: 'Za dużo prób' });
  if (!tajne(req.headers['x-admin-key'] || '', ADMIN_KEY)) { if (!limit(req, 'admzle', 10, 9e5)) return json(res, 429, { blad: 'Zablokowane na 15 minut' }); return json(res, 401, { blad: 'Zły klucz' }); }
  if (p === '/api/admin/przeglad') {
    const dzis = nrDnia(), dni = [];
    for (let nr = dzis; nr >= Math.max(1, dzis - 13); nr--) { const d = st.dni[nr] || { wyniki: [], wybory: {} }, W = d.wyniki;
      dni.push({ nr, data: dataNr(nr), graczy: W.length, srednio: W.length ? Math.round(W.reduce((a, b) => a + b, 0) / W.length) : 0,
        pytania: pytaniaDnia(nr).map((ix, i) => ({ q: pytania[ix].q, o: pytania[ix].o, wybory: d.wybory[i] || {} })) }); }
    let zg = []; try { zg = fs.readFileSync(PLIK_ZG, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
    zg = zg.map((z, k) => ({ ...z, id: z.id || 'L' + k, zalatwione: !!zgStan[z.id || 'L' + k] })).reverse().slice(0, 500);
    return json(res, 200, { dzis, data: dzisiaj(), pytan: pytania.length, dniZPytaniami: dniZPytaniami(), koniecPuli: dataNr(dniZPytaniami()), dni, zgloszenia: zg, poprawki,
      kraje: KRAJE.filter(k => !k.t).map(k => [k.c, k.n]), lista: pytania.map(x => ({ q: x.q, n: Object.keys(x.o).length })) });
  }
  if (p === '/api/admin/zalatw' && req.method === 'POST') { const b = await body(req); if (typeof b.id !== 'string') return json(res, 400, {}); if (b.cofnij) delete zgStan[b.id]; else zgStan[b.id] = Date.now(); zapiszJson(PLIK_ZG_ST, zgStan); return json(res, 200, { ok: true }); }
  if (p === '/api/admin/dodaj' && req.method === 'POST') {
    const b = await body(req), P = pytania.find(x => x.q === b.q), poz = +b.poziom;
    if (!P || !KOTWICA[b.kraj] || !(Number.isInteger(poz) && poz >= 0 && poz <= 5)) return json(res, 400, { blad: 'Złe dane' });
    (poprawki[P.q] || (poprawki[P.q] = {}))[b.kraj] = poz; zapiszJson(PLIK_POP, poprawki);
    if (poz) P.o[b.kraj] = poz; else delete P.o[b.kraj];
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { blad: 'Nie ma' });
}

function msDoPolnocy() {
  const now = new Date(), s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  const [h, m, sec] = s.split(':').map(Number); return ((23 - h) * 3600 + (59 - m) * 60 + (60 - sec)) * 1000;
}

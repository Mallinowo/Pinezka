(() => {
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POZ = ['Pudło', 'Oczywisty', 'Znany', 'Rzadki', 'Egzotyczny', 'Biały kruk'];
let KEY = sessionStorage.getItem('pz-adm') || '', D = null, tab = 'zg', filtr = 'nowe';
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', 2200); };
async function api(u, b) {
  const r = await fetch('/api/admin/' + u, { method: b ? 'POST' : 'GET', headers: { 'x-admin-key': KEY, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.blad || 'HTTP ' + r.status), { s: r.status }); return j;
}
const nazwa = c => (D.kraje.find(k => k[0] === c) || [c, c])[1];
const opcjeKrajow = sel => '<option value="">— wybierz kraj —</option>' + D.kraje.slice().sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(k => `<option value="${k[0]}" ${k[0] === sel ? 'selected' : ''}>${esc(k[1])}</option>`).join('');
const opcjePoz = (p = 3) => POZ.map((n, i) => `<option value="${i}" ${i === p ? 'selected' : ''}>${i ? n : 'usuń (pudło)'}</option>`).join('');
async function laduj() {
  try { D = await api('przeglad'); } catch (e) { if (e.s === 401 || e.s === 429) { sessionStorage.removeItem('pz-adm'); KEY = ''; return login(e.message); } toast(e.message); return; }
  $('#nav').hidden = false;
  const dni = D.dniZPytaniami - D.dzis + 1;
  $('#info').textContent = `Dziś lot ${D.dzis} (${D.data}) · ${D.pytan} pytań · nowe pytania wystarczą do ${D.koniecPuli} (${dni} dni)`;
  $('#info').classList.toggle('zle', dni < 7);
  rysuj();
}
function login(err) {
  $('#nav').hidden = true; $('#main').innerHTML = `<div id="login" class="karta"><h3>Klucz autora</h3><form id="lf"><input id="klucz" type="password" autocomplete="current-password" placeholder="ADMIN_KEY"><button>Wejdź</button></form><div class="meta">${esc(err || '')}</div></div>`;
  $('#lf').onsubmit = e => { e.preventDefault(); KEY = $('#klucz').value.trim(); sessionStorage.setItem('pz-adm', KEY); laduj(); };
}
function dodajForm(q, kraj, poz) {
  return `<div class="dz" data-q="${esc(q)}"><select class="k">${opcjeKrajow(kraj)}</select><select class="p">${opcjePoz(poz)}</select><button class="dodaj">Zapisz w odpowiedziach</button></div>`;
}
function rysuj() {
  document.querySelectorAll('#nav button[data-t]').forEach(b => b.classList.toggle('akt', b.dataset.t === tab));
  const m = $('#main');
  if (tab === 'zg') {
    const lista = D.zgloszenia.filter(z => filtr === 'wszystkie' || !z.zalatwione);
    m.innerHTML = `<div class="fil">Pokaż: <select id="filtr"><option value="nowe">nowe (${D.zgloszenia.filter(z => !z.zalatwione).length})</option><option value="wszystkie" ${filtr === 'wszystkie' ? 'selected' : ''}>wszystkie (${D.zgloszenia.length})</option></select></div>` +
      (lista.length ? lista.map(z => `<div class="karta ${z.zalatwione ? 'ok' : ''}" data-id="${esc(z.id)}"><div class="meta"><span class="typ ${z.typ === 'blad' ? 'blad' : 'brak'}">${z.typ === 'blad' ? 'BŁĄD' : 'BRAKUJĄCY KRAJ'}</span>${esc(new Date(z.t).toLocaleString('pl-PL'))}${z.nr ? ' · lot ' + z.nr + (z.i != null ? ', pytanie ' + (z.i + 1) : '') : ''}${z.gdzie ? ' · ' + esc(z.gdzie) : ''}</div>
        ${z.pytanie ? `<h3>${esc(z.pytanie)}</h3>` : ''}${z.kraj ? `<div>Kraj: <b>${esc(nazwa(z.kraj))}</b></div>` : ''}<div class="tekst">${esc(z.tekst)}</div><div class="meta">${esc(z.ua || '')}</div>
        ${z.pytanie ? dodajForm(z.pytanie, z.kraj, 3) : ''}<div class="dz"><button class="zal">${z.zalatwione ? 'Przywróć' : 'Oznacz jako załatwione'}</button></div></div>`).join('') : '<div class="karta">Brak zgłoszeń 🎉</div>');
    $('#filtr').onchange = e => { filtr = e.target.value; rysuj(); };
    m.querySelectorAll('.zal').forEach(b => b.onclick = async () => { const k = b.closest('.karta'), z = D.zgloszenia.find(z => z.id === k.dataset.id); await api('zalatw', { id: z.id, cofnij: z.zalatwione }); z.zalatwione = !z.zalatwione; rysuj(); });
  }
  if (tab === 'dni') {
    m.innerHTML = D.dni.map(d => `<div class="karta"><h3>Lot ${d.nr} · ${d.data}</h3><div class="meta">${d.graczy} ukończonych lotów · średnio ${d.srednio} mil</div>
      ${d.pytania.map((p, i) => { const w = Object.entries(p.wybory).sort((a, b) => b[1] - a[1]), raz = w.reduce((a, b) => a + b[1], 0);
        return `<div style="margin-top:10px"><b>${i + 1}. ${esc(p.q)}</b> <span class="meta">(${raz} odpowiedzi)</span><div class="wyb">${w.length ? w.map(([c, n]) => `<span class="${p.o[c] ? 'dobry' : 'zly'}" data-q="${esc(p.q)}" data-c="${c}" title="${p.o[c] ? POZ[p.o[c]] : 'kliknij, aby dodać do odpowiedzi'}">${esc(nazwa(c))} ${Math.round(100 * n / raz)}%</span>`).join('') : '<span>brak danych</span>'}</div></div>`; }).join('')}</div>`).join('');
    m.querySelectorAll('.wyb .zly').forEach(s => s.onclick = () => { const k = s.closest('div'); if (k.nextElementSibling && k.nextElementSibling.classList.contains('dz')) return; k.insertAdjacentHTML('afterend', dodajForm(s.dataset.q, s.dataset.c, 3)); podepnij(); });
  }
  if (tab === 'pyt') {
    m.innerHTML = `<div class="karta"><div class="meta">Nowe pytania dopisuje się w pliku shared/pytania.js. Tu możesz poprawiać odpowiedzi istniejących pytań.</div><table><tr><th>#</th><th>Pytanie</th><th>Odpowiedzi</th><th></th></tr>${D.lista.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.q)}${D.poprawki[p.q] ? ` <span class="meta">(poprawki: ${Object.entries(D.poprawki[p.q]).map(([c, z]) => esc(nazwa(c)) + ' → ' + POZ[z]).join(', ')})</span>` : ''}</td><td>${p.n}</td><td><button class="edyt" data-q="${esc(p.q)}">Popraw</button></td></tr>`).join('')}</table></div>`;
    m.querySelectorAll('.edyt').forEach(b => b.onclick = () => { const tr = b.closest('tr'); if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('ed')) return; tr.insertAdjacentHTML('afterend', `<tr class="ed"><td></td><td colspan="3">${dodajForm(b.dataset.q, '', 3)}</td></tr>`); podepnij(); });
  }
  podepnij();
}
function podepnij() {
  document.querySelectorAll('.dodaj').forEach(b => b.onclick = async () => {
    const d = b.closest('.dz'), kraj = d.querySelector('.k').value, poziom = +d.querySelector('.p').value;
    if (!kraj) return toast('Najpierw wybierz kraj');
    try { await api('dodaj', { q: d.dataset.q, kraj, poziom }); toast(`Zapisano: ${nazwa(kraj)} → ${POZ[poziom]}`); await laduj(); } catch (e) { toast(e.message); }
  });
}
document.querySelectorAll('#nav button[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; rysuj(); });
$('#wyloguj').onclick = () => { sessionStorage.removeItem('pz-adm'); KEY = ''; login(); };
if (KEY) laduj(); else login();
})();

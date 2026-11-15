// Area view: farming in one Norwegian municipality. Search a place, then three answers: what farms grow, how the
// climate is changing, and where the farms are. Details stay behind "Show the evidence".
import { api } from './api.js';
import en from './i18n/en.js';

const STR = en;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function t(path, params = {}) {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), STR);
  if (typeof v !== 'string') return v ?? path;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}
const num = (v) => Math.round(v).toLocaleString(STR.locale || 'en-GB');
const groupName = (g) => t(`area.group.${g}`);

// Fixed colour per crop group (identity, not rank), matching the crop colours used elsewhere in the app.
const COLOUR = { 'Grass and forage': '#2fa477', Barley: '#c8801f', Oats: '#d9b43a', Wheat: '#2e98c4', 'Other cereals': '#8a6d3b',
  'Potatoes and vegetables': '#9d5bdb', 'Oilseeds, peas and beans': '#c2547f', Other: '#8a8f98', Pasture: '#9fbf8f' };
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const EXAMPLE = '5035'; // Stjørdal, home of the example field

const state = { list: [], code: null, map: null, layer: null };

function applyText() {
  document.documentElement.lang = STR.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
}

function findCode(q) {
  const norm = (s) => s.trim().toLocaleLowerCase('nb');
  const n = norm(q);
  return (state.list.find((a) => norm(a.name) === n) || state.list.find((a) => norm(a.name).startsWith(n)) || {}).code;
}

async function show(code) {
  state.code = code;
  history.replaceState(null, '', `?area=${code}`);
  $('result').hidden = false;
  $('area-title').textContent = t('area.loading');
  ['area-lead', 'grow', 'evidence'].forEach((id) => { $(id).innerHTML = ''; });
  try {
    const d = await api.area(code);
    if (state.code !== code) return;
    renderSummary(d);
    renderGrow(d);
    renderMap(d);
    renderEvidence(d);
    renderClimate(d, code);
  } catch (e) {
    if (state.code === code) $('area-title').textContent = t('area.failed', { error: e.message });
  }
}

function renderSummary(d) {
  const i = d.years.length - 1, year = d.years[i];
  $('area-title').textContent = t('area.title', { name: d.name });
  const [a, b] = d.crops;
  const fc = d.farms_change, diff = fc.to - fc.from;
  $('area-lead').textContent = t('area.lead', { year, farms: num(d.farms[i]), ha: num(d.arable_daa[i] / 10),
    a: groupName(a.group), ap: Math.round(a.share_pct[i]), b: b ? groupName(b.group) : '', bp: b ? Math.round(b.share_pct[i]) : 0 })
    + (Math.abs(diff) >= 5 ? ' ' + t(diff < 0 ? 'area.farmsFell' : 'area.farmsRose', { d: num(Math.abs(diff)), first: fc.first, was: num(fc.from) }) : '');
}

function renderGrow(d) {
  const i = d.years.length - 1, first = d.years[0];
  const shown = d.crops.filter((c) => c.share_pct[i] >= 0.5 || c.consistent);
  const max = Math.max(...shown.map((c) => c.share_pct[i]), 1);
  $('grow').innerHTML = `<p class="muted">${esc(t('area.growIntro', { year: d.years[i], first }))}</p>
    <ul class="crop-bars">${shown.map((c) => {
      const diff = c.share_pct[i] - c.share_pct[0];  // shown as read; "steady" comes from the whole-record trend test
      const trend = c.consistent && Math.sign(diff) === Math.sign(c.change_pp) ? t(diff > 0 ? 'area.up' : 'area.down', { pp: Math.abs(diff).toFixed(diff < 10 && diff > -10 ? 1 : 0), first, was: Math.round(c.share_pct[0]) })
        : t('area.steady', { first });
      return `<li><span>${esc(groupName(c.group).replace(/^./, (x) => x.toUpperCase()))}</span>
        <span class="bar-track"><i style="width:${(100 * c.share_pct[i]) / max}%;background:${COLOUR[c.group] || '#8a8f98'}"></i></span>
        <span class="val">${Math.round(c.share_pct[i])}%</span>
        <span class="trend${c.consistent ? '' : ' muted'}">${esc(trend)}</span></li>`;
    }).join('')}</ul>
    <p class="small muted">${esc(t('area.growNote', { ha: num(d.pasture_daa[i] / 10) }))}</p>`;
}

async function renderClimate(d, code) {
  const box = $('climate');
  if (!d.centre) { box.innerHTML = ''; return; }
  box.innerHTML = `<p class="loading">${esc(t('area.climateLoading'))}</p>`;
  try {
    const c = await api.change(d.centre[0], d.centre[1]);
    if (state.code !== code) return;
    const both = ['warm_days', 'hot_days'].every((k) => c.metrics.find((m) => m.code === k)?.consistent);
    const clear = c.metrics.filter((m) => m.consistent && !(both && m.code === 'warm_days'));
    const rest = c.metrics.filter((m) => !m.consistent);
    const whole = (m, v) => (m.unit === 'days' ? Math.round(v) : v);
    const pct = (m) => Math.round(100 * Math.abs(m.change) / (m.then || 1));
    const line = (m) => t(`changed.m.${m.code}.${m.change > 0 ? 'up' : 'down'}`, {
      now: m.now_label || whole(m, m.now), was: m.then_label || whole(m, m.then), d: whole(m, Math.abs(m.change)), pct: pct(m), then: c.then });
    box.innerHTML = `<p class="muted">${esc(t('area.climateIntro', { now: c.now, then: c.then }))}</p>
      ${clear.length ? `<ul class="changes">${clear.map((m) => `<li><span class="arrow" aria-hidden="true">${m.change > 0 ? '▲' : '▼'}</span>${esc(line(m))}</li>`).join('')}</ul>`
        : `<p>${esc(t('changed.noneClear'))}</p>`}
      ${rest.length ? `<p class="small">${esc(t('changed.noClear', { list: rest.map((m) => t(`changed.name.${m.code}`)).join(', ') }))}</p>` : ''}
      <p class="small muted">${esc(t('changed.note', { record: c.record }))}</p>`;
  } catch (e) {
    if (state.code === code) box.innerHTML = `<p class="loading error">${esc(t('changed.failed', { error: e.message }))}</p>`;
  }
}

function renderMap(d) {
  if (!state.map) {
    state.map = L.map('farm-map', { scrollWheelZoom: false });
    L.tileLayer(IMAGERY, { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(state.map);
    L.tileLayer(LABELS, { maxZoom: 18 }).addTo(state.map);
    new ResizeObserver(() => state.map.invalidateSize()).observe($('farm-map'));
  }
  if (state.layer) state.layer.remove();
  const dots = d.dots.map(([lat, lon, daa, crop, year]) => L.circleMarker([lat, lon], {
    radius: Math.max(3, Math.min(12, Math.sqrt(daa) / 3)), color: '#fff', weight: 1, fillColor: COLOUR[crop] || '#8a8f98', fillOpacity: 0.9,
  }).bindPopup(`${esc(t('area.popup', { daa: num(daa), crop: groupName(crop), year }))}<br>
    <a href="/field?${new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4), place: d.name, area: d.code })}">${esc(t('area.openField'))}</a>`));
  state.layer = L.featureGroup(dots).addTo(state.map);
  if (dots.length) state.map.fitBounds(state.layer.getBounds(), { padding: [16, 16], maxZoom: 13 });
  const used = [...new Set(d.dots.map((x) => x[3]))];
  $('farm-legend').innerHTML = Object.keys(COLOUR).filter((k) => used.includes(k))
    .map((k) => `<span><i style="background:${COLOUR[k]}"></i>${esc(groupName(k).replace(/^./, (x) => x.toUpperCase()))}</span>`).join('');
}

function renderEvidence(d) {
  const groups = d.crops.map((c) => c.group);
  $('evidence').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${esc(t('area.tableYear'))}</th><th>${esc(t('area.tableFarms'))}</th>
    <th>${esc(t('area.tableArable'))}</th>${groups.map((g) => `<th>${esc(groupName(g))}</th>`).join('')}<th>${esc(groupName('Pasture'))}</th></tr></thead>
    <tbody>${d.years.map((y, i) => `<tr><td>${y}</td><td>${num(d.farms[i])}</td><td>${num(d.arable_daa[i])}</td>
      ${d.crops.map((c) => `<td>${num(c.daa[i])}</td>`).join('')}<td>${num(d.pasture_daa[i])}</td></tr>`).join('')}</tbody></table></div>
    <p class="small">${esc(d.method)}</p>
    <p class="small">Source: <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.source)}</a>.</p>`;
}

async function boot() {
  applyText();
  const idx = await api.areas();
  state.list = idx.areas;
  $('places').innerHTML = state.list.map((a) => `<option value="${esc(a.name)}">`).join('');
  $('largest').innerHTML = [...state.list].sort((a, b) => b.arable_daa - a.arable_daa).slice(0, 6)
    .map((a) => `<button type="button" class="link-btn" data-code="${a.code}">${esc(a.name)}</button>`).join(', ');
  $('largest').onclick = (e) => { const b = e.target.closest('[data-code]'); if (b) { $('place').value = b.textContent; show(b.dataset.code); } };
  $('find').onsubmit = (e) => {
    e.preventDefault();
    const q = $('place').value || $('place').placeholder;
    const code = findCode(q);
    $('find-msg').textContent = code ? '' : t('area.notFound', { q });
    if (code) show(code);
  };
  const want = new URLSearchParams(location.search).get('area');
  const start = state.list.find((a) => a.code === want) || state.list.find((a) => a.code === EXAMPLE);
  if (start) { $('place').value = start.name; show(start.code); }
}

boot();

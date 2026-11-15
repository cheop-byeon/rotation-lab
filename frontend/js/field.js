// Field view: one field at a glance, in plain words. All visible text comes from the i18n file.
import { api } from './api.js';
import en from './i18n/en.js';
import { createDrawer, areaHa, centroid } from './draw.js';

const STR = en; // swap for another language file to translate the field view
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function t(path, params = {}) {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), STR);
  if (typeof v !== 'string') return v ?? path;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}
const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(STR.locale || STR.lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '—';
const fmtDateY = (iso) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(STR.locale || STR.lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const cropName = (n) => STR.crop[n] || n;

const ICON = {
  Barley: '🌾', Oats: '🌾', 'Spring wheat': '🌾', 'Field pea': '🌱', 'Faba bean': '🫘', 'Oilseed rape': '🌼', Potato: '🥔',
  'Grass–clover ley': '☘️', 'Silage maize': '🌽', 'Grain maize': '🌽', Soybean: '🫘', Sorghum: '🌾', Sunflower: '🌻',
};
const FAMILY_COLOUR = { Cereal: '#F1D58A', Legume: '#B5D99C', Brassica: '#F7E26B', Solanaceae: '#E3B98F', Forage: '#9CCB86', 'Warm cereal': '#F6C27A', Composite: '#F9D976' };
const LEVEL_ICON = { warning: '⚠️', watch: '👀', info: 'ℹ️', good: '✅' };

const state = { fields: [], field: null, pending: null, analysis: null, catalog: [], prio: new Set([0, 3]), mine: null, mineEdited: false, pickMap: null, pickMarker: null, miniMap: null, miniMarker: null, miniShape: null, drawer: null, vegFor: null };

// ------------------------------------------------------------------ static text
function applyText() {
  document.documentElement.lang = STR.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
}

// ------------------------------------------------------------------ chips
function chips(id, options, selected, onPick, multi = false) {
  const el = $(id);
  el.innerHTML = options.map((o, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${multi ? selected.has(i) : o.value === selected}">${o.label}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const i = +b.dataset.i;
    if (multi) {
      selected.has(i) ? selected.delete(i) : selected.add(i);
      b.setAttribute('aria-pressed', selected.has(i));
    } else {
      el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    }
    onPick(options[i].value, i);
  };
}

// ------------------------------------------------------------------ maps
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const reticle = () => L.divIcon({ className: '', html: '<div class="reticle"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });

function baseMap(el, opts) {
  const m = L.map(el, { attributionControl: true, ...opts });
  L.tileLayer(IMAGERY, { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(m);
  L.tileLayer(LABELS, { maxZoom: 18 }).addTo(m);
  new ResizeObserver(() => m.invalidateSize()).observe(el);
  return m;
}

function showMini(f) {
  if (!state.miniMap) {
    state.miniMap = baseMap($('mini-map'), { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false });
  }
  if (state.miniShape) { state.miniMap.removeLayer(state.miniShape); state.miniShape = null; }
  if (f.boundary) {
    const ll = f.boundary.coordinates[0].map(([x, y]) => [y, x]);
    state.miniShape = L.polygon(ll, { color: '#FFFDF8', weight: 3, fillColor: '#2E7D32', fillOpacity: 0.25, interactive: false }).addTo(state.miniMap);
    state.miniMap.fitBounds(ll, { padding: [20, 20], maxZoom: 16 });
  } else state.miniMap.setView([f.lat, f.lon], 11);
  if (state.miniMarker) state.miniMarker.setLatLng([f.lat, f.lon]);
  else state.miniMarker = L.marker([f.lat, f.lon], { icon: reticle(), interactive: false }).addTo(state.miniMap);
  state.miniMarker.setOpacity(f.boundary ? 0 : 1);
}

function setPick(lat, lon, fly, keepOutline = false) {
  state.pending.lat = +lat.toFixed(4); state.pending.lon = +lon.toFixed(4);
  if (!keepOutline && state.pending.boundary) { state.pending.boundary = null; state.drawer?.clear(); }
  if (state.pickMarker) state.pickMarker.setLatLng([lat, lon]);
  else state.pickMarker = L.marker([lat, lon], { icon: reticle(), interactive: false }).addTo(state.pickMap);
  if (fly) state.pickMap.setView([lat, lon], 13);
  $('pick-status').textContent = t('field.picked', { lat: state.pending.lat, lon: state.pending.lon });
}

// ------------------------------------------------------------------ field
function renderField() {
  const f = state.field;
  $('field-name').textContent = f ? `${f.name} · ${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}` : '—';
  $('demo-note').hidden = !f?.demo;
  // Demo fields: offer the other ones (e.g. Norway and Hungary) so each can be shown without setup.
  const others = state.fields.filter((d) => d.demo && d.id !== f?.id);
  $('demo-note').innerHTML = esc(t('field.demoNote')) + (others.length ? ` ${esc(t('field.otherDemo'))} ${others.map((d) =>
    `<button type="button" class="link-btn" data-demo="${d.id}">${esc(d.name)}</button>`).join(', ')}` : '');
  $('demo-note').querySelectorAll('[data-demo]').forEach((b) => { b.onclick = () => switchField(+b.dataset.demo); });
  $('choose-btn').textContent = t(f && !f.demo ? 'field.change' : 'field.choose');
  if (f) showMini(f);
  // Keep the two views on the same field: links to the data view carry it, and so does this page's address.
  const q = !f ? '' : f.id ? `?field=${f.id}` : `?${new URLSearchParams({ lat: f.lat, lon: f.lon, name: f.name || '' })}`;
  document.querySelectorAll('a[data-anchor]').forEach((a) => { a.href = `/data${q}${a.dataset.anchor ? '#' + a.dataset.anchor : ''}`; });
  if (f?.id) history.replaceState(null, '', `?field=${f.id}`);
}

function switchField(id) {
  const f = state.fields.find((x) => x.id === id);
  if (!f) return;
  state.field = f; state.mine = null; state.mineEdited = false;
  history.replaceState(null, '', `?field=${id}`);
  renderField(); analyze(f);
}

function openChooser(startDrawing = false) {
  const ch = $('chooser');
  if (!ch.hidden && !startDrawing) { ch.hidden = true; $('choose-btn').textContent = t(state.field && !state.field.demo ? 'field.change' : 'field.choose'); return; }
  ch.hidden = false;
  $('choose-btn').textContent = t('field.close');
  const f = state.field || { lat: 63.46, lon: 10.92 };
  state.pending = { ...f, name: f.demo ? t('field.defaultName') : f.name, id: f.demo ? null : f.id, demo: 0 };
  $('f-name').value = state.pending.name;
  const opts = (key, values) => values.map((v) => ({ value: v, label: t(`field.${key}.${v}`) }));
  chips('q-soil', opts('soil', ['Sandy', 'Loamy', 'Clayey', 'Peat', 'Unknown']), state.pending.soil, (v) => { state.pending.soil = v; });
  chips('q-drainage', opts('drainage', ['Good', 'Moderate', 'Poor', 'Unknown']), state.pending.drainage, (v) => { state.pending.drainage = v; });
  chips('q-irrigation', opts('irrigation', ['Yes', 'No', 'Unknown']), state.pending.irrigation, (v) => { state.pending.irrigation = v; });
  chips('q-previous', state.catalog.map((c) => ({ value: c.name, label: `${ICON[c.name] || '🌱'} ${esc(cropName(c.name))}` })), state.pending.previous_crop, (v) => { state.pending.previous_crop = v; });
  if (!state.pickMap) {
    state.pickMap = baseMap($('pick-map'), { scrollWheelZoom: false });
    state.pickMap.on('click', (e) => { if (!state.drawer?.drawing) setPick(e.latlng.lat, ((e.latlng.lng + 180) % 360 + 360) % 360 - 180, false); });
    state.drawer = createDrawer(state.pickMap, { color: '#2E7D32', onChange: updateOutlineUI });
  }
  setPick(f.lat, f.lon, true, true);
  state.drawer.set(state.pending.boundary || null);
  if (state.pending.boundary) state.drawer.fit();
  if (startDrawing) { state.pickMap.setView([state.pending.lat, state.pending.lon], 16); state.drawer.start(); }
  ch.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateOutlineUI(st) {
  const show = (id, on) => { $(id).hidden = !on; };
  show('outline-start', !st.drawing); show('outline-undo', st.drawing && st.points > 0);
  show('outline-done', st.drawing); show('outline-cancel', st.drawing); show('outline-clear', !st.drawing && !!st.shape);
  $('outline-start').textContent = t(st.shape ? 'outline.redraw' : 'outline.start');
  $('outline-status').textContent = st.drawing
    ? t('outline.drawing', { n: st.points, ha: st.areaHa ? st.areaHa.toFixed(1) : '0' })
    : st.shape ? t('outline.set', { ha: st.areaHa.toFixed(1) }) : t('outline.intro');
}

function finishOutline() {
  const shape = state.drawer.finish();
  if (!shape) { $('outline-status').textContent = t('outline.tooFew'); return; }
  const ha = areaHa(shape);
  if (ha < 0.3) { state.drawer.clear(); $('outline-status').textContent = t('outline.tooSmall', { ha: ha.toFixed(2) }); return; }
  state.pending.boundary = shape;
  const [lat, lon] = centroid(shape);
  setPick(lat, lon, false, true);
}

function readPending() {
  return { ...state.pending, name: $('f-name').value.trim() || t('field.defaultName'), notes: '' };
}

// ------------------------------------------------------------------ analysis
async function analyze(f) {
  $('loading').className = 'loading';
  $('loading').textContent = t('app.loading');
  try {
    const d = await api.analysis(f);
    state.analysis = d;
    $('loading').textContent = '';
    $('results').hidden = false;
    renderNow(d); renderTodo(d); renderSeason(d); renderCrops(d); renderPrioChips(); await renderPlan(); renderSource(d);
    renderSpace(f); renderChanged(f); renderCropCheck(f); renderAround(f);
  } catch (e) {
    $('loading').className = 'loading error';
    $('loading').textContent = t('app.failed', { error: e.message });
  }
}

function gauge(icon, k, v, d) {
  return `<div class="gauge"><div class="ic" aria-hidden="true">${icon}</div><div><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div></div>`;
}

function renderNow(d) {
  const n = d.now;
  $('now-headline').textContent = t(`now.phase.${d.phase}`);
  const out = [];
  if (n.rain_30d != null && n.rain_30d_normal) {
    const r = n.rain_30d / n.rain_30d_normal;
    out.push(gauge('🌧️', t('now.rain'), t(r < 0.7 ? 'now.rainLess' : r > 1.3 ? 'now.rainMore' : 'now.rainNormal'),
      t('now.rainDetail', { mm: Math.round(n.rain_30d), normal: Math.round(n.rain_30d_normal) })));
  }
  if (n.root_wetness_pct != null) {
    const p = n.root_wetness_pct;
    out.push(gauge('🌱', t('now.soil'), t(p <= 20 ? 'now.soilDry' : p >= 80 ? 'now.soilWet' : 'now.soilNormal'), t('now.soilDetail', { date: fmtDate(n.soil_date) })));
  }
  if (n.tmean_7d != null && n.tmean_7d_normal != null) {
    const diff = n.tmean_7d - n.tmean_7d_normal;
    out.push(gauge('🌡️', t('now.temp'), t(diff <= -1.5 ? 'now.tempCool' : diff >= 1.5 ? 'now.tempWarm' : 'now.tempNormal'),
      t('now.tempDetail', { t: n.tmean_7d.toFixed(1), normal: n.tmean_7d_normal.toFixed(1) })));
  }
  $('gauges').innerHTML = out.join('');
  $('now-note').textContent = t('now.dataNote', { date: fmtDate(n.date) });
}

function advText(a) {
  const p = a.params || {};
  const S = STR.adv[a.code];
  if (!S) return { title: a.title, action: a.action, why: a.detail };
  let action = S.action;
  if (p.irrigated && S.actionIrrigated) action = S.actionIrrigated;
  if (p.poor_drainage && S.actionPoor) action = S.actionPoor;
  const vars = {
    pct: a.code === 'soil_dry' ? 100 - Math.round(p.pct) : a.code === 'soil_wet' ? Math.round(p.pct) : (p.pct_of_normal ?? p.pct),
    rain: Math.round(p.rain_mm ?? 0), et0: Math.round(p.et0_mm ?? 0),
    safe: fmtDate(p.safe_after), last: fmtDate(p.last_frost), early: fmtDate(p.early_autumn_frost),
    date: fmtDate(a.code === 'frost_autumn' ? p.first_autumn_frost : p.date), days: p.frost_free_days ?? p.extra_days,
    nights: p.nights, crops: (p.best_crops || []).map((c) => cropName(c.name).toLowerCase()).join(', ') || '—',
  };
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return { title: S.title, action: fill(action), why: fill(S.why) };
}

function renderTodo(d) {
  const items = d.advisories.filter((a) => a.code !== 'data_lag' || d.advisories.length === 1);
  $('todo').innerHTML = items.map((a) => {
    const x = advText(a);
    return `<article class="task" data-level="${a.level}">
      <span class="lvl"><span aria-hidden="true">${LEVEL_ICON[a.level]}</span>${esc(t(`todo.level.${a.level}`))}</span>
      <h3>${esc(x.title)}</h3><p>${esc(x.action)}</p>
      <details><summary>${esc(t('todo.why'))}</summary><p>${esc(x.why)}</p></details></article>`;
  }).join('');
}

// ------------------------------------------------------------------ season calendar
function seasonStart(d) {
  const last = new Date(d.now.date + 'T00:00:00Z');
  if (d.location.hemisphere === 'north') return Date.UTC(last.getUTCFullYear(), 0, 1);
  const y = last.getUTCMonth() >= 6 ? last.getUTCFullYear() : last.getUTCFullYear() - 1;
  return Date.UTC(y, 6, 1);
}

function renderSeason(d) {
  const fr = d.frost, start = seasonStart(d), YEAR = 365 * 864e5;
  const frac = (iso) => Math.min(1, Math.max(0, (Date.parse(iso + 'T00:00:00Z') - start) / YEAR));
  const W = 700, X0 = 10, BW = 680, Y = 34, H = 44;
  const C = { frost: '#9CC3EA', maybe: '#F2C14E', safe: '#7CB66F' };
  const segs = fr.frost_years ? [
    [0, frac(fr.last_spring_median), 'frost'], [frac(fr.last_spring_median), frac(fr.last_spring_safe), 'maybe'],
    [frac(fr.last_spring_safe), frac(fr.first_fall_early), 'safe'], [frac(fr.first_fall_early), frac(fr.first_fall_median), 'maybe'],
    [frac(fr.first_fall_median), 1, 'frost'],
  ] : [[0, 1, 'safe']];
  const months = Array.from({ length: 12 }, (_, i) => new Date(start + i * (YEAR / 12) + 5 * 864e5).toLocaleDateString(STR.locale || STR.lang, { month: 'short', timeZone: 'UTC' }));
  const todayF = Math.min(1, Math.max(0, (Date.now() - start) / YEAR));
  const rects = segs.filter(([a, b]) => b > a).map(([a, b, k]) =>
    `<rect x="${(X0 + a * BW).toFixed(1)}" y="${Y}" width="${((b - a) * BW).toFixed(1)}" height="${H}" fill="${C[k]}"/>`).join('');
  const ticks = months.map((m, i) => `<text x="${X0 + (i + 0.5) * BW / 12}" y="22" text-anchor="middle" font-size="15" fill="#4A5A4C">${esc(m)}</text>
    ${i ? `<line x1="${X0 + i * BW / 12}" x2="${X0 + i * BW / 12}" y1="${Y}" y2="${Y + H}" stroke="#FFFDF8" stroke-opacity=".6"/>` : ''}`).join('');
  const tx = X0 + todayF * BW;
  $('calendar').innerHTML = `<svg viewBox="0 0 ${W} 112" role="img" aria-label="${esc(t('season.title'))}">
    <clipPath id="calclip"><rect x="${X0}" y="${Y}" width="${BW}" height="${H}" rx="10"/></clipPath>
    ${ticks}<g clip-path="url(#calclip)">${rects}</g>
    <line x1="${tx}" x2="${tx}" y1="${Y - 6}" y2="${Y + H + 6}" stroke="#1F2A1F" stroke-width="3"/>
    <text x="${Math.min(W - 40, Math.max(30, tx))}" y="${Y + H + 26}" text-anchor="middle" font-size="16" font-weight="700" fill="#1F2A1F">▲ ${esc(t('season.today'))}</text></svg>
    <div class="cal-legend"><span><i style="background:${C.frost}"></i>${esc(t('season.frost'))}</span><span><i style="background:${C.maybe}"></i>${esc(t('season.maybe'))}</span><span><i style="background:${C.safe}"></i>${esc(t('season.safe'))}</span></div>`;
  const facts = [];
  if (fr.frost_years) {
    facts.push(t('season.lastFrost', { date: fmtDate(fr.last_spring_median), safe: fmtDate(fr.last_spring_safe) }));
    facts.push(t('season.firstFrost', { date: fmtDate(fr.first_fall_median) }));
    facts.push(t('season.length', { days: fr.frost_free_days_median }));
  } else facts.push(t('season.noFrost'));
  const sow = d.suitability.filter((s) => s.status === 'Well suited' && s.sow_safe).slice(0, 3);
  sow.forEach((s) => facts.push(t('season.sowFrom', { crop: cropName(s.name), date: fmtDate(s.sow_safe) })));
  if (fr.frost_years && sow.some((s) => s.sow_safe < fr.last_spring_safe)) facts.push(t('season.hardy'));
  $('season-facts').innerHTML = facts.map((f) => `<li>${esc(f)}</li>`).join('');
}

// ------------------------------------------------------------------ crops
function cropReason(s) {
  const total = s.seasons, n = Math.round(s.thermal_reliability * total / 100);
  if (s.status === 'Well suited') return `${t('crops.ripened', { n, total })} · ${t('crops.sowFrom', { date: fmtDate(s.sow_safe) })}`;
  if (s.thermal_reliability < 80) return t('crops.shortSeason', { n, total });
  if (s.water_ratio != null && s.water_ratio < 0.7) return t('crops.thirsty');
  if (s.heat_days >= 5) return t('crops.hot');
  return t('crops.ripened', { n, total });
}

function renderCrops(d) {
  const groups = [['Well suited', 'good', '#2E7D32'], ['Marginal', 'ok', '#8A5A00'], ['Poor fit', 'bad', '#B42318']];
  $('crop-groups').innerHTML = groups.map(([status, key, colour]) => {
    const list = d.suitability.filter((s) => s.status === status);
    return `<div class="group ${key}"><h3><span class="dot" style="background:${colour}" aria-hidden="true"></span>${esc(t(`crops.${key}`))}</h3>
      ${list.length ? `<div class="crop-grid">${list.map((s) => `<div class="crop"><span class="em" aria-hidden="true">${ICON[s.name] || '🌱'}</span>
        <div><b>${esc(cropName(s.name))}</b><span>${esc(cropReason(s))}</span></div></div>`).join('')}</div>` : `<p class="muted">${esc(t('crops.none'))}</p>`}</div>`;
  }).join('');
}

// ------------------------------------------------------------------ what's grown around you (satellite, ~2 km)
const AROUND_COLOUR = { grass: '#2fa477', winter_crop: '#2e98c4', spring_crop: '#c8801f', late_crop: '#9d5bdb', bare: '#8a8f98', unclear: '#B8B3A6' };
let aroundMap;
async function renderAround(f) {
  const box = $('around'), key = JSON.stringify(f.boundary || [f.lat, f.lon]);
  state.aroundFor = key;
  if (!f.boundary) { box.innerHTML = `<p class="muted">${esc(t('around.noOutline'))}</p>`; return; }
  box.innerHTML = `<p class="loading">${esc(t('around.loading'))}</p>`;
  try {
    const d = await api.neighbourhood(f.boundary);
    if (state.aroundFor !== key) return;
    if (d.status !== 'ok') { box.innerHTML = `<p class="muted">${esc(d.reason || '')}</p>`; return; }
    const use = d.seasons.filter((s) => s.usable), last = use[use.length - 1];
    const name = (k) => t(`space.hint.${k}`).toLowerCase();
    // Order, not percentages: a check against official statistics showed the order holds better than the numbers.
    const ranked = Object.entries(last?.shares || {}).filter(([k, v]) => k !== 'unclear' && k !== 'bare' && v >= 0.1).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const lines = [];
    if (ranked.length) lines.push(t(ranked.length > 1 ? 'around.mostly2' : 'around.mostly1', { season: last.label, ha: Math.round(d.farmland_ha), a: name(ranked[0]), b: ranked[1] ? name(ranked[1]) : '' }));
    if (!d.change) lines.push(t('around.tooFew'));
    else if (!d.change.notable.length) lines.push(t('around.noShift', { range: d.change.seasons }));
    else d.change.notable.forEach((k) => lines.push(t(d.change.classes[k].pp_per_year > 0 ? 'around.more' : 'around.less', { type: name(k), range: d.change.seasons })));
    const legend = Object.keys(AROUND_COLOUR).map((k) => `<span><i style="background:${AROUND_COLOUR[k]}"></i>${esc(t(`space.hint.${k}`))}</span>`).join('');
    box.innerHTML = `<div id="around-map" class="zones-map"></div><span class="cal-legend zone-key">${legend}</span>
      <ul class="changes">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">${esc(t('around.note', { season: d.map.season }))}</p>`;
    if (aroundMap) aroundMap.remove();
    aroundMap = L.map('around-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(aroundMap);
    const [w, s, e, n] = d.bbox;
    aroundMap.fitBounds([[s, w], [n, e]]);  // set the view before adding vector layers
    if (d.map.cells) L.geoJSON(d.map.cells, { style: (ft) => ({ stroke: false, fillColor: AROUND_COLOUR[ft.properties.class], fillOpacity: 0.7 }) }).addTo(aroundMap);
    L.polygon(f.boundary.coordinates[0].map(([x, y]) => [y, x]), { color: '#FFFDF8', weight: 3, fill: false, interactive: false }).addTo(aroundMap);
  } catch (e) {
    if (state.aroundFor === key) box.innerHTML = `<p class="loading error">${esc(t('around.failed', { error: e.message }))}</p>`;
  }
}

// ------------------------------------------------------------------ what has changed here (since the 1990s)
async function renderChanged(f) {
  const box = $('changed'), key = `${f.lat},${f.lon}`;
  state.changeFor = key;
  box.innerHTML = `<p class="loading">${esc(t('changed.loading'))}</p>`;
  try {
    const d = await api.change(f.lat, f.lon);
    if (state.changeFor !== key) return;
    // Days above 30 °C already say what days above 25 °C would; show the hotter one when both changed.
    const both = ['warm_days', 'hot_days'].every((c) => d.metrics.find((m) => m.code === c)?.consistent);
    const clear = d.metrics.filter((m) => m.consistent && !(both && m.code === 'warm_days'));
    const rest = d.metrics.filter((m) => !m.consistent);
    const pct = (m) => Math.round(100 * Math.abs(m.change) / (m.then || 1));
    const whole = (m, v) => (m.unit === 'days' ? Math.round(v) : v);  // "about 114 days", not 114.3
    const line = (m) => t(`changed.m.${m.code}.${m.change > 0 ? 'up' : 'down'}`, {
      now: m.now_label || whole(m, m.now), was: m.then_label || whole(m, m.then), d: whole(m, Math.abs(m.change)), pct: pct(m), then: d.then });
    box.innerHTML = `<p class="muted">${esc(t('changed.intro', { now: d.now, then: d.then }))}</p>
      ${clear.length ? `<ul class="changes">${clear.map((m) => `<li>
        <span class="arrow" aria-hidden="true">${m.change > 0 ? '▲' : '▼'}</span>${esc(line(m))}</li>`).join('')}</ul>`
        : `<p>${esc(t('changed.noneClear'))}</p>`}
      ${rest.length ? `<p>${esc(t('changed.noClear', { list: rest.map((m) => t(`changed.name.${m.code}`)).join(', ') }))}</p>` : ''}
      <p class="muted small">${esc(t('changed.note', { record: d.record }))}</p>`;
  } catch (e) {
    if (state.changeFor === key) box.innerHTML = `<p class="loading error">${esc(t('changed.failed', { error: e.message }))}</p>`;
  }
}

// ------------------------------------------------------------------ is this crop still a good choice here?
function renderCropCheck(f) {
  const sel = $('cc-crop');
  if (!sel.options.length) {
    sel.innerHTML = state.catalog.map((c) => `<option value="${esc(c.name)}">${esc(cropName(c.name))}</option>`).join('');
    sel.value = state.catalog.some((c) => c.name === 'Potato') ? 'Potato' : state.catalog[0]?.name;
  }
  sel.onchange = () => showCropCheck(f, sel.value);
  showCropCheck(f, sel.value);
}

async function showCropCheck(f, crop) {
  const box = $('cc-out'), key = `${f.lat},${f.lon},${crop}`;
  state.ccFor = key;
  box.innerHTML = `<p class="loading">${esc(t('changed.loading'))}</p>`;
  try {
    const d = await api.cropCheck(f.lat, f.lon, crop);
    if (state.ccFor !== key) return;
    const r = d.ripened;
    const whole = (m, v) => (m.unit === 'days' ? Math.round(v) : v);
    const clear = d.measures.filter((m) => m.consistent);
    const rest = d.measures.filter((m) => !m.consistent);
    const lines = [t('cc.ripened', { now: r.now, nowOf: r.now_of, then: r.then, thenOf: r.then_of, range: d.then }),
      ...clear.map((m) => t(`cc.m.${m.code}.${m.change > 0 ? 'up' : 'down'}`, { now: whole(m, m.now), was: whole(m, m.then), d: whole(m, Math.abs(m.change)), then: d.then }))];
    const water = d.measures.find((m) => m.code === 'water_pct');
    if (water && water.now < 70) lines.push(t('cc.thirsty', { now: water.now }));
    box.innerHTML = `<ul class="changes">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${rest.length ? `<p>${esc(t('cc.noClear', { list: rest.map((m) => t(`cc.name.${m.code}`)).join(', ') }))}</p>` : ''}
      <p class="muted small">${esc(t('cc.note'))}${d.family === 'Solanaceae' ? ' ' + esc(t('cc.blightNote')) : ''}</p>`;
  } catch (e) {
    if (state.ccFor === key) box.innerHTML = `<p class="loading error">${esc(t('cc.failed', { error: e.message }))}</p>`;
  }
}

// ------------------------------------------------------------------ rotation plan
function candidatePlans(suit) {
  const usable = suit.filter((s) => s.status !== 'Poor fit');
  const best = {};
  for (const s of usable) if (!best[s.family] || s.score > best[s.family].score) best[s.family] = s;
  const fams = Object.values(best).sort((a, b) => b.score - a.score).slice(0, 4);
  const plans = [];
  const add = (crops) => {
    const name = crops.map(cropName).join(' → ');
    if (!plans.some((p) => p.name === name)) plans.push({ name, years: crops });
  };
  const catalog = Object.fromEntries(state.catalog.map((c) => [c.name, c]));
  for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) for (let k = j + 1; k < fams.length; k++) {
    // nitrogen fixers first, but never two in a row: a grain crop should use the nitrogen they leave
    const names = [fams[i], fams[j], fams[k]].map((s) => s.name);
    const fixers = names.filter((n) => catalog[n]?.n_fixing), others = names.filter((n) => !catalog[n]?.n_fixing);
    add(fixers.length >= 2 ? [fixers[0], others[0] ?? fixers[2], fixers[1]] : [...fixers, ...others]);
  }
  if (usable.length) { // a one-crop baseline, for contrast
    const top = usable[0].name, alt = usable.find((s) => s.family === usable[0].family && s.name !== top)?.name || top;
    add([top, alt, top]);
  }
  if (state.mine) add(state.mine);
  return plans.slice(0, 8);
}

function renderPrioChips() {
  chips('q-prio', STR.plan.prio.map((label, i) => ({ value: i, label: esc(label) })), state.prio, () => renderPlan(), true);
}

function planReasons(r) {
  const cat = Object.fromEntries(state.catalog.map((c) => [c.name, c]));
  const suit = Object.fromEntries(state.analysis.suitability.map((s) => [s.name, s]));
  const prev = cat[state.field.previous_crop];
  const fams = [prev?.family, ...r.years.map((n) => cat[n]?.family)].filter(Boolean);
  const repeats = fams.slice(1).filter((f, i) => f === fams[i]).length;
  const out = [];
  const fixer = r.years.find((n) => cat[n]?.n_fixing && !cat[n]?.perennial);
  if (fixer) out.push(['plus', t('plan.reason.nitrogen', { crop: cropName(fixer) })]);
  if (r.years.some((n) => cat[n]?.perennial)) out.push(['plus', t('plan.reason.ley')]);
  if (!repeats && new Set(r.years.map((n) => cat[n]?.family)).size === r.years.length) out.push(['plus', t('plan.reason.variety')]);
  const seq = [prev, ...r.years.map((n) => cat[n])].filter(Boolean);
  const legumeRun = seq.slice(1).some((c, i) => c.n_fixing && seq[i].n_fixing && c.family !== seq[i].family);
  if (repeats) out.push(['minus', t('plan.reason.repeat')]);
  if (legumeRun) out.push(['minus', t('plan.reason.legumes')]);
  const weakest = r.years.map((n) => suit[n]).filter(Boolean).sort((a, b) => a.thermal_reliability - b.thermal_reliability)[0];
  if (weakest && weakest.thermal_reliability < 80) out.push(['minus', t('plan.reason.risky', { crop: cropName(weakest.name), n: Math.round(weakest.thermal_reliability / 10) })]);
  if (r.components[1] < 70) out.push(['minus', t('plan.reason.water')]);
  return out;
}

const verdict = (s) => t(`plan.verdict.${s >= 75 ? 'strong' : s >= 60 ? 'good' : s >= 45 ? 'ok' : 'weak'}`);
const planName = (years) => years.map(cropName).join(' → ');

// The grower's own rotation is the subject; other sequences are offered as ideas.
async function renderPlan() {
  const d = state.analysis, f = state.field;
  const priorities = [0, 1, 2, 3].map((i) => (state.prio.has(i) ? 4 : 1));
  const plans = candidatePlans(d.suitability);
  if (!plans.length) { $('my-plan').innerHTML = ''; $('my-plan-strip').innerHTML = ''; return; }
  const { rankings } = await api.rank({ lat: f.lat, lon: f.lon, soil: f.soil, drainage: f.drainage, irrigation: f.irrigation,
    previous_crop: f.previous_crop, priorities, plans });
  if (!state.mine) { state.mine = [...rankings[0].years]; state.mineEdited = false; }
  const mine = rankings.find((r) => r.name === planName(state.mine)) || rankings[0];
  const cat = Object.fromEntries(state.catalog.map((c) => [c.name, c]));
  $('my-plan-strip').innerHTML = state.mine.map((n, i) => `<div class="plot" style="background-color:${FAMILY_COLOUR[cat[n]?.family] || '#DDE5D0'}">
      <span class="yr">${esc(t('plan.year', { n: i + 1 }))}</span><span class="em" aria-hidden="true">${ICON[n] || '🌱'}</span>
      <select data-y="${i}" aria-label="${esc(t('plan.year', { n: i + 1 }))}">${state.catalog.map((c) =>
        `<option value="${esc(c.name)}" ${c.name === n ? 'selected' : ''}>${esc(cropName(c.name))}</option>`).join('')}</select></div>`).join('');
  $('my-plan').innerHTML = `${state.mineEdited ? '' : `<p class="start-note">${esc(t('plan.start'))}</p>`}
    <div class="verdict"><b>${esc(t('plan.yours'))}: ${esc(verdict(mine.score))}</b><span class="muted">${esc(t('plan.score', { s: Math.round(mine.score) }))}</span></div>
    <ul class="reasons">${planReasons(mine).map(([k, txt]) => `<li class="${k}">${esc(txt)}</li>`).join('')}</ul>`;
  const others = rankings.filter((r) => r.name !== mine.name).slice(0, 4);
  state.others = others;
  $('other-plans').innerHTML = others.map((r, i) => `<div class="alt"><span>${r.years.map((n) => `${ICON[n] || '🌱'} ${esc(cropName(n))}`).join(' → ')}</span>
    <span class="alt-right"><b>${esc(verdict(r.score))} · ${Math.round(r.score)}</b><button class="btn secondary small-btn" type="button" data-use="${i}">${esc(t('plan.use'))}</button></span></div>`).join('');
}

// ------------------------------------------------------------------ field from space (NASA HLS)
function growWindow(season, lat) {
  const D = (y, m, d) => Date.UTC(y, m, d);
  if (lat >= 23.5) return [D(season, 3, 1), D(season, 9, 31)];
  if (lat >= 0) return [D(season, 0, 1), D(season, 11, 31)];
  if (lat > -23.5) return [D(season - 1, 6, 1), D(season, 5, 30)];
  return [D(season - 1, 9, 1), D(season, 3, 30)];
}

function greennessChart(veg) {
  const lat = veg.centroid.lat, W = 640, H = 230, L0 = 40, R = 10, T = 14, B = 34, PW = W - L0 - R, PH = H - T - B;
  const seasons = veg.seasons.filter((s) => s.clear_images >= 3);
  const latest = seasons[seasons.length - 1]?.season;
  const y = (v) => T + PH * (1 - Math.max(0, Math.min(1, v)));
  const lines = seasons.map((s) => {
    const [a, b] = growWindow(s.season, lat);
    const pts = veg.observations.filter((o) => o.ndvi != null).map((o) => [Date.parse(o.date + 'T00:00:00Z'), o.ndvi])
      .filter(([d]) => d >= a && d <= b).map(([d, v]) => [L0 + PW * (d - a) / (b - a), y(v)]);
    const now = s.season === latest;
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    return `<path d="${path}" fill="none" stroke="${now ? '#2E7D32' : '#B7BFB2'}" stroke-width="${now ? 3.5 : 2}" stroke-linejoin="round"/>` +
      (now ? pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#2E7D32"/>`).join('') : '');
  });
  const [a, b] = growWindow(latest, lat);
  const months = [];
  for (let m = new Date(a); m.getTime() <= b; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const x = L0 + PW * (m.getTime() - a) / (b - a);
    months.push(`<line x1="${x}" x2="${x}" y1="${T}" y2="${T + PH}" stroke="#E2DED2"/><text x="${x + 4}" y="${H - 12}" font-size="13" fill="#4A5A4C">${esc(m.toLocaleDateString(STR.locale || STR.lang, { month: 'short', timeZone: 'UTC' }))}</text>`);
  }
  const grid = [0, 0.5, 1].map((v) => `<line x1="${L0}" x2="${L0 + PW}" y1="${y(v)}" y2="${y(v)}" stroke="#E2DED2"/><text x="${L0 - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#4A5A4C">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('space.chartLabel'))}">${grid}${months.join('')}
    <text x="${L0 + 6}" y="${y(1) + 14}" font-size="12" fill="#4A5A4C">${esc(t('space.axisHigh'))}</text>
    <text x="${L0 + 6}" y="${y(0) - 6}" font-size="12" fill="#4A5A4C">${esc(t('space.axisLow'))}</text>${lines.join('')}</svg>
    <div class="cal-legend"><span><i style="background:#2E7D32"></i>${esc(t('space.thisYear', { y: seasons[seasons.length - 1]?.label ?? '' }))}</span><span><i style="background:#B7BFB2"></i>${esc(t('space.earlier'))}</span></div>`;
}

// Season check: a season clearly less green than the field's other seasons with the same likely crop, and its weather.
function seasonCheckNotes(veg) {
  const sc = veg.season_check;
  if (!sc) return [];
  const out = [];
  for (const r of sc.seasons.filter((x) => x.status === 'lower')) {
    out.push(t('check.lower', { y: r.label, pct: Math.round(-r.diff_pct), crop: t(`space.hint.${r.crop}`).toLowerCase() }));
    const f = (r.weather || []).map((w) => t(`check.f.${w.code}`, { r: t(`check.rank${w.rank}`), of: w.of, v: w.value, m: w.normal }));
    out.push(r.weather == null ? t('check.wxUnknown') : f.length ? t('check.wx', { list: f.join('; ') }) : t('check.wxNone'));
  }
  if (!out.length) out.push(sc.judged >= 2 ? t('check.none', { n: sc.judged }) : t('check.cannot'));
  return out;
}

// What the curve shape suggests, compared with what the grower entered (an observation, not a correction).
// Cereals and oilseed rape can be sown in spring or autumn (e.g. winter barley), so either pattern fits them.
const HINT_FOR_FAMILY = { Forage: ['grass'], Solanaceae: ['late_crop'], 'Warm cereal': ['late_crop'], Cereal: ['spring_crop', 'winter_crop'], Brassica: ['spring_crop', 'winter_crop'] };
function trendNote(veg) {
  const tr = veg.trend;
  if (!tr || !tr.seasons.length) return [];
  const range = `${tr.seasons[0].season}–${tr.seasons[tr.seasons.length - 1].season}`;
  if (tr.status === 'too_few') return [t('trend.tooFew', { n: tr.seasons.length, need: tr.min_seasons })];
  if (tr.status === 'mixed_crops') {
    const sc = tr.same_crop;
    if (!sc) return [t('trend.mixed')];
    const crop = t(`space.hint.${sc.crop}`).toLowerCase();
    if (sc.direction === 'none') return [t('trend.sameNone', { crop, n: sc.n })];
    return [t(sc.direction === 'rising' ? 'trend.sameRising' : 'trend.sameFalling', { crop, n: sc.n, pct: Math.abs(sc.pct_per_year) })];
  }
  if (tr.direction === 'none') return [t('trend.none', { range })];
  return [t(tr.direction === 'rising' ? 'trend.rising' : 'trend.falling', { range, pct: Math.abs(tr.pct_per_year) })];
}


function hintNotes(veg) {
  const known = veg.seasons.filter((s) => ['grass', 'winter_crop', 'spring_crop', 'late_crop', 'bare'].includes(s.crop_hint?.type));
  const out = [];
  if (known.length >= 3 && known.length === veg.seasons.length && new Set(known.map((s) => s.crop_hint.type)).size === 1) {
    out.push(t('space.pattern', { n: known.length, type: t(`space.hint.${known[0].crop_hint.type}`).toLowerCase() }));
  }
  const last = veg.seasons[veg.seasons.length - 1], f = state.field;
  const fam = state.catalog.find((c) => c.name === f?.previous_crop)?.family;
  const expected = fam ? (HINT_FOR_FAMILY[fam] || ['spring_crop']) : null;
  const seen = last?.crop_hint?.type;
  if (expected && ['grass', 'spring_crop', 'late_crop', 'winter_crop'].includes(seen) && !expected.includes(seen)) {
    out.push(t('space.mismatch', { y: last.label, type: t(`space.hint.${seen}`).toLowerCase(), crop: cropName(f.previous_crop).toLowerCase() }));
  }
  return out;
}

async function renderSpace(f) {
  const box = $('space');
  if (!f.boundary) {
    box.innerHTML = `<p>${esc(t('space.noOutline'))}</p><button class="btn secondary" type="button" id="space-outline">${esc(t('space.outlineBtn'))}</button>`;
    $('space-outline').onclick = () => openChooser(true);
    return;
  }
  const key = JSON.stringify(f.boundary);
  state.vegFor = key;
  box.innerHTML = `<p class="loading">${esc(t('space.loading'))}</p>`;
  try {
    const veg = await api.vegetation(f.boundary);
    if (state.vegFor !== key) return; // a newer field was chosen meanwhile
    const rows = veg.seasons.map((s) => `<tr><td><b>${esc(s.label)}</b></td>
      <td title="${esc(s.crop_hint?.evidence ?? '')}">${esc(t(`space.hint.${s.crop_hint?.type ?? 'unknown'}`))}</td>
      <td>${s.greenup_date ? esc(fmtDate(s.greenup_date)) : s.greenup_cloud_gap ? esc(t('space.cloudGap')) : '—'}</td>
      <td>${s.peak_date ? esc(fmtDate(s.peak_date)) : '—'}</td>
      <td>${s.peak_ndvi != null ? `<span class="pbar"><i style="width:${Math.max(0, s.peak_ndvi) * 100}%"></i></span>${s.peak_ndvi.toFixed(2)}` : '—'}</td>
      <td>${s.clear_images} / ${s.images}</td></tr>`).join('');
    const T = STR.space.table;
    setTimeout(() => renderZones(f.boundary, key), 0);
    box.innerHTML = `<p class="small muted">${esc(t('outline.set', { ha: veg.area_ha.toFixed(1) }))}</p>${greennessChart(veg)}
      <ul class="season-facts">${[...hintNotes(veg), ...trendNote(veg), ...seasonCheckNotes(veg)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="table-wrap"><table class="simple"><thead><tr><th>${esc(T.year)}</th><th>${esc(T.likely)}</th><th>${esc(T.up)}</th><th>${esc(T.peak)}</th><th>${esc(T.value)}</th><th>${esc(T.clear)}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 class="sub-h">${esc(t('zones.title'))}</h3>
      <div id="zones-map" class="zones-map"></div><p id="zones-text"></p>
      ${veg.delivery !== 'live' ? `<p class="demo-note">${esc(t('space.offline'))}</p>` : ''}
      <p class="small muted">${esc(t('space.hintNote'))} ${esc(t('space.ndviNote'))} ${esc(t('space.source', { from: fmtDateY(veg.period.start), to: fmtDateY(veg.period.end), clear: veg.stats.clear_images, total: veg.observations.length }))}</p>`;
  } catch (e) {
    if (state.vegFor === key) box.innerHTML = `<p class="loading error">${esc(t('space.failed', { error: e.message }))}</p>`;
  }
}

const ZONE_COLOUR = { weaker: '#C58A3D', average: '#D9D4C3', stronger: '#2E7D32' };
let zonesMap;
async function renderZones(boundary, key) {
  const text = () => $('zones-text');
  try {
    const z = await api.zones(boundary);
    if (state.vegFor !== key || !text()) return;
    if (z.status !== 'ok') { $('zones-map').hidden = true; text().textContent = z.status === 'too_small' ? t('zones.tooSmall') : z.message; return; }
    if (zonesMap) zonesMap.remove();
    zonesMap = L.map('zones-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(zonesMap);
    const layer = L.geoJSON(z.cells, { style: (ft) => ft.properties.zone === 'edge'
      ? { color: '#FFFDF8', weight: 1, dashArray: '3 3', fillOpacity: 0 }
      : { color: '#FFFDF8', weight: 0.6, fillColor: ZONE_COLOUR[ft.properties.zone], fillOpacity: 0.85 } });
    zonesMap.fitBounds(layer.getBounds(), { padding: [10, 10] }); // set the view before adding vector layers
    layer.addTo(zonesMap);
    L.polygon(boundary.coordinates[0].map(([x, y]) => [y, x]), { color: '#FFFDF8', weight: 3, fill: false, interactive: false }).addTo(zonesMap);
    const n = z.seasons_used.length, pct = (v) => Math.round(v * 100);
    const legend = ['weaker', 'average', 'stronger'].map((k) => `<span><i style="background:${ZONE_COLOUR[k]}"></i>${esc(t('zones.' + k))}</span>`).join('') +
      `<span><i class="edge"></i>${esc(t('zones.edge'))}</span>`;
    text().innerHTML = `<span class="cal-legend zone-key">${legend}</span><br>${esc(z.uniform ? t('zones.uniform', { n })
      : t('zones.summary', { w: pct(z.share.weaker), s: pct(z.share.stronger), n }))} ${esc(t('zones.note'))}
      <br><button class="btn secondary small-btn" type="button" id="zones-dl">${esc(t('zones.download'))}</button>`;
    $('zones-dl').onclick = () => {
      const fc = { type: 'FeatureCollection', name: `Rotation Lab zones · ${state.field?.name || 'field'}`,
        features: z.cells.features.map((f) => ({ ...f, properties: { ...f.properties, zone_id: { edge: 0, weaker: 1, average: 2, stronger: 3 }[f.properties.zone] } })) };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }));
      a.download = `zones_${(state.field?.name || 'field').replace(/[^\w-]+/g, '_')}.geojson`;
      a.click(); URL.revokeObjectURL(a.href);
    };
  } catch (e) {
    if (state.vegFor === key && text()) text().textContent = t('space.failed', { error: e.message });
  }
}

function renderSource(d) {
  const [from, to] = d.provenance.period.split(' → ');
  $('source-text').textContent = t('source.text', { from: fmtDateY(from), to: fmtDateY(to) });
}

// ------------------------------------------------------------------ wiring
function wire() {
  $('choose-btn').onclick = () => openChooser();
  $('locate-btn').onclick = () => {
    if (!navigator.geolocation) { $('pick-status').textContent = t('field.locationFailed'); return; }
    $('pick-status').textContent = t('field.locating');
    navigator.geolocation.getCurrentPosition((p) => setPick(p.coords.latitude, p.coords.longitude, true),
      () => { $('pick-status').textContent = t('field.locationFailed'); }, { timeout: 10000 });
  };
  $('show-btn').onclick = () => {
    state.field = readPending(); state.mine = null; state.mineEdited = false;
    $('chooser').hidden = true; renderField(); analyze(state.field);
    $('results').scrollIntoView({ behavior: 'smooth' });
  };
  $('save-btn').onclick = async () => {
    const f = readPending();
    const saved = f.id ? await api.updateField(f.id, f) : await api.createField(f);
    state.fields = await api.fields();
    state.pending = { ...saved };
    $('pick-status').textContent = t('field.saved');
  };
  $('my-plan-strip').onchange = (e) => {
    const sel = e.target.closest('select'); if (!sel) return;
    state.mine[+sel.dataset.y] = sel.value; state.mineEdited = true; renderPlan();
  };
  $('other-plans').onclick = (e) => {
    const b = e.target.closest('[data-use]'); if (!b) return;
    state.mine = [...state.others[+b.dataset.use].years]; state.mineEdited = true; renderPlan();
    $('plan-h').scrollIntoView({ behavior: 'smooth' });
  };
  $('print-btn').onclick = () => window.print();
  $('outline-start').onclick = () => { state.pickMap.setView([state.pending.lat, state.pending.lon], Math.max(state.pickMap.getZoom(), 15)); state.drawer.start(); };
  $('outline-undo').onclick = () => state.drawer.undo();
  $('outline-done').onclick = finishOutline;
  $('outline-cancel').onclick = () => state.drawer.cancel();
  $('outline-clear').onclick = () => { state.drawer.clear(); state.pending.boundary = null; };
}

async function boot() {
  applyText(); wire();
  try {
    const [cat, fields] = await Promise.all([api.crops(), api.fields()]);
    state.catalog = cat.crops; state.fields = fields;
    const want = Number(new URLSearchParams(location.search).get('field'));  // ?field=<id> opens that field (handy for demos)
    state.field = fields.find((f) => f.id === want) || fields.find((f) => !f.demo) || fields[0] || null;
    renderField();
    if (state.field) analyze(state.field); else openChooser();
  } catch (e) {
    $('loading').className = 'loading error';
    $('loading').textContent = t('app.failed', { error: e.message });
  }
}

boot();

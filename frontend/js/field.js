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
  $('demo-note').textContent = t('field.demoNote');
  $('choose-btn').textContent = t(f && !f.demo ? 'field.change' : 'field.choose');
  if (f) showMini(f);
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
    renderSpace(f);
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

function spaceInsight(veg) {
  const usable = veg.seasons.filter((s) => s.peak_ndvi != null && s.clear_images >= 8);
  if (usable.length < 2) return [];
  const out = [];
  const best = usable.reduce((a, b) => (b.peak_ndvi > a.peak_ndvi ? b : a));
  const worst = usable.reduce((a, b) => (b.peak_ndvi < a.peak_ndvi ? b : a));
  if (best.peak_ndvi - worst.peak_ndvi < 0.08) { // within measurement noise: don't single out a season
    out.push(t('space.similar', { lo: worst.peak_ndvi.toFixed(2), hi: best.peak_ndvi.toFixed(2) }), t('space.crops'));
    return out;
  }
  out.push(t('space.greenest', { y: best.label, v: best.peak_ndvi.toFixed(2), d: fmtDate(best.peak_date) }));
  out.push(t('space.least', { y: worst.label, v: worst.peak_ndvi.toFixed(2) }));
  const wx = Object.fromEntries((state.analysis?.seasons || []).map((s) => [s.label, s]));
  const pool = usable.map((s) => wx[s.label]).filter(Boolean);
  const w = wx[worst.label];
  if (w && pool.length >= 2) {
    if (w.longest_dry_spell === Math.max(...pool.map((s) => s.longest_dry_spell))) out.push(t('space.leastDry', { y: worst.label, days: w.longest_dry_spell }));
    else if (w.season_rain_mm === Math.max(...pool.map((s) => s.season_rain_mm))) out.push(t('space.leastWet', { y: worst.label, mm: w.season_rain_mm }));
    else out.push(t('space.leastNormal', { y: worst.label }));
  }
  out.push(t('space.crops'));
  return out;
}

// What the curve shape suggests, compared with what the grower entered (an observation, not a correction).
const HINT_FOR_FAMILY = { Forage: 'grass', Solanaceae: 'late_crop', 'Warm cereal': 'late_crop' };
function hintNotes(veg) {
  const known = veg.seasons.filter((s) => ['grass', 'winter_crop', 'spring_crop', 'late_crop', 'bare'].includes(s.crop_hint?.type));
  const out = [];
  if (known.length >= 3 && known.length === veg.seasons.length && new Set(known.map((s) => s.crop_hint.type)).size === 1) {
    out.push(t('space.pattern', { n: known.length, type: t(`space.hint.${known[0].crop_hint.type}`).toLowerCase() }));
  }
  const last = veg.seasons[veg.seasons.length - 1], f = state.field;
  const fam = state.catalog.find((c) => c.name === f?.previous_crop)?.family;
  const expected = fam ? (HINT_FOR_FAMILY[fam] || 'spring_crop') : null;
  const seen = last?.crop_hint?.type;
  if (expected && ['grass', 'spring_crop', 'late_crop', 'winter_crop'].includes(seen) && seen !== expected) {
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
    box.innerHTML = `<p class="small muted">${esc(t('outline.set', { ha: veg.area_ha.toFixed(1) }))}</p>${greennessChart(veg)}
      <ul class="season-facts">${[...hintNotes(veg), ...spaceInsight(veg)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="table-wrap"><table class="simple"><thead><tr><th>${esc(T.year)}</th><th>${esc(T.likely)}</th><th>${esc(T.up)}</th><th>${esc(T.peak)}</th><th>${esc(T.value)}</th><th>${esc(T.clear)}</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${veg.delivery !== 'live' ? `<p class="demo-note">${esc(t('space.offline'))}</p>` : ''}
      <p class="small muted">${esc(t('space.hintNote'))} ${esc(t('space.ndviNote'))} ${esc(t('space.source', { from: fmtDateY(veg.period.start), to: fmtDateY(veg.period.end), clear: veg.stats.clear_images, total: veg.observations.length }))}</p>`;
  } catch (e) {
    if (state.vegFor === key) box.innerHTML = `<p class="loading error">${esc(t('space.failed', { error: e.message }))}</p>`;
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
    state.field = fields.find((f) => !f.demo) || fields[0] || null;
    renderField();
    if (state.field) analyze(state.field); else openChooser();
  } catch (e) {
    $('loading').className = 'loading error';
    $('loading').textContent = t('app.failed', { error: e.message });
  }
}

boot();

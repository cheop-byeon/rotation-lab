import { api } from './api.js';
import { createMap } from './map.js';
import { renderCharts, tableFor, renderVegCharts, renderTrendChart, renderChangeChart, renderAroundChart } from './charts.js';
import { createDrawer, centroid } from './draw.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const sign = (n) => (n > 0 ? '+' : '') + n;
const ICON = {
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 15 14H1L8 1zm-.8 5v4h1.6V6H7.2zm0 5v1.6h1.6V11H7.2z"/></svg>',
  watch: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4v4.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M7.2 7h1.6v5H7.2zM7.2 4h1.6v1.6H7.2z" fill="#151D27"/></svg>',
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m4.5 8.2 2.3 2.3 4.7-4.8" fill="none" stroke="#151D27" stroke-width="1.8"/></svg>',
};
const LEVEL_LABEL = { warning: 'Warning', watch: 'Watch', info: 'Info', good: 'Normal' };

const state = { fields: [], fieldId: null, boundary: null, veg: null, vegFor: null, analysis: null, crops: [], goals: [], plans: [], priorities: [4, 3, 2, 3], tab: 'recent' };

// ------------------------------------------------------------------ status
function status(text, mode = '') {
  $('mission-text').textContent = text;
  $('mission-status').className = 'mission-status ' + mode;
}

function readForm() {
  return {
    name: $('f-name').value.trim() || 'Unnamed field', lat: +$('f-lat').value, lon: +$('f-lon').value,
    soil: $('f-soil').value, drainage: $('f-drainage').value, irrigation: $('f-irrigation').value,
    previous_crop: $('f-previous').value, notes: '', boundary: state.boundary,
  };
}
function fillForm(f) {
  $('f-name').value = f.name; $('f-lat').value = f.lat; $('f-lon').value = f.lon;
  $('f-soil').value = f.soil; $('f-drainage').value = f.drainage; $('f-irrigation').value = f.irrigation;
  $('f-previous').value = f.previous_crop;
  state.boundary = f.boundary || null;
  drawer?.set(state.boundary);
}

// ------------------------------------------------------------------ fields
function renderSaved() {
  $('saved-list').innerHTML = state.fields.length ? state.fields.map(f => `
    <button type="button" class="saved-item" data-id="${f.id}" aria-current="${f.id === state.fieldId}">
      <span>${esc(f.name)}</span><small>${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}</small></button>`).join('')
    : '<span class="muted" style="font-size:.8rem">No saved fields yet.</span>';
  const current = state.fields.find(f => f.id === state.fieldId);
  $('demo-badge').hidden = !current?.demo;
  $('delete-btn').hidden = state.fieldId == null;
  $('save-btn').textContent = state.fieldId == null ? 'Save field' : 'Update field';
  // Keep the two views on the same field: this page's address and the link back carry the field id.
  // (An unsaved location stays in this page's address so a reload keeps it; save the field to carry it to the field view.)
  const lat = $('f-lat').value, lon = $('f-lon').value;
  const q = state.fieldId != null ? `?field=${state.fieldId}`
    : lat && lon ? `?${new URLSearchParams({ lat, lon, name: $('f-name').value })}` : '';
  history.replaceState(null, '', `${location.pathname}${q}${location.hash}`);
  $('to-field').href = state.fieldId != null ? `/field?field=${state.fieldId}` : '/field';
}

// Arriving from a field-view "See the evidence" link (/data?field=3#crops): scroll to that section once the
// sections above it have loaded, unless the reader has already scrolled.
let readerScrolled = false;
['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach((ev) => addEventListener(ev, () => { readerScrolled = true; }, { once: true, passive: true }));
function settleHash() {
  const el = location.hash && document.getElementById(location.hash.slice(1));
  if (el && !readerScrolled) el.scrollIntoView({ block: 'start', behavior: 'instant' });
}
async function loadFields() { state.fields = await api.fields(); renderSaved(); }

// ------------------------------------------------------------------ analysis
async function analyze() {
  const f = readForm();
  if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon) || f.lat < -60 || f.lat > 75) {
    status('Enter a latitude between −60 and 75 and a longitude between −180 and 180.', 'error'); return;
  }
  $('analyze-btn').disabled = true;
  status(`Acquiring NASA POWER daily data since 1981 for ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)} (the last 10 years drive the analysis)… first request ~5 s, then cached`, 'busy');
  mapCtl.setTarget(f.lat, f.lon); mapCtl.showCell(f.lat, f.lon);
  try {
    const t0 = performance.now();
    const d = await api.analysis(f);
    state.analysis = d;
    renderHero(d, f); renderTelemetry(d); renderAdvisories(d); renderCharts(d); renderTable(); renderSuitability(d); renderSeasons(d); renderProvenance(d, f);
    renderSatellite(f, d); renderChange(f); renderCropCheck(f); renderAround(f);
    await rankPlans();
    settleHash();
    const src = { live: 'live from NASA POWER', cache: 'from local cache', 'stale-cache': 'from an older cache (NASA POWER unreachable)', snapshot: 'from the offline snapshot' }[d.provenance.delivery];
    status(`Analysis complete · ${d.provenance.days.toLocaleString()} days of data ${src} · ${((performance.now() - t0) / 1000).toFixed(1)} s · latest day ${d.now.date}`, d.provenance.delivery === 'live' || d.provenance.delivery === 'cache' ? '' : 'error');
  } catch (e) {
    status(`Analysis failed: ${e.message}`, 'error');
  } finally { $('analyze-btn').disabled = false; }
}

// ------------------------------------------------------------------ map hero overlays
function sparkline(soil) {
  const all = [...soil.root, ...soil.root_nrt, ...soil.normal_p10, ...soil.normal_p90].filter(v => v != null);
  const lo = Math.min(...all), hi = Math.max(...all), W = 266, H = 70, n = soil.dates.length;
  const x = (i) => (i / (n - 1)) * W, y = (v) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const path = (arr) => arr.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .reduce((acc, p) => { if (p) acc[acc.length - 1].push(p); else if (acc[acc.length - 1].length) acc.push([]); return acc; }, [[]])
    .filter(seg => seg.length > 1).map(seg => 'M' + seg.join('L')).join('');
  const band = soil.normal_p90.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L') + 'L' +
    soil.normal_p10.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse().join('L');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Root-zone wetness over 12 months against its typical range">
    <path d="M${band}Z" fill="rgba(163,174,189,.16)"/>
    <path d="${path(soil.root)}" fill="none" stroke="var(--s-soil)" stroke-width="2"/>
    <path d="${path(soil.root_nrt)}" fill="none" stroke="var(--s-soil)" stroke-width="2" stroke-dasharray="4 3"/></svg>`;
}

function renderHero(d, f) {
  const field = state.fields.find(x => x.id === state.fieldId);
  $('hero-loc').innerHTML = `<b>${esc(f.name)}</b> · <span class="mono">${d.location.lat.toFixed(2)}, ${d.location.lon.toFixed(2)}</span>${field?.demo ? ' · <span style="color:var(--st-watch)">demo</span>' : ''}`;
  $('hero-date').textContent = `NASA POWER · to ${fmtDay(d.now.date)}`;
  $('hero-spark').innerHTML = sparkline(d.soil);
  $('hero-spark-range').textContent = d.soil.nrt_break ? 'dashed = NRT' : '12 mo';
  const colour = { 'Well suited': 'var(--st-good)', Marginal: 'var(--st-watch)', 'Poor fit': 'var(--st-warning)' };
  $('hero-crops').innerHTML = d.suitability.slice(0, 7).map(s => `<div class="ov-row" title="${esc(s.status)}"><span>${esc(s.name)}</span>
    <span class="bar"><i style="width:${s.thermal_reliability}%;background:${colour[s.status]}"></i></span><span class="v">${s.thermal_reliability}%</span></div>`).join('');
  const n = d.now, g = d.gdd, fr = d.frost;
  const chip = (k, v, extra = '') => `<div class="stat-chip"><div class="k"><span>${k}</span>${extra}</div><div class="v">${v}</div></div>`;
  $('hero-stats').innerHTML = [
    chip('Frost-free season', fr.frost_years ? `${fr.frost_free_days_median} d` : 'no frost'),
    chip('GDD₅ to date', g.to_date.toLocaleString(), g.to_date_normal ? `<span>${sign(g.to_date - g.to_date_normal)}</span>` : ''),
    chip('Rain · 30 d', `${n.rain_30d} mm`, n.rain_30d_normal ? `<span>${Math.round(100 * n.rain_30d / n.rain_30d_normal)}%</span>` : ''),
    '<div class="stat-chip" id="hero-legend"></div>',
  ].join('');
  updateLegendChip();
}

function updateLegendChip() {
  const el = $('hero-legend'), l = mapCtl?.current;
  if (!el || !l) return;
  el.innerHTML = l.legend
    ? `<div class="k"><span>${esc(l.title.split(' (')[0])}</span></div><div class="k"><span>${esc(l.legend.low)}</span><span>${esc(l.legend.high)}</span></div><div class="ramp" style="background:linear-gradient(90deg,${l.legend.colors.join(',')})"></div>`
    : `<div class="k"><span>Layer</span></div><div class="v" style="font-size:.78rem">${esc(l.title)}</div>`;
}

function tile(label, value, unit, sub, extra = '') {
  return `<div class="panel tile"><div class="label">${label}</div><div class="value">${value}<small>${unit}</small></div><div class="sub">${sub}</div>${extra}</div>`;
}

function renderTelemetry(d) {
  const n = d.now, g = d.gdd, fr = d.frost;
  const rainPct = n.rain_30d_normal ? Math.round(100 * n.rain_30d / n.rain_30d_normal) : null;
  const t7diff = n.tmean_7d != null && n.tmean_7d_normal != null ? +(n.tmean_7d - n.tmean_7d_normal).toFixed(1) : null;
  const gddDiff = g.to_date_normal ? g.to_date - g.to_date_normal : null;
  const pct = n.root_wetness_pct;
  $('tiles').innerHTML = [
    tile('Air temperature', n.tmean ?? '—', '°C', `Min <b>${n.tmin}</b> · Max <b>${n.tmax}</b> on ${fmtDay(n.date)}<br>7-day mean ${n.tmean_7d} °C${t7diff != null ? ` (<b>${sign(t7diff)}</b> vs normal)` : ''}`),
    tile('Rain · last 30 days', n.rain_30d ?? '—', 'mm', rainPct != null ? `<b>${rainPct}%</b> of normal (${n.rain_30d_normal} mm)<br>Last 7 days: ${n.rain_7d} mm` : ''),
    tile('Root-zone soil wetness', n.root_wetness ?? '—', '/ 1', pct != null ? `<b>${pct}th</b> percentile · as of <b>${fmtDay(n.soil_date)}</b><br>typical ${n.root_wetness_normal}${n.nrt_break ? ` · NRT ${n.nrt_root_wetness} (${fmtDay(n.nrt_date)})` : ''}` : '',
      n.root_wetness != null ? `<div class="gauge" aria-hidden="true"><i style="width:${n.root_wetness * 100}%"></i><b style="left:${(n.root_wetness_normal ?? 0) * 100}%" title="typical"></b></div>` : ''),
    tile('Water balance · 30 days', n.balance_30d != null ? sign(n.balance_30d) : '—', 'mm', `Rain ${n.rain_30d} mm − ET₀ ${n.et0_30d} mm<br>${n.balance_30d < 0 ? 'Crops draw down soil water' : 'Rain exceeds evaporative demand'}`),
    tile(`Heat units · GDD${g.base}`, g.to_date.toLocaleString(), '°C·d', gddDiff != null ? `<b>${sign(gddDiff)}</b> vs normal to date<br>Full-season normal: ${g.season_total_normal?.toLocaleString()}` : ''),
    tile('Frost-free season', fr.frost_years ? fr.frost_free_days_median : '365', 'days', fr.frost_years
      ? `Last spring frost ~<b>${fmtDay(fr.last_spring_median)}</b><br>First autumn frost ~<b>${fmtDay(fr.first_fall_median)}</b>` : 'No 2 m air frost recorded in 10 years'),
  ].join('');
  const phase = { winter: 'Off-season / winter', planting: 'Planting window', growing: 'Growing season', harvest: 'Harvest / autumn', 'year-round': 'Frost-free, year-round climate' }[d.phase];
  $('context-line').innerHTML = `<span class="phase-chip">◉ PHASE: ${esc(phase).toUpperCase()}</span><span>GRID CELL ${d.location.lat.toFixed(2)}, ${d.location.lon.toFixed(2)}</span>${d.location.elevation_m != null ? `<span>CELL ELEVATION ${Math.round(d.location.elevation_m)} M</span>` : ''}<span>DATA LAG ${n.lag_days} DAYS</span><span>${[n.humidity != null && `RH ${n.humidity}%`, n.wind != null && `WIND ${n.wind} M/S`, n.radiation != null && `SUN ${n.radiation} MJ/M²`].filter(Boolean).join(' · ')}</span>`;
}

function renderAdvisories(d) {
  $('advisories').innerHTML = d.advisories.map(a => `
    <article class="panel advisory" data-level="${a.level}">
      <span class="level">${ICON[a.level]}${LEVEL_LABEL[a.level]} · ${esc(a.topic)}</span>
      <h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p>
      <div class="action">${esc(a.action)}</div>
      <details><summary>Evidence</summary><dl>${a.evidence.map(e => `<dt>${esc(e.label)}</dt><dd>${esc(e.value)}</dd>`).join('')}</dl></details>
    </article>`).join('') || '<div class="empty-state">No advisories.</div>';
}

function renderTable() {
  if (!state.analysis) return;
  const t = tableFor(state.tab, state.analysis);
  $('chart-table').innerHTML = `<table><thead><tr>${t.head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function statusPill(s) {
  const cls = { 'Well suited': 'good', Marginal: 'watch', 'Poor fit': 'warning' }[s];
  const icon = { good: ICON.good, watch: ICON.watch, warning: ICON.warning }[cls];
  return `<span class="pill ${cls}">${icon}${s}</span>`;
}

function renderSuitability(d) {
  $('suit-table').innerHTML = `<table><thead><tr><th>Crop</th><th>Fit</th><th>Matures in…</th><th class="num">Rain / need</th><th class="num">Heat days</th><th>Sow from (4 in 5 yrs)</th><th class="num">Cycle</th><th>Limits &amp; notes</th></tr></thead><tbody>
  ${d.suitability.map(s => `<tr>
    <td><b>${esc(s.name)}</b><br><span class="muted" style="font-size:.74rem">${esc(s.family)}${s.n_fixing ? ' · N-fixing' : ''}</span></td>
    <td>${statusPill(s.status)}</td>
    <td><span class="relbar" aria-hidden="true"><i style="width:${s.thermal_reliability}%"></i></span><span class="mono" style="font-size:.78rem">${s.thermal_reliability}% of ${s.seasons} seasons</span></td>
    <td class="num">${s.rain_mm ?? '—'} / ${s.water_need_mm ?? '—'} mm</td>
    <td class="num">${s.heat_days}</td>
    <td>${fmtDay(s.sow_safe)}</td>
    <td class="num">${s.cycle_days ?? '—'} d</td>
    <td class="crop-note">${s.limits.length ? esc(s.limits.join('; ')) : esc(s.note)}</td></tr>`).join('')}
  </tbody></table>
  <p class="chart-note" style="padding:0 10px">Crop water need = crop coefficient (FAO-56) × Hargreaves ET₀ over the simulated crop cycle. Parameters are planning-grade approximations. Varieties differ, so validate with a local agronomist.</p>`;
}

function renderSeasons(d) {
  $('season-table').innerHTML = `<table><thead><tr><th>Season</th><th class="num">GDD5</th><th>Last spring frost</th><th>First autumn frost</th><th class="num">Frost-free days</th><th class="num">Rain (frost-free)</th><th class="num">ET₀</th><th class="num">Balance</th><th class="num">Heat days ≥30 °C</th><th class="num">Longest dry spell</th><th class="num">Mean root wetness</th></tr></thead><tbody>
  ${d.seasons.slice().reverse().map(s => `<tr><td><b>${s.label}</b></td><td class="num">${s.gdd5}</td><td>${fmtDay(s.last_spring_frost)}</td><td>${fmtDay(s.first_fall_frost)}</td>
    <td class="num">${s.frost_free_days}</td><td class="num">${s.season_rain_mm} mm</td><td class="num">${s.season_et0_mm} mm</td><td class="num">${sign(s.water_balance_mm)} mm</td>
    <td class="num">${s.heat_days}</td><td class="num">${s.longest_dry_spell} d</td><td class="num">${s.mean_root_wetness ?? '—'}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderProvenance(d, f) {
  const p = d.provenance;
  const missing = Object.entries(p.interior_missing_days).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(', ') || 'none';
  $('prov').innerHTML = `
    <div class="panel"><h3>Climate record</h3><dl>
      <dt>DATASET</dt><dd>${esc(p.dataset)}</dd><dt>SOURCES</dt><dd>${esc(p.sources)}</dd><dt>GRID</dt><dd>${esc(p.grid)} · the dashed box on the map</dd>
      <dt>PERIOD</dt><dd>${esc(p.period)} (${p.days.toLocaleString()} days)</dd><dt>RETRIEVED</dt><dd>${esc(p.retrieved_at)} · ${esc(p.delivery)}</dd>
      <dt>GAPS</dt><dd>${esc(missing)} (trailing near-real-time latency excluded)</dd>
      <dt>NORMALS</dt><dd>${p.climatology ? `POWER climatology ${esc(p.climatology.period)}` : 'unavailable'}</dd></dl></div>
    <div class="panel"><h3>Parameters</h3><dl>${Object.entries(p.parameters).map(([k, v]) => `<dt><code>${k}</code></dt><dd>${esc(v.name)} (${esc(v.unit)})</dd>`).join('')}</dl></div>
    <div class="panel"><h3>Methods &amp; access</h3><dl>${Object.entries(p.methods).map(([k, v]) => `<dt>${esc(k.toUpperCase())}</dt><dd>${esc(v)}</dd>`).join('')}
      <dt>SOIL NRT</dt><dd>${d.soil.nrt_break ? `GEOS-IT near-real-time from ${esc(d.soil.nrt_break)}; excluded from percentiles` : 'single source'}</dd></dl>
      <div class="btn-row" style="margin-top:12px"><a class="btn" href="${api.exportUrl(f)}">⤓ Download daily CSV</a><a class="btn ghost" href="${esc(p.request_url)}" target="_blank" rel="noopener">Raw POWER request ↗</a><a class="btn ghost" href="/docs" target="_blank">API docs ↗</a></div></div>`;
}

// ------------------------------------------------------------------ planner
function renderPriorities() {
  $('priorities').innerHTML = state.goals.map((g, i) => `<label class="slider"><div><span>${g}</span><output id="pv-${i}">${state.priorities[i]}</output></div>
    <input type="range" min="0" max="5" step="1" value="${state.priorities[i]}" data-goal="${i}" aria-label="${g} weight"></label>`).join('');
}

let rankTimer;
function scheduleRank() { clearTimeout(rankTimer); rankTimer = setTimeout(rankPlans, 180); }

async function rankPlans() {
  const f = readForm();
  const body = { ...f, priorities: state.priorities, plans: state.plans };
  if (!state.analysis) { delete body.lat; delete body.lon; }
  try {
    const { rankings } = await api.rank(body);
    renderPlans(rankings);
  } catch (e) { $('plans').innerHTML = `<div class="empty-state">Ranking failed: ${esc(e.message)}</div>`; }
}

function renderPlans(rankings) {
  const open = new Set([...document.querySelectorAll('#plans details[open]')].map(x => x.dataset.name));
  const cropOpts = (sel) => state.crops.map(c => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $('plans').innerHTML = rankings.map((r, i) => {
    const idx = state.plans.findIndex(p => p.name === r.name);
    return `<article class="panel plan ${i === 0 ? 'top corner' : ''}">
      <div class="plan-head"><span class="rank">${i === 0 ? '★ TOP' : '#' + (i + 1)}</span>
        <input type="text" value="${esc(r.name)}" data-rename="${idx}" aria-label="Rotation name" maxlength="60">
        <button class="icon-btn" type="button" data-remove="${idx}" aria-label="Remove ${esc(r.name)}">✕</button>
        <div class="score-orb" style="--p:${r.score}" role="img" aria-label="Score ${r.score} of 100"><span>${Math.round(r.score)}</span></div></div>
      <div class="years">${r.years.map((y, j) => `<label>Year ${j + 1}<select data-plan="${idx}" data-year="${j}">${cropOpts(y)}</select></label>`).join('')}
        ${r.years.length < 6 ? `<button class="icon-btn" style="color:var(--accent)" type="button" data-addyear="${idx}">＋ year</button>` : ''}
        ${r.years.length > 2 ? `<button class="icon-btn" type="button" data-dropyear="${idx}">− year</button>` : ''}</div>
      <div class="comp-grid">${r.components.map((v, j) => `<div class="comp">${state.goals[j]}<b>${v}</b><div class="gauge"><i style="width:${v}%"></i></div></div>`).join('')}</div>
      <details data-name="${esc(r.name)}" ${open.has(r.name) || (i === 0 && !open.size) ? 'open' : ''}><summary>Why this score ${r.uses_climate ? '· uses NASA climate history' : '· analyze a field to add climate'}</summary>
        <ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
    </article>`;
  }).join('');
}

function wirePlanner() {
  $('priorities').addEventListener('input', (e) => {
    const i = e.target.dataset.goal; if (i == null) return;
    state.priorities[i] = +e.target.value; $(`pv-${i}`).value = e.target.value; scheduleRank();
  });
  $('plans').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.plan != null) { state.plans[t.dataset.plan].years[t.dataset.year] = t.value; scheduleRank(); }
    if (t.dataset.rename != null) {
      const name = t.value.trim().slice(0, 60);
      if (name && !state.plans.some(p => p.name === name)) state.plans[t.dataset.rename].name = name;
      scheduleRank();
    }
  });
  $('plans').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.remove != null && state.plans.length > 1) state.plans.splice(+t.dataset.remove, 1);
    else if (t.dataset.addyear != null) { const p = state.plans[t.dataset.addyear]; p.years.push(p.years[p.years.length - 1]); }
    else if (t.dataset.dropyear != null) state.plans[t.dataset.dropyear].years.pop();
    else return;
    scheduleRank();
  });
  $('add-plan').addEventListener('click', () => {
    if (state.plans.length >= 8) return;
    let n = state.plans.length + 1; while (state.plans.some(p => p.name === `Rotation ${n}`)) n++;
    state.plans.push({ name: `Rotation ${n}`, years: ['Field pea', 'Spring wheat', 'Oats'] });
    scheduleRank();
  });
}

// ------------------------------------------------------------------ map & UI wiring
let mapCtl;
let drawer;
function onPick(lat, lon) {
  $('f-lat').value = lat; $('f-lon').value = lon;
  if (state.boundary) { state.boundary = null; drawer.clear(); }
  if (state.fieldId != null) { state.fieldId = null; $('f-name').value = 'New field'; renderSaved(); }
  $('hero-loc').innerHTML = `<b>New target</b> · <span class="mono">${lat}, ${lon}</span>`;
  status(`Target set at ${lat}, ${lon}. Press Analyze to pull NASA data.`);
}

// ------------------------------------------------------------------ field boundary + NASA HLS record
function updateDrawUI(st) {
  const show = (id, on) => { $(id).hidden = !on; };
  show('draw-start', !st.drawing); show('draw-undo', st.drawing && st.points > 0); show('draw-done', st.drawing);
  show('draw-cancel', st.drawing); show('draw-clear', !st.drawing && !!st.shape);
  $('draw-start').textContent = st.shape ? 'Redraw boundary' : 'Draw field boundary';
  $('draw-status').textContent = st.drawing ? `${st.points} vertices · ${st.areaHa.toFixed(2)} ha` : st.shape ? `Boundary ${st.areaHa.toFixed(2)} ha` : '';
}

function finishBoundary() {
  const shape = drawer.finish();
  if (!shape) { status('Click at least 3 vertices, then Done.', 'error'); return; }
  state.boundary = shape;
  const [lat, lon] = centroid(shape);
  $('f-lat').value = +lat.toFixed(4); $('f-lon').value = +lon.toFixed(4);
  mapCtl.setTarget(+lat.toFixed(4), +lon.toFixed(4), { fly: false });
  status('Boundary set. Press Analyze field to read its NASA HLS record (first time: up to a minute).');
}

const HINT_LABEL = { grass: 'Grass / ley', new_ley: 'New ley', winter_crop: 'Autumn-sown', spring_crop: 'Spring-sown', late_crop: 'Late crop',
  bare: 'Bare / failed', unclear: 'Unclear', unknown: 'Too cloudy', unavailable: 'n/a (tropics)' };

const AROUND_COLOUR = { grass: '#2fa477', new_ley: '#c2547f', winter_crop: '#2e98c4', spring_crop: '#c8801f', late_crop: '#9d5bdb', bare: '#6b7684', unclear: '#4B5563' };
const AROUND_NAME = { grass: 'Grass / ley', new_ley: 'New ley', winter_crop: 'Autumn-sown', spring_crop: 'Spring-sown', late_crop: 'Late crop', bare: 'Bare / failed', unclear: 'Unclear' };
let aroundMap;
async function renderAround(f) {
  const key = JSON.stringify(f.boundary); state.aroundFor = key;
  if (!f.boundary) { $('around-status').innerHTML = '<div class="empty-state">Draw or load a field boundary to read the area around it.</div>'; return; }
  $('around-status').innerHTML = '<div class="mission-status busy"><span class="scanner"></span><span>Reading every HLS image of a 4 km square around the field (first time about a minute)…</span></div>';
  try {
    const d = await api.neighbourhood(f.boundary);
    if (state.aroundFor !== key) return;
    if (d.status !== 'ok') { $('around-status').innerHTML = `<div class="empty-state">${esc(d.reason || '')}</div>`; return; }
    const ch = d.change;
    const shift = !ch ? 'Too few usable seasons to test for a shift.'
      : ch.notable.length ? `Consistent shift over ${esc(ch.seasons)}: ${ch.notable.map((k) => `${AROUND_NAME[k]} ${ch.classes[k].pp_per_year > 0 ? '+' : ''}${ch.classes[k].pp_per_year} points a year (p = ${ch.classes[k].p_value})`).join('; ')}.`
      : `No consistent shift in any crop type over ${esc(ch.seasons)} (Mann–Kendall p ≥ 0.1 for all).`;
    $('around-status').innerHTML = `<p style="margin:0 0 10px">${d.farmland_ha} ha of farmland around the field · ${d.images} images · tile ${esc(d.tile)} · ${esc(d.delivery)}. ${shift}</p>
      <div class="legend">${Object.keys(AROUND_COLOUR).map((k) => `<span><i style="background:${AROUND_COLOUR[k]}"></i>${AROUND_NAME[k]}</span>`).join('')}</div>`;
    renderAroundChart(d, AROUND_COLOUR, AROUND_NAME);
    const pct = (v) => (v == null ? '—' : `${Math.round(100 * v)}%`);
    $('around-table').innerHTML = `<table><thead><tr><th>Season</th><th class="num">Farmland classified</th>${Object.keys(AROUND_NAME).map((k) => `<th class="num">${AROUND_NAME[k]}</th>`).join('')}</tr></thead><tbody>
      ${d.seasons.map((s) => `<tr><td><b>${esc(s.label)}</b>${s.usable ? '' : ' <span class="muted">(too cloudy)</span>'}</td><td class="num">${pct(s.classified_share)}</td>
        ${Object.keys(AROUND_NAME).map((k) => `<td class="num">${pct(s.shares[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('around-method').textContent = `${d.method} ${d.attribution}`;
    if (aroundMap) aroundMap.remove();
    aroundMap = L.map('around-map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(aroundMap);
    const [w, s, e, n] = d.bbox;
    aroundMap.fitBounds([[s, w], [n, e]]);
    if (d.map.cells) L.geoJSON(d.map.cells, { style: (ft) => ({ stroke: false, fillColor: AROUND_COLOUR[ft.properties.class], fillOpacity: 0.75 }) })
      .bindTooltip((l) => `${AROUND_NAME[l.feature.properties.class]} · ${d.map.season}`).addTo(aroundMap);
    L.polygon(f.boundary.coordinates[0].map(([x, y]) => [y, x]), { color: '#FFFFFF', weight: 2.5, fill: false, interactive: false }).addTo(aroundMap);
  } catch (e) {
    if (state.aroundFor === key) $('around-status').innerHTML = `<div class="empty-state">Could not read the area around the field: ${esc(e.message)}</div>`;
  }
  settleHash();
}

async function renderCropCheck(f) {
  const sel = $('cc-crop');
  if (!sel.options.length) {
    const cat = state.crops.length ? state.crops : (await api.crops()).crops;
    sel.innerHTML = cat.map((c) => `<option>${esc(c.name)}</option>`).join('');
    const asked = state.askedCrop;  // from ?crop= (e.g. the field view's crop check), read at startup
    sel.value = cat.some((c) => c.name === asked) ? asked : cat.some((c) => c.name === 'Potato') ? 'Potato' : cat[0].name;
  }
  const show = async () => {
    const key = `${f.lat},${f.lon},${sel.value}`; state.ccFor = key;
    $('cc-summary').innerHTML = '<div class="empty-state">Running the crop through every season since 1981…</div>';
    try {
      const d = await api.cropCheck(f.lat, f.lon, sel.value);
      if (state.ccFor !== key) return;
      const r = d.ripened, sign = (v) => `${v > 0 ? '+' : ''}${v}`;
      $('cc-summary').innerHTML = `<p style="margin:0 0 10px">Reached maturity before frost in <b>${r.then} of ${r.then_of}</b> seasons ${esc(d.then)} and <b>${r.now} of ${r.now_of}</b> in ${esc(d.now)}.</p>`;
      $('cc-table').innerHTML = `<table><thead><tr><th>Measure (while the crop is in the ground)</th><th class="num">${esc(d.then)}</th><th class="num">${esc(d.now)}</th>
        <th class="num">Change</th><th class="num">Trend per decade</th><th class="num">Mann–Kendall p</th><th>Consistent</th></tr></thead><tbody>
        ${d.measures.map((m) => `<tr${m.consistent ? ' class="row-strong"' : ''}><td>${esc(m.label)}</td><td class="num">${m.then}</td><td class="num">${m.now}</td>
          <td class="num">${sign(m.change)} ${esc(m.unit)}</td><td class="num">${sign(m.per_decade)}</td><td class="num">${m.p_value < 0.001 ? '&lt; 0.001' : m.p_value}</td>
          <td>${m.consistent ? 'yes' : '<span class="muted">no</span>'}</td></tr>`).join('')}</tbody></table>`;
      $('cc-method').textContent = `${d.method} Crop profile: base ${d.params.base_c} °C, ${d.params.gdd} degree-days to maturity, sowing at a 7-day mean of ${d.params.sow_c} °C, heat stress above ${d.params.heat_limit_c} °C, Kc ${d.params.kc}.`;
      const ms = $('cc-metric');
      ms.innerHTML = d.measures.map((m) => `<option value="${m.code}">${esc(m.label)}</option>`).join('');
      if (d.measures.some((m) => m.code === 'blight_days')) ms.value = 'blight_days';
      const draw = () => renderChangeChart(d.measures.find((m) => m.code === ms.value), d, 'c-cropcheck');
      ms.onchange = draw; draw();
    } catch (e) {
      $('cc-summary').innerHTML = `<div class="empty-state">Could not check this crop: ${esc(e.message)}</div>`;
    }
  };
  sel.onchange = show; await show();
  settleHash();
}

async function renderChange(f) {
  const key = `${f.lat},${f.lon}`; state.changeFor = key;
  $('change-table').innerHTML = '<div class="empty-state">Reading the NASA POWER record since 1981…</div>';
  try {
    const d = await api.change(f.lat, f.lon);
    if (state.changeFor !== key) return;
    const fmt = (m, v, lab) => lab || `${v}`;
    const sign = (v) => `${v > 0 ? '+' : ''}${v}`;
    $('change-table').innerHTML = `<table><thead><tr><th>Measure</th><th class="num">${esc(d.then)}</th><th class="num">${esc(d.now)}</th>
      <th class="num">Change</th><th class="num">Trend per decade (${esc(d.record)})</th><th class="num">Mann–Kendall p</th><th>Consistent</th></tr></thead><tbody>
      ${d.metrics.map((m) => `<tr${m.consistent ? ' class="row-strong"' : ''}><td>${esc(m.label)}</td><td class="num">${esc(fmt(m, m.then, m.then_label))}</td>
        <td class="num">${esc(fmt(m, m.now, m.now_label))}</td><td class="num">${sign(m.change)} ${m.unit === 'date' ? 'days' : esc(m.unit)}</td>
        <td class="num">${sign(m.per_decade)}</td><td class="num">${m.p_value < 0.001 ? '&lt; 0.001' : m.p_value}</td><td>${m.consistent ? 'yes' : '<span class="muted">no</span>'}</td></tr>`).join('')}
      </tbody></table>`;
    $('change-method').textContent = `${d.method} Source: ${d.provenance.delivery}.`;
    const sel = $('change-metric');
    sel.innerHTML = d.metrics.map((m) => `<option value="${m.code}">${esc(m.label)}</option>`).join('');
    const show = () => { const m = d.metrics.find((x) => x.code === sel.value); $('change-chart-h').textContent = m.label; renderChangeChart(m, d); };
    sel.onchange = show; show();
  } catch (e) {
    $('change-table').innerHTML = `<div class="empty-state">Could not read the long record: ${esc(e.message)}</div>`;
  }
  settleHash();
}

function renderTrend(tr, archive) {
  renderTrendChart(tr);
  const fmt = (v) => `${v > 0 ? '+' : ''}${v}% a year`;
  const crop = (v) => esc((v || 'unclear').replace('_', ' '));
  const say = (f, what) => f.direction === 'none' ? `no clear trend in ${what}: ${fmt(f.pct_per_year)}, Mann–Kendall p = ${f.p_value} (${f.n} seasons)`
    : `${what} ${f.direction === 'rising' ? 'rising' : 'falling'}: <b>${fmt(f.pct_per_year)}</b>, p = ${f.p_value} (${f.n} seasons)`;
  let verdict;
  if (tr.status === 'too_few') verdict = `Not enough complete seasons to judge a trend (${tr.seasons.length} of ${tr.min_seasons} needed).`;
  else if (tr.status === 'mixed_crops') {
    verdict = `The likely crop changed over these seasons (${tr.crops.map(crop).join(', ')}), so an overall line would compare different crops. No overall direction is given.`;
    verdict += tr.same_crop ? ` Among ${crop(tr.same_crop.crop)} seasons only: ${say(tr.same_crop, 'greenness')}.` : ' No crop has the 4 seasons needed for a same-crop trend yet.';
  } else verdict = say(tr, 'season-long greenness').replace(/^./, (ch) => ch.toUpperCase()) + '.';
  const skipped = tr.skipped.length ? `<dt>Skipped</dt><dd>${tr.skipped.map((s) => `${s.season}${s.gap_days ? ` (${s.gap_days}-day cloud gap)` : ''}`).join(', ')}</dd>` : '';
  $('trend-info').innerHTML = `<p style="margin:0 0 10px">${verdict}</p><dl class="zone-stats">${skipped}
    <dt>Record</dt><dd>${esc(archive.note)}</dd></dl><p class="chart-note">${esc(tr.method)}</p>`;
}


const WX_LABEL = { dry_spell: ['longest dry spell', ' d'], low_rain: ['lowest rain', ' mm'], wet: ['highest rain', ' mm'],
  heat: ['most hot days', ''], cool: ['coolest (GDD5)', ''], late_frost: ['latest spring frost', ''],
  dry_soil: ['driest root zone', ''], wet_soil: ['wettest root zone', ''] };
const CHECK_STATUS = { lower: 'Clearly lower', normal: 'Within normal', no_value: 'Not judged: cloud gap', crop_unclear: 'Not judged: crop unclear',
  too_few_same_crop: 'Not judged: too few same-crop seasons' };

function renderSeasonCheck(sc) {
  if (!sc) { $('season-check').innerHTML = ''; return; }
  const wx = (r) => r.weather == null ? '<span class="muted">no weather yet</span>' : (r.weather_through ? `<span class="muted">season so far, to ${esc(r.weather_through)}:</span> ` : '') + (r.weather.length
    ? r.weather.map((w) => `${WX_LABEL[w.code][0]} (${w.rank === 1 ? '1st' : '2nd'} of ${w.of}${w.code === 'late_frost' ? '' : `: ${w.value}${WX_LABEL[w.code][1]}, median ${w.normal}${WX_LABEL[w.code][1]}`})`).join('<br>')
    : '<span class="muted">nothing unusual</span>');
  const n = (v) => (v == null ? '—' : v.toFixed(3));
  const verdict = sc.flagged.length ? `<b>${sc.flagged.join(', ')}</b> ${sc.flagged.length > 1 ? 'were' : 'was'} clearly less green than the field's other seasons with the same likely crop.`
    : sc.judged ? `No season was clearly less green than the field's other seasons with the same likely crop (${sc.judged} judged).`
    : 'Too few comparable seasons to judge yet.';
  $('season-check').innerHTML = `<p style="margin:0 0 10px">${verdict}</p>
    <div class="data-table-wrap" style="max-height:none"><table><thead><tr><th>Season</th><th>Likely crop</th><th class="num">Season EVI</th><th class="num">Same-crop median</th>
    <th class="num">Difference</th><th>Reading</th><th>Weather that stood out (NASA POWER)</th></tr></thead><tbody>
    ${sc.seasons.map((r) => `<tr${r.status === 'lower' ? ' class="row-flag"' : ''}><td><b>${esc(r.label)}</b></td><td>${esc((r.crop || '—').replace('_', ' '))}</td>
      <td class="num">${n(r.evi_mean)}</td><td class="num">${n(r.reference)}${r.n_same_crop ? ` <span class="muted">(${r.n_same_crop})</span>` : ''}</td>
      <td class="num">${r.diff_pct == null ? '—' : `${r.diff_pct > 0 ? '+' : ''}${r.diff_pct}%`}</td><td>${CHECK_STATUS[r.status]}</td><td>${wx(r)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="chart-note">${esc(sc.method)}</p>`;
}

const ZONE_COLOUR = { weaker: '#c8801f', average: '#6b7684', stronger: '#2fa477' };

function downloadZones(z, name) {
  const fc = { type: 'FeatureCollection', name: `Rotation Lab productivity zones · ${name}`,
    properties: { source: 'NASA HLS v2.0 EVI, 30 m', seasons: z.seasons_used.map((s) => s.season), method: z.method,
      zone_id: { 0: 'edge (not classified)', 1: 'weaker', 2: 'average', 3: 'stronger' } },
    features: z.cells.features.map((f) => ({ ...f, properties: { ...f.properties, zone_id: { edge: 0, weaker: 1, average: 2, stronger: 3 }[f.properties.zone] } })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }));
  a.download = `zones_${name.replace(/[^\w-]+/g, '_')}.geojson`;
  a.click(); URL.revokeObjectURL(a.href);
}
let zonesMap;
async function renderZones(boundary, key) {
  try {
    const z = await api.zones(boundary);
    if (state.vegFor !== key) return;
    const info = $('zones-info');
    if (z.status !== 'ok') { info.innerHTML = `<p class="chart-note">${esc(z.message)}</p>`; $('zones-map').hidden = true; return; }
    if (zonesMap) zonesMap.remove();
    zonesMap = L.map('zones-map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(zonesMap);
    const layer = L.geoJSON(z.cells, { style: (ft) => ft.properties.zone === 'edge'
      ? { color: '#A3AEBD', weight: 1, dashArray: '3 3', fillOpacity: 0 }
      : { color: '#0E141B', weight: 0.5, fillColor: ZONE_COLOUR[ft.properties.zone], fillOpacity: 0.78 },
      onEachFeature: (ft, l) => l.bindTooltip(ft.properties.zone === 'edge' ? 'Edge pixel: mixed with neighbouring land, not classified'
        : `${ft.properties.zone} · ${(ft.properties.relative * 100).toFixed(0)}% of field median · same side in ${Math.round(ft.properties.consistency * 100)}% of ${ft.properties.seasons} seasons`) });
    zonesMap.fitBounds(layer.getBounds(), { padding: [10, 10] }); // set the view before adding vector layers
    layer.addTo(zonesMap);
    L.polygon(boundary.coordinates[0].map(([x, y]) => [y, x]), { color: '#4FD29A', weight: 2.5, fill: false, interactive: false }).addTo(zonesMap);
    const pct = (v) => `${Math.round(v * 100)}%`;
    info.innerHTML = `<div class="zone-legend">${['weaker', 'average', 'stronger'].map((k) => `<div><i style="background:${ZONE_COLOUR[k]}"></i><b>${k[0].toUpperCase() + k.slice(1)}</b><span class="mono">${pct(z.share[k])}</span></div>`).join('')}
        <div><i class="edge"></i><b>Edge</b><span class="mono">not classified</span></div></div>
      <dl class="zone-stats"><dt>Interior pixels</dt><dd>${z.interior_pixels} pixels, 30 m each</dd><dt>Variability (CV)</dt><dd>${(z.cv * 100).toFixed(1)}%${z.uniform ? ' · uniform field' : ''}</dd>
        <dt>Seasons</dt><dd>${z.seasons_used.map((s) => `${s.season} (${s.images})`).join(', ')}</dd><dt>Thresholds</dt><dd>&lt; ${z.thresholds.weaker_below} · &gt; ${z.thresholds.stronger_above} of field median</dd>
        <dt>Delivery</dt><dd>${esc(z.delivery)}</dd></dl>
      <button class="btn" type="button" id="zones-dl">Download zone map (GeoJSON)</button>
      <p class="chart-note">${esc(z.method)} The file has one 30 m square per pixel with a zone_id (1 weaker, 2 average, 3 stronger, 0 edge), for loading into farm-machinery software.</p>`;
    $('zones-dl').onclick = () => downloadZones(z, $('f-name').value || 'field');
  } catch (e) {
    if (state.vegFor === key) $('zones-info').innerHTML = `<p class="chart-note">Zones unavailable: ${esc(e.message)}</p>`;
  }
}

async function renderSatellite(f, d) {
  const panel = $('sat-panel');
  if (!f.boundary) { panel.innerHTML = '<div class="empty-state">Draw a field boundary on the map, then press Analyze field.</div>'; return; }
  const key = JSON.stringify(f.boundary);
  state.vegFor = key;
  panel.innerHTML = '<div class="mission-status busy"><span class="scanner"></span><span>Reading NASA HLS images inside the boundary (cloud-masked, every season since 2020)…</span></div>';
  try {
    const [veg, fc] = await Promise.all([api.vegetation(f.boundary), api.farmCrops(f.lat, f.lon).catch(() => null)]);
    if (state.vegFor !== key) return;
    state.veg = veg;
    const wx = Object.fromEntries(d.seasons.map((s) => [s.label, s]));
    // Crops the farm based on this property reported (Landbruksdirektoratet, per farm); one farm only, else not tied to the field.
    const rep = fc?.status === 'ok' && fc.farms.length === 1 ? Object.fromEntries(fc.farms[0].years.map((y) => [String(y.year),
      y.one_crop ? y.main : `mixed: ${Object.entries(y.areas).filter(([k]) => k !== 'Pasture').map(([k, v]) => `${k} ${v}`).join(', ')} daa`])) : null;
    const st = veg.stats, n = (v, k = 3) => (v == null ? '—' : v.toFixed(k));
    const chip = (k, v) => `<div class="stat-chip"><div class="k"><span>${k}</span></div><div class="v">${v}</div></div>`;
    panel.innerHTML = `<div class="sat-stats">${[chip('Field area', `${veg.area_ha.toFixed(2)} ha`), chip('Images found', st.images_found),
        chip('Clear field images', st.clear_images), chip('Read now / cached', `${st.images_read_now} / ${st.images_from_cache}`), chip('Time', `${st.seconds} s`),
        chip('Delivery', { live: 'live', 'offline-cache': 'offline · local cache', snapshot: 'offline · saved snapshot' }[veg.delivery] || veg.delivery)].join('')}</div>
      <div class="season-key" id="season-key"></div>
      <p class="chart-note" id="usual-line"></p>
      <div class="sat-grid">
        <div><div class="chart-title"><h3>Greenness inside the boundary</h3><div class="mini-switch" role="group" aria-label="Greenness index"><button type="button" data-g="ndvi" aria-pressed="true">NDVI</button><button type="button" data-g="evi" aria-pressed="false">EVI</button></div></div><div class="chart-box tall"><canvas id="c-ndvi" aria-label="Greenness by season"></canvas></div></div>
        <div><div class="chart-title"><h3>NDMI (canopy moisture) inside the boundary</h3></div><div class="chart-box tall"><canvas id="c-ndmi" aria-label="NDMI by season"></canvas></div></div>
      </div>
      <p class="chart-note">Each point is one image: the median of clear pixels inside the boundary; images with under ${Math.round(veg.method.min_clear_share * 100)}% of the field clear are dropped. Growing months only (${esc(veg.method.growing_months)}).</p>
      <div class="data-table-wrap" style="max-height:none"><table><thead><tr><th>Season</th><th>Crop-type hint</th>${rep ? '<th>Reported crop</th>' : ''}<th class="num">Images</th><th class="num">Clear</th><th>Green-up</th><th>Peak date</th>
        <th class="num">Peak NDVI</th><th class="num">Mean NDVI</th><th class="num">Season EVI</th><th class="num">Peak NDMI</th><th class="num">Rain (frost-free)</th><th class="num">ET₀</th><th class="num">Longest dry spell</th><th class="num">Heat days</th></tr></thead><tbody>
        ${veg.seasons.map((s) => { const w = wx[s.label]; return `<tr><td><b>${esc(s.label)}</b></td><td title="${esc(s.crop_hint?.evidence ?? '')}">${esc(HINT_LABEL[s.crop_hint?.type] ?? '—')}</td>${rep ? `<td>${esc(rep[s.label] ?? '—')}</td>` : ''}<td class="num">${s.images}</td><td class="num">${s.clear_images}</td>
          <td>${s.greenup_date ? fmtDay(s.greenup_date) : s.greenup_cloud_gap ? '<span class="muted">cloud gap</span>' : '—'}</td><td>${s.peak_date ? fmtDay(s.peak_date) : '—'}</td>
          <td class="num">${n(s.peak_ndvi)}</td><td class="num">${n(s.mean_ndvi)}</td><td class="num" title="${s.season_evi_mean == null && s.core_gap_days ? `skipped: ${s.core_gap_days}-day cloud gap` : ''}">${s.season_evi_mean == null ? (s.core_gap_days > s.max_gap_days ? '<span class="muted">gap</span>' : '—') : n(s.season_evi_mean)}</td><td class="num">${n(s.peak_ndmi)}</td>
          <td class="num">${w ? w.season_rain_mm + ' mm' : '—'}</td><td class="num">${w ? w.season_et0_mm + ' mm' : '—'}</td><td class="num">${w ? w.longest_dry_spell + ' d' : '—'}</td><td class="num">${w ? w.heat_days : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="zones-block"><div class="chart-title"><h3>Productivity zones (multi-season EVI)</h3></div>
        <div class="zones-grid"><div id="zones-map" class="zones-map"></div><div id="zones-info"><div class="mission-status busy"><span class="scanner"></span><span>Computing zones from every 30 m pixel…</span></div></div></div></div>
      <div class="zones-block"><div class="chart-title"><h3>Productivity trend (season-long EVI, ${veg.trend.seasons.length ? `${veg.trend.seasons[0].season}–${veg.trend.seasons[veg.trend.seasons.length - 1].season}` : '—'})</h3></div>
        <div class="zones-grid"><div class="chart-box"><canvas id="c-trend" aria-label="Season-long EVI by season with trend line"></canvas></div><div id="trend-info"></div></div></div>
      <div class="zones-block"><div class="chart-title"><h3>Season check: weak seasons and their weather</h3></div><div id="season-check"></div></div>
      ${fc ? `<p class="chart-note"><b>Reported crops</b> (${esc(fc.source)}): ${esc(rep ? fc.note : fc.message || 'several farms are based on this property, so their crops are not tied to this field.')}</p>` : ''}
      <p class="chart-note">Crop-type hints are rule-based on the curve shape (hover a hint for its evidence): ${esc(veg.method.crop_hint)}</p>
      <p class="chart-note">Weather columns come from NASA POWER for the same season (frost-free window); “—” where the season is not complete in the weather record.</p>
      <details><summary class="label" style="cursor:pointer">All ${veg.observations.length} image readings</summary><div class="data-table-wrap"><table><thead><tr><th>Date</th><th>Sensor</th><th class="num">Field clear</th><th class="num">Tile cloud</th><th class="num">NDVI</th><th class="num">NDMI</th></tr></thead><tbody>
        ${veg.observations.slice().reverse().map((o) => `<tr><td>${o.date}</td><td>${o.sensor}</td><td class="num">${Math.round(o.clear_pct * 100)}%</td><td class="num">${o.scene_cloud ?? '—'}%</td><td class="num">${n(o.ndvi)}</td><td class="num">${n(o.ndmi)}</td></tr>`).join('')}
      </tbody></table></div></details>
      <p class="chart-note">${esc(veg.attribution)} · ${esc(veg.method.cloud_mask)} · NDVI ${esc(veg.method.ndvi)} · NDMI ${esc(veg.method.ndmi)} · bands: Sentinel-2 ${Object.values(veg.method.bands['Sentinel-2']).join('/')}, Landsat ${Object.values(veg.method.bands.Landsat).join('/')}.</p>`;
    renderZones(f.boundary, key);
    const drawKey = (g) => { $('season-key').innerHTML = renderVegCharts(veg, g).map((k) => `<span><i style="background:${k.colour}"></i>${esc(k.label)}</span>`).join(''); };
    drawKey('ndvi');
    panel.querySelector('.mini-switch').onclick = (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      panel.querySelectorAll('.mini-switch button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawKey(b.dataset.g);
    };
    const u = veg.usual_range;
    if (u && $('usual-line')) $('usual-line').textContent = u.status === 'too_few' ? `Not enough earlier ${u.crop ? u.crop.replace('_', ' ') : ''} seasons on this field for a usual range.`
      : u.status === 'no_images' ? '' : `${u.season}: ${u.status === 'within' ? 'within' : `mostly ${u.status}`} the usual range ${u.basis === 'all' ? 'of all earlier seasons (crop not clear yet)' : `for ${u.crop.replace('_', ' ')} (${u.seasons.join(', ')})`}: `
        + `${u.counts.within} of ${u.counts.within + u.counts.below + u.counts.above} clear images inside the crop's window (${u.judged_window[0]} to ${u.judged_window[1]}) fall within it, ${u.counts.below} below, ${u.counts.above} above (±${u.tolerance}). ${u.method}`;
    renderTrend(veg.trend, veg.archive);
    renderSeasonCheck(veg.season_check);
  } catch (e) {
    if (state.vegFor === key) panel.innerHTML = `<div class="mission-status error">Satellite record unavailable: ${esc(e.message)}</div>`;
  }
  settleHash();
}

function wireLayers(cfg) {
  $('layer-select').innerHTML = cfg.layers.map(l => `<option value="${l.id}">${esc(l.title)}</option>`).join('');
  const apply = (id, date) => {
    const l = mapCtl.show(id, date);
    $('layer-date').disabled = !l.dated;
    $('layer-date').value = l.dated ? mapCtl.date : '';
    $('layer-desc').textContent = l.description + (l.dated ? ` · ${mapCtl.date}` : '');
    updateLegendChip();
    $('layer-legend').innerHTML = l.legend ? `<span class="legend-ramp">${esc(l.legend.low)} <span class="ramp" style="background:linear-gradient(90deg,${l.legend.colors.join(',')})"></span> ${esc(l.legend.high)}</span>` : '';
  };
  $('layer-date').max = new Date().toISOString().slice(0, 10);
  $('layer-select').addEventListener('change', (e) => apply(e.target.value));
  $('layer-date').addEventListener('change', (e) => e.target.value && apply($('layer-select').value, e.target.value));
  $('layer-opacity').addEventListener('input', (e) => mapCtl.setOpacity(+e.target.value));
  apply(cfg.layers[0].id);
}

function wireUI() {
  $('field-form').addEventListener('submit', (e) => { e.preventDefault(); analyze(); });
  ['f-soil', 'f-drainage', 'f-irrigation', 'f-previous'].forEach(id => $(id).addEventListener('change', scheduleRank));
  $('saved-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const f = state.fields.find(x => x.id === +b.dataset.id);
    state.fieldId = f.id; fillForm(f); renderSaved(); analyze();
  });
  $('save-btn').addEventListener('click', async () => {
    const f = readForm();
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) { status('Pick a location first.', 'error'); return; }
    try {
      const saved = state.fieldId == null ? await api.createField(f) : await api.updateField(state.fieldId, f);
      state.fieldId = saved.id; await loadFields(); status(`Field “${saved.name}” saved.`);
    } catch (e) { status(`Could not save: ${e.message}`, 'error'); }
  });
  $('delete-btn').addEventListener('click', async () => {
    if (state.fieldId == null) return;
    const f = state.fields.find(x => x.id === state.fieldId);
    await api.deleteField(state.fieldId); state.fieldId = null; $('f-name').value = 'New field';
    await loadFields(); status(`Field “${f?.name}” deleted.`);
  });
  $('locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { status('Geolocation is not available in this browser.', 'error'); return; }
    status('Requesting your location…', 'busy');
    navigator.geolocation.getCurrentPosition(
      (p) => { const lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4); onPick(lat, lon); mapCtl.setTarget(lat, lon); },
      (err) => status(`Location unavailable: ${err.message}`, 'error'), { timeout: 10000 });
  });
  $('place').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const m = e.target.value.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) { status('Type coordinates as “lat, lon”, e.g. 63.46, 10.92', 'error'); return; }
    onPick(+m[1], +m[2]); mapCtl.setTarget(+m[1], +m[2]);
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    state.tab = b.dataset.tab;
    document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.chart-pane').forEach(p => p.hidden = p.dataset.pane !== state.tab);
    renderTable();
  });
  $('table-toggle').addEventListener('click', (e) => {
    const open = $('chart-table').hidden; $('chart-table').hidden = !open;
    e.target.setAttribute('aria-expanded', open); e.target.textContent = open ? 'Hide table view' : 'Show table view';
  });
}

async function boot() {
  const qs = new URLSearchParams(location.search);  // read before anything rewrites the address
  state.askedCrop = qs.get('crop');
  wireUI(); wirePlanner();
  try {
    await api.health(); $('api-dot').className = 'dot ok';
  } catch { $('api-dot').className = 'dot err'; status('Backend unreachable. Start it with ./run.sh', 'error'); return; }
  const [cropInfo, layers] = await Promise.all([api.crops(), api.layers()]);
  state.crops = cropInfo.crops; state.goals = cropInfo.goals; state.plans = structuredClone(cropInfo.default_rotations);
  $('f-previous').innerHTML = state.crops.map(c => `<option>${esc(c.name)}</option>`).join('');
  renderPriorities();
  mapCtl = createMap($('map'), layers, onPick, () => drawer?.drawing);
  drawer = createDrawer(mapCtl.map, { color: '#4FD29A', onChange: updateDrawUI });
  // While tracing, fade the coarse satellite overlay so the field edges in the basemap are visible.
  let savedOpacity = null;
  const dim = () => { savedOpacity = +$('layer-opacity').value; mapCtl.setOpacity(0.1); $('layer-opacity').value = 0.1; };
  const undim = () => { if (savedOpacity != null) { mapCtl.setOpacity(savedOpacity); $('layer-opacity').value = savedOpacity; savedOpacity = null; } };
  $('draw-start').onclick = () => { if (mapCtl.map.getZoom() < 14) mapCtl.map.setView(mapCtl.map.getCenter(), 15); dim(); drawer.start(); };
  $('draw-undo').onclick = () => drawer.undo();
  $('draw-done').onclick = () => { finishBoundary(); if (!drawer.drawing) undim(); };
  $('draw-cancel').onclick = () => { drawer.cancel(); undim(); };
  $('draw-clear').onclick = () => { drawer.clear(); state.boundary = null; };
  wireLayers(layers);
  await loadFields();
  // Same choice of field as the field view: ?field=<id>, or a location passed from an unsaved field, else your
  // own first field, else a demo field.
  const want = state.fields.find((f) => f.id === Number(qs.get('field')));
  const lat = Number(qs.get('lat')), lon = Number(qs.get('lon'));
  if (!want && qs.has('lat') && Number.isFinite(lat) && Number.isFinite(lon)) {
    state.fieldId = null;
    fillForm({ name: qs.get('name') || 'Field from the field view', lat, lon, soil: 'Unknown', drainage: 'Unknown', irrigation: 'Unknown',
      previous_crop: state.crops[0]?.name, boundary: null });
    renderSaved(); analyze();
  } else if (state.fields.length) {
    const f = want || state.fields.find((x) => !x.demo) || state.fields[0];
    state.fieldId = f.id; fillForm(f); renderSaved(); analyze();
  } else rankPlans();
}

boot();

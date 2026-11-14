import { api } from './api.js';
import { createMap } from './map.js';
import { renderCharts, tableFor } from './charts.js';
import { startStars } from './stars.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const sign = (n) => (n > 0 ? '+' : '') + n;
const ICON = {
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 15 14H1L8 1zm-.8 5v4h1.6V6H7.2zm0 5v1.6h1.6V11H7.2z"/></svg>',
  watch: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4v4.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M7.2 7h1.6v5H7.2zM7.2 4h1.6v1.6H7.2z" fill="#0e1530"/></svg>',
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m4.5 8.2 2.3 2.3 4.7-4.8" fill="none" stroke="#0e1530" stroke-width="1.8"/></svg>',
};
const LEVEL_LABEL = { warning: 'Warning', watch: 'Watch', info: 'Info', good: 'Normal' };

const state = { fields: [], fieldId: null, analysis: null, crops: [], goals: [], plans: [], priorities: [4, 3, 2, 3], tab: 'recent' };

// ------------------------------------------------------------------ status
function status(text, mode = '') {
  $('mission-text').textContent = text;
  $('mission-status').className = 'mission-status ' + mode;
}

function readForm() {
  return {
    name: $('f-name').value.trim() || 'Unnamed field', lat: +$('f-lat').value, lon: +$('f-lon').value,
    soil: $('f-soil').value, drainage: $('f-drainage').value, irrigation: $('f-irrigation').value,
    previous_crop: $('f-previous').value, notes: '',
  };
}
function fillForm(f) {
  $('f-name').value = f.name; $('f-lat').value = f.lat; $('f-lon').value = f.lon;
  $('f-soil').value = f.soil; $('f-drainage').value = f.drainage; $('f-irrigation').value = f.irrigation;
  $('f-previous').value = f.previous_crop;
}

// ------------------------------------------------------------------ fields
function renderSaved() {
  $('saved-list').innerHTML = state.fields.length ? state.fields.map(f => `
    <button type="button" class="saved-item" data-id="${f.id}" aria-current="${f.id === state.fieldId}">
      <span>${esc(f.name)}</span><small>${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}</small></button>`).join('')
    : '<span class="muted" style="font-size:.8rem">No saved fields yet.</span>';
  $('delete-btn').hidden = state.fieldId == null;
  $('save-btn').textContent = state.fieldId == null ? 'Save field' : 'Update field';
}
async function loadFields() { state.fields = await api.fields(); renderSaved(); }

// ------------------------------------------------------------------ analysis
async function analyze() {
  const f = readForm();
  if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon) || f.lat < -60 || f.lat > 75) {
    status('Enter a latitude between −60 and 75 and a longitude between −180 and 180.', 'error'); return;
  }
  $('analyze-btn').disabled = true;
  status(`Acquiring 10 years of NASA POWER daily data for ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}… (first request ~5 s, then cached)`, 'busy');
  mapCtl.setTarget(f.lat, f.lon); mapCtl.showCell(f.lat, f.lon);
  try {
    const t0 = performance.now();
    const d = await api.analysis(f);
    state.analysis = d;
    renderTelemetry(d); renderAdvisories(d); renderCharts(d); renderTable(); renderSuitability(d); renderSeasons(d); renderProvenance(d, f);
    await rankPlans();
    const src = { live: 'live from NASA POWER', cache: 'from local cache', 'stale-cache': 'from an older cache (NASA POWER unreachable)', snapshot: 'from the offline snapshot' }[d.provenance.delivery];
    status(`Signal locked · ${d.provenance.days.toLocaleString()} days of data ${src} · ${((performance.now() - t0) / 1000).toFixed(1)} s · latest day ${d.now.date}`, d.provenance.delivery === 'live' || d.provenance.delivery === 'cache' ? '' : 'error');
  } catch (e) {
    status(`Analysis failed: ${e.message}`, 'error');
  } finally { $('analyze-btn').disabled = false; }
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
function onPick(lat, lon) {
  $('f-lat').value = lat; $('f-lon').value = lon;
  if (state.fieldId != null) { state.fieldId = null; $('f-name').value = 'New field'; renderSaved(); }
  status(`Target set at ${lat}, ${lon}. Press Analyze to pull NASA data.`);
}

function wireLayers(cfg) {
  $('layer-select').innerHTML = cfg.layers.map(l => `<option value="${l.id}">${esc(l.title)}</option>`).join('');
  const apply = (id, date) => {
    const l = mapCtl.show(id, date);
    $('layer-date').disabled = !l.dated;
    $('layer-date').value = l.dated ? mapCtl.date : '';
    $('layer-desc').textContent = l.description + (l.dated ? ` · ${mapCtl.date}` : '');
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

function startClock() {
  const tick = () => { $('utc').textContent = 'UTC ' + new Date().toISOString().slice(11, 19); };
  tick(); setInterval(tick, 1000);
}

async function boot() {
  startStars($('stars')); startClock(); wireUI(); wirePlanner();
  try {
    await api.health(); $('api-dot').className = 'dot ok';
  } catch { $('api-dot').className = 'dot err'; status('Backend unreachable. Start it with ./run.sh', 'error'); return; }
  const [cropInfo, layers] = await Promise.all([api.crops(), api.layers()]);
  state.crops = cropInfo.crops; state.goals = cropInfo.goals; state.plans = structuredClone(cropInfo.default_rotations);
  $('f-previous').innerHTML = state.crops.map(c => `<option>${esc(c.name)}</option>`).join('');
  renderPriorities();
  mapCtl = createMap($('map'), layers, onPick);
  wireLayers(layers);
  await loadFields();
  if (state.fields.length) { const f = state.fields[0]; state.fieldId = f.id; fillForm(f); renderSaved(); analyze(); }
  else rankPlans();
}

boot();

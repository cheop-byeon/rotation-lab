// Chart builders. One y-axis per chart (never dual-axis); every chart has a table view.
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const C = () => ({
  temp: css('--s-temp'), rain: css('--s-rain'), et0: css('--s-et0'), soil: css('--s-soil'),
  ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), grid: 'rgba(130,165,255,0.08)', surface: css('--panel-solid'),
});
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

const charts = {};

function base(c, { yTitle, yMin, yMax, legendFilter } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.surface, borderColor: 'rgba(130,165,255,0.3)', borderWidth: 1, padding: 10,
        titleColor: c.ink, bodyColor: c.ink2, titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 }, usePointStyle: true, boxWidth: 8, boxHeight: 8,
        filter: legendFilter || (() => true),
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 18, font: { family: 'JetBrains Mono', size: 10 } } },
      y: { min: yMin, max: yMax, grid: { color: c.grid }, border: { display: false },
           title: { display: !!yTitle, text: yTitle, color: c.muted, font: { family: 'JetBrains Mono', size: 10 } },
           ticks: { color: c.muted, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 6 } },
    },
    elements: { point: { radius: 0, hoverRadius: 5, hitRadius: 8 }, line: { borderWidth: 2, tension: 0.25 } },
  };
}

// Vertical crosshair on hover (line/area charts).
const crosshair = {
  id: 'crosshair',
  afterDraw(chart) {
    const a = chart.tooltip?._active;
    if (!a?.length || chart.config.type === 'bar') return;
    const { ctx, chartArea: { top, bottom } } = chart; const x = a[0].element.x;
    ctx.save(); ctx.strokeStyle = 'rgba(232,237,255,0.35)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
  },
};

function draw(id, config) {
  charts[id]?.destroy();
  config.plugins = [crosshair];
  charts[id] = new Chart(document.getElementById(id), config);
}

const notBand = (item) => !item.dataset._band;

export function renderCharts(d) {
  const c = C();
  Chart.defaults.font.family = 'Space Grotesk';
  const r = d.recent, labels = r.dates.map(fmtDay);

  draw('c-temp', { type: 'line', data: { labels, datasets: [
    { label: 'Max', data: r.tmax, borderColor: 'transparent', backgroundColor: alpha(c.temp, 0.22), fill: '+1', _band: true, pointHitRadius: 0 },
    { label: 'Min', data: r.tmin, borderColor: 'transparent', fill: false, _band: true, pointHitRadius: 0 },
    { label: 'Mean °C', data: r.tmean, borderColor: c.temp, backgroundColor: c.temp, pointHoverBorderColor: c.surface, pointHoverBorderWidth: 2 },
  ] }, options: { ...base(c), plugins: { ...base(c).plugins, tooltip: { ...base(c).plugins.tooltip,
    callbacks: { label: (ctx) => ctx.dataset._band ? null : ` Mean ${ctx.parsed.y} °C  (min ${r.tmin[ctx.dataIndex]}, max ${r.tmax[ctx.dataIndex]})` } } } } });

  draw('c-rain', { type: 'bar', data: { labels, datasets: [
    { type: 'line', label: 'ET₀ mm', data: r.et0.map(v => v == null ? null : +v.toFixed(1)), borderColor: c.et0, backgroundColor: c.et0, borderDash: [5, 4], order: 0 },
    { label: 'Rain mm', data: r.prec, backgroundColor: c.rain, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', barPercentage: 0.8, categoryPercentage: 0.9, order: 1 },
  ] }, options: { ...base(c, { yMin: 0 }), interaction: { mode: 'index', intersect: false } } });

  // GDD vs envelope
  const g = d.gdd, start = new Date(g.season_start + 'T00:00:00Z');
  const n = g.envelope.mean.length;
  const glabels = Array.from({ length: n }, (_, i) => fmtDay(new Date(start.getTime() + i * g.step_days * 864e5).toISOString().slice(0, 10)));
  document.getElementById('gdd-title').textContent = `Cumulative growing degree days (base ${g.base} °C) · season from ${fmtDay(g.season_start)}`;
  draw('c-gdd', { type: 'line', data: { labels: glabels, datasets: [
    { label: 'P90', data: g.envelope.p90, borderColor: 'transparent', backgroundColor: alpha(c.ink2, 0.14), fill: '+1', _band: true },
    { label: 'P10', data: g.envelope.p10, borderColor: 'transparent', fill: false, _band: true },
    { label: '10-yr mean', data: g.envelope.mean, borderColor: c.ink2, borderDash: [5, 4], borderWidth: 1.5 },
    { label: 'This season', data: g.current, borderColor: c.temp, backgroundColor: c.temp, borderWidth: 2.5 },
  ] }, options: { ...base(c, { yMin: 0, yTitle: '°C·days', legendFilter: notBand }) } });

  // Soil wetness
  const s = d.soil, slabels = s.dates.map(fmtDay);
  draw('c-soil', { type: 'line', data: { labels: slabels, datasets: [
    { label: 'P90', data: s.normal_p90, borderColor: 'transparent', backgroundColor: alpha(c.ink2, 0.14), fill: '+1', _band: true },
    { label: 'P10', data: s.normal_p10, borderColor: 'transparent', fill: false, _band: true },
    { label: 'Root zone (MERRA-2)', data: s.root, borderColor: c.soil, backgroundColor: c.soil, spanGaps: false },
    { label: 'Root zone (near-real-time)', data: s.root_nrt, borderColor: c.soil, backgroundColor: c.soil, borderDash: [5, 4] },
  ] }, options: { ...base(c, { yTitle: 'wetness 0–1', legendFilter: notBand }) } });
  document.getElementById('soil-note').textContent = s.nrt_break
    ? `NASA POWER switches from MERRA-2 reanalysis to the GEOS-IT near-real-time feed on ${fmtDay(s.nrt_break)}. The near-real-time model has a different soil baseline, so that segment (dashed) is not compared with the typical range; advisories use the last reanalysis day.`
    : 'Root-zone soil wetness from MERRA-2 via NASA POWER. The grey band is the typical range for each date over the last 10 years.';

  // Monthly anomalies (diverging: warm/cool)
  document.querySelectorAll('.norm-period').forEach(e => { e.textContent = d.provenance.climatology?.period ?? 'long-term'; });
  const m = d.monthly, mlabels = m.map(x => fmtMonth(x.month) + (x.complete ? '' : '*'));
  draw('c-tanom', { type: 'bar', data: { labels: mlabels, datasets: [{ label: 'Anomaly °C', data: m.map(x => x.t_anomaly),
    backgroundColor: m.map(x => (x.t_anomaly ?? 0) >= 0 ? c.temp : c.rain), borderRadius: 3, borderSkipped: false, barPercentage: 0.85 }] },
    options: { ...base(c, { yTitle: '°C' }), interaction: { mode: 'index', intersect: false } } });
  draw('c-panom', { type: 'bar', data: { labels: mlabels, datasets: [{ label: 'Rain vs normal %', data: m.map(x => x.rain_anomaly_pct),
    backgroundColor: m.map(x => (x.rain_anomaly_pct ?? 0) >= 0 ? c.rain : c.temp), borderRadius: 3, borderSkipped: false, barPercentage: 0.85 }] },
    options: { ...base(c, { yTitle: '%' }), interaction: { mode: 'index', intersect: false },
      plugins: { ...base(c).plugins, tooltip: { ...base(c).plugins.tooltip, callbacks: { afterLabel: (ctx) => ` ${m[ctx.dataIndex].rain} mm (normal ${m[ctx.dataIndex].rain_normal} mm)` } } } } });
}

const v = (x, suffix = '') => x == null ? '—' : `${x}${suffix}`;
export function tableFor(tab, d) {
  if (tab === 'recent') return { head: ['Date', 'Tmin °C', 'Tmean °C', 'Tmax °C', 'Rain mm', 'ET₀ mm'],
    rows: d.recent.dates.map((x, i) => [x, v(d.recent.tmin[i]), v(d.recent.tmean[i]), v(d.recent.tmax[i]), v(d.recent.prec[i]), v(d.recent.et0[i])]).reverse() };
  if (tab === 'gdd') { const g = d.gdd, st = new Date(g.season_start + 'T00:00:00Z');
    return { head: ['Date', 'This season', '10-yr mean', 'P10', 'P90'], rows: g.envelope.mean.map((_, i) => [
      new Date(st.getTime() + i * g.step_days * 864e5).toISOString().slice(0, 10), v(g.current[i]), g.envelope.mean[i], g.envelope.p10[i], g.envelope.p90[i]]) }; }
  if (tab === 'soil') return { head: ['Date', 'Root zone', 'Root zone (NRT)', 'Surface', 'Typical P10', 'Typical P90'],
    rows: d.soil.dates.map((x, i) => [x, v(d.soil.root[i]), v(d.soil.root_nrt[i]), v(d.soil.top[i]), v(d.soil.normal_p10[i]), v(d.soil.normal_p90[i])]).reverse() };
  return { head: ['Month', 'Tmean °C', 'Anomaly °C', 'Rain mm', 'Normal mm', 'Rain vs normal'],
    rows: d.monthly.map(x => [x.month + (x.complete ? '' : ' (partial)'), v(x.tmean), v(x.t_anomaly), v(x.rain), v(x.rain_normal), v(x.rain_anomaly_pct, '%')]).reverse() };
}

// ---------------------------------------------------------------- NASA HLS satellite record
// Seasons oldest → newest; order validated for adjacent-pair separation on the dark panel.
const SEASON_COLOURS = ['#2fa477', '#9d5bdb', '#c8801f', '#2e98c4', '#c2547d'];

export function growWindow(season, lat) {
  const D = (y, m, d) => Date.UTC(y, m, d);
  if (lat >= 23.5) return [D(season, 3, 1), D(season, 9, 31)];
  if (lat >= 0) return [D(season, 0, 1), D(season, 11, 31)];
  if (lat > -23.5) return [D(season - 1, 6, 1), D(season, 5, 30)];
  return [D(season - 1, 9, 1), D(season, 3, 30)];
}

export function renderVegCharts(veg, greenness = 'ndvi') {
  const c = C(), lat = veg.centroid.lat;
  const seasons = veg.seasons.filter((s) => s.clear_images > 0);
  const recent = seasons.slice(-5);
  // the last five seasons get the validated categorical colours; older seasons are grey context
  const colour = Object.fromEntries(seasons.map((s) => [s.season, recent.includes(s)
    ? SEASON_COLOURS[recent.indexOf(s) + (5 - recent.length)] : '#4B5563']));
  const ref = growWindow(seasons[seasons.length - 1]?.season ?? new Date().getUTCFullYear(), lat)[0];
  const sets = (key) => seasons.map((s) => {
    const [a, b] = growWindow(s.season, lat);
    const data = veg.observations.filter((o) => o[key] != null).map((o) => [Date.parse(o.date + 'T00:00:00Z'), o])
      .filter(([d]) => d >= a && d <= b).map(([d, o]) => ({ x: (d - a) / 864e5, y: o[key], date: o.date, sensor: o.sensor, clear: o.clear_pct }));
    const old = !recent.includes(s);
    return { label: s.label, data, borderColor: colour[s.season], backgroundColor: colour[s.season], pointRadius: old ? 0 : 2.5, pointHoverRadius: 6,
      borderWidth: old ? 1.2 : 2, tension: 0.2, order: old ? 1 : 0 };
  });
  const span = (growWindow(seasons[seasons.length - 1]?.season ?? 2000, lat)[1] - ref) / 864e5;
  const opts = (yTitle, yMin, yMax) => {
    const o = base(c, { yTitle, yMin, yMax });
    o.interaction = { mode: 'nearest', intersect: false };
    const monthStarts = [];
    for (let m = new Date(ref); (m.getTime() - ref) / 864e5 <= span; m.setUTCMonth(m.getUTCMonth() + 1)) monthStarts.push((m.getTime() - ref) / 864e5);
    o.scales.x = { type: 'linear', min: 0, max: span, grid: { color: c.grid }, border: { color: c.grid },
      afterBuildTicks: (axis) => { axis.ticks = monthStarts.map((value) => ({ value })); },
      ticks: { color: c.muted, font: { family: 'JetBrains Mono', size: 10 },
        callback: (v) => new Date(ref + v * 864e5).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) } };
    o.plugins.tooltip.callbacks = { title: (items) => items[0].raw.date, label: (ctx) => ` ${ctx.dataset.label} · ${ctx.parsed.y.toFixed(3)} · ${ctx.raw.sensor} · ${Math.round(ctx.raw.clear * 100)}% clear` };
    return o;
  };
  // The field's usual range for this season's likely crop (NDVI only), as a shaded band behind the season lines.
  const u = veg.usual_range, band = greenness === 'ndvi' && u?.band?.length;
  const bandSets = band ? [
    { label: 'Usual range', data: u.band.map(([d, , hi]) => ({ x: d, y: hi })), borderColor: 'transparent', backgroundColor: alpha(c.soil, 0.32),
      fill: '+1', pointRadius: 0, pointHoverRadius: 0, order: 3, _band: true },
    { label: 'Usual range (low)', data: u.band.map(([d, lo]) => ({ x: d, y: lo })), borderColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, order: 3, _band: true },
  ] : [];
  const vo = opts(greenness.toUpperCase(), -0.1, 1);
  vo.plugins.tooltip.filter = (item) => !item.dataset._band;
  draw('c-ndvi', { type: 'line', data: { datasets: [...sets(greenness), ...bandSets] }, options: vo });
  draw('c-ndmi', { type: 'line', data: { datasets: sets('ndmi') }, options: opts('NDMI', -0.4, 0.8) });
  const older = seasons.filter((s) => !recent.includes(s));
  return [...(older.length ? [{ label: `${older[0].label}–${older[older.length - 1].label}`, colour: '#4B5563' }] : []),
    ...recent.map((s) => ({ label: s.label, colour: colour[s.season] })),
    ...(band ? [{ label: `usual range${u.crop ? ` (${u.crop.replace('_', ' ')}: ${u.seasons.join(', ')})` : ''}`, colour: alpha(c.soil, 0.55) }] : [])];
}

export function renderTrendChart(trend) {
  const c = C(), pts = trend.seasons.map((s) => ({ x: s.season, y: s.evi_mean, crop: s.crop }));
  const key = trend.status === 'mixed_crops' ? trend.same_crop?.crop : null;
  const crop = (v) => (v || 'unclear').replace('_', ' ');
  // With mixed crops, each likely crop gets its own colour (fixed per crop, from the validated season palette).
  const CROP_COLOUR = { grass: '#2fa477', new_ley: '#c2547f', winter_crop: '#2e98c4', spring_crop: '#c8801f', late_crop: '#9d5bdb' };
  const groups = trend.status === 'mixed_crops'
    ? [...new Set(pts.map((p) => (p.crop in CROP_COLOUR ? p.crop : 'other')))].map((k) => [k, pts.filter((p) => (p.crop in CROP_COLOUR ? p.crop : 'other') === k)])
    : [[null, pts]];
  const sets = groups.map(([k, data]) => ({ label: k ? (k === 'other' ? 'unclear' : crop(k)) : 'Season-long EVI', data,
    borderColor: k ? (CROP_COLOUR[k] || c.muted) : c.soil, backgroundColor: k ? (CROP_COLOUR[k] || c.muted) : c.soil,
    pointRadius: 5, pointHoverRadius: 7, borderWidth: 0, showLine: false }));
  const fit = trend.status === 'ok' ? trend.fit : trend.same_crop?.fit;
  if (fit) {
    sets.push({ label: key ? `Theil–Sen (${crop(key)} only)` : 'Theil–Sen trend', data: fit.map(([x, y]) => ({ x, y })),
      borderColor: c.ink2, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, showLine: true });
  }
  const o = base(c, { yTitle: 'mean EVI' });
  o.interaction = { mode: 'nearest', intersect: true };
  const years = [...trend.seasons.map((s) => s.season), ...trend.skipped.map((s) => s.season)];
  o.scales.x = { ...o.scales.x, type: 'linear', min: Math.min(...years) - 0.5, max: Math.max(...years) + 0.5,
    ticks: { ...(o.scales.x?.ticks || {}), callback: (v) => String(v) },
    afterBuildTicks: (ax) => { ax.ticks = Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => ({ value: Math.min(...years) + i })); } };
  o.plugins.legend = { display: trend.status === 'mixed_crops', position: 'top', align: 'end',
    labels: { color: c.ink2, usePointStyle: true, boxWidth: 8, font: { family: 'JetBrains Mono', size: 10 } } };
  o.plugins.tooltip.callbacks = { title: (items) => String(items[0].raw.x),
    afterLabel: (ctx) => ctx.raw.crop !== undefined ? ` likely crop: ${crop(ctx.raw.crop)}` : '' };
  draw('c-trend', { type: 'scatter', data: { datasets: sets }, options: o });
}


export function renderChangeChart(m, d, canvas = 'c-change') {
  const c = C();
  const [t0, t1] = d.then.split('–').map(Number), [n0, n1] = d.now.split('–').map(Number);
  const mean = (a, b) => { const v = m.series.filter(([y]) => y >= a && y <= b).map(([, x]) => x); return v.reduce((s, x) => s + x, 0) / v.length; };
  const seg = (a, b, label, colour) => ({ label, data: [{ x: a - 0.4, y: mean(a, b) }, { x: b + 0.4, y: mean(a, b) }], borderColor: colour,
    borderWidth: 3, pointRadius: 0, showLine: true });
  const sets = [
    { label: 'Each season', data: m.series.map(([x, y]) => ({ x, y })), borderColor: c.muted, backgroundColor: c.muted, pointRadius: 3, pointHoverRadius: 6, showLine: false },
    seg(t0, t1, `${d.then} average`, c.ink2), seg(n0, n1, `${d.now} average`, c.soil),
  ];
  const o = base(c, { yTitle: m.unit === 'date' ? 'day of season' : m.unit });
  o.interaction = { mode: 'nearest', intersect: true };
  o.scales.x = { ...o.scales.x, type: 'linear', min: m.series[0][0] - 0.5, max: m.series[m.series.length - 1][0] + 0.5,
    ticks: { ...(o.scales.x?.ticks || {}), callback: (v) => String(v) },
    afterBuildTicks: (ax) => { const a = Math.ceil(m.series[0][0] / 5) * 5; ax.ticks = Array.from({ length: Math.floor((m.series[m.series.length - 1][0] - a) / 5) + 1 }, (_, i) => ({ value: a + 5 * i })); } };
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: c.ink2, usePointStyle: true, boxWidth: 8, font: { family: 'JetBrains Mono', size: 10 } } };
  o.plugins.tooltip.callbacks = { title: (items) => String(items[0].raw.x), label: (ctx) => ` ${ctx.dataset.label}: ${(+ctx.raw.y).toFixed(m.unit === '°C' ? 1 : 0)}` };
  draw(canvas, { type: 'scatter', data: { datasets: sets }, options: o });
}

export function renderAroundChart(d, colours, names) {
  const c = C();
  const seasons = d.seasons.filter((s) => s.usable);
  const keys = ['spring_crop', 'new_ley', 'winter_crop', 'late_crop', 'grass', 'unclear', 'bare'];
  const sets = keys.map((k) => ({ label: names[k], data: seasons.map((s) => +(100 * (s.shares[k] || 0)).toFixed(1)),
    backgroundColor: colours[k], borderColor: c.surface, borderWidth: { top: 2 }, borderSkipped: false, stack: 'all' }));
  const o = base(c, { yTitle: '% of farmland', yMin: 0, yMax: 100 });
  o.scales.x.stacked = true; o.scales.y.stacked = true;
  o.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}%` };
  draw('c-around', { type: 'bar', data: { labels: seasons.map((s) => s.label), datasets: sets }, options: o });
}

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

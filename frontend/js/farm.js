// Farm page: one farm's land (parcels to choose a field from), what it reported growing, and how its crops compare with
// the municipality. Reached from "Find my farm" (?area=&gnr=&bnr=) or a farm dot (?area=&at=lat,lon).
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
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Reported crops (Landbruksdirektoratet names) → the municipality's crop groups, to compare like with like.
const GROUP = { 'Grass ley': 'Grass and forage', 'Other fodder': 'Grass and forage', Barley: 'Barley', Oats: 'Oats',
  'Spring wheat': 'Wheat', 'Winter wheat': 'Wheat', Rye: 'Other cereals', 'Other cereal': 'Other cereals', 'Cereal for crushing': 'Other cereals',
  Potato: 'Potatoes and vegetables', Vegetables: 'Potatoes and vegetables', Oilseed: 'Oilseeds, peas and beans', 'Peas and beans': 'Oilseeds, peas and beans' };
const COLOUR = { 'Grass and forage': '#2fa477', Barley: '#c8801f', Oats: '#d9b43a', Wheat: '#2e98c4', 'Other cereals': '#8a6d3b',
  'Potatoes and vegetables': '#9d5bdb', 'Oilseeds, peas and beans': '#c2547f', Other: '#8a8f98' };

function farmQuery(qs) {
  return qs.has('at') ? { area: qs.get('area') || '', at: qs.get('at') } : { area: qs.get('area') || '', gnr: qs.get('gnr'), bnr: qs.get('bnr') };
}

async function boot() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  const qs = new URLSearchParams(location.search);
  const fq = farmQuery(qs);
  let d;
  try {
    if (fq.at) { const [lat, lon] = fq.at.split(',').map(Number); d = await api.farm({ lat, lon }); }
    else d = await api.farm({ kommune: fq.area, gnr: fq.gnr, bnr: fq.bnr });
  } catch (e) { $('farm-title').textContent = t('farm.failed', { error: e.message }); return; }
  const idx = await api.areas().catch(() => ({ areas: [] }));
  const code = d.property?.kommune || fq.area;
  const area = idx.areas.find((a) => a.code === code);
  if (area) { $('crumb-area').hidden = false; $('crumb-area-link').textContent = area.name; $('crumb-area-link').href = `/area?area=${area.code}`; }
  if (d.status !== 'ok') {
    $('farm-title').textContent = t('farm.notFoundTitle');
    $('farm-lead').innerHTML = `${esc(d.message)} <a href="/">${esc(t('farm.tryAgain'))}</a>`;
    return;
  }
  // The number is shown when the grower typed it; a farm picked on the map is just "your farm".
  const name = fq.gnr ? t('farm.titleNumber', { gnr: d.property.gnr, bnr: d.property.bnr }) : t('farm.title');
  $('crumb-here').textContent = name;
  $('farm-title').textContent = area ? `${name}, ${area.name}` : name;
  const total = d.parcels.reduce((s, p) => s + p.area_ha, 0);
  $('farm-lead').textContent = t('farm.lead', { n: d.parcels.length, ha: total.toFixed(1) });
  $('farm-body').hidden = false;
  const farmLink = new URLSearchParams(fq).toString();
  renderParcels(d, area, name, farmLink);
  renderGrew(d);
  renderCompare(d, area);
}

function fieldUrl(p, area, farmName, farmLink) {
  return `/field?${new URLSearchParams({ lat: p.point[0], lon: p.point[1], place: area?.name || '', area: area?.code || '',
    label: t('farm.parcel', { n: p.n, ha: p.area_ha.toFixed(1) }), fq: farmLink, fn: farmName })}`;
}

function renderParcels(d, area, farmName, farmLink) {
  const map = L.map('parcel-map', { scrollWheelZoom: false });
  L.tileLayer(IMAGERY, { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
  const layers = d.parcels.map((p) => {
    const poly = L.polygon(p.boundary.coordinates[0].map(([x, y]) => [y, x]), { color: '#FFFDF8', weight: 2.5, fillColor: '#2E7D32', fillOpacity: 0.25 });
    poly.bindTooltip(String(p.n), { permanent: true, direction: 'center', className: 'parcel-label' });
    if (p.usable) poly.on('click', () => { location.href = fieldUrl(p, area, farmName, farmLink); });
    return poly;
  });
  const group = L.featureGroup(layers).addTo(map);
  map.fitBounds(group.getBounds(), { padding: [16, 16], maxZoom: 16 });
  $('parcels').innerHTML = d.parcels.map((p) => `<li>${p.usable
    ? `<a class="btn secondary" href="${esc(fieldUrl(p, area, farmName, farmLink))}">${esc(t('farm.parcel', { n: p.n, ha: p.area_ha.toFixed(1) }))} →</a>`
    : `<span class="muted">${esc(t('farm.parcel', { n: p.n, ha: p.area_ha.toFixed(1) }))}: ${esc(t('farm.unusable'))}</span>`}</li>`).join('');
}

function renderGrew(d) {
  if (d.reported !== 'one') {
    $('grew').innerHTML = `<p>${esc(t(d.reported === 'several' ? 'farm.severalFarms' : 'farm.noReports'))}</p>`;
    return;
  }
  const years = d.farms[0].years;
  const rows = years.slice().reverse().map((y) => {
    const arable = Object.entries(y.areas).filter(([k]) => k !== 'Pasture').sort((a, b) => b[1] - a[1]);
    const text = arable.map(([k, v]) => `${k} ${v}`).join(', ');
    return `<tr><td><b>${y.year}</b></td><td>${esc(y.one_crop ? y.main : t('farm.mixed'))}</td><td class="small">${esc(text)} daa</td></tr>`;
  }).join('');
  $('grew').innerHTML = `<div class="table-wrap"><table class="simple"><thead><tr><th>${esc(t('farm.year'))}</th><th>${esc(t('farm.mainCrop'))}</th><th>${esc(t('farm.allCrops'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small muted">${esc(t('farm.grewNote'))}</p>`;
}

async function renderCompare(d, area) {
  if (!area || d.reported !== 'one') { $('compare').innerHTML = area ? `<p><a href="/area?area=${area.code}">${esc(t('farm.seeArea', { name: area.name }))}</a></p>` : ''; return; }
  const a = await api.area(area.code);
  const last = d.farms[0].years[d.farms[0].years.length - 1];
  const i = a.years.indexOf(last.year);
  const mine = {};
  for (const [k, v] of Object.entries(last.areas)) if (k !== 'Pasture') { const g = GROUP[k] || 'Other'; mine[g] = (mine[g] || 0) + v; }
  const myTotal = Object.values(mine).reduce((s, v) => s + v, 0) || 1;
  const groups = [...new Set([...Object.keys(mine), ...a.crops.filter((c) => c.share_pct[i] >= 2).map((c) => c.group)])];
  const bar = (pct, g) => `<span class="bar-track"><i style="width:${pct}%;background:${COLOUR[g] || '#8a8f98'}"></i></span>`;
  $('compare').innerHTML = `<p class="muted">${esc(t('farm.compareIntro', { year: last.year, name: area.name }))}</p>
    <table class="compare"><thead><tr><th></th><th>${esc(t('farm.yourFarm'))}</th><th>${esc(area.name)}</th></tr></thead><tbody>
    ${groups.map((g) => { const m = 100 * (mine[g] || 0) / myTotal, k = a.crops.find((c) => c.group === g)?.share_pct[i] || 0;
      return `<tr><td>${esc(t(`area.group.${g}`).replace(/^./, (x) => x.toUpperCase()))}</td><td>${bar(m, g)} ${Math.round(m)}%</td><td>${bar(k, g)} ${Math.round(k)}%</td></tr>`; }).join('')}
    </tbody></table>
    <p><a href="/area?area=${area.code}">${esc(t('farm.seeArea', { name: area.name }))}</a></p>`;
}

boot();

// Start page: find my farm, by municipality and farm/holding number, or by tapping it on a map of farms.
import { api } from './api.js';
import en from './i18n/en.js';

const STR = en;
const $ = (id) => document.getElementById(id);
function t(path, params = {}) {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), STR);
  if (typeof v !== 'string') return v ?? path;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const state = { list: [], map: null, layer: null, mapFor: null };

function findArea(q) {
  const norm = (s) => s.trim().toLocaleLowerCase('nb');
  const n = norm(q);
  return state.list.find((a) => norm(a.name) === n) || state.list.find((a) => norm(a.name).startsWith(n));
}

async function showMap() {
  const a = findArea($('kommune').value);
  if (!$('by-map').open) return;
  if (!a) { $('map-msg').textContent = t('start.mapHint'); return; }
  if (state.mapFor === a.code) return;
  state.mapFor = a.code;
  $('map-msg').textContent = t('start.mapFor', { name: a.name });
  const d = await api.area(a.code);
  if (!state.map) {
    state.map = L.map('farm-map', { scrollWheelZoom: false });
    L.tileLayer(IMAGERY, { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(state.map);
    L.tileLayer(LABELS, { maxZoom: 18 }).addTo(state.map);
  }
  state.map.invalidateSize();
  if (state.layer) state.layer.remove();
  const dots = d.dots.map(([lat, lon]) => L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: '#2E7D32', fillOpacity: 0.9 })
    .on('click', () => { location.href = `/farm?${new URLSearchParams({ area: a.code, at: `${lat},${lon}` })}`; }));
  state.layer = L.featureGroup(dots).addTo(state.map);
  if (dots.length) state.map.fitBounds(state.layer.getBounds(), { padding: [16, 16], maxZoom: 13 });
}

async function boot() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  state.list = (await api.areas()).areas;
  $('places').innerHTML = state.list.map((a) => `<option value="${a.name.replace(/"/g, '&quot;')}">`).join('');
  $('find').onsubmit = (e) => {
    e.preventDefault();
    const a = findArea($('kommune').value || $('kommune').placeholder);
    const gnr = +$('gnr').value, bnr = +$('bnr').value;
    if (!a) { $('find-msg').textContent = t('start.noArea', { q: $('kommune').value }); return; }
    if (!gnr || !bnr) { $('find-msg').textContent = t('start.needNumbers'); $('by-map').open = true; showMap(); return; }
    location.href = `/farm?${new URLSearchParams({ area: a.code, gnr, bnr })}`;
  };
  $('by-map').addEventListener('toggle', showMap);
  $('kommune').addEventListener('change', showMap);
}

boot();

async function request(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail); } catch {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => request('/api/health'),
  crops: () => request('/api/crops'),
  layers: () => request('/api/layers'),
  cropCheck: (lat, lon, crop) => request('/api/crop-check?' + new URLSearchParams({ lat, lon, crop })),
  change: (lat, lon) => request('/api/change?' + new URLSearchParams({ lat, lon })),
  analysis: (f) => request('/api/analysis?' + new URLSearchParams({
    lat: f.lat, lon: f.lon, soil: f.soil, drainage: f.drainage, irrigation: f.irrigation, previous_crop: f.previous_crop })),
  rank: (body) => request('/api/rotations/rank', { method: 'POST', body: JSON.stringify(body) }),
  fields: () => request('/api/fields'),
  createField: (f) => request('/api/fields', { method: 'POST', body: JSON.stringify(f) }),
  updateField: (id, f) => request(`/api/fields/${id}`, { method: 'PUT', body: JSON.stringify(f) }),
  deleteField: (id) => request(`/api/fields/${id}`, { method: 'DELETE' }),
  neighbourhood: (boundary) => request('/api/neighbourhood', { method: 'POST', body: JSON.stringify({ boundary }) }),
  zones: (boundary, seasons = 5) => request('/api/zones', { method: 'POST', body: JSON.stringify({ boundary, seasons }) }),
  vegetation: (boundary, seasons = null) => request('/api/vegetation', { method: 'POST', body: JSON.stringify({ boundary, seasons }) }),
  areas: () => request('/api/areas'),
  area: (code) => request(`/api/areas/${encodeURIComponent(code)}`),
  farm: (q) => request('/api/farm?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')))),
  parcel: (lat, lon) => request('/api/parcel?' + new URLSearchParams({ lat, lon })),
  soil: (lat, lon) => request('/api/soil?' + new URLSearchParams({ lat, lon })),
  farmCrops: (lat, lon) => request('/api/farm-crops?' + new URLSearchParams({ lat, lon })),
  exportUrl: (f) => `/api/export.csv?lat=${f.lat}&lon=${f.lon}`,
};

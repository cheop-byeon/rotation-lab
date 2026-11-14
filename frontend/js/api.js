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
  analysis: (f) => request('/api/analysis?' + new URLSearchParams({
    lat: f.lat, lon: f.lon, soil: f.soil, drainage: f.drainage, irrigation: f.irrigation, previous_crop: f.previous_crop })),
  rank: (body) => request('/api/rotations/rank', { method: 'POST', body: JSON.stringify(body) }),
  fields: () => request('/api/fields'),
  createField: (f) => request('/api/fields', { method: 'POST', body: JSON.stringify(f) }),
  updateField: (id, f) => request(`/api/fields/${id}`, { method: 'PUT', body: JSON.stringify(f) }),
  deleteField: (id) => request(`/api/fields/${id}`, { method: 'DELETE' }),
  exportUrl: (f) => `/api/export.csv?lat=${f.lat}&lon=${f.lon}`,
};

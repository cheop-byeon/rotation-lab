// Minimal field-outline drawing for Leaflet: tap corners, Undo, Done. Works with mouse and touch.
// Returns GeoJSON Polygons ([lon, lat] order, closed ring).

export function areaHa(geom) {
  const ring = geom.coordinates[0];
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI / 180;
  const pts = ring.map(([x, y]) => [x * 111320 * Math.cos(lat0), y * 110540]);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(s) / 2 / 10000;
}

export function centroid(geom) {
  const ring = geom.coordinates[0].slice(0, -1);
  return [ring.reduce((s, p) => s + p[1], 0) / ring.length, ring.reduce((s, p) => s + p[0], 0) / ring.length];
}

export function createDrawer(map, { color = '#2E7D32', onChange = () => {} } = {}) {
  const layer = L.layerGroup().addTo(map);
  let pts = [], drawing = false, shape = null;

  function redraw() {
    layer.clearLayers();
    const ll = pts.map(([lat, lon]) => [lat, lon]);
    if (drawing) {
      if (ll.length >= 2) L.polyline(ll.length >= 3 ? [...ll, ll[0]] : ll, { color, weight: 3, dashArray: '6 6', interactive: false }).addTo(layer);
      ll.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 8 : 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false }).addTo(layer));
    } else if (shape) {
      L.polygon(shape.coordinates[0].map(([x, y]) => [y, x]), { color, weight: 3, fillColor: color, fillOpacity: 0.18, interactive: false }).addTo(layer);
    }
  }

  function toGeo() {
    const ring = pts.map(([lat, lon]) => [+lon.toFixed(6), +lat.toFixed(6)]);
    return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  }

  function emit() { onChange({ drawing, points: pts.length, shape, areaHa: drawing && pts.length >= 3 ? areaHa(toGeo()) : shape ? areaHa(shape) : 0 }); }

  map.on('click', (e) => {
    if (!drawing) return;
    pts.push([e.latlng.lat, e.latlng.lng]);
    redraw(); emit();
  });

  return {
    get drawing() { return drawing; },
    get shape() { return shape; },
    start() { drawing = true; pts = []; map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair'; redraw(); emit(); },
    undo() { pts.pop(); redraw(); emit(); },
    cancel() { drawing = false; pts = []; map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; redraw(); emit(); },
    finish() {
      if (pts.length < 3) return null;
      shape = toGeo(); drawing = false; pts = [];
      map.doubleClickZoom.enable(); map.getContainer().style.cursor = '';
      redraw(); emit();
      return shape;
    },
    set(geo) { shape = geo || null; drawing = false; pts = []; redraw(); emit(); },
    clear() { shape = null; drawing = false; pts = []; redraw(); emit(); },
    fit() { if (shape) map.fitBounds(shape.coordinates[0].map(([x, y]) => [y, x]), { padding: [30, 30], maxZoom: 16 }); },
  };
}

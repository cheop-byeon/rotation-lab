// Leaflet map with live NASA GIBS layers over a high-resolution basemap.
export function createMap(el, config, onPick, isDrawing = () => false) {
  const map = L.map(el, { worldCopyJump: true, zoomControl: true, minZoom: 2, scrollWheelZoom: false })
    .setView([63.46, 10.92], 6);
  // Don't hijack page scrolling: wheel-zoom only after the user engages with the map.
  map.on('click focus', () => map.scrollWheelZoom.enable());
  el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
  new ResizeObserver(() => map.invalidateSize()).observe(el);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Basemap © Esri, Maxar, Earthstar Geographics',
  }).addTo(map);
  const labels = L.tileLayer(config.labels, { maxZoom: 18, pane: 'overlayPane', zIndex: 650,
    attribution: config.attribution, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' });

  let nasa = null, current = null, date = null, opacity = 0.75;
  function show(layerId, newDate) {
    current = config.layers.find(l => l.id === layerId) || config.layers[0];
    date = current.dated ? (newDate || current.default_date) : null;
    if (nasa) map.removeLayer(nasa);
    nasa = L.tileLayer(current.url, {
      time: date, maxZoom: 18, maxNativeZoom: current.max_native_zoom, opacity, zIndex: 400,
      attribution: 'NASA GIBS', bounds: [[-85, -180], [85, 180]], noWrap: false,
    }).addTo(map);
    labels.addTo(map); labels.bringToFront();
    return current;
  }
  function setOpacity(v) { opacity = v; nasa?.setOpacity(v); }

  const reticle = L.divIcon({ className: 'reticle-icon', html: '<div class="reticle"></div>', iconSize: [34, 34], iconAnchor: [17, 17] });
  let marker = null;
  function setTarget(lat, lon, { fly = true } = {}) {
    if (!marker) {
      marker = L.marker([lat, lon], { icon: reticle, draggable: true, keyboard: true, title: 'Field location' }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); onPick(+p.lat.toFixed(4), +wrapLon(p.lng).toFixed(4)); });
    } else marker.setLatLng([lat, lon]);
    if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 9), { duration: 1.2 });
  }
  map.on('click', e => { if (isDrawing()) return; const lat = +e.latlng.lat.toFixed(4), lon = +wrapLon(e.latlng.lng).toFixed(4); setTarget(lat, lon, { fly: false }); onPick(lat, lon); });
  // POWER's met grid cell (0.5° × 0.625°) — shows the footprint the climate numbers represent.
  let cell = null;
  function showCell(lat, lon) {
    const la = Math.round(lat / 0.5) * 0.5, lo = Math.round(lon / 0.625) * 0.625;
    const b = [[la - 0.25, lo - 0.3125], [la + 0.25, lo + 0.3125]];
    if (cell) cell.setBounds(b); else cell = L.rectangle(b, { color: '#4FD29A', weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(map);
  }
  return { map, show, setOpacity, setTarget, showCell, get current() { return current; }, get date() { return date; } };
}

function wrapLon(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }

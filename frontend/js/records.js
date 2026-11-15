// One piece of farm land opened from a spot (e.g. a farm dot in the area view), filled from public records. The simple
// (field) and detailed (data) views both use this, so they always show the same land with the same inputs.
//
// URL: ?lat=&lon=&place=&area=  — lat/lon is the spot that was picked, place the municipality name, area its number.
import { api } from './api.js';
import { centroid } from './draw.js';

// Reported crop names (Landbruksdirektoratet) → the app's crop catalogue.
const REPORTED_TO_CATALOG = { Barley: 'Barley', Oats: 'Oats', 'Spring wheat': 'Spring wheat', 'Winter wheat': 'Spring wheat',
  'Grass ley': 'Grass–clover ley', 'Other fodder': 'Grass–clover ley', Potato: 'Potato', Oilseed: 'Oilseed rape', 'Peas and beans': 'Field pea' };

export function spotFromUrl(qs = new URLSearchParams(location.search)) {
  const lat = Number(qs.get('lat')), lon = Number(qs.get('lon'));
  if (!qs.has('lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, place: qs.get('place') || qs.get('name') || '', area: qs.get('area') || '' };
}

export function spotQuery(spot) {
  return new URLSearchParams({ lat: spot.lat, lon: spot.lon, ...(spot.place ? { place: spot.place } : {}), ...(spot.area ? { area: spot.area } : {}) }).toString();
}

export async function fieldFromSpot(spot, nameFor) {
  const [parcel, soil, farm] = await Promise.all([api.parcel(spot.lat, spot.lon), api.soil(spot.lat, spot.lon), api.farmCrops(spot.lat, spot.lon)]
    .map((p) => p.catch(() => null)));
  const years = farm?.status === 'ok' && farm.farms.length === 1 ? farm.farms[0].years : [];
  const last = years[years.length - 1];
  const c = parcel?.status === 'ok' ? centroid(parcel.boundary) : null;  // [lat, lon]
  return {
    id: null, demo: 0, from_records: true, spot,
    name: nameFor(spot.place || `${spot.lat.toFixed(3)}, ${spot.lon.toFixed(3)}`),
    lat: c ? +c[0].toFixed(4) : spot.lat, lon: c ? +c[1].toFixed(4) : spot.lon,
    soil: soil?.status === 'ok' ? soil.soil : 'Unknown', drainage: 'Unknown', irrigation: 'Unknown',
    // The farm's last reported main crop; with no farm on record, barley (Norway's most grown crop) as a stated default.
    previous_crop: REPORTED_TO_CATALOG[last?.main] || 'Barley', previous_from_records: Boolean(REPORTED_TO_CATALOG[last?.main]),
    boundary: parcel?.status === 'ok' ? parcel.boundary : null, notes: '',
  };
}

// The area (municipality) a field belongs to, for the "All areas › <area>" trail: from the URL, else from the property.
export async function areaOf(field) {
  if (field?.spot?.area) return { code: field.spot.area, name: field.spot.place };
  try {
    const fc = await api.farmCrops(field.lat, field.lon);
    const code = fc?.property?.kommunenummer;
    if (!code) return null;
    const idx = await api.areas();
    const a = idx.areas.find((x) => x.code === code);
    return a ? { code: a.code, name: a.name } : null;
  } catch { return null; }
}

/* FabianApp — libreta de campo geológica (PWA). Todo se guarda en el teléfono (IndexedDB). */
'use strict';
{
const VERSION = '1.2.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;
const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fx = (v, d = 0) => v == null || isNaN(v) ? '—' : (+v).toFixed(d);

/* ---------- Base de datos (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('fabianapp', 2);
      r.onupgradeneeded = () => {
        const db = r.result, has = n => db.objectStoreNames.contains(n);
        if (!has('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!has('items')) { const it = db.createObjectStore('items', { keyPath: 'id' }); it.createIndex('projectId', 'projectId'); }
        if (!has('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!has('kv')) db.createObjectStore('kv');
        if (!has('rasters')) db.createObjectStore('rasters', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), s = t.objectStore(store), r = fn(s);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  get(st, k) { return this.req(st, 'readonly', s => s.get(k)); },
  all(st) { return this.req(st, 'readonly', s => s.getAll()); },
  put(st, v, k) { return this.req(st, 'readwrite', s => k === undefined ? s.put(v) : s.put(v, k)); },
  del(st, k) { return this.req(st, 'readwrite', s => s.delete(k)); },
  keys(st) { return this.req(st, 'readonly', s => s.getAllKeys()); }
};

/* ---------- Estado ---------- */
const DEF = { crs: 'ctm12', fmt: 'dd', decl: 0, geoid: 0, csv: 'intl', theme: 'auto', base: 'topo', ov: { st: true, sy: true, tr: true, me: true } };
const S = {
  set: { ...DEF }, projects: [], project: null, items: [], pos: null, follow: true,
  ori: null, heading: null, vecBuf: [], capture: null, mode: 'plane', pick: null,
  rec: null, meas: null, nav: null, panel: 'map', guard: false, photoUrls: new Map()
};

/* ---------- Coordenadas ---------- */
proj4.defs('EPSG:9377', '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:3116', '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:3117', '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-71.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const CRS = [
  { id: 'ctm12', name: 'Origen Nacional CTM12 (EPSG:9377)', short: 'CTM12' },
  { id: 'utm', name: 'UTM WGS84 (zona automática)', short: 'UTM' },
  { id: 'dd', name: 'Geográficas WGS84 (grados decimales)', short: 'WGS84' },
  { id: 'dms', name: 'Geográficas WGS84 (G° M\' S")', short: 'WGS84 GMS' },
  { id: 'bog', name: 'MAGNA-SIRGAS Bogotá (EPSG:3116)', short: 'MAGNA Bogotá' },
  { id: 'este', name: 'MAGNA-SIRGAS Este Central (EPSG:3117)', short: 'MAGNA Este C.' }
];
const utmDef = (z, south) => `+proj=utm +zone=${z}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
const utmZone = lon => Math.min(60, Math.floor((lon + 180) / 6) + 1);
function proj(lat, lon, id) {
  if (id === 'utm') { const z = utmZone(lon), s = lat < 0, p = proj4(utmDef(z, s), [lon, lat]); return { x: p[0], y: p[1], zone: z + (s ? 'S' : 'N') }; }
  const code = { ctm12: 'EPSG:9377', bog: 'EPSG:3116', este: 'EPSG:3117' }[id];
  const p = proj4(code, [lon, lat]); return { x: p[0], y: p[1] };
}
function unproj(x, y, id, zone) {
  if (id === 'utm') { const z = parseInt(zone) || 18, s = /s/i.test(String(zone)); const p = proj4(utmDef(z, s), 'WGS84', [x, y]); return [p[1], p[0]]; }
  const code = { ctm12: 'EPSG:9377', bog: 'EPSG:3116', este: 'EPSG:3117' }[id];
  const p = proj4(code, 'WGS84', [x, y]); return [p[1], p[0]];
}
function dms(v, pos, neg) {
  const h = v < 0 ? neg : pos; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
  if (s >= 59.995) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
  return `${d}°${pad(m, 2)}'${s.toFixed(2).padStart(5, '0')}"${h}`;
}
function fmtCoord(lat, lon, id = S.set.crs) {
  if (lat == null || lon == null) return '—';
  if (id === 'dd') return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  if (id === 'dms') return `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`;
  const p = proj(lat, lon, id);
  return `${id === 'utm' ? p.zone + ' ' : ''}E ${p.x.toFixed(1)}  N ${p.y.toFixed(1)}`;
}
const crsShort = id => CRS.find(c => c.id === id)?.short || id;

/* ---------- Geodesia ---------- */
const RE = 6371008.8;
function dist(a, b) {
  const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(s)));
}
function bearing(a, b) {
  const f1 = a[0] * D2R, f2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
  return norm360(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * R2D);
}
function ringArea(pts) {
  if (pts.length < 3) return 0; let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += (b[1] - a[1]) * D2R * (2 + Math.sin(a[0] * D2R) + Math.sin(b[0] * D2R)); }
  return Math.abs(s * RE * RE / 2);
}
const pathLen = pts => pts.reduce((t, p, i) => i ? t + dist(pts[i - 1], p) : 0, 0);
const fmtDist = m => m == null ? '—' : m < 1000 ? `${m.toFixed(m < 10 ? 1 : 0)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const fmtArea = a => a < 10000 ? `${a.toFixed(0)} m²` : `${(a / 10000).toFixed(2)} ha`;
const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + pad(m, 2) : pad(m, 2)) + ':' + pad(x, 2); };
const elev = alt => alt == null ? null : alt - (+S.set.geoid || 0);
const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };

/* ---------- Notación estructural ---------- */
const PLANES = ['Veta', 'Falla', 'Diaclasa', 'Estratificación', 'Foliación', 'Contacto', 'Dique', 'Bandeamiento', 'Plano de brecha'];
const LINES = ['Lineación', 'Estría de falla', 'Eje de pliegue', 'Clavo mineralizado (ore shoot)'];
const isLine = k => LINES.includes(k);
const QUAD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const quadOf = az => QUAD[Math.round(norm360(az) / 45) % 8];
function strikeQuad(dd) {
  let s = norm360(dd - 90) % 180; s = Math.round(s);
  return s <= 90 ? `N${pad(s, 2)}E` : `N${pad(180 - s, 2)}W`;
}
function fmtStruct(st, f = S.set.fmt) {
  if (st.dipDir == null || st.dip == null) return '—';
  if (isLine(st.kind)) return `${pad(st.dip, 2)}→${pad(norm360(st.dipDir), 3)}`;
  if (f === 'rhr') return `${pad(norm360(st.dipDir - 90), 3)}/${pad(st.dip, 2)}`;
  if (f === 'quad') return `${strikeQuad(st.dipDir)}/${pad(st.dip, 2)}${quadOf(st.dipDir)}`;
  return `${pad(norm360(st.dipDir), 3)}/${pad(st.dip, 2)}`;
}
const fmtLabel = { dd: 'Dir. buz./Buz.', rhr: 'Rumbo (RHR)/Buz.', quad: 'Cuadrante' };

/* ---------- UI básica ---------- */
let toastT;
function toast(msg, act, fn, ms = 3500) {
  const t = $('#toast'); $('#toastText').textContent = msg; const b = $('#toastAct');
  if (act) { b.hidden = false; b.textContent = act; b.onclick = () => { t.hidden = true; fn(); }; } else b.hidden = true;
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, act ? 6000 : ms);
}
function guard() { if (!S.guard) { history.pushState({ fab: 1 }, ''); S.guard = true; } }
function openSheet(html) {
  const w = $('#sheetWrap'), s = $('#sheet'); s.innerHTML = html; w.hidden = false; s.scrollTop = 0; guard();
  $$('[data-close]', s).forEach(b => b.onclick = closeSheet); return s;
}
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
let dlg;
function dialog({ title, text = '', input, ok = 'Aceptar', danger = false, cancel = 'Cancelar' }) {
  return new Promise(res => {
    if (!dlg) { dlg = document.createElement('div'); dlg.className = 'sheet-wrap'; dlg.style.zIndex = 1100; dlg.style.alignItems = 'center'; document.body.append(dlg); }
    dlg.innerHTML = `<div class="sheet" style="border-radius:20px;max-width:440px;margin:16px"><h2 style="font-size:19px">${esc(title)}</h2>${text ? `<p class="sub" style="font-size:15px">${esc(text)}</p>` : ''}${input != null ? `<input id="dlgIn" value="${esc(input)}">` : ''}<div class="btns"><button class="btn ghost" data-r="0" style="flex:1">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-r="1" style="flex:1">${esc(ok)}</button></div></div>`;
    dlg.hidden = false; const inp = $('#dlgIn', dlg); if (inp) { inp.focus(); inp.select(); }
    $$('[data-r]', dlg).forEach(b => b.onclick = () => { dlg.hidden = true; res(b.dataset.r === '1' ? (inp ? inp.value.trim() : true) : (inp ? null : false)); });
  });
}
window.addEventListener('popstate', () => {
  S.guard = false;
  if (dlg && !dlg.hidden) { dlg.hidden = true; }
  else if (!$('#viewer').hidden) $('#viewer').hidden = true;
  else if (!$('#sheetWrap').hidden) closeSheet();
  else if (S.panel !== 'map') showPanel('map');
  else return;
  if (!$('#sheetWrap').hidden || S.panel !== 'map') guard();
});

function showPanel(name) {
  S.panel = name;
  $$('.panel').forEach(p => p.hidden = p.id !== 'panel-' + name);
  $$('.dock button').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
  if (name !== 'map') guard();
  if (name === 'map') setTimeout(() => map.invalidateSize(), 50);
  if (name === 'stations') renderStations();
  if (name === 'tracks') renderTracks();
  if (name === 'more') renderMore();
  if (name === 'compass') { startSensors(); updateCompassHeader(); }
}
$$('.dock button').forEach(b => b.onclick = () => showPanel(b.dataset.panel));

/* ---------- Mapa ---------- */
const BASES = [
  { id: 'topo', name: 'Topográfico (OpenTopoMap)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', max: 17, attr: 'Mapa © OpenTopoMap (CC-BY-SA) · Datos © colaboradores de OpenStreetMap, SRTM', pre: true },
  { id: 'sat', name: 'Satélite (Esri World Imagery)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Imágenes © Esri, Maxar, Earthstar Geographics', pre: true },
  { id: 'esritopo', name: 'Topográfico Esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Mapa © Esri y colaboradores', pre: true },
  { id: 'osm', name: 'Calles (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© colaboradores de OpenStreetMap', pre: false },
  { id: 'none', name: 'Sin mapa base (solo mis datos)' }
];
const map = L.map('map', { zoomControl: false, maxZoom: 21, attributionControl: true, tap: false }).setView([10.77, -73.0], 12);
L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
map.createPane('rasterPane').style.zIndex = 350;
const canvasR = L.canvas({ padding: 0.5 });
let baseLayer = null;
function setBase(id) {
  if (baseLayer) map.removeLayer(baseLayer); baseLayer = null;
  const b = BASES.find(x => x.id === id) || BASES[0];
  if (b.url) { baseLayer = L.tileLayer(b.url, { subdomains: b.sub || 'abc', maxNativeZoom: b.max, maxZoom: 21, attribution: b.attr, crossOrigin: 'anonymous' }).addTo(map); }
  map.getContainer().style.background = b.url ? '#d9d5cc' : '#eef0ea';
  S.set.base = b.id; saveSettings();
}
const G = { st: L.layerGroup().addTo(map), sy: L.layerGroup().addTo(map), tr: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map), imp: L.layerGroup().addTo(map), nav: L.layerGroup().addTo(map), rec: L.layerGroup().addTo(map), meas: L.layerGroup().addTo(map) };

function structIcon(st, i = 0) {
  const line = isLine(st.kind), dd = norm360(st.dipDir);
  const col = st.kind === 'Veta' ? '#d0241b' : st.kind === 'Falla' ? '#111' : line ? '#a87b0c' : '#1d4f91';
  const lx = 22 + Math.sin(dd * D2R) * 19, ly = 22 - Math.cos(dd * D2R) * 19;
  const body = line
    ? `<g transform="rotate(${dd} 22 22)"><line x1="22" y1="22" x2="22" y2="4" stroke="${col}" stroke-width="3"/><path d="M22 0 27 9 17 9z" fill="${col}"/></g>`
    : `<g transform="rotate(${dd - 180} 22 22)"><line x1="6" y1="22" x2="38" y2="22" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><line x1="22" y1="22" x2="22" y2="31" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/></g>`;
  const html = `<svg viewBox="0 0 44 44" style="stroke:none">${body}<text x="${lx}" y="${ly}" font-size="12" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${col}" stroke="#fff" stroke-width="3" paint-order="stroke">${Math.round(st.dip)}</text></svg>`;
  return L.divIcon({ className: 'sym', html, iconSize: [44, 44], iconAnchor: [22 + 34 + i * 40, 22] }); // a la izquierda de la estación
}
function renderMapData() {
  Object.values(G).forEach(g => { if (![G.nav, G.rec, G.meas].includes(g)) g.clearLayers(); });
  const z = map.getZoom();
  for (const it of S.items) {
    if (it.type === 'station' && it.lat != null) {
      const m = L.marker([it.lat, it.lon], { icon: L.divIcon({ className: 'st-ico', html: `<div class="pin"></div><div class="lbl">${esc(it.code)}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 500 });
      m.on('click', () => openStation(it.id)); G.st.addLayer(m);
      (it.structs || []).forEach((s, i) => {
        if (s.dipDir == null) return;
        const sm = L.marker([it.lat, it.lon], { icon: structIcon(s, i), interactive: true });
        sm.on('click', () => openStation(it.id)); G.sy.addLayer(sm);
      });
    }
    if (it.type === 'track' && it.pts?.length > 1) {
      const pl = L.polyline(it.pts.map(p => [p[0], p[1]]), { color: '#b25520', weight: 4, opacity: .85 });
      pl.on('click', () => openTrack(it.id)); G.tr.addLayer(pl);
    }
    if (it.type === 'measure' && it.pts?.length > 1) {
      const shape = it.pts.length > 2 && it.area ? L.polygon(it.pts, { color: '#1d4f91', weight: 2, dashArray: '6 4', fillOpacity: .12 }) : L.polyline(it.pts, { color: '#1d4f91', weight: 3, dashArray: '6 4' });
      shape.bindPopup(`<b>${esc(it.name)}</b><br>${fmtDist(it.dist)}${it.area ? ' · ' + fmtArea(it.area) : ''}`); G.me.addLayer(shape);
    }
    if (it.type === 'layer' && it.visible && it.geojson) {
      try {
        const col = it.color || '#6b3fa0';
        G.imp.addLayer(L.geoJSON(it.geojson, {
          renderer: canvasR,
          style: { color: col, weight: 2.2, fillOpacity: .12, renderer: canvasR },
          pointToLayer: (f, ll) => L.circleMarker(ll, { renderer: canvasR, radius: 6, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }),
          onEachFeature: (f, l) => { const p = f.properties || {}; const t = p.name || p.Name || p.NAME || p.nombre || p.NOMBRE || p.Nombre || p.ID || p.id || ''; const rows = Object.entries(p).slice(0, 12).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join(''); l.bindPopup(`<b>${esc(t)}</b><table style="font-size:12px">${rows}</table><small>${esc(it.name)}</small>`); }
        }));
      } catch (e) { console.warn('capa', e); }
    }
  }
  renderRasters();
  for (const k of ['st', 'sy', 'tr', 'me']) { const on = S.set.ov[k] !== false; if (on && !map.hasLayer(G[k])) map.addLayer(G[k]); if (!on && map.hasLayer(G[k])) map.removeLayer(G[k]); }
  toggleSymbolsByZoom(z);
}
function toggleSymbolsByZoom(z = map.getZoom()) { const on = S.set.ov.sy !== false && z >= 14; if (on && !map.hasLayer(G.sy)) map.addLayer(G.sy); if (!on && map.hasLayer(G.sy)) map.removeLayer(G.sy); }
map.on('zoomend', () => toggleSymbolsByZoom());
map.on('dragstart', () => { if (S.follow) { S.follow = false; $('#btnLocate').classList.remove('on'); } });

/* Posición propia */
const meIcon = L.divIcon({ className: 'me-ico', html: '<svg viewBox="-20 -20 40 40" style="width:40px;height:40px;overflow:visible;stroke:none"><path id="meCone" d="M0 0 L-9 -18 A20 20 0 0 1 9 -18Z" fill="rgba(178,85,32,.35)" style="display:none"/><circle r="8" fill="#b25520" stroke="#fff" stroke-width="3"/></svg>', iconSize: [40, 40], iconAnchor: [20, 20] });
let meMarker = null, accCircle = null;
function updateMe() {
  const p = S.pos; if (!p) return;
  if (!meMarker) { meMarker = L.marker([p.lat, p.lon], { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map); accCircle = L.circle([p.lat, p.lon], { radius: p.acc, color: '#b25520', weight: 1, fillOpacity: .08, interactive: false }).addTo(map); }
  meMarker.setLatLng([p.lat, p.lon]); accCircle.setLatLng([p.lat, p.lon]).setRadius(p.acc || 0);
  updateCone();
}
function updateCone() {
  const c = document.getElementById('meCone'); if (!c) return;
  if (S.heading == null) { c.style.display = 'none'; return; }
  c.style.display = ''; c.setAttribute('transform', `rotate(${S.heading})`);
}

/* ---------- GPS ---------- */
const posSubs = new Set();
function startGPS() {
  if (!('geolocation' in navigator)) { $('#coordText').textContent = 'Este navegador no tiene GPS'; return; }
  navigator.geolocation.watchPosition(onPos, err => {
    $('#gpsDot').className = 'dot bad';
    $('#crsName').textContent = 'GPS no disponible';
    $('#coordText').textContent = err.code === 1 ? 'Permite la ubicación para esta app' : 'Sin señal GPS… sal a cielo abierto';
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
}
let firstFix = true;
function onPos(e) {
  const c = e.coords;
  S.pos = { lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, altAcc: c.altitudeAccuracy, t: e.timestamp, speed: c.speed };
  $('#gpsDot').className = 'dot ' + (c.accuracy <= 10 ? 'ok' : c.accuracy <= 30 ? 'mid' : 'bad');
  updateHud(); updateMe();
  if (firstFix) { firstFix = false; if (!S.items.some(i => i.type === 'station')) map.setView([c.latitude, c.longitude], 15); }
  if (S.follow && S.panel === 'map') map.panTo([c.latitude, c.longitude], { animate: true });
  if (S.rec) recPoint(); if (S.nav) updateNav();
  posSubs.forEach(f => f(S.pos));
}
function updateHud() {
  const p = S.pos; $('#crsName').textContent = crsShort(S.set.crs);
  if (!p) return;
  $('#coordText').textContent = fmtCoord(p.lat, p.lon);
  $('#accText').textContent = `± ${fx(p.acc)} m`;
  $('#altText').textContent = p.alt == null ? 'sin altura' : `${fx(elev(p.alt))} m alt.`;
}
$('#coordPill').onclick = () => { const i = CRS.findIndex(c => c.id === S.set.crs); S.set.crs = CRS[(i + 1) % CRS.length].id; saveSettings(); updateHud(); if (!S.pos) $('#coordText').textContent = CRS.find(c => c.id === S.set.crs).name; toast('Coordenadas en ' + CRS.find(c => c.id === S.set.crs).name, null, null, 1800); };
$('#btnLocate').onclick = () => { S.follow = true; $('#btnLocate').classList.add('on'); startSensors(); if (S.pos) map.setView([S.pos.lat, S.pos.lon], Math.max(map.getZoom(), 16)); else toast('Esperando señal GPS…'); };

/* ---------- Sensores de orientación ---------- */
let sensorsOn = false, oriSeen = false, rafPending = false;
function zAxis(a, b, g) { const ca = Math.cos(a * D2R), sa = Math.sin(a * D2R), cb = Math.cos(b * D2R), sb = Math.sin(b * D2R), cg = Math.cos(g * D2R), sg = Math.sin(g * D2R); return [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg]; }
function yAxis(a, b) { const ca = Math.cos(a * D2R), sa = Math.sin(a * D2R), cb = Math.cos(b * D2R), sb = Math.sin(b * D2R); return [-sa * cb, ca * cb, sb]; }
const decl = () => +S.set.decl || 0;
function planeFrom(n) { if (n[2] < 0) n = n.map(v => -v); const dip = Math.acos(Math.max(-1, Math.min(1, n[2]))) * R2D; const dd = norm360(Math.atan2(n[0], n[1]) * R2D + decl()); return { dipDir: dd, dip }; }
function lineFrom(v) { if (v[2] > 0) v = v.map(x => -x); const plunge = Math.asin(Math.max(-1, Math.min(1, -v[2]))) * R2D; const trend = norm360(Math.atan2(v[0], v[1]) * R2D + decl()); return { dipDir: trend, dip: plunge }; }
function headingFrom(a, b, g) {
  const y = yAxis(a, b); if (Math.hypot(y[0], y[1]) > 0.5) return norm360(Math.atan2(y[0], y[1]) * R2D + decl());
  const z = zAxis(a, b, g); return norm360(Math.atan2(-z[0], -z[1]) * R2D + decl());
}
function onOri(e) {
  let a = e.alpha; if (e.webkitCompassHeading != null) a = 360 - e.webkitCompassHeading;
  if (a == null || e.beta == null) return;
  oriSeen = true; S.ori = { a, b: e.beta, g: e.gamma };
  const v = S.mode === 'line' ? yAxis(a, e.beta) : zAxis(a, e.beta, e.gamma);
  S.vecBuf.push(v); if (S.vecBuf.length > 20) S.vecBuf.shift();
  if (S.capture) S.capture.push(v);
  S.heading = headingFrom(a, e.beta, e.gamma);
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; updateCone(); if (S.panel === 'compass') updateCompass(); if (S.nav) updateNav(); }); }
}
async function startSensors() {
  if (sensorsOn) return;
  sensorsOn = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await Promise.race([DeviceOrientationEvent.requestPermission(), new Promise(res => setTimeout(() => res('timeout'), 4000))]);
      if (r === 'denied') toast('Sin permiso para los sensores de orientación: actívalo en los ajustes del navegador');
    }
  } catch (e) { /* algunos navegadores exigen un toque; se reintenta en el siguiente */ }
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri);
  else window.addEventListener('deviceorientation', onOri);
  setTimeout(() => { if (!oriSeen) { $('#cmpMid').textContent = 'Este dispositivo no entrega datos de brújula/inclinación (en un PC no hay sensores).'; } }, 3000);
}
function meanVec(arr) { const s = arr.reduce((t, v) => [t[0] + v[0], t[1] + v[1], t[2] + v[2]], [0, 0, 0]); const n = Math.hypot(...s); return { v: s.map(x => x / (n || 1)), R: n / (arr.length || 1) }; }
const spreadDeg = R => Math.acos(Math.max(-1, Math.min(1, R))) * R2D;

/* ---------- Brújula ---------- */
(function buildRose() {
  let h = '';
  for (let i = 0; i < 360; i += 10) { const maj = i % 30 === 0, r1 = 104, r2 = maj ? 90 : 96; const s = Math.sin(i * D2R), c = -Math.cos(i * D2R); h += `<line class="tick${maj ? ' maj' : ''}" x1="${s * r1}" y1="${c * r1}" x2="${s * r2}" y2="${c * r2}"/>`; }
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { h += `<text class="${t === 'N' ? 'n' : ''}" x="${Math.sin(a * D2R) * 78}" y="${-Math.cos(a * D2R) * 78}">${t}</text>`; });
  for (const a of [30, 60, 120, 150, 210, 240, 300, 330]) h += `<text style="font-size:10px;font-weight:500" x="${Math.sin(a * D2R) * 78}" y="${-Math.cos(a * D2R) * 78}">${a}</text>`;
  $('#dialRose').innerHTML = h;
})();
$$('#panel-compass .seg button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; S.vecBuf = []; $$('#panel-compass .seg button').forEach(x => x.classList.toggle('on', x === b)); updateCompassHeader(); });
function updateCompassHeader() {
  $('#cmpHint').textContent = S.mode === 'plane' ? 'Apoya el dorso del teléfono sobre la superficie del plano y espera a que la estabilidad se ponga verde.' : 'Apoya el borde largo del teléfono sobre la lineación, con la parte superior apuntando hacia donde se hunde.';
  $('#cmpDecl').textContent = `Declinación magnética aplicada: ${decl() > 0 ? '+' : ''}${decl()}° (cámbiala en Más → Ajustes). Lejos de metales, vehículos y líneas eléctricas.`;
  $('#cmpPickNote').textContent = S.pick ? `Midiendo para: ${S.pick.label}` : 'Mide planos y lineaciones con los sensores del teléfono';
}
function updateCompass() {
  if (!S.ori) return;
  const h = S.heading ?? 0; $('#dialRose').setAttribute('transform', `rotate(${-h})`);
  const { v, R } = meanVec(S.vecBuf); const sp = spreadDeg(R);
  const m = S.mode === 'line' ? lineFrom(v) : planeFrom(v);
  const st = { kind: S.mode === 'line' ? 'Lineación' : 'Plano', dipDir: m.dipDir, dip: m.dip };
  if (S.mode === 'line') { $('#cmpBig').textContent = `${pad(m.dip, 2)}° → ${pad(m.dipDir, 3)}°`; $('#cmpMid').textContent = `Inmersión ${fx(m.dip)}° hacia ${fx(m.dipDir)}° (${quadOf(m.dipDir)}) · Rumbo del equipo ${fx(h)}°`; }
  else { $('#cmpBig').textContent = `${pad(m.dipDir, 3)}° / ${pad(m.dip, 2)}°`; $('#cmpMid').textContent = `Rumbo RHR ${pad(norm360(m.dipDir - 90), 3)}° · ${strikeQuad(m.dipDir)}/${pad(m.dip, 2)}${quadOf(m.dipDir)} · Equipo ${fx(h)}°`; }
  const pct = Math.max(0, Math.min(100, 100 - (sp - 0.3) * 25));
  const bar = $('#cmpStab'); bar.style.width = pct + '%'; bar.style.background = pct > 70 ? 'var(--ok)' : pct > 35 ? 'var(--au)' : 'var(--bad)';
  const dd = st.dipDir;
  $('#planeSym').setAttribute('transform', `rotate(${-h})`);
  $('#planeSym').innerHTML = S.mode === 'line'
    ? `<g transform="rotate(${dd})"><line x1="0" y1="0" x2="0" y2="-62" stroke="var(--au)" stroke-width="6" stroke-linecap="round"/><path d="M0 -76 9 -60 -9 -60z" fill="var(--au)" stroke="none"/></g>`
    : `<g transform="rotate(${dd - 180})"><line x1="-66" y1="0" x2="66" y2="0" stroke="var(--cu)" stroke-width="7" stroke-linecap="round"/><line x1="0" y1="0" x2="0" y2="26" stroke="var(--cu)" stroke-width="7" stroke-linecap="round"/></g>`;
}
$('#cmpCapture').onclick = () => {
  startSensors();
  if (!oriSeen) { toast('No hay datos de los sensores todavía'); return; }
  const btn = $('#cmpCapture'); btn.disabled = true; btn.textContent = 'Quieto… midiendo'; S.capture = [];
  setTimeout(() => {
    const arr = S.capture; S.capture = null; btn.disabled = false; btn.textContent = 'Capturar (promedio 2 s)';
    if (!arr.length) { toast('No llegaron lecturas'); return; }
    const { v, R } = meanVec(arr); const sp = spreadDeg(R);
    const m = S.mode === 'line' ? lineFrom(v) : planeFrom(v);
    const res = { dipDir: Math.round(m.dipDir), dip: Math.round(m.dip), mode: S.mode, spread: sp, n: arr.length };
    if (navigator.vibrate) navigator.vibrate(60);
    showCapture(res);
  }, 2000);
};
function showCapture(r) {
  const box = $('#cmpResult'); box.hidden = false;
  const fake = { kind: r.mode === 'line' ? 'Lineación' : 'Veta', dipDir: r.dipDir, dip: r.dip };
  box.innerHTML = `<div class="sub">Lectura promediada (${r.n} muestras, dispersión ${fx(r.spread, 1)}°)</div>
    <div class="val">${r.mode === 'line' ? `${pad(r.dip, 2)}° → ${pad(r.dipDir, 3)}°` : `${pad(r.dipDir, 3)}/${pad(r.dip, 2)}`}</div>
    <div class="sub">${r.mode === 'line' ? 'Inmersión → dirección' : `Dir. buz./Buz. · Rumbo RHR ${pad(norm360(r.dipDir - 90), 3)} · ${fmtStruct(fake, 'quad')}`}</div>
    ${r.spread > 3 ? '<p class="note" style="color:var(--bad)">Lectura inestable: repite con el teléfono bien apoyado.</p>' : ''}
    <div class="btns">${S.pick ? '<button class="btn" id="capUse">Usar en la estructura</button>' : '<button class="btn" id="capSave">Guardar en una estación</button>'}<button class="btn ghost" id="capAgain">Repetir</button></div>`;
  $('#capAgain').onclick = () => { box.hidden = true; };
  if (S.pick) $('#capUse').onclick = () => { const p = S.pick; S.pick = null; box.hidden = true; updateCompassHeader(); p.done(r); };
  else $('#capSave').onclick = () => chooseStationFor(r);
}
function chooseStationFor(r) {
  const sts = stations(); const here = S.pos ? [S.pos.lat, S.pos.lon] : null;
  const sorted = here ? [...sts].sort((a, b) => dist(here, [a.lat, a.lon]) - dist(here, [b.lat, b.lon])) : sts.slice().reverse();
  const s = openSheet(`<div class="sheet-head"><h2>¿En qué estación?</h2><button class="btn ghost small" data-close>Cerrar</button></div>
    <button class="btn" id="chNew" style="width:100%;margin:8px 0 12px">Nueva estación en mi posición GPS</button>
    <div class="sublist">${sorted.slice(0, 30).map(x => `<button class="subitem" data-id="${esc(x.id)}"><b>${esc(x.code)}</b><span class="grow">${esc(x.litho || '')}</span><span class="sub">${here ? fmtDist(dist(here, [x.lat, x.lon])) : ''}</span></button>`).join('') || '<p class="note">Aún no hay estaciones en este proyecto.</p>'}</div>`);
  const kind = r.mode === 'line' ? 'Lineación' : 'Veta';
  $$('.subitem', s).forEach(b => b.onclick = () => structForm(b.dataset.id, null, { kind, dipDir: r.dipDir, dip: r.dip, method: 'Brújula FabianApp' }));
  $('#chNew', s).onclick = async () => { const st = await quickStation(); if (st) structForm(st.id, null, { kind, dipDir: r.dipDir, dip: r.dip, method: 'Brújula FabianApp' }); };
}

/* ---------- Proyectos y datos ---------- */
const stations = () => S.items.filter(i => i.type === 'station' && i.projectId === S.project.id);
const tracks = () => S.items.filter(i => i.type === 'track' && i.projectId === S.project.id);
async function loadAll() {
  S.projects = await DB.all('projects');
  if (!S.projects.length) { const p = newProject('Proyecto 1'); await DB.put('projects', p); S.projects = [p]; }
  const act = await DB.get('kv', 'active');
  S.project = S.projects.find(p => p.id === act) || S.projects[0];
  const all = await DB.all('items');
  S.items = all.filter(i => i.type === 'layer' || i.type === 'raster' || i.projectId === S.project.id);
  $('#stProjName').textContent = S.project.name;
}
function newProject(name) { return { id: uid(), name, stPrefix: 'EST-', smPrefix: 'M-', stCount: 0, smCount: 0, created: new Date().toISOString() }; }
async function saveItem(it) { it.updated = new Date().toISOString(); await DB.put('items', it); const i = S.items.findIndex(x => x.id === it.id); if (i >= 0) S.items[i] = it; else S.items.push(it); renderMapData(); askPersist(); }
async function saveProject() { await DB.put('projects', S.project); }
async function saveSettings() { try { await DB.put('kv', S.set, 'settings'); } catch (e) { } }
let persistAsked = false;
async function askPersist() { if (persistAsked || !navigator.storage?.persist) return; persistAsked = true; try { await navigator.storage.persist(); } catch (e) { } }
async function removeItem(it, label) {
  await DB.del('items', it.id); S.items = S.items.filter(x => x.id !== it.id); renderMapData();
  if (S.panel === 'stations') renderStations(); if (S.panel === 'tracks') renderTracks(); if (S.panel === 'more') renderMore();
  toast(`${label} eliminado`, 'Deshacer', async () => { await saveItem(it); if (S.panel === 'stations') renderStations(); if (S.panel === 'tracks') renderTracks(); if (S.panel === 'more') renderMore(); toast('Restaurado'); });
}
const nextCode = (prefix, n, w) => prefix + pad(n + 1, w);

/* ---------- Estaciones ---------- */
const LITHO = ['Andesita', 'Dacita', 'Riolita', 'Basalto', 'Toba', 'Toba lítica', 'Brecha hidrotermal', 'Brecha volcánica', 'Brecha de falla', 'Pórfido andesítico', 'Pórfido dacítico', 'Granodiorita', 'Tonalita', 'Diorita', 'Cuarzodiorita', 'Monzonita', 'Granito', 'Arenisca', 'Lutita', 'Limolita', 'Caliza', 'Conglomerado', 'Chert', 'Esquisto', 'Gneis', 'Filita', 'Cuarcita', 'Veta de cuarzo', 'Saprolito', 'Suelo residual', 'Coluvión', 'Aluvión'];
const ALTER = ['Argílica', 'Argílica avanzada', 'Fílica (sericítica)', 'Propilítica', 'Potásica', 'Silicificación', 'Carbonatación', 'Cloritización', 'Epidotización', 'Adularia', 'Oxidación (limonitas)', 'Sin alteración'];
const MINER = ['Pirita', 'Calcopirita', 'Bornita', 'Calcosina', 'Covelina', 'Malaquita', 'Azurita', 'Crisocola', 'Oro visible', 'Electrum', 'Galena', 'Esfalerita', 'Arsenopirita', 'Tetraedrita', 'Molibdenita', 'Magnetita', 'Hematita/especularita', 'Goethita/jarosita'];
const GANGA = ['Cuarzo', 'Calcedonia', 'Calcita', 'Adularia', 'Baritina', 'Rodocrosita', 'Fluorita', 'Clorita'];
const TEXT = ['Crustiforme', 'Coloforme', 'Bandeada', 'Brechada', 'Drusiforme', 'Cocarda', 'Hojosa (lattice)', 'Masiva', 'Diseminada', 'Stockwork', 'Cavidades (vugs)'];
const chips = (name, list, sel = []) => `<div class="chips" data-chips="${name}">${list.map(x => `<button type="button" class="chip${sel.includes(x) ? ' on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
const readChips = (s, name) => $$(`[data-chips="${name}"] .chip.on`, s).map(b => b.dataset.v);

function renderStations() {
  $('#stProjName').textContent = `${S.project.name} · ${stations().length} estaciones`;
  const q = $('#stSearch').value.trim().toLowerCase(), sort = $('#stSort').value, here = S.pos ? [S.pos.lat, S.pos.lon] : null;
  let list = stations().filter(s => !q || [s.code, s.litho, s.desc, ...(s.miner || []), ...(s.alter || []), ...(s.samples || []).map(m => m.code)].join(' ').toLowerCase().includes(q));
  if (sort === 'code') list.sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
  else if (sort === 'near' && here) list.sort((a, b) => dist(here, [a.lat, a.lon]) - dist(here, [b.lat, b.lon]));
  else list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#stList').innerHTML = list.length ? list.map(s => `<button class="item" data-id="${esc(s.id)}"><div class="grow"><div class="code">${esc(s.code)}</div><div class="meta">${esc(s.litho || 'Sin litología')} · ${esc(fmtDate(s.date))}</div><div>${(s.structs || []).length ? `<span class="badge">${s.structs.length} estructura(s)</span>` : ''}${(s.samples || []).length ? `<span class="badge cu">${s.samples.length} muestra(s)</span>` : ''}${(s.photos || []).length ? `<span class="badge">${s.photos.length} foto(s)</span>` : ''}</div></div><div class="right">${here && s.lat != null ? fmtDist(dist(here, [s.lat, s.lon])) : ''}</div></button>`).join('')
    : `<div class="empty"><b>${q ? 'Sin resultados' : 'Todavía no hay estaciones'}</b>${q ? 'Prueba con otro código o mineral.' : 'Toca «Nueva» o el botón «Estación» del mapa: se crea con tu posición GPS.'}</div>`;
  $$('#stList .item').forEach(b => b.onclick = () => openStation(b.dataset.id));
}
$('#stSearch').oninput = renderStations; $('#stSort').onchange = renderStations;
$('#stNew').onclick = () => stationForm(null);
$('#btnAddStation').onclick = () => stationForm(null);

async function quickStation() {
  if (!S.pos) { toast('Sin posición GPS todavía'); return null; }
  const p = S.project, st = { id: uid(), type: 'station', projectId: p.id, code: nextCode(p.stPrefix, p.stCount, 3), date: new Date().toISOString(), lat: S.pos.lat, lon: S.pos.lon, alt: S.pos.alt, acc: S.pos.acc, litho: '', alter: [], miner: [], ganga: [], texture: [], desc: '', photos: [], structs: [], samples: [] };
  p.stCount++; await saveProject(); await saveItem(st); return st;
}
const localDT = iso => { const d = iso ? new Date(iso) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function stationForm(id, at) {
  const p = S.project, ex = id ? S.items.find(i => i.id === id) : null;
  const st = ex ? structuredClone(ex) : { id: uid(), type: 'station', projectId: p.id, code: nextCode(p.stPrefix, p.stCount, 3), date: new Date().toISOString(), lat: at ? at[0] : S.pos?.lat ?? null, lon: at ? at[1] : S.pos?.lon ?? null, alt: at ? null : S.pos?.alt ?? null, acc: at ? null : S.pos?.acc ?? null, litho: '', alter: [], miner: [], ganga: [], texture: [], desc: '', photos: [], structs: [], samples: [] };
  const s = openSheet(`<div class="sheet-head"><h2>${ex ? 'Editar ' + esc(st.code) : 'Nueva estación'}</h2><button class="btn ghost small" data-close>Cancelar</button></div>
  <div class="grid2"><label class="f"><span>Código</span><input id="fCode" value="${esc(st.code)}" autocapitalize="characters"></label>
  <label class="f"><span>Fecha y hora</span><input id="fDate" type="datetime-local" value="${localDT(st.date)}"></label></div>
  <div class="card"><h3>Ubicación</h3>
    <div class="btns" style="margin-top:0"><button class="btn small" id="fGps">GPS actual</button><button class="btn small ghost" id="fAvg">Promediar GPS 15 s</button><button class="btn small ghost" id="fCenter">Centro del mapa</button></div>
    <label class="f"><span>Sistema para escribir coordenadas</span><select id="fCrsIn">${[['geo', 'Geográficas WGS84 (lat, lon)'], ['ctm12', 'Origen Nacional CTM12'], ['utm', 'UTM WGS84'], ['bog', 'MAGNA Bogotá'], ['este', 'MAGNA Este Central']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
    <div class="grid3"><label class="f"><span id="lA">Latitud</span><input id="fA" inputmode="decimal"></label><label class="f"><span id="lB">Longitud</span><input id="fB" inputmode="decimal"></label><label class="f" id="zoneWrap" hidden><span>Zona</span><input id="fZone" value="18N"></label></div>
    <div class="grid2"><label class="f"><span>Altura (m)</span><input id="fAlt" inputmode="decimal" value="${st.alt == null ? '' : fx(elev(st.alt), 1)}"></label><label class="f"><span>Precisión (± m)</span><input id="fAcc" inputmode="decimal" value="${st.acc == null ? '' : fx(st.acc, 1)}"></label></div>
    <p class="note" id="fConv">—</p></div>
  <label class="f"><span>Litología</span><input id="fLitho" list="dlLitho" value="${esc(st.litho)}" placeholder="Ej. Brecha hidrotermal"><datalist id="dlLitho">${LITHO.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
  <h3>Alteración</h3>${chips('alter', ALTER, st.alter)}
  <h3>Mineralización</h3>${chips('miner', MINER, st.miner)}
  <h3>Ganga</h3>${chips('ganga', GANGA, st.ganga || [])}
  <h3>Textura</h3>${chips('texture', TEXT, st.texture)}
  <label class="f"><span>Descripción / observaciones</span><textarea id="fDesc" placeholder="Afloramiento, color, tamaño de grano, % sulfuros, relaciones de corte…">${esc(st.desc)}</textarea></label>
  <div class="sheet-foot"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="fSave">Guardar</button></div>`);
  $$('.chip', s).forEach(c => c.onclick = () => c.classList.toggle('on'));
  let lat = st.lat, lon = st.lon;
  const crsSel = $('#fCrsIn', s), A = $('#fA', s), B = $('#fB', s);
  const writeInputs = () => {
    const m = crsSel.value; $('#zoneWrap', s).hidden = m !== 'utm';
    $('#lA', s).textContent = m === 'geo' ? 'Latitud' : 'Este (m)'; $('#lB', s).textContent = m === 'geo' ? 'Longitud' : 'Norte (m)';
    if (lat == null) { A.value = ''; B.value = ''; return conv(); }
    if (m === 'geo') { A.value = lat.toFixed(7); B.value = lon.toFixed(7); }
    else { const pr = proj(lat, lon, m); A.value = pr.x.toFixed(2); B.value = pr.y.toFixed(2); if (m === 'utm') $('#fZone', s).value = pr.zone; }
    conv();
  };
  const readInputs = () => {
    const a = num(A.value.replace(',', '.')), b = num(B.value.replace(',', '.')), m = crsSel.value;
    if (a == null || b == null) { lat = lon = null; return; }
    if (m === 'geo') { lat = a; lon = b; } else { try { [lat, lon] = unproj(a, b, m, $('#fZone', s).value); } catch (e) { lat = lon = null; } }
  };
  const conv = () => { $('#fConv', s).textContent = lat == null ? 'Sin coordenadas' : `CTM12: ${fmtCoord(lat, lon, 'ctm12')} · WGS84: ${lat.toFixed(6)}, ${lon.toFixed(6)}`; };
  crsSel.value = ['dd', 'dms'].includes(S.set.crs) ? 'geo' : S.set.crs;
  crsSel.onchange = writeInputs; [A, B, $('#fZone', s)].forEach(i => i.oninput = () => { readInputs(); conv(); });
  writeInputs();
  const setFrom = (p) => { lat = p.lat; lon = p.lon; writeInputs(); if (p.alt != null) $('#fAlt', s).value = fx(elev(p.alt), 1); $('#fAcc', s).value = p.acc == null ? '' : fx(p.acc, 1); };
  $('#fGps', s).onclick = () => S.pos ? setFrom(S.pos) : toast('Sin señal GPS todavía');
  $('#fCenter', s).onclick = () => { const c = map.getCenter(); setFrom({ lat: c.lat, lon: c.lng, alt: null, acc: null }); $('#fAlt', s).value = ''; };
  $('#fAvg', s).onclick = () => {
    if (!S.pos) { toast('Sin señal GPS todavía'); return; }
    const b = $('#fAvg', s), fixes = []; b.disabled = true;
    const sub = p => { fixes.push(p); b.textContent = `Promediando… ${fixes.length} lecturas`; };
    posSubs.add(sub); fixes.push(S.pos);
    setTimeout(() => {
      posSubs.delete(sub); b.disabled = false; b.textContent = 'Promediar GPS 15 s';
      let w = 0, la = 0, lo = 0, al = 0, wa = 0;
      fixes.forEach(f => { const k = 1 / Math.max(1, f.acc || 50) ** 2; w += k; la += f.lat * k; lo += f.lon * k; if (f.alt != null) { al += f.alt * k; wa += k; } });
      const mLat = la / w, mLon = lo / w, sd = Math.sqrt(fixes.reduce((t, f) => t + dist([mLat, mLon], [f.lat, f.lon]) ** 2, 0) / fixes.length);
      const best = Math.min(...fixes.map(f => f.acc || 99));
      setFrom({ lat: mLat, lon: mLon, alt: wa ? al / wa : null, acc: Math.max(sd, best / Math.sqrt(fixes.length)) });
      toast(`${fixes.length} lecturas promediadas · dispersión ${fx(sd, 1)} m`);
    }, 15000);
  };
  $('#fSave', s).onclick = async () => {
    readInputs();
    const code = $('#fCode', s).value.trim(); if (!code) { toast('Escribe un código'); return; }
    if (stations().some(x => x.code === code && x.id !== st.id)) { const ok = await dialog({ title: 'Código repetido', text: `Ya existe ${code} en este proyecto. ¿Guardar de todos modos?`, ok: 'Guardar' }); if (!ok) return; }
    const altv = num($('#fAlt', s).value.replace(',', '.'));
    Object.assign(st, { code, date: new Date($('#fDate', s).value || Date.now()).toISOString(), lat, lon, alt: altv == null ? null : altv + (+S.set.geoid || 0), acc: num($('#fAcc', s).value.replace(',', '.')), litho: $('#fLitho', s).value.trim(), alter: readChips(s, 'alter'), miner: readChips(s, 'miner'), ganga: readChips(s, 'ganga'), texture: readChips(s, 'texture'), desc: $('#fDesc', s).value.trim() });
    if (!ex) { if (code === nextCode(p.stPrefix, p.stCount, 3)) p.stCount++; await saveProject(); }
    await saveItem(st); if (S.panel === 'stations') renderStations();
    toast(`${st.code} guardada`); openStation(st.id);
  };
}

async function photoUrl(pid) {
  if (S.photoUrls.has(pid)) return S.photoUrls.get(pid);
  const ph = await DB.get('photos', pid); if (!ph) return null;
  const u = URL.createObjectURL(ph.blob); S.photoUrls.set(pid, u); return u;
}
function openStation(id) {
  const st = S.items.find(i => i.id === id); if (!st) return;
  const here = S.pos ? [S.pos.lat, S.pos.lon] : null;
  const s = openSheet(`<div class="sheet-head"><div><h2>${esc(st.code)}</h2><p class="sub">${esc(fmtDate(st.date))}${here && st.lat != null ? ' · a ' + fmtDist(dist(here, [st.lat, st.lon])) : ''}</p></div><button class="btn ghost small" data-close>Cerrar</button></div>
  <dl class="kv">
    <dt>${esc(crsShort(S.set.crs))}</dt><dd>${esc(fmtCoord(st.lat, st.lon))}</dd>
    ${S.set.crs !== 'ctm12' ? `<dt>CTM12</dt><dd>${esc(fmtCoord(st.lat, st.lon, 'ctm12'))}</dd>` : ''}
    <dt>WGS84</dt><dd>${st.lat == null ? '—' : `${st.lat.toFixed(6)}, ${st.lon.toFixed(6)}`}</dd>
    <dt>Altura</dt><dd>${st.alt == null ? '—' : fx(elev(st.alt), 1) + ' m'} ${st.acc != null ? `· ± ${fx(st.acc, 1)} m` : ''}</dd>
    <dt>Litología</dt><dd>${esc(st.litho || '—')}</dd>
    ${st.alter?.length ? `<dt>Alteración</dt><dd>${st.alter.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</dd>` : ''}
    ${st.miner?.length ? `<dt>Mineral.</dt><dd>${st.miner.map(x => `<span class="badge cu">${esc(x)}</span>`).join('')}</dd>` : ''}
    ${st.ganga?.length ? `<dt>Ganga</dt><dd>${st.ganga.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</dd>` : ''}
    ${st.texture?.length ? `<dt>Textura</dt><dd>${st.texture.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</dd>` : ''}
    ${st.desc ? `<dt>Notas</dt><dd style="white-space:pre-wrap">${esc(st.desc)}</dd>` : ''}
  </dl>
  <div class="btns"><button class="btn small" id="dEdit">Editar</button><button class="btn small ghost" id="dMap">Ver en mapa</button><button class="btn small ghost" id="dNav">Navegar hasta aquí</button></div>
  <h3>Datos estructurales <span class="sub">(${fmtLabel[S.set.fmt]})</span></h3>
  <div class="sublist">${(st.structs || []).map(x => `<button class="subitem" data-sid="${esc(x.id)}"><b>${esc(fmtStruct(x))}</b><span class="grow">${esc(x.kind)}${x.thick ? ` · ${esc(x.thick)} cm` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</span><span class="sub">${x.method === 'Brújula FabianApp' ? 'sensor' : 'manual'}</span></button>`).join('') || '<p class="note">Sin mediciones.</p>'}</div>
  <div class="btns"><button class="btn small" id="dStruct">+ Estructura</button><button class="btn small ghost" id="dMeasure">Medir con la brújula</button></div>
  <h3>Muestras</h3>
  <div class="sublist">${(st.samples || []).map(x => `<button class="subitem" data-mid="${esc(x.id)}"><b>${esc(x.code)}</b><span class="grow">${esc(x.kind)}${x.qc && x.qc !== 'Normal' ? ` · <span class="badge cu">${esc(x.qc)}</span>` : ''}${x.len ? ` · ${esc(x.len)} m` : ''}${x.wt ? ` · ${esc(x.wt)} kg` : ''}</span></button>`).join('') || '<p class="note">Sin muestras.</p>'}</div>
  <div class="btns"><button class="btn small" id="dSample">+ Muestra</button></div>
  <h3>Fotos</h3><div class="photos" id="dPhotos">${(st.photos || []).map(pid => `<div class="ph" data-pid="${esc(pid)}"><img alt="Foto"><button class="x" aria-label="Eliminar foto">×</button></div>`).join('')}</div>
  <div class="btns"><button class="btn small" id="dPhoto">Tomar / agregar fotos</button></div>
  <div class="btns" style="margin-top:24px"><button class="btn danger small" id="dDel">Eliminar estación</button></div>`);
  $$('#dPhotos .ph', s).forEach(async el => {
    const u = await photoUrl(el.dataset.pid); if (u) $('img', el).src = u;
    el.onclick = e => { if (e.target.classList.contains('x')) return; $('#viewerImg').src = u; $('#viewer').hidden = false; guard(); };
    $('.x', el).onclick = async () => { if (!await dialog({ title: 'Eliminar foto', text: 'La foto se borrará del teléfono.', ok: 'Eliminar', danger: true })) return; st.photos = st.photos.filter(x => x !== el.dataset.pid); await DB.del('photos', el.dataset.pid); await saveItem(st); openStation(st.id); };
  });
  $('#dEdit', s).onclick = () => stationForm(st.id);
  $('#dMap', s).onclick = () => { closeSheet(); showPanel('map'); S.follow = false; $('#btnLocate').classList.remove('on'); if (st.lat != null) map.setView([st.lat, st.lon], 17); };
  $('#dNav', s).onclick = () => { if (st.lat == null) return; startNav(st.lat, st.lon, st.code); closeSheet(); showPanel('map'); };
  $('#dStruct', s).onclick = () => structForm(st.id, null);
  $('#dMeasure', s).onclick = () => structForm(st.id, null, null, true);
  $('#dSample', s).onclick = () => sampleForm(st.id, null);
  $$('[data-sid]', s).forEach(b => b.onclick = () => structForm(st.id, b.dataset.sid));
  $$('[data-mid]', s).forEach(b => b.onclick = () => sampleForm(st.id, b.dataset.mid));
  $('#dPhoto', s).onclick = () => { const f = $('#filePhoto'); f.value = ''; f.onchange = () => addPhotos(st, [...f.files]); f.click(); };
  $('#dDel', s).onclick = async () => { if (!await dialog({ title: `Eliminar ${st.code}`, text: 'Se borra la estación con sus estructuras y muestras. Podrás deshacer durante unos segundos.', ok: 'Eliminar', danger: true })) return; closeSheet(); removeItem(st, st.code); };
}
async function addPhotos(st, files) {
  if (!files.length) return; toast(`Procesando ${files.length} foto(s)…`);
  for (const f of files) {
    try { const blob = await compressPhoto(f, st); const pid = uid(); await DB.put('photos', { id: pid, blob, stationId: st.id, name: `${st.code}_${(st.photos || []).length + 1}.jpg` }); st.photos = [...(st.photos || []), pid]; }
    catch (e) { console.warn(e); toast('No se pudo leer una foto'); }
  }
  await saveItem(st); openStation(st.id); toast('Fotos guardadas');
}
async function compressPhoto(file, st) {
  let src; try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w0 = src.width, h0 = src.height, k = Math.min(1, 1800 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
  const bar = Math.max(28, Math.round(h * 0.045));
  const c = document.createElement('canvas'); c.width = w; c.height = h + bar; const x = c.getContext('2d');
  x.drawImage(src, 0, 0, w, h); x.fillStyle = '#1d2327'; x.fillRect(0, h, w, bar);
  x.fillStyle = '#fff'; x.font = `600 ${Math.round(bar * 0.5)}px system-ui,sans-serif`; x.textBaseline = 'middle';
  x.fillText(`${st.code} · ${new Date().toLocaleString('es-CO')} · CTM12 ${st.lat != null ? fmtCoord(st.lat, st.lon, 'ctm12') : '—'}`, Math.round(bar * 0.4), h + bar / 2, w - bar);
  return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}
$('#viewerClose').onclick = () => { $('#viewer').hidden = true; };

/* Estructuras */
function structForm(stId, sid, pre, autoMeasure) {
  const st = S.items.find(i => i.id === stId); if (!st) return;
  const ex = sid ? st.structs.find(x => x.id === sid) : null;
  const d = { id: uid(), kind: 'Veta', dipDir: null, dip: null, thick: '', note: '', method: 'Manual', date: new Date().toISOString(), ...(ex || {}), ...(pre || {}) };
  let inMode = S.set.fmt === 'rhr' ? 'rhr' : 'dd';
  const s = openSheet(`<div class="sheet-head"><h2>${ex ? 'Editar' : 'Nueva'} estructura · ${esc(st.code)}</h2><button class="btn ghost small" id="sBack">Volver</button></div>
  <label class="f"><span>Tipo</span><select id="sKind"><optgroup label="Planos">${PLANES.map(k => `<option${k === d.kind ? ' selected' : ''}>${k}</option>`).join('')}</optgroup><optgroup label="Líneas">${LINES.map(k => `<option${k === d.kind ? ' selected' : ''}>${k}</option>`).join('')}</optgroup></select></label>
  <div class="seg" id="sMode" style="margin:6px 0"><button data-m="dd">Dir. buz. / Buz.</button><button data-m="rhr">Rumbo RHR / Buz.</button></div>
  <div class="grid2"><label class="f"><span id="lS1">Dirección de buzamiento (°)</span><input id="s1" inputmode="numeric"></label><label class="f"><span id="lS2">Buzamiento (°)</span><input id="s2" inputmode="numeric" value="${d.dip ?? ''}"></label></div>
  <p class="note" id="sPrev">—</p>
  <button class="btn ghost" id="sCmp" style="width:100%">Medir con la brújula del teléfono</button>
  <div class="grid2"><label class="f"><span>Espesor (cm)</span><input id="sThick" inputmode="decimal" value="${esc(d.thick)}"></label><label class="f"><span>Método</span><input id="sMethod" value="${esc(d.method)}"></label></div>
  <label class="f"><span>Nota</span><input id="sNote" value="${esc(d.note)}" placeholder="Relleno, relación de corte, sentido de movimiento…"></label>
  <div class="sheet-foot">${ex ? '<button class="btn danger" id="sDel">Eliminar</button>' : ''}<button class="btn" id="sSave">Guardar</button></div>`);
  const k = $('#sKind', s), a = $('#s1', s), b = $('#s2', s);
  const ddVal = () => { const v = num(a.value); if (v == null) return null; return isLine(k.value) || inMode === 'dd' ? norm360(v) : norm360(v + 90); };
  const setMode = m => { inMode = m; $$('#sMode button', s).forEach(x => x.classList.toggle('on', x.dataset.m === m)); labels(); a.value = d.dipDir == null ? '' : Math.round(isLine(k.value) || m === 'dd' ? d.dipDir : norm360(d.dipDir - 90)); prev(); };
  const labels = () => { const ln = isLine(k.value); $('#sMode', s).hidden = ln; $('#lS1', s).textContent = ln ? 'Dirección de inmersión (trend °)' : inMode === 'dd' ? 'Dirección de buzamiento (°)' : 'Rumbo, regla mano derecha (°)'; $('#lS2', s).textContent = ln ? 'Inmersión (plunge °)' : 'Buzamiento (°)'; };
  const prev = () => { d.dipDir = ddVal(); d.dip = num(b.value); const t = { kind: k.value, dipDir: d.dipDir, dip: d.dip }; $('#sPrev', s).textContent = d.dipDir == null || d.dip == null ? 'Escribe los dos valores' : isLine(k.value) ? `Inmersión ${fmtStruct(t)}` : `Dir. buz./Buz. ${fmtStruct(t, 'dd')} · RHR ${fmtStruct(t, 'rhr')} · ${fmtStruct(t, 'quad')}`; };
  $$('#sMode button', s).forEach(x => x.onclick = () => { d.dipDir = ddVal(); setMode(x.dataset.m); });
  k.onchange = () => { labels(); prev(); }; a.oninput = prev; b.oninput = prev;
  setMode(inMode);
  const back = () => openStation(st.id);
  $('#sBack', s).onclick = back;
  const measure = () => {
    d.kind = k.value; d.thick = $('#sThick', s).value; d.note = $('#sNote', s).value;
    S.pick = { label: `${st.code} · ${d.kind}`, done: r => { structForm(st.id, sid, { ...d, dipDir: r.dipDir, dip: r.dip, method: 'Brújula FabianApp' }); } };
    S.mode = isLine(d.kind) ? 'line' : 'plane'; $$('#panel-compass .seg button').forEach(x => x.classList.toggle('on', x.dataset.mode === S.mode));
    closeSheet(); $('#cmpResult').hidden = true; showPanel('compass');
  };
  $('#sCmp', s).onclick = measure;
  if (autoMeasure) return measure();
  $('#sSave', s).onclick = async () => {
    prev(); if (d.dipDir == null || d.dip == null || d.dip < 0 || d.dip > 90) { toast('Revisa los valores: buzamiento entre 0 y 90°'); return; }
    Object.assign(d, { kind: k.value, dipDir: Math.round(d.dipDir), dip: Math.round(d.dip), thick: $('#sThick', s).value.trim(), method: $('#sMethod', s).value.trim(), note: $('#sNote', s).value.trim() });
    st.structs = st.structs || []; const i = st.structs.findIndex(x => x.id === d.id); if (i >= 0) st.structs[i] = d; else st.structs.push(d);
    await saveItem(st); toast(`${d.kind} ${fmtStruct(d)} guardada`); back();
  };
  if (ex) $('#sDel', s).onclick = async () => { if (!await dialog({ title: 'Eliminar estructura', text: `${d.kind} ${fmtStruct(d)}`, ok: 'Eliminar', danger: true })) return; st.structs = st.structs.filter(x => x.id !== d.id); await saveItem(st); back(); };
}

/* Muestras */
const SKIND = ['Roca (grab)', 'Canal', 'Esquirlas (chip)', 'Panel', 'Suelo', 'Sedimento activo', 'Concentrado de batea', 'Trinchera', 'Otro'];
const QC = ['Normal', 'Duplicado de campo', 'Blanco', 'Estándar (MRC)'];
function sampleForm(stId, mid) {
  const st = S.items.find(i => i.id === stId); if (!st) return; const p = S.project;
  const ex = mid ? st.samples.find(x => x.id === mid) : null;
  const def = nextCode(p.smPrefix, p.smCount, 4);
  const d = { id: uid(), code: def, kind: 'Roca (grab)', qc: 'Normal', ref: '', len: '', wt: '', desc: '', date: new Date().toISOString(), ...(ex || {}) };
  const s = openSheet(`<div class="sheet-head"><h2>${ex ? 'Editar' : 'Nueva'} muestra · ${esc(st.code)}</h2><button class="btn ghost small" id="mBack">Volver</button></div>
  <div class="grid2"><label class="f"><span>Código de muestra</span><input id="mCode" value="${esc(d.code)}" autocapitalize="characters"></label>
  <label class="f"><span>Tipo</span><select id="mKind">${SKIND.map(k => `<option${k === d.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></label></div>
  <div class="grid2"><label class="f"><span>Control QA/QC</span><select id="mQc">${QC.map(k => `<option${k === d.qc ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
  <label class="f"><span id="lRef">Referencia</span><input id="mRef" value="${esc(d.ref)}"></label></div>
  <div class="grid2"><label class="f"><span>Longitud (m)</span><input id="mLen" inputmode="decimal" value="${esc(d.len)}"></label><label class="f"><span>Peso (kg)</span><input id="mWt" inputmode="decimal" value="${esc(d.wt)}"></label></div>
  <label class="f"><span>Descripción</span><textarea id="mDesc" placeholder="Material muestreado, % sulfuros, intervalo…">${esc(d.desc)}</textarea></label>
  <div class="sheet-foot">${ex ? '<button class="btn danger" id="mDel">Eliminar</button>' : ''}<button class="btn" id="mSave">Guardar</button></div>`);
  const qc = $('#mQc', s); const refLbl = () => { const v = qc.value; $('#lRef', s).textContent = v === 'Duplicado de campo' ? 'Muestra original (código)' : v === 'Estándar (MRC)' ? 'Material de referencia (MRC)' : v === 'Blanco' ? 'Material del blanco' : 'Referencia (opcional)'; };
  qc.onchange = refLbl; refLbl();
  const back = () => openStation(st.id); $('#mBack', s).onclick = back;
  $('#mSave', s).onclick = async () => {
    const code = $('#mCode', s).value.trim(); if (!code) { toast('Escribe el código'); return; }
    const dup = S.items.some(i => i.type === 'station' && i.projectId === p.id && (i.samples || []).some(m => m.code === code && m.id !== d.id));
    if (dup && !await dialog({ title: 'Código repetido', text: `La muestra ${code} ya existe en el proyecto.`, ok: 'Guardar igual' })) return;
    Object.assign(d, { code, kind: $('#mKind', s).value, qc: qc.value, ref: $('#mRef', s).value.trim(), len: $('#mLen', s).value.trim(), wt: $('#mWt', s).value.trim(), desc: $('#mDesc', s).value.trim() });
    st.samples = st.samples || []; const i = st.samples.findIndex(x => x.id === d.id); if (i >= 0) st.samples[i] = d; else { st.samples.push(d); if (code === def) { p.smCount++; await saveProject(); } }
    await saveItem(st); toast(`Muestra ${code} guardada`); back();
  };
  if (ex) $('#mDel', s).onclick = async () => { if (!await dialog({ title: `Eliminar ${d.code}`, ok: 'Eliminar', danger: true })) return; st.samples = st.samples.filter(x => x.id !== d.id); await saveItem(st); back(); };
}

/* ---------- Navegación ---------- */
function startNav(lat, lon, name) { S.nav = { lat, lon, name }; $('#navHud').hidden = false; $('#navName').textContent = name; startSensors(); updateNav(); }
function updateNav() {
  const n = S.nav; if (!n) return; G.nav.clearLayers();
  L.circleMarker([n.lat, n.lon], { radius: 10, color: '#c9971c', weight: 3, fillOpacity: 0 }).addTo(G.nav);
  if (!S.pos) { $('#navInfo').textContent = 'Esperando GPS…'; return; }
  const here = [S.pos.lat, S.pos.lon], d = dist(here, [n.lat, n.lon]), b = bearing(here, [n.lat, n.lon]);
  L.polyline([here, [n.lat, n.lon]], { color: '#c9971c', weight: 3, dashArray: '4 6' }).addTo(G.nav);
  const rel = S.heading == null ? b : b - S.heading;
  $('#navArrow').style.transform = `rotate(${rel}deg)`;
  $('#navInfo').textContent = `${fmtDist(d)} · azimut ${pad(b, 3)}°${S.heading == null ? ' (flecha respecto al norte)' : ''}${d < Math.max(5, S.pos.acc || 0) ? ' · ¡Llegaste!' : ''}`;
}
$('#navClose').onclick = () => { S.nav = null; G.nav.clearLayers(); $('#navHud').hidden = true; };

/* ---------- Tracks ---------- */
let recTimer = null, wakeLock = null;
async function keepAwake(on) {
  try { if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) { }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.rec) keepAwake(true); });
function startRec(resume) {
  if (S.rec) return;
  S.rec = resume || { pts: [], start: Date.now(), dist: 0, gain: 0, refAlt: null, pausedMs: 0, pauseAt: null };
  $('#trackBar').hidden = false; $('#trackBar').classList.remove('paused'); $('#trkPause').textContent = 'Pausar';
  keepAwake(true); recTimer = setInterval(recUi, 1000); recUi(); drawRec(); showPanel('map');
  toast(resume ? 'Grabación retomada' : 'Grabando track');
}
function recPoint() {
  const r = S.rec, p = S.pos; if (!r || r.pauseAt || !p || p.acc > 30) return;
  const last = r.pts[r.pts.length - 1];
  if (last) { const d = dist([last[0], last[1]], [p.lat, p.lon]); if (d < Math.max(3, p.acc * 0.5)) return; r.dist += d; }
  if (p.alt != null) { if (r.refAlt == null) r.refAlt = p.alt; else if (Math.abs(p.alt - r.refAlt) > 3) { if (p.alt > r.refAlt) r.gain += p.alt - r.refAlt; r.refAlt = p.alt; } }
  r.pts.push([+p.lat.toFixed(7), +p.lon.toFixed(7), p.alt == null ? null : +p.alt.toFixed(1), Date.now()]);
  drawRec(); if (r.pts.length % 10 === 0) DB.put('kv', r, 'recDraft').catch(() => { });
}
function recUi() { const r = S.rec; if (!r) return; const el = ((r.pauseAt || Date.now()) - r.start - r.pausedMs) / 1000; $('#trkLive').textContent = `${fmtDist(r.dist)} · ${fmtDur(el)}`; $('#trkLive2').textContent = `${r.pts.length} puntos · +${fx(r.gain)} m${r.pauseAt ? ' · en pausa' : ''}`; }
function drawRec() { G.rec.clearLayers(); const r = S.rec; if (r && r.pts.length > 1) L.polyline(r.pts.map(p => [p[0], p[1]]), { color: '#d0241b', weight: 4 }).addTo(G.rec); }
$('#trkStart').onclick = () => { if (!S.pos) toast('Esperando GPS: el track empieza con la primera posición'); startRec(); };
$('#trkPause').onclick = () => { const r = S.rec; if (!r) return; if (r.pauseAt) { r.pausedMs += Date.now() - r.pauseAt; r.pauseAt = null; $('#trkPause').textContent = 'Pausar'; $('#trackBar').classList.remove('paused'); } else { r.pauseAt = Date.now(); $('#trkPause').textContent = 'Seguir'; $('#trackBar').classList.add('paused'); } recUi(); };
$('#trkStop').onclick = async () => {
  const r = S.rec; if (!r) return;
  if (r.pts.length < 2) { if (await dialog({ title: 'Track muy corto', text: 'Tiene menos de 2 puntos. ¿Descartarlo?', ok: 'Descartar', danger: true })) endRec(); return; }
  const d = new Date(r.start); const name = await dialog({ title: 'Guardar track', input: `Track ${d.toLocaleDateString('es-CO')} ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`, ok: 'Guardar', cancel: 'Seguir grabando' });
  if (name == null) return;
  const it = { id: uid(), type: 'track', projectId: S.project.id, name: name || 'Track', date: new Date(r.start).toISOString(), pts: r.pts, dist: r.dist, dur: ((r.pauseAt || Date.now()) - r.start - r.pausedMs) / 1000, gain: r.gain };
  await saveItem(it); endRec(); toast(`Track guardado: ${fmtDist(it.dist)}`);
};
function endRec() { S.rec = null; clearInterval(recTimer); keepAwake(false); $('#trackBar').hidden = true; G.rec.clearLayers(); DB.del('kv', 'recDraft').catch(() => { }); }
function renderTracks() {
  const list = tracks().sort((a, b) => b.date.localeCompare(a.date));
  $('#trkStart').disabled = !!S.rec; $('#trkStart').textContent = S.rec ? 'Grabando…' : 'Grabar';
  $('#trkList').innerHTML = list.length ? list.map(t => `<button class="item" data-id="${esc(t.id)}"><div class="grow"><div class="code">${esc(t.name)}</div><div class="meta">${esc(fmtDate(t.date))} · ${t.pts.length} puntos</div></div><div class="right">${fmtDist(t.dist)}<br>${fmtDur(t.dur || 0)}</div></button>`).join('')
    : '<div class="empty"><b>Sin tracks</b>Toca «Grabar» para registrar tu recorrido.</div>';
  $$('#trkList .item').forEach(b => b.onclick = () => openTrack(b.dataset.id));
}
function profileSvg(pts) {
  const a = pts.filter(p => p[2] != null); if (a.length < 2) return '<p class="note">El track no tiene alturas GPS.</p>';
  let dd = 0; const xs = [0]; for (let i = 1; i < a.length; i++) { dd += dist(a[i - 1], a[i]); xs.push(dd); }
  const zs = a.map(p => elev(p[2])), mn = Math.min(...zs), mx = Math.max(...zs), W = 600, H = 120, pd = 4, rng = Math.max(1, mx - mn);
  const X = x => pd + x / (dd || 1) * (W - 2 * pd), Y = z => H - 18 - (z - mn) / rng * (H - 34);
  const line = zs.map((z, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)} ${Y(z).toFixed(1)}`).join('');
  return `<svg class="prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="area" d="${line}L${X(dd)} ${H - 18}L${X(0)} ${H - 18}Z"/><path d="${line}" vector-effect="non-scaling-stroke"/></svg><p class="note">Altura ${fx(mn)}–${fx(mx)} m · distancia ${fmtDist(dd)}</p>`;
}
function openTrack(id) {
  const t = S.items.find(i => i.id === id); if (!t) return;
  const s = openSheet(`<div class="sheet-head"><div><h2>${esc(t.name)}</h2><p class="sub">${esc(fmtDate(t.date))}</p></div><button class="btn ghost small" data-close>Cerrar</button></div>
  <dl class="kv"><dt>Distancia</dt><dd>${fmtDist(t.dist)}</dd><dt>Duración</dt><dd>${fmtDur(t.dur || 0)}</dd><dt>Ascenso</dt><dd>+${fx(t.gain)} m</dd><dt>Puntos</dt><dd>${t.pts.length}</dd></dl>
  <h3>Perfil de elevación</h3>${profileSvg(t.pts)}
  <div class="btns"><button class="btn small" id="tMap">Ver en mapa</button><button class="btn small ghost" id="tGpx">Exportar GPX</button><button class="btn small ghost" id="tRen">Renombrar</button><button class="btn small danger" id="tDel">Eliminar</button></div>`);
  $('#tMap', s).onclick = () => { closeSheet(); showPanel('map'); S.follow = false; $('#btnLocate').classList.remove('on'); map.fitBounds(L.latLngBounds(t.pts.map(p => [p[0], p[1]])), { padding: [40, 40] }); };
  $('#tGpx', s).onclick = () => deliver(new Blob([gpx([], [t])], { type: 'application/gpx+xml' }), safe(t.name) + '.gpx');
  $('#tRen', s).onclick = async () => { const n = await dialog({ title: 'Renombrar track', input: t.name, ok: 'Guardar' }); if (n) { t.name = n; await saveItem(t); openTrack(t.id); } };
  $('#tDel', s).onclick = async () => { if (!await dialog({ title: 'Eliminar track', text: t.name, ok: 'Eliminar', danger: true })) return; closeSheet(); removeItem(t, 'Track'); };
}

/* ---------- Medición ---------- */
$('#btnMeasure').onclick = () => {
  if (S.meas) return endMeasure();
  S.meas = { pts: [] }; $('#measureBar').hidden = false; $('#btnMeasure').classList.add('on'); $('#btnAddStation').hidden = true; measUi();
  toast('Toca el mapa para marcar puntos', null, null, 2500);
};
function endMeasure() { S.meas = null; G.meas.clearLayers(); $('#measureBar').hidden = true; $('#btnMeasure').classList.remove('on'); $('#btnAddStation').hidden = false; }
function measUi() {
  const m = S.meas; G.meas.clearLayers(); if (!m) return;
  const d = pathLen(m.pts), a = ringArea(m.pts);
  if (m.pts.length > 2) L.polygon(m.pts, { color: '#1d4f91', weight: 1, fillOpacity: .12, interactive: false }).addTo(G.meas);
  if (m.pts.length > 1) L.polyline(m.pts, { color: '#1d4f91', weight: 3, interactive: false }).addTo(G.meas);
  m.pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#1d4f91', fillOpacity: 1, interactive: false }).addTo(G.meas));
  $('#measDist').textContent = fmtDist(d);
  $('#measArea').textContent = m.pts.length > 2 ? `Área ${fmtArea(a)} · perímetro ${fmtDist(d + dist(m.pts[m.pts.length - 1], m.pts[0]))}` : m.pts.length === 2 ? `Azimut ${pad(bearing(m.pts[0], m.pts[1]), 3)}°` : 'Toca el mapa para agregar puntos';
}
$('#measUndo').onclick = () => { if (S.meas) { S.meas.pts.pop(); measUi(); } };
$('#measClose').onclick = endMeasure;
$('#measSave').onclick = async () => {
  const m = S.meas; if (!m || m.pts.length < 2) { toast('Marca al menos 2 puntos'); return; }
  const name = await dialog({ title: 'Guardar medición', input: `Medición ${new Date().toLocaleDateString('es-CO')}`, ok: 'Guardar' }); if (!name) return;
  await saveItem({ id: uid(), type: 'measure', projectId: S.project.id, name, date: new Date().toISOString(), pts: m.pts, dist: pathLen(m.pts), area: m.pts.length > 2 ? ringArea(m.pts) : 0 });
  endMeasure(); toast('Medición guardada');
};
map.on('click', e => { if (S.meas) { S.meas.pts.push([e.latlng.lat, e.latlng.lng]); measUi(); } });
map.on('contextmenu', e => {
  if (S.meas) return; const ll = [e.latlng.lat, e.latlng.lng];
  const s = openSheet(`<div class="sheet-head"><h2>Punto en el mapa</h2><button class="btn ghost small" data-close>Cerrar</button></div>
    <dl class="kv">${CRS.map(c => `<dt>${esc(c.short)}</dt><dd>${esc(fmtCoord(ll[0], ll[1], c.id))}</dd>`).join('')}${S.pos ? `<dt>Desde mí</dt><dd>${fmtDist(dist([S.pos.lat, S.pos.lon], ll))} · azimut ${pad(bearing([S.pos.lat, S.pos.lon], ll), 3)}°</dd>` : ''}</dl>
    <div class="btns"><button class="btn" id="pSt">Crear estación aquí</button><button class="btn ghost" id="pNav">Navegar hasta aquí</button></div>`);
  $('#pSt', s).onclick = () => stationForm(null, ll);
  $('#pNav', s).onclick = () => { closeSheet(); startNav(ll[0], ll[1], 'Punto marcado'); };
});

/* ---------- Capas y mapas offline ---------- */
$('#btnLayers').onclick = () => {
  const imp = S.items.filter(i => i.type === 'layer'), ras = S.items.filter(i => i.type === 'raster');
  const s = openSheet(`<div class="sheet-head"><h2>Capas</h2><button class="btn ghost small" data-close>Listo</button></div>
  <h3>Mapa base</h3><div class="sublist">${BASES.map(b => `<button class="subitem" data-b="${b.id}"><span class="grow">${esc(b.name)}</span>${S.set.base === b.id ? '<b style="color:var(--cu)">✓</b>' : ''}</button>`).join('')}</div>
  <h3>Mis datos</h3><div class="chips">${[['st', 'Estaciones'], ['sy', 'Símbolos estructurales'], ['tr', 'Tracks'], ['me', 'Mediciones']].map(([k, t]) => `<button class="chip${S.set.ov[k] !== false ? ' on' : ''}" data-ov="${k}">${t}</button>`).join('')}</div>
  <p class="note">Los símbolos de rumbo y buzamiento aparecen desde zoom 14.</p>
  <h3>Capas importadas</h3><div class="chips">${imp.map(l => `<button class="chip${l.visible ? ' on' : ''}" data-l="${esc(l.id)}">${esc(l.name)}</button>`).join('') || '<span class="note">Importa shapefiles, KML/KMZ, GPX o GeoJSON desde Más.</span>'}</div>
  <h3>Mapas PDF e imágenes</h3><div class="sublist">${ras.map(r => `<div class="subitem"><button class="chip${r.visible ? ' on' : ''}" data-l="${esc(r.id)}">${esc(r.name)}</button><input type="range" min="0.1" max="1" step="0.05" value="${r.opacity ?? 0.85}" data-op="${esc(r.id)}" aria-label="Transparencia" style="flex:1;min-height:36px;padding:0"></div>`).join('') || '<span class="note">Importa un PDF georreferenciado o una imagen desde Más.</span>'}</div>`);
  $$('[data-b]', s).forEach(b => b.onclick = () => { setBase(b.dataset.b); $('#btnLayers').onclick(); });
  $$('[data-ov]', s).forEach(b => b.onclick = () => { b.classList.toggle('on'); S.set.ov[b.dataset.ov] = b.classList.contains('on'); saveSettings(); renderMapData(); });
  $$('[data-l]', s).forEach(b => b.onclick = async () => { const l = S.items.find(i => i.id === b.dataset.l); l.visible = !l.visible; b.classList.toggle('on', l.visible); await saveItem(l); });
  $$('[data-op]', s).forEach(r => { r.oninput = () => { const l = rasterLayers.get(r.dataset.op); if (l) l.setOpacity(+r.value); }; r.onchange = async () => { const it = S.items.find(i => i.id === r.dataset.op); it.opacity = +r.value; await saveItem(it); }; });
};
function tileList(b, bounds, z0, z1) {
  const out = [];
  for (let z = z0; z <= z1; z++) {
    const n = 2 ** z, lx = lon => Math.floor((lon + 180) / 360 * n), ly = lat => { const r = Math.max(-85.05, Math.min(85.05, lat)) * D2R; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    for (let x = lx(bounds.getWest()); x <= lx(bounds.getEast()); x++) for (let y = ly(bounds.getNorth()); y <= ly(bounds.getSouth()); y++) {
      const sub = (b.sub || 'abc')[Math.abs(x + y) % (b.sub || 'abc').length];
      out.push(b.url.replace('{s}', sub).replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
  }
  return out;
}
$('#btnOffline').onclick = async () => {
  const b = BASES.find(x => x.id === S.set.base);
  if (!b?.url) { toast('Elige primero un mapa base'); return; }
  if (!b.pre) { await dialog({ title: 'Cambia de mapa base', text: 'OpenStreetMap no permite descargas masivas. Usa «Topográfico» o «Satélite» para guardar zonas; lo que ya hayas visto queda guardado igual.', ok: 'Entendido', cancel: 'Cerrar' }); return; }
  if (!navigator.serviceWorker?.controller) { await dialog({ title: 'Modo offline no activo', text: 'Abre FabianApp desde su dirección web (https) o instalada para poder guardar mapas sin señal.', ok: 'Entendido', cancel: 'Cerrar' }); return; }
  const z0 = Math.max(1, Math.floor(map.getZoom())); let z1 = Math.min(b.max, z0 + 4), list = tileList(b, map.getBounds(), z0, z1);
  while (list.length > 2500 && z1 > z0) { z1--; list = tileList(b, map.getBounds(), z0, z1); }
  const ok = await dialog({ title: 'Guardar zona visible', text: `${list.length} teselas (zoom ${z0} a ${z1}), unos ${Math.round(list.length * 0.025)} MB, del mapa «${b.name}». Hazlo con Wi-Fi.`, ok: 'Descargar' });
  if (!ok) return;
  let done = 0, fail = 0, i = 0;
  const worker = async () => { while (i < list.length) { const u = list[i++]; try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) fail++; } catch (e) { fail++; } done++; if (done % 20 === 0 || done === list.length) toast(`Guardando mapa… ${done}/${list.length}`, null, null, 4000); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  toast(`Zona guardada: ${done - fail} teselas${fail ? ` (${fail} fallaron)` : ''}`);
};

/* ---------- Importar ---------- */
const kmlCoords = t => t.trim().split(/\s+/).map(c => c.split(',').map(Number)).filter(c => c.length >= 2 && !isNaN(c[0])).map(c => c.length > 2 ? [c[0], c[1], c[2]] : [c[0], c[1]]);
function kmlToGeo(txt) {
  const x = new DOMParser().parseFromString(txt, 'application/xml'), fs = [];
  const geoms = el => { const g = []; for (const p of el.getElementsByTagName('Point')) g.push({ type: 'Point', coordinates: kmlCoords(p.getElementsByTagName('coordinates')[0]?.textContent || '')[0] }); for (const l of el.getElementsByTagName('LineString')) g.push({ type: 'LineString', coordinates: kmlCoords(l.getElementsByTagName('coordinates')[0]?.textContent || '') }); for (const p of el.getElementsByTagName('Polygon')) { const rings = [...p.getElementsByTagName('LinearRing')].map(r => kmlCoords(r.getElementsByTagName('coordinates')[0]?.textContent || '')); g.push({ type: 'Polygon', coordinates: rings }); } return g.filter(q => q.coordinates && q.coordinates.length); };
  for (const pm of x.getElementsByTagName('Placemark')) {
    const props = { name: pm.getElementsByTagName('name')[0]?.textContent || '' };
    for (const d of pm.getElementsByTagName('Data')) props[d.getAttribute('name')] = d.getElementsByTagName('value')[0]?.textContent;
    for (const d of pm.getElementsByTagName('SimpleData')) props[d.getAttribute('name')] = d.textContent;
    geoms(pm).forEach(g => fs.push({ type: 'Feature', properties: props, geometry: g }));
  }
  return { type: 'FeatureCollection', features: fs };
}
function gpxToGeo(txt) {
  const x = new DOMParser().parseFromString(txt, 'application/xml'), fs = [];
  const pt = e => { const c = [+e.getAttribute('lon'), +e.getAttribute('lat')]; const el = e.getElementsByTagName('ele')[0]; if (el) c.push(+el.textContent); return c; };
  for (const w of x.getElementsByTagName('wpt')) fs.push({ type: 'Feature', properties: { name: w.getElementsByTagName('name')[0]?.textContent || '' }, geometry: { type: 'Point', coordinates: pt(w) } });
  for (const t of x.getElementsByTagName('trk')) for (const sg of t.getElementsByTagName('trkseg')) fs.push({ type: 'Feature', properties: { name: t.getElementsByTagName('name')[0]?.textContent || 'track' }, geometry: { type: 'LineString', coordinates: [...sg.getElementsByTagName('trkpt')].map(pt) } });
  for (const r of x.getElementsByTagName('rte')) fs.push({ type: 'Feature', properties: { name: r.getElementsByTagName('name')[0]?.textContent || 'ruta' }, geometry: { type: 'LineString', coordinates: [...r.getElementsByTagName('rtept')].map(pt) } });
  return { type: 'FeatureCollection', features: fs };
}
/* ---------- Importar: Shapefile, KML/KMZ, GPX, GeoJSON, PDF georreferenciado, imágenes ---------- */
const LCOLORS = ['#6b3fa0', '#0b7a75', '#c2185b', '#1d4f91', '#8a6d00', '#2e7d32', '#d84315'];
const nextColor = () => LCOLORS[S.items.filter(i => i.type === 'layer').length % LCOLORS.length];
const BOG_DATUM = '+proj=longlat +ellps=intl +towgs84=307,304,-318,0,0,0,0 +no_defs';

async function inflate(u8, fmt) {
  const out = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('ZIP inválido');
  const n = dv.getUint16(e + 10, true), td = new TextDecoder(), out = {}; let p = dv.getUint32(e + 16, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/') || name.includes('__MACOSX')) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), data = u8.subarray(ds, ds + csize);
    if (method === 0) out[name] = data; else if (method === 8) out[name] = await inflate(data, 'deflate-raw');
  }
  return out;
}

/* Sistemas de coordenadas para datos sin .prj */
function eachCoord(c, fn) { if (typeof c[0] === 'number') fn(c); else c.forEach(x => eachCoord(x, fn)); }
function geoms(gj) { const out = []; const walk = g => { if (!g) return; if (g.type === 'FeatureCollection') g.features.forEach(f => walk(f.geometry)); else if (g.type === 'Feature') walk(g.geometry); else if (g.type === 'GeometryCollection') g.geometries.forEach(walk); else if (g.coordinates) out.push(g); }; walk(gj); return out; }
function gjBBox(gj) { const b = [Infinity, Infinity, -Infinity, -Infinity]; geoms(gj).forEach(g => eachCoord(g.coordinates, c => { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); })); return b; }
const looksGeo = b => isFinite(b[0]) && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90;
function reprojectGJ(gj, crs, zone) {
  const fn = crs === 'bogdatum' ? (c => { const p = proj4(BOG_DATUM, 'WGS84', [c[0], c[1]]); c[0] = p[0]; c[1] = p[1]; })
    : (c => { const [la, lo] = unproj(c[0], c[1], crs, zone); c[0] = lo; c[1] = la; });
  geoms(gj).forEach(g => eachCoord(g.coordinates, fn)); return gj;
}
function guessCrs(b) {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  if (cx > 4.3e6 && cx < 5.8e6 && cy > 1.0e6 && cy < 3.2e6) return 'ctm12';
  if (cx > 1.6e5 && cx < 8.4e5) return 'utm';
  return 'bog';
}
function pickCrs(title, b) {
  return new Promise(res => {
    const g = guessCrs(b);
    const s = openSheet(`<div class="sheet-head"><h2>${esc(title)}</h2></div>
      <p class="sub">El archivo no trae sistema de coordenadas (.prj). Rango de coordenadas: X ${fx(b[0])} a ${fx(b[2])}, Y ${fx(b[1])} a ${fx(b[3])}. ¿En qué sistema está?</p>
      <label class="f"><span>Sistema</span><select id="pcS">${[['ctm12', 'Origen Nacional CTM12 (EPSG:9377)'], ['bog', 'MAGNA-SIRGAS Bogotá (EPSG:3116)'], ['este', 'MAGNA-SIRGAS Este Central (EPSG:3117)'], ['utm', 'UTM WGS84']].map(([v, t]) => `<option value="${v}"${v === g ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="f" id="pcZw"><span>Zona UTM</span><input id="pcZ" value="18N"></label>
      <div class="sheet-foot"><button class="btn ghost" id="pcNo">Cancelar</button><button class="btn" id="pcOk">Importar</button></div>`);
    const sel = $('#pcS', s), zw = $('#pcZw', s); const upd = () => zw.hidden = sel.value !== 'utm'; sel.onchange = upd; upd();
    $('#pcNo', s).onclick = () => { closeSheet(); res(null); };
    $('#pcOk', s).onclick = () => { const r = { crs: sel.value, zone: $('#pcZ', s).value }; closeSheet(); res(r); };
  });
}
function fixPrj(prj) {
  if (prj && /bogota/i.test(prj) && !/magna/i.test(prj) && !/TOWGS84/i.test(prj)) return prj.replace(/(DATUM\[[^\[]*\[[^\]]*\])/i, '$1,TOWGS84[307,304,-318,0,0,0,0]');
  return prj;
}
async function parseShapefile(parts, name) {
  const td = new TextDecoder();
  const prj = parts.prj ? fixPrj(td.decode(parts.prj)) : undefined;
  let gj;
  try { gj = await shp({ shp: parts.shp, dbf: parts.dbf, cpg: parts.cpg ? td.decode(parts.cpg) : undefined, prj }); }
  catch (e) { if (!prj) throw e; gj = await shp({ shp: parts.shp, dbf: parts.dbf, cpg: parts.cpg ? td.decode(parts.cpg) : undefined }); gj.__noPrj = true; }
  const b = gjBBox(gj);
  if (!looksGeo(b)) { const c = await pickCrs(`Shapefile «${name}»`, b); if (!c) return null; reprojectGJ(gj, c.crs, c.zone); }
  return gj;
}
function groupShp(files) {
  const sets = {};
  for (const [n, data] of Object.entries(files)) {
    const m = n.match(/^(.*)\.(shp|dbf|prj|cpg)$/i); if (!m) continue;
    (sets[m[1]] ||= {})[m[2].toLowerCase()] = data;
  }
  return Object.entries(sets).filter(([, v]) => v.shp);
}
async function addVectorLayer(gj, name) {
  const n = gj.features?.length ?? 1;
  if (!n) throw new Error('vacío');
  const l = { id: uid(), type: 'layer', projectId: null, name, visible: true, geojson: gj, color: nextColor(), date: new Date().toISOString() };
  await saveItem(l); return l;
}
function fitItem(l) {
  try {
    if (l.type === 'raster') { const ly = rasterLayers.get(l.id); const pts = [[0, 0], [l.w, 0], [l.w, l.h], [0, l.h]].map(p => affPx2ll(l.aff, p[0], p[1])); map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] }); return ly; }
    map.fitBounds(L.geoJSON(l.geojson).getBounds(), { padding: [30, 30], maxZoom: 17 });
  } catch (e) { }
}

/* ---------- Imágenes georreferenciadas (afín) ---------- */
function fitAffine(gcps) {
  // píxel (x,y) -> Web Mercator (X,Y) por mínimos cuadrados
  const P = gcps.map(g => { const m = L.CRS.EPSG3857.project(L.latLng(g.lat, g.lon)); return { x: g.px, y: g.py, X: m.x, Y: m.y }; });
  const n = P.length, mx = P.reduce((t, p) => t + p.x, 0) / n, my = P.reduce((t, p) => t + p.y, 0) / n, mX = P.reduce((t, p) => t + p.X, 0) / n, mY = P.reduce((t, p) => t + p.Y, 0) / n;
  let Sxx = 0, Sxy = 0, Syy = 0, SxX = 0, SyX = 0, SxY = 0, SyY = 0;
  P.forEach(p => { const x = p.x - mx, y = p.y - my, X = p.X - mX, Y = p.Y - mY; Sxx += x * x; Sxy += x * y; Syy += y * y; SxX += x * X; SyX += y * X; SxY += x * Y; SyY += y * Y; });
  const det = Sxx * Syy - Sxy * Sxy; if (Math.abs(det) < 1e-9) throw new Error('Puntos alineados: usa puntos repartidos por la imagen');
  const a = (SxX * Syy - SyX * Sxy) / det, b = (Sxx * SyX - Sxy * SxX) / det, d = (SxY * Syy - SyY * Sxy) / det, e = (Sxx * SyY - Sxy * SxY) / det;
  const aff = { a, b, c: mX - a * mx - b * my, d, e, f: mY - d * mx - e * my };
  const k = Math.cos(gcps[0].lat * D2R);
  const rms = n > 3 ? Math.sqrt(P.reduce((t, p) => t + ((aff.a * p.x + aff.b * p.y + aff.c - p.X) ** 2 + (aff.d * p.x + aff.e * p.y + aff.f - p.Y) ** 2), 0) / n) * k : null;
  return { aff, rms };
}
const affPx2ll = (A, x, y) => L.CRS.EPSG3857.unproject(L.point(A.a * x + A.b * y + A.c, A.d * x + A.e * y + A.f));
const AffineImage = L.Layer.extend({
  initialize(url, w, h, aff, opacity) { this._url = url; this._w = w; this._h = h; this._aff = aff; this._op = opacity ?? 0.85; },
  onAdd(m) {
    const img = this._img = L.DomUtil.create('img', 'leaflet-image-layer leaflet-zoom-hide');
    img.src = this._url; img.alt = ''; Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: this._w + 'px', height: this._h + 'px', maxWidth: 'none', transformOrigin: '0 0', opacity: this._op, pointerEvents: 'none' });
    m.getPane('rasterPane').appendChild(img); m.on('zoomend viewreset', this._update, this); this._update();
  },
  onRemove(m) { L.DomUtil.remove(this._img); m.off('zoomend viewreset', this._update, this); },
  setOpacity(o) { this._op = o; if (this._img) this._img.style.opacity = o; },
  _update() {
    const m = this._map, A = this._aff, p0 = m.latLngToLayerPoint(affPx2ll(A, 0, 0)), p1 = m.latLngToLayerPoint(affPx2ll(A, this._w, 0)), p2 = m.latLngToLayerPoint(affPx2ll(A, 0, this._h));
    this._img.style.transform = `matrix(${(p1.x - p0.x) / this._w},${(p1.y - p0.y) / this._w},${(p2.x - p0.x) / this._h},${(p2.y - p0.y) / this._h},${p0.x},${p0.y})`;
  }
});
const rasterLayers = new Map(), rasterUrls = new Map();
async function renderRasters() {
  const want = S.items.filter(i => i.type === 'raster' && i.visible);
  for (const [id, l] of rasterLayers) if (!want.some(w => w.id === id)) { map.removeLayer(l); rasterLayers.delete(id); }
  for (const r of want) {
    let l = rasterLayers.get(r.id);
    if (!l) {
      let u = rasterUrls.get(r.blobId);
      if (!u) { const rec = await DB.get('rasters', r.blobId); if (!rec) continue; u = URL.createObjectURL(rec.blob); rasterUrls.set(r.blobId, u); }
      if (rasterLayers.has(r.id) || !S.items.some(i => i.id === r.id && i.visible)) continue;
      l = new AffineImage(u, r.w, r.h, r.aff, r.opacity); rasterLayers.set(r.id, l); l.addTo(map);
    }
    l.setOpacity(r.opacity ?? 0.85);
  }
}
async function canvasBlob(c) {
  let b = await new Promise(r => c.toBlob(r, 'image/webp', 0.86));
  if (!b || b.type !== 'image/webp') b = await new Promise(r => c.toBlob(r, 'image/png'));
  return b;
}
async function saveRaster(canvas, name, gcps, src) {
  const { aff, rms } = fitAffine(gcps), blob = await canvasBlob(canvas), blobId = uid();
  await DB.put('rasters', { id: blobId, blob });
  const it = { id: uid(), type: 'raster', projectId: null, name, w: canvas.width, h: canvas.height, gcps, aff, rms, src, blobId, visible: true, opacity: 0.85, date: new Date().toISOString() };
  await saveItem(it); return it;
}

/* ---------- PDF georreferenciado (ISO 32000 / Adobe geospatial) ---------- */
let pdfjsReady = null;
function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdfjs/pdf.min.js'; s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(pdfjsLib); }; s.onerror = () => { pdfjsReady = null; rej(new Error('No se pudo cargar el lector de PDF')); }; document.head.append(s); });
  return pdfjsReady;
}
const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
const numsIn = s => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
function arrAt(t, i) { const a = t.indexOf('[', i), b = t.indexOf(']', a); return a < 0 || b < 0 ? null : numsIn(t.slice(a + 1, b)); }
function nearest(t, key, pos) { let best = -1, i = -1; while ((i = t.indexOf(key, i + 1)) >= 0) if (best < 0 || Math.abs(i - pos) < Math.abs(best - pos)) best = i; return best; }
async function pdfObjects(raw, u8) {
  const objs = new Map(), re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(raw))) {
    const st = m.index + m[0].length; let en = raw.indexOf('endobj', st); if (en < 0) en = raw.length;
    const s = raw.slice(st, Math.min(en, st + 200000)), k = s.search(/\bstream\r?\n/);
    objs.set(+m[1], { text: k >= 0 ? s.slice(0, k) : s, streamAt: k >= 0 ? st + k : -1 });
    re.lastIndex = en;
  }
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.text) || o.streamAt < 0) continue;
    try {
      let lm = o.text.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/), len = lm ? +lm[1] : 0;
      if (lm && lm[2]) len = +(objs.get(+lm[1])?.text.trim().match(/^\d+/)?.[0] || 0);
      let ds = o.streamAt + 6; if (raw[ds] === '\r') ds++; if (raw[ds] === '\n') ds++;
      if (!len) { len = raw.indexOf('endstream', ds) - ds; }
      let data = u8.subarray(ds, ds + len);
      if (/FlateDecode/.test(o.text)) data = await inflate(data, 'deflate');
      const t = latin1(data), N = +o.text.match(/\/N\s+(\d+)/)[1], F = +o.text.match(/\/First\s+(\d+)/)[1], hdr = numsIn(t.slice(0, F));
      for (let i = 0; i < N; i++) { const off = F + hdr[2 * i + 1], end = i + 1 < N ? F + hdr[2 * i + 3] : t.length; if (!objs.has(hdr[2 * i])) objs.set(hdr[2 * i], { text: t.slice(off, end), streamAt: -1 }); }
    } catch (e) { console.warn('ObjStm', e); }
  }
  return objs;
}
async function findPdfGeo(u8) {
  const raw = latin1(u8);
  if (!/\/GPTS/.test(raw) && !/\/ObjStm/.test(raw)) return { none: true, lgi: /\/LGIDict/.test(raw) };
  const objs = await pdfObjects(raw, u8), found = [];
  for (const [num, o] of objs) {
    const t = o.text; let i = -1;
    while ((i = t.indexOf('/GPTS', i + 1)) >= 0) {
      const gpts = arrAt(t, i), li = nearest(t, '/LPTS', i), lpts = li >= 0 ? arrAt(t, li) : null;
      if (!gpts || gpts.length < 6) continue;
      const bi = nearest(t, '/Bounds', i), bounds = bi >= 0 && Math.abs(bi - i) < 4000 ? arrAt(t, bi) : null;
      let gcs = ''; const gm = t.slice(Math.max(0, i - 4000), i + 4000).match(/\/GCS\s+(\d+)\s+\d+\s+R/); if (gm) gcs = objs.get(+gm[1])?.text || ''; else { const gi = nearest(t, '/GCS', i); if (gi >= 0) gcs = t.slice(gi, gi + 3000); }
      let bbox = null;
      const bxi = nearest(t, '/BBox', i);
      if (bxi >= 0 && /\/Measure\s*<</.test(t)) bbox = arrAt(t, bxi);
      if (!bbox) for (const [, o2] of objs) { const mm = o2.text.search(new RegExp(`/Measure\\s+${num}\\s+\\d+\\s+R`)); if (mm >= 0) { const b2 = nearest(o2.text, '/BBox', mm); if (b2 >= 0) { bbox = arrAt(o2.text, b2); break; } } }
      if (!bbox) continue;
      found.push({ gpts, lpts: lpts && lpts.length === gpts.length ? lpts : null, bounds, gcs, bbox, area: Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) });
    }
  }
  if (!found.length) return { none: true, lgi: /\/LGIDict/.test(raw) };
  found.sort((a, b) => b.area - a.area); return found[0];
}
async function renderPdfPage(u8) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: u8.slice(), isEvalSupported: false, disableFontFace: false }).promise;
  const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4096 / Math.max(v1.width, v1.height), Math.sqrt(14e6 / (v1.width * v1.height)), 6);
  const vp = page.getViewport({ scale }), c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, vp, pages: doc.numPages };
}
async function importPdf(file) {
  toast('Leyendo PDF…', null, null, 20000);
  const u8 = new Uint8Array(await file.arrayBuffer()), name = file.name.replace(/\.[^.]+$/, '');
  const geo = await findPdfGeo(u8);
  toast('Dibujando el mapa del PDF…', null, null, 30000);
  const { canvas, vp, pages } = await renderPdfPage(u8);
  $('#toast').hidden = true;
  if (geo.none) {
    const ok = await dialog({ title: 'PDF sin georreferencia', text: geo.lgi ? 'Este PDF usa el formato GeoPDF antiguo (TerraGo/OGC), que la app no lee. Puedes reexportarlo desde QGIS o ArcGIS como PDF geoespacial (ISO 32000), o georreferenciarlo a mano con 3 o más puntos conocidos.' : 'No encontré coordenadas dentro del PDF. Puedes georreferenciarlo a mano marcando 3 o más puntos de coordenadas conocidas (cruces de grilla, esquinas de la plancha).', ok: 'Georreferenciar a mano' });
    if (ok) georefManual(canvas, name); return;
  }
  const [x1, y1, x2, y2] = [Math.min(geo.bbox[0], geo.bbox[2]), Math.min(geo.bbox[1], geo.bbox[3]), Math.max(geo.bbox[0], geo.bbox[2]), Math.max(geo.bbox[1], geo.bbox[3])];
  const toPx = (u, v) => vp.convertToViewportPoint(x1 + u * (x2 - x1), y1 + v * (y2 - y1));
  const bog = /bogota/i.test(geo.gcs) && !/magna/i.test(geo.gcs) || /\/EPSG\s+(4218|2189\d)\b/.test(geo.gcs);
  const n = geo.gpts.length / 2, lp = geo.lpts || (geo.bounds && geo.bounds.length === geo.gpts.length ? geo.bounds : null);
  if (!lp) { toast('El PDF tiene coordenadas pero no sus puntos de referencia (LPTS)'); return; }
  const gcps = [];
  for (let k = 0; k < n; k++) {
    let lat = geo.gpts[2 * k], lon = geo.gpts[2 * k + 1];
    if (bog) { const p = proj4(BOG_DATUM, 'WGS84', [lon, lat]); lon = p[0]; lat = p[1]; }
    const [px, py] = toPx(lp[2 * k], lp[2 * k + 1]); gcps.push({ px, py, lat, lon });
  }
  // recorta al marco del mapa (sin leyenda ni márgenes)
  const poly = geo.bounds && geo.bounds.length >= 6 ? [...Array(geo.bounds.length / 2)].map((_, k) => toPx(geo.bounds[2 * k], geo.bounds[2 * k + 1])) : [toPx(0, 0), toPx(1, 0), toPx(1, 1), toPx(0, 1)];
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height; const x = c2.getContext('2d');
  x.beginPath(); poly.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.clip(); x.drawImage(canvas, 0, 0);
  const it = await saveRaster(c2, name, gcps, 'GeoPDF');
  showPanel('map'); fitItem(it);
  toast(`Mapa «${name}» cargado${bog ? ' (convertido de Datum Bogotá a MAGNA/WGS84)' : ''}${pages > 1 ? ` · se usó la página 1 de ${pages}` : ''}`, null, null, 6000);
}
async function importImage(file) {
  let src; try { src = await createImageBitmap(file); } catch (e) { toast('No se pudo abrir la imagen'); return; }
  const k = Math.min(1, 4096 / Math.max(src.width, src.height)), c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); georefManual(c, file.name.replace(/\.[^.]+$/, ''));
}

/* Georreferenciación manual con puntos de control */
function georefManual(canvas, name) {
  const url = canvas.toDataURL('image/jpeg', 0.8), pts = []; let zoom = 1, pending = null;
  const s = openSheet(`<div class="sheet-head"><div><h2>Georreferenciar «${esc(name)}»</h2><p class="sub">Toca un punto de coordenadas conocidas en la imagen y escribe sus coordenadas. Mínimo 3 puntos, lo más separados posible.</p></div><button class="btn ghost small" data-close>Cancelar</button></div>
    <div class="row gap" style="margin:6px 0"><button class="btn small ghost" id="grOut">−</button><button class="btn small ghost" id="grIn">+</button><span class="sub" id="grZ">100%</span></div>
    <div id="grBox" style="position:relative;overflow:auto;max-height:46vh;border:1px solid var(--line);border-radius:12px;background:#fff;touch-action:pan-x pan-y"><div id="grIn2" style="position:relative;width:100%"><img id="grImg" src="${url}" style="width:100%;display:block" alt="Imagen a georreferenciar"><div id="grDots"></div></div></div>
    <div class="card" id="grForm" hidden style="margin-top:10px"><b id="grPx">Punto</b>
      <label class="f"><span>Sistema</span><select id="grC">${[['ctm12', 'Origen Nacional CTM12'], ['geo', 'Geográficas WGS84 (lat, lon)'], ['utm', 'UTM WGS84'], ['bog', 'MAGNA Bogotá'], ['este', 'MAGNA Este Central']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <div class="grid3"><label class="f"><span id="grLA">Este (m)</span><input id="grA" inputmode="decimal"></label><label class="f"><span id="grLB">Norte (m)</span><input id="grB" inputmode="decimal"></label><label class="f" id="grZw" hidden><span>Zona</span><input id="grZn" value="18N"></label></div>
      <div class="btns"><button class="btn small" id="grAdd">Agregar punto</button><button class="btn small ghost" id="grGps">Usar mi posición GPS</button></div></div>
    <div class="sublist" id="grList" style="margin-top:10px"></div>
    <p class="note" id="grRms"></p>
    <div class="sheet-foot"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="grSave" disabled>Guardar capa</button></div>`);
  const img = $('#grImg', s), sel = $('#grC', s);
  const labels = () => { const g = sel.value === 'geo'; $('#grLA', s).textContent = g ? 'Latitud' : 'Este (m)'; $('#grLB', s).textContent = g ? 'Longitud' : 'Norte (m)'; $('#grZw', s).hidden = sel.value !== 'utm'; };
  sel.value = ['dd', 'dms'].includes(S.set.crs) ? 'geo' : S.set.crs; labels(); sel.onchange = labels;
  const setZoom = z => { zoom = Math.max(1, Math.min(8, z)); $('#grIn2', s).style.width = zoom * 100 + '%'; $('#grZ', s).textContent = Math.round(zoom * 100) + '%'; dots(); };
  $('#grIn', s).onclick = () => setZoom(zoom * 1.6); $('#grOut', s).onclick = () => setZoom(zoom / 1.6);
  const dots = () => { const k = img.clientWidth / canvas.width; $('#grDots', s).innerHTML = [...pts.map((p, i) => ({ ...p, t: String(i + 1) })), ...(pending ? [{ ...pending, t: '?' }] : [])].map(p => `<div style="position:absolute;left:${p.px * k - 11}px;top:${p.py * k - 11}px;width:22px;height:22px;border-radius:50%;background:${p.t === '?' ? '#e2b440' : '#b25520'};color:#fff;border:2px solid #fff;font:700 12px/18px system-ui;text-align:center;pointer-events:none">${p.t}</div>`).join(''); };
  img.onclick = e => { const r = img.getBoundingClientRect(), k = canvas.width / r.width; pending = { px: (e.clientX - r.left) * k, py: (e.clientY - r.top) * k }; $('#grForm', s).hidden = false; $('#grPx', s).textContent = `Punto ${pts.length + 1} (píxel ${Math.round(pending.px)}, ${Math.round(pending.py)})`; dots(); $('#grA', s).focus(); };
  const list = () => {
    $('#grList', s).innerHTML = pts.map((p, i) => `<div class="subitem"><b>${i + 1}</b><span class="grow">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</span><button class="btn small danger" data-del="${i}">Quitar</button></div>`).join('');
    $$('[data-del]', s).forEach(b => b.onclick = () => { pts.splice(+b.dataset.del, 1); list(); dots(); });
    $('#grSave', s).disabled = pts.length < 3;
    try { $('#grRms', s).textContent = pts.length >= 4 ? `Error medio cuadrático: ${fx(fitAffine(pts).rms, 1)} m` : pts.length === 3 ? 'Con 3 puntos la ubicación es exacta pero sin control de error; agrega un 4.º punto para verificar.' : ''; } catch (e) { $('#grRms', s).textContent = e.message; }
  };
  $('#grAdd', s).onclick = () => {
    if (!pending) return; const a = num($('#grA', s).value.replace(',', '.')), b = num($('#grB', s).value.replace(',', '.')); if (a == null || b == null) { toast('Escribe las dos coordenadas'); return; }
    let lat, lon; try { if (sel.value === 'geo') { lat = a; lon = b; } else [lat, lon] = unproj(a, b, sel.value, $('#grZn', s).value); } catch (e) { toast('Coordenadas inválidas'); return; }
    pts.push({ ...pending, lat, lon }); pending = null; $('#grForm', s).hidden = true; $('#grA', s).value = ''; $('#grB', s).value = ''; list(); dots();
  };
  $('#grGps', s).onclick = () => { if (!S.pos || !pending) { toast('Sin GPS o sin punto marcado'); return; } pts.push({ ...pending, lat: S.pos.lat, lon: S.pos.lon }); pending = null; $('#grForm', s).hidden = true; list(); dots(); };
  img.onload = dots;
  $('#grSave', s).onclick = async () => { try { const it = await saveRaster(canvas, name, pts, 'manual'); closeSheet(); showPanel('map'); fitItem(it); toast(`Capa «${name}» guardada`); } catch (e) { toast(e.message); } };
}

/* Entrada de archivos */
$('#fileImport').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  const ext = f => f.name.split('.').pop().toLowerCase();
  try {
    // shapefile en archivos sueltos (.shp + .dbf + .prj + .cpg)
    if (files.some(f => ext(f) === 'shp')) {
      const parts = {}; for (const f of files) if (['shp', 'dbf', 'prj', 'cpg'].includes(ext(f))) parts[f.name] = new Uint8Array(await f.arrayBuffer());
      if (!files.some(f => ext(f) === 'prj')) toast('Sin .prj: te preguntaré el sistema de coordenadas', null, null, 2500);
      for (const [nm, set] of groupShp(parts)) { const gj = await parseShapefile(set, nm); if (gj) { const l = await addVectorLayer(gj, nm.split('/').pop()); showPanel('map'); fitItem(l); toast(`Shapefile «${l.name}»: ${gj.features.length} elementos`); } }
      if (!files.some(f => ext(f) === 'dbf')) toast('Importado sin .dbf: no habrá atributos. Selecciona .shp, .dbf y .prj juntos.', null, null, 6000);
      return;
    }
    for (const f of files) {
      const x = ext(f), name = f.name.replace(/\.[^.]+$/, '');
      if (x === 'pdf') { await importPdf(f); continue; }
      if (['jpg', 'jpeg', 'png', 'webp'].includes(x)) { await importImage(f); continue; }
      if (x === 'zip' || x === 'kmz') {
        const z = await unzip(new Uint8Array(await f.arrayBuffer())), sets = groupShp(z);
        if (sets.length) { for (const [nm, set] of sets) { const gj = await parseShapefile(set, nm); if (gj) { const l = await addVectorLayer(gj, nm.split('/').pop()); fitItem(l); toast(`Shapefile «${l.name}»: ${gj.features.length} elementos`); } } showPanel('map'); continue; }
        const kmlName = Object.keys(z).find(n => /doc\.kml$/i.test(n)) || Object.keys(z).find(n => /\.kml$/i.test(n));
        if (kmlName) { const l = await addVectorLayer(kmlToGeo(new TextDecoder().decode(z[kmlName])), name); showPanel('map'); fitItem(l); toast(`«${name}» importado`); continue; }
        const gjName = Object.keys(z).find(n => /\.(geo)?json$/i.test(n));
        if (gjName) { const l = await addVectorLayer(JSON.parse(new TextDecoder().decode(z[gjName])), name); showPanel('map'); fitItem(l); continue; }
        throw new Error('El ZIP no tiene .shp, .kml ni GeoJSON');
      }
      const txt = await f.text();
      if (x === 'json' || x === 'geojson') {
        const o = JSON.parse(txt); if (o.app === 'FabianApp') { await restoreBackup(o); continue; }
        const b = gjBBox(o); if (!looksGeo(b)) { const c = await pickCrs(`«${name}»`, b); if (!c) continue; reprojectGJ(o, c.crs, c.zone); }
        const l = await addVectorLayer(o, name); showPanel('map'); fitItem(l); toast(`«${name}»: ${o.features?.length || 1} elementos`); continue;
      }
      if (x === 'kml') { const l = await addVectorLayer(kmlToGeo(txt), name); showPanel('map'); fitItem(l); toast(`«${name}» importado`); continue; }
      if (x === 'gpx') { const l = await addVectorLayer(gpxToGeo(txt), name); showPanel('map'); fitItem(l); toast(`«${name}» importado`); continue; }
      toast(`Formato .${x} no soportado`);
    }
  } catch (er) { console.warn(er); toast('No se pudo importar: ' + (er.message || 'archivo dañado o formato no soportado'), null, null, 6000); }
};


/* ---------- Exportar ---------- */
const safe = s => String(s).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_') || 'export';
const stamp = () => new Date().toISOString().slice(0, 10);
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const s = openSheet(`<div class="sheet-head"><h2>${esc(name)}</h2><button class="btn ghost small" data-close>Cerrar</button></div><p class="sub">${(blob.size / 1024).toFixed(1)} KB listo.</p><div class="btns"><button class="btn" id="xDl">Guardar en Descargas</button>${navigator.canShare && navigator.canShare({ files: [file] }) ? '<button class="btn ghost" id="xSh">Compartir (WhatsApp, correo, Drive…)</button>' : ''}</div>`);
  $('#xDl', s).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast('Archivo guardado'); };
  const sh = $('#xSh', s); if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file], title: name }); } catch (e) { } };
}
function csv(rows) {
  const es = S.set.csv === 'es', sep = es ? ';' : ',';
  const cell = v => { if (v == null) return ''; if (typeof v === 'number') return es ? String(v).replace('.', ',') : String(v); v = String(v); return /[";,\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return '﻿' + rows.map(r => r.map(cell).join(sep)).join('\r\n');
}
const ld = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' '); };
const r6 = v => v == null ? null : +(+v).toFixed(7), r2 = v => v == null ? null : +(+v).toFixed(2);
function cposCols(lat, lon) {
  if (lat == null) return [null, null, null, null, null, null, null];
  const u = proj(lat, lon, 'utm'), c = proj(lat, lon, 'ctm12');
  return [r6(lat), r6(lon), u.zone, r2(u.x), r2(u.y), r2(c.x), r2(c.y)];
}
const CH = ['latitud', 'longitud', 'utm_zona', 'utm_este', 'utm_norte', 'ctm12_este', 'ctm12_norte'];
function exportStationsCsv() {
  const rows = [['proyecto', 'estacion', 'fecha', ...CH, 'altura_m', 'precision_m', 'litologia', 'alteracion', 'mineralizacion', 'ganga', 'textura', 'descripcion', 'n_estructuras', 'n_muestras', 'n_fotos']];
  stations().forEach(s => rows.push([S.project.name, s.code, ld(s.date), ...cposCols(s.lat, s.lon), s.alt == null ? null : r2(elev(s.alt)), s.acc == null ? null : r2(s.acc), s.litho, (s.alter || []).join(' | '), (s.miner || []).join(' | '), (s.ganga || []).join(' | '), (s.texture || []).join(' | '), s.desc, (s.structs || []).length, (s.samples || []).length, (s.photos || []).length]));
  return csv(rows);
}
function exportStructCsv() {
  const rows = [['proyecto', 'estacion', 'tipo', 'clase', 'dir_buzamiento_o_trend', 'buzamiento_o_plunge', 'rumbo_rhr', 'notacion_cuadrante', 'espesor_cm', 'metodo', 'declinacion_aplicada', 'nota', 'fecha', ...CH]];
  stations().forEach(s => (s.structs || []).forEach(x => rows.push([S.project.name, s.code, x.kind, isLine(x.kind) ? 'linea' : 'plano', x.dipDir, x.dip, isLine(x.kind) ? null : Math.round(norm360(x.dipDir - 90)), isLine(x.kind) ? null : fmtStruct(x, 'quad'), x.thick, x.method, x.method === 'Brújula FabianApp' ? decl() : null, x.note, ld(x.date), ...cposCols(s.lat, s.lon)])));
  return csv(rows);
}
function exportSamplesCsv() {
  const rows = [['proyecto', 'muestra', 'estacion', 'tipo', 'control_qaqc', 'referencia', 'longitud_m', 'peso_kg', 'descripcion', 'fecha', ...CH, 'litologia_estacion']];
  stations().forEach(s => (s.samples || []).forEach(m => rows.push([S.project.name, m.code, s.code, m.kind, m.qc, m.ref, num(String(m.len).replace(',', '.')), num(String(m.wt).replace(',', '.')), m.desc, ld(m.date), ...cposCols(s.lat, s.lon), s.litho])));
  return csv(rows);
}
const xe = v => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function geojsonAll() {
  const F = [];
  stations().forEach(s => {
    if (s.lat == null) return; const pt = { type: 'Point', coordinates: [r6(s.lon), r6(s.lat)] };
    F.push({ type: 'Feature', geometry: pt, properties: { capa: 'estacion', codigo: s.code, fecha: s.date, altura_m: s.alt == null ? null : r2(elev(s.alt)), litologia: s.litho, alteracion: (s.alter || []).join(', '), mineralizacion: (s.miner || []).join(', '), ganga: (s.ganga || []).join(', '), textura: (s.texture || []).join(', '), descripcion: s.desc, muestras: (s.samples || []).map(m => m.code).join(', ') } });
    (s.structs || []).forEach(x => F.push({ type: 'Feature', geometry: pt, properties: { capa: 'estructura', estacion: s.code, tipo: x.kind, dir_buz: x.dipDir, buz: x.dip, rumbo_rhr: isLine(x.kind) ? null : Math.round(norm360(x.dipDir - 90)), espesor_cm: x.thick, nota: x.note } }));
    (s.samples || []).forEach(m => F.push({ type: 'Feature', geometry: pt, properties: { capa: 'muestra', codigo: m.code, estacion: s.code, tipo: m.kind, qaqc: m.qc, referencia: m.ref, longitud_m: m.len, peso_kg: m.wt, descripcion: m.desc } }));
  });
  tracks().forEach(t => F.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.pts.map(p => p[2] == null ? [p[1], p[0]] : [p[1], p[0], r2(elev(p[2]))]) }, properties: { capa: 'track', nombre: t.name, fecha: t.date, distancia_m: r2(t.dist) } }));
  S.items.filter(i => i.type === 'measure' && i.projectId === S.project.id).forEach(m => F.push({ type: 'Feature', geometry: m.area ? { type: 'Polygon', coordinates: [[...m.pts, m.pts[0]].map(p => [p[1], p[0]])] } : { type: 'LineString', coordinates: m.pts.map(p => [p[1], p[0]]) }, properties: { capa: 'medicion', nombre: m.name, distancia_m: r2(m.dist), area_m2: r2(m.area) } }));
  return JSON.stringify({ type: 'FeatureCollection', name: S.project.name, features: F }, null, 1);
}
function kmlAll() {
  const st = stations(), pm = [];
  const desc = s => `<table>${[['Fecha', fmtDate(s.date)], ['CTM12', fmtCoord(s.lat, s.lon, 'ctm12')], ['Litología', s.litho], ['Alteración', (s.alter || []).join(', ')], ['Mineralización', (s.miner || []).join(', ')], ['Textura', (s.texture || []).join(', ')], ['Estructuras', (s.structs || []).map(x => x.kind + ' ' + fmtStruct(x)).join('; ')], ['Muestras', (s.samples || []).map(m => m.code).join(', ')], ['Notas', s.desc]].filter(r => r[1]).map(r => `<tr><td><b>${xe(r[0])}</b></td><td>${xe(r[1])}</td></tr>`).join('')}</table>`;
  const stK = st.filter(s => s.lat != null).map(s => `<Placemark><name>${xe(s.code)}</name><styleUrl>#st</styleUrl><description><![CDATA[${desc(s)}]]></description><Point><coordinates>${r6(s.lon)},${r6(s.lat)}${s.alt != null ? ',' + r2(elev(s.alt)) : ''}</coordinates></Point></Placemark>`).join('');
  const sy = st.filter(s => s.lat != null).flatMap(s => (s.structs || []).map(x => `<Placemark><name>${xe(fmtStruct(x))}</name><description>${xe(s.code + ' · ' + x.kind + (x.note ? ' · ' + x.note : ''))}</description><Style><IconStyle><heading>${x.dipDir}</heading><Icon><href>http://maps.google.com/mapfiles/kml/shapes/arrow.png</href></Icon></IconStyle></Style><Point><coordinates>${r6(s.lon)},${r6(s.lat)}</coordinates></Point></Placemark>`)).join('');
  const sm = st.filter(s => s.lat != null).flatMap(s => (s.samples || []).map(m => `<Placemark><name>${xe(m.code)}</name><styleUrl>#sm</styleUrl><description>${xe(`${s.code} · ${m.kind} · ${m.qc}${m.desc ? ' · ' + m.desc : ''}`)}</description><Point><coordinates>${r6(s.lon)},${r6(s.lat)}</coordinates></Point></Placemark>`)).join('');
  const tr = tracks().map(t => `<Placemark><name>${xe(t.name)}</name><styleUrl>#tr</styleUrl><LineString><tessellate>1</tessellate><coordinates>${t.pts.map(p => `${p[1]},${p[0]}`).join(' ')}</coordinates></LineString></Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xe(S.project.name)} — FabianApp</name>
<Style id="st"><IconStyle><color>ff2055b2</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="sm"><IconStyle><color>ff1c97c9</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>
<Style id="tr"><LineStyle><color>ff2055b2</color><width>3</width></LineStyle></Style>
<Folder><name>Estaciones</name>${stK}</Folder><Folder><name>Datos estructurales</name>${sy}</Folder><Folder><name>Muestras</name>${sm}</Folder><Folder><name>Tracks</name>${tr}</Folder></Document></kml>`;
}
function gpx(sts, trs) {
  const w = sts.filter(s => s.lat != null).map(s => `<wpt lat="${r6(s.lat)}" lon="${r6(s.lon)}">${s.alt != null ? `<ele>${r2(s.alt)}</ele>` : ''}<time>${s.date}</time><name>${xe(s.code)}</name><desc>${xe(s.litho)}</desc></wpt>`).join('\n');
  const t = trs.map(t => `<trk><name>${xe(t.name)}</name><trkseg>${t.pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}${p[3] ? `<time>${new Date(p[3]).toISOString()}</time>` : ''}</trkpt>`).join('')}</trkseg></trk>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FabianApp" xmlns="http://www.topografix.com/GPX/1/1">\n${w}\n${t}\n</gpx>`;
}
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function backup() {
  toast('Preparando respaldo…');
  const projects = await DB.all('projects'), items = await DB.all('items'), photos = [];
  for (const ph of await DB.all('photos')) photos.push({ id: ph.id, stationId: ph.stationId, name: ph.name, data: await blobToData(ph.blob) });
  const rasters = []; for (const r of await DB.all('rasters')) rasters.push({ id: r.id, data: await blobToData(r.blob) });
  const settings = S.set;
  deliver(new Blob([JSON.stringify({ app: 'FabianApp', version: VERSION, exported: new Date().toISOString(), projects, items, photos, rasters, settings })], { type: 'application/json' }), `FabianApp_respaldo_${stamp()}.json`);
}
async function restoreBackup(o) {
  const ok = await dialog({ title: 'Restaurar respaldo', text: `${o.projects?.length || 0} proyecto(s), ${o.items?.length || 0} elementos y ${o.photos?.length || 0} fotos del ${fmtDate(o.exported)}. Se combinan con lo que ya tienes (lo del respaldo reemplaza elementos iguales).`, ok: 'Restaurar' });
  if (!ok) return;
  for (const p of o.projects || []) await DB.put('projects', p);
  for (const i of o.items || []) await DB.put('items', i);
  for (const ph of o.photos || []) { const blob = await (await fetch(ph.data)).blob(); await DB.put('photos', { id: ph.id, stationId: ph.stationId, name: ph.name, blob }); }
  for (const r of o.rasters || []) { const blob = await (await fetch(r.data)).blob(); await DB.put('rasters', { id: r.id, blob }); }
  await loadAll(); renderMapData(); renderMore(); toast('Respaldo restaurado');
}

/* ---------- Panel «Más» ---------- */
async function renderMore() {
  const p = S.project, sts = stations();
  const nS = sts.reduce((t, s) => t + (s.structs || []).length, 0), nM = sts.reduce((t, s) => t + (s.samples || []).length, 0);
  const layers = S.items.filter(i => i.type === 'layer' || i.type === 'raster');
  let est = ''; try { const e = await navigator.storage?.estimate(); if (e) est = `Usado: ${(e.usage / 1048576).toFixed(1)} MB de ${(e.quota / 1073741824).toFixed(1)} GB disponibles.`; } catch (e) { }
  let pers = false; try { pers = await navigator.storage?.persisted?.(); } catch (e) { }
  $('#moreBody').innerHTML = `${installCard()}
  <div class="card"><h3>Proyecto activo: ${esc(p.name)}</h3><p class="sub">${sts.length} estaciones · ${nS} estructuras · ${nM} muestras · ${tracks().length} tracks</p>
    <div class="grid2"><label class="f"><span>Prefijo de estaciones</span><input id="mStP" value="${esc(p.stPrefix)}"></label><label class="f"><span>Prefijo de muestras</span><input id="mSmP" value="${esc(p.smPrefix)}"></label></div>
    <p class="note">Próximos códigos: ${esc(nextCode(p.stPrefix, p.stCount, 3))} y ${esc(nextCode(p.smPrefix, p.smCount, 4))}</p>
    <div class="sublist">${S.projects.map(x => `<button class="subitem" data-p="${esc(x.id)}"><span class="grow">${esc(x.name)}</span>${x.id === p.id ? '<b style="color:var(--cu)">Activo</b>' : '<span class="sub">Abrir</span>'}</button>`).join('')}</div>
    <div class="btns"><button class="btn small" id="mNewP">Nuevo proyecto</button><button class="btn small ghost" id="mRenP">Renombrar</button>${S.projects.length > 1 ? '<button class="btn small danger" id="mDelP">Eliminar proyecto</button>' : ''}</div></div>
  <div class="card"><h3>Exportar «${esc(p.name)}»</h3><p class="sub">Coordenadas en WGS84, UTM y CTM12 en cada fila.</p>
    <div class="btns"><button class="btn small" data-x="st">Estaciones CSV</button><button class="btn small" data-x="sy">Estructuras CSV</button><button class="btn small" data-x="sm">Muestras CSV</button><button class="btn small ghost" data-x="kml">KML (Google Earth)</button><button class="btn small ghost" data-x="gj">GeoJSON (ArcGIS/QGIS)</button><button class="btn small ghost" data-x="gpx">GPX</button></div></div>
  <div class="card"><h3>Capas importadas</h3><p class="sub">Shapefile (.zip, o .shp + .dbf + .prj juntos), PDF georreferenciado, KML/KMZ, GPX, GeoJSON o una imagen para georreferenciar a mano: planchas, título minero, sondajes, puntos planeados…</p>
    <div class="sublist">${layers.map(l => `<div class="subitem"><span class="grow">${esc(l.name)}<br><span class="sub">${l.type === 'raster' ? (l.src === 'GeoPDF' ? 'PDF georreferenciado' : 'Georreferenciado a mano') + (l.rms != null ? ` · error ${fx(l.rms, 1)} m` : '') : `${l.geojson?.features?.length ?? 1} elementos`}</span></span><button class="btn small ghost" data-lz="${esc(l.id)}">Ver</button><button class="btn small danger" data-ld="${esc(l.id)}">Quitar</button></div>`).join('') || '<p class="note">Ninguna todavía.</p>'}</div>
    <div class="btns"><button class="btn small" id="mImp">Importar archivo</button></div></div>
  <div class="card"><h3>Respaldo</h3><p class="sub">Todo queda guardado solo en este teléfono. Haz un respaldo al terminar cada salida de campo.</p>
    <div class="btns"><button class="btn small" id="mBak">Crear respaldo completo (con fotos)</button><button class="btn small ghost" id="mRes">Restaurar respaldo</button></div>
    <p class="note">${esc(est)} ${pers ? 'Almacenamiento protegido contra borrado automático.' : 'Almacenamiento no protegido todavía: instala la app para protegerlo.'}</p></div>
  <div class="card"><h3>Ajustes</h3>
    <label class="f"><span>Coordenadas en pantalla</span><select id="aCrs">${CRS.map(c => `<option value="${c.id}"${c.id === S.set.crs ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Notación de planos</span><select id="aFmt">${[['dd', 'Dirección de buzamiento / Buzamiento (120/35)'], ['rhr', 'Rumbo regla mano derecha / Buzamiento (030/35)'], ['quad', 'Cuadrante (N30E/35SE)']].map(([v, t]) => `<option value="${v}"${v === S.set.fmt ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <div class="grid2"><label class="f"><span>Declinación magnética (°, Este +, Oeste −)</span><input id="aDecl" inputmode="decimal" value="${esc(S.set.decl)}"></label>
    <label class="f"><span>Ondulación del geoide N (m)</span><input id="aGeo" inputmode="decimal" value="${esc(S.set.geoid)}"></label></div>
    <p class="note">La declinación se suma a las lecturas de la brújula del teléfono (consúltala para tu zona y fecha en el calculador de NOAA). El GPS da altura elipsoidal; escribe N de tu zona (modelo EGM2008 o GEOCOL) para mostrar alturas sobre el nivel del mar.</p>
    <label class="f"><span>Formato CSV</span><select id="aCsv"><option value="intl"${S.set.csv === 'intl' ? ' selected' : ''}>Internacional (coma y punto decimal)</option><option value="es"${S.set.csv === 'es' ? ' selected' : ''}>Excel en español (punto y coma y coma decimal)</option></select></label>
    <label class="f"><span>Tema</span><select id="aTheme"><option value="auto">Automático</option><option value="light">Claro (mejor al sol)</option><option value="dark">Oscuro</option></select></label>
    <div class="btns"><button class="btn small ghost" id="aClr">Borrar mapas guardados</button></div></div>
  <div class="card"><h3>Acerca de FabianApp ${VERSION}</h3><p class="sub">Libreta de campo geológica para exploración: estaciones, estructuras, muestras y tracks, con mapas sin señal. Hecha para Fabián Andrés Rosado. Tus datos nunca salen del teléfono salvo cuando tú exportas.</p>
    <p class="note">Usa Leaflet (BSD-2), proj4js (MIT) y teselas de OpenTopoMap, OpenStreetMap y Esri, cada una con su atribución en el mapa. Las lecturas de brújula dependen de la calibración del magnetómetro: compara de vez en cuando con tu Brunton.</p></div>`;
  const b = $('#moreBody');
  const mi = $('#mInst', b); if (mi) mi.onclick = doInstall;
  $('#mStP', b).onchange = async e => { p.stPrefix = e.target.value; await saveProject(); renderMore(); };
  $('#mSmP', b).onchange = async e => { p.smPrefix = e.target.value; await saveProject(); renderMore(); };
  $$('[data-p]', b).forEach(x => x.onclick = async () => { if (x.dataset.p === p.id) return; await DB.put('kv', x.dataset.p, 'active'); await loadAll(); renderMapData(); renderMore(); toast(`Proyecto «${S.project.name}» abierto`); const s = stations().filter(s => s.lat != null); if (s.length) map.fitBounds(L.latLngBounds(s.map(q => [q.lat, q.lon])), { padding: [40, 40], maxZoom: 16 }); });
  $('#mNewP', b).onclick = async () => { const n = await dialog({ title: 'Nuevo proyecto', input: '', ok: 'Crear' }); if (!n) return; const np = newProject(n); await DB.put('projects', np); await DB.put('kv', np.id, 'active'); await loadAll(); renderMapData(); renderMore(); };
  $('#mRenP', b).onclick = async () => { const n = await dialog({ title: 'Renombrar proyecto', input: p.name, ok: 'Guardar' }); if (!n) return; p.name = n; await saveProject(); S.projects = await DB.all('projects'); renderMore(); };
  const del = $('#mDelP', b); if (del) del.onclick = async () => {
    if (!await dialog({ title: `Eliminar «${p.name}»`, text: 'Se borran todas sus estaciones, muestras, tracks y fotos. Esto no se puede deshacer. Haz un respaldo antes.', ok: 'Eliminar todo', danger: true })) return;
    const all = await DB.all('items'); for (const i of all.filter(i => i.projectId === p.id)) { for (const ph of i.photos || []) await DB.del('photos', ph); await DB.del('items', i.id); }
    await DB.del('projects', p.id); await DB.del('kv', 'active'); await loadAll(); renderMapData(); renderMore(); toast('Proyecto eliminado');
  };
  $$('[data-x]', b).forEach(x => x.onclick = () => {
    const n = safe(p.name) + '_' + stamp(), k = x.dataset.x;
    if (k === 'st') deliver(new Blob([exportStationsCsv()], { type: 'text/csv' }), n + '_estaciones.csv');
    if (k === 'sy') deliver(new Blob([exportStructCsv()], { type: 'text/csv' }), n + '_estructuras.csv');
    if (k === 'sm') deliver(new Blob([exportSamplesCsv()], { type: 'text/csv' }), n + '_muestras.csv');
    if (k === 'kml') deliver(new Blob([kmlAll()], { type: 'application/vnd.google-earth.kml+xml' }), n + '.kml');
    if (k === 'gj') deliver(new Blob([geojsonAll()], { type: 'application/geo+json' }), n + '.geojson');
    if (k === 'gpx') deliver(new Blob([gpx(stations(), tracks())], { type: 'application/gpx+xml' }), n + '.gpx');
  });
  $$('[data-lz]', b).forEach(x => x.onclick = () => { const l = S.items.find(i => i.id === x.dataset.lz); showPanel('map'); fitItem(l); });
  $$('[data-ld]', b).forEach(x => x.onclick = () => { const l = S.items.find(i => i.id === x.dataset.ld); removeItem(l, 'Capa'); });
  $('#mImp', b).onclick = $('#mRes', b).onclick = () => { const f = $('#fileImport'); f.value = ''; f.click(); };
  $('#mBak', b).onclick = backup;
  $('#aCrs', b).onchange = e => { S.set.crs = e.target.value; saveSettings(); updateHud(); };
  $('#aFmt', b).onchange = e => { S.set.fmt = e.target.value; saveSettings(); };
  $('#aDecl', b).onchange = e => { const v = num(e.target.value.replace(',', '.')); S.set.decl = v == null ? 0 : Math.max(-30, Math.min(30, v)); saveSettings(); updateCompassHeader(); };
  $('#aGeo', b).onchange = e => { const v = num(e.target.value.replace(',', '.')); S.set.geoid = v ?? 0; saveSettings(); updateHud(); };
  $('#aCsv', b).onchange = e => { S.set.csv = e.target.value; saveSettings(); };
  $('#aTheme', b).value = S.set.theme; $('#aTheme', b).onchange = e => { S.set.theme = e.target.value; applyTheme(); saveSettings(); };
  $('#aClr', b).onclick = async () => { if (!await dialog({ title: 'Borrar mapas guardados', text: 'Se eliminan las teselas guardadas para uso sin señal. Tus datos no se tocan.', ok: 'Borrar', danger: true })) return; try { await caches.delete('fabianapp-tiles'); toast('Mapas guardados borrados'); } catch (e) { } renderMore(); };
}
function applyTheme() { const t = S.set.theme; if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; }


/* ---------- Instalar en el celular ---------- */
let installEvt = null, installedHere = false;
const UA = navigator.userAgent;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(UA);
const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|WhatsApp|MicroMessenger|; wv\)|GSA\//i.test(UA);
const isSamsung = /SamsungBrowser/i.test(UA);
const isFirefox = /Firefox|FxiOS/i.test(UA);
const isMobile = isIOS || isAndroid;
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (installedHere) { installedHere = false; DB.put('kv', false, 'installedHere').catch(() => { }); } updateInstallUi(); });
window.addEventListener('appinstalled', () => { installEvt = null; markInstalled(); toast('FabianApp quedó instalada: búscala en tu pantalla de inicio', null, null, 6000); });
let installDismissed = false;
function updateInstallUi() {
  const show = !isStandalone() && !installDismissed && !installedHere && location.protocol.startsWith('http') && (installEvt || isMobile);
  $('#installBar').hidden = !show;
  if (S.panel === 'more') renderMore();
}
$('#instBtn').onclick = () => doInstall();
$('#instX').onclick = () => { installDismissed = true; $('#installBar').hidden = true; DB.put('kv', Date.now(), 'installDismissed').catch(() => { }); toast('Puedes instalarla cuando quieras desde Más', null, null, 3000); };
async function doInstall() {
  if (isStandalone()) { toast('Ya estás usando FabianApp instalada'); return; }
  if (installEvt) {
    const e = installEvt; installEvt = null;
    try { await e.prompt(); const r = await e.userChoice; if (r.outcome === 'accepted') { markInstalled(); toast('Instalando FabianApp… ábrela desde el ícono de tu pantalla de inicio', null, null, 6000); } else toast('Instalación cancelada. Puedes hacerlo luego desde Más'); }
    catch (er) { installHelp(); }
    updateInstallUi(); return;
  }
  installHelp();
}
function markInstalled() { installedHere = true; DB.put('kv', true, 'installedHere').catch(() => { }); updateInstallUi(); }
async function installHelp() {
  const url = appUrl();
  let body = '';
  if (!isMobile) {
    let qr = '';
    try { if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.append(s); }); const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { }
    body = `<p class="sub">Estás en un computador. FabianApp está hecha para el celular (GPS y brújula).</p>
      ${qr ? `<div class="qr">${qr}</div>` : ''}
      <ol class="steps"><li>Abre la <b>cámara</b> del celular y apunta a este código.</li><li>Toca el enlace que aparece; se abre en <b>Chrome</b>.</li><li>En el celular toca <b>Instalar</b> en el aviso de FabianApp.</li></ol>`;
  } else if (inAppBrowser) {
    body = `<p class="sub">Abriste el enlace dentro de otra app (WhatsApp, Instagram, Facebook…). Desde ahí no se puede instalar.</p>
      <ol class="steps"><li>Toca <span class="kbd">⋮</span> arriba a la derecha.</li><li>Elige <b>«Abrir en Chrome»</b> (o «Abrir en el navegador»).</li><li>En Chrome, toca <b>Instalar</b> en el aviso de FabianApp.</li></ol>`;
  } else if (isIOS) {
    body = `<ol class="steps"><li>Abre esta página en <b>Safari</b>.</li><li>Toca el botón <b>Compartir</b> <span class="kbd">⬆︎</span> (abajo en el centro).</li><li>Baja y toca <b>«Agregar a inicio»</b> → <b>Agregar</b>.</li></ol><p class="note">En iPhone la brújula pide permiso la primera vez que la usas.</p>`;
  } else if (isSamsung) {
    body = `<ol class="steps"><li>Toca el menú <span class="kbd">☰</span> abajo a la derecha.</li><li>Elige <b>«Añadir página a»</b> → <b>«Pantalla de inicio»</b>.</li><li>Confirma con <b>Añadir</b>.</li></ol><p class="note">Con Chrome la instalación es más completa: si lo tienes, abre allí este enlace.</p>`;
  } else if (isFirefox) {
    body = `<ol class="steps"><li>Toca <span class="kbd">⋮</span>.</li><li>Elige <b>«Instalar»</b> o <b>«Añadir a la pantalla de inicio»</b>.</li></ol>`;
  } else {
    body = `<ol class="steps"><li>Toca <span class="kbd">⋮</span> arriba a la derecha de Chrome.</li><li>Elige <b>«Instalar aplicación»</b> o <b>«Agregar a la pantalla principal»</b>.</li><li>Confirma con <b>Instalar</b>.</li></ol>
      <p class="note">Si no aparece la opción: recarga la página una vez y espera unos segundos. Si ya la instalaste antes, búscala en tus aplicaciones como «FabianApp».</p>`;
  }
  const s = openSheet(`<div class="sheet-head"><h2>Instalar FabianApp</h2><button class="btn ghost small" data-close>Cerrar</button></div>${body}
    <div class="card" style="margin-top:14px"><span class="sub">Dirección de la app</span><div style="overflow-wrap:anywhere;font-weight:600">${esc(url)}</div><div class="btns"><button class="btn small ghost" id="instCopy">Copiar enlace</button>${navigator.share ? '<button class="btn small ghost" id="instShare">Compartir enlace</button>' : ''}</div></div>`);
  $('#instCopy', s).onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (e) { toast('No se pudo copiar; mantén presionada la dirección'); } };
  const sh = $('#instShare', s); if (sh) sh.onclick = () => navigator.share({ title: 'FabianApp', url }).catch(() => { });
}
function installCard() {
  if (!location.protocol.startsWith('http')) return '';
  if (installedHere && !isStandalone() && !installEvt) return `<div class="card"><h3>FabianApp ya está instalada ✓</h3><p class="sub">Ábrela desde el ícono «FabianApp» de tu pantalla de inicio: ahí funciona a pantalla completa y sin señal.</p><div class="btns"><button class="btn small ghost" id="mInst">Ver cómo instalar en otro equipo</button></div></div>`;
  if (isStandalone()) return `<div class="card"><h3>FabianApp instalada ✓</h3><p class="sub">Estás usando la app instalada. Versión ${VERSION}.</p></div>`;
  return `<div class="card" style="border:2px solid var(--cu)"><h3>Instalar en este ${isMobile ? 'celular' : 'equipo'}</h3><p class="sub">Queda como una app más: ícono en la pantalla de inicio, pantalla completa y funciona sin señal en campo.</p><div class="btns"><button class="btn" id="mInst">${installEvt ? 'Instalar FabianApp' : isMobile ? 'Cómo instalarla' : 'Abrir en el celular (código QR)'}</button></div></div>`;
}

/* ---------- Inicio ---------- */
async function cleanPhotos() {
  try { const items = await DB.all('items'), used = new Set(), ras = new Set(); items.forEach(i => { (i.photos || []).forEach(p => used.add(p)); if (i.blobId) ras.add(i.blobId); }); for (const k of await DB.keys('photos')) if (!used.has(k)) await DB.del('photos', k); for (const k of await DB.keys('rasters')) if (!ras.has(k)) await DB.del('rasters', k); } catch (e) { }
}
async function init() {
  try { await DB.open(); } catch (e) { toast('No se pudo abrir el almacenamiento del navegador'); return; }
  const st = await DB.get('kv', 'settings'); if (st) S.set = { ...DEF, ...st, ov: { ...DEF.ov, ...(st.ov || {}) } };
  applyTheme(); await loadAll(); setBase(S.set.base); renderMapData(); updateHud();
  const pts = stations().filter(s => s.lat != null); if (pts.length) map.fitBounds(L.latLngBounds(pts.map(q => [q.lat, q.lon])), { padding: [50, 50], maxZoom: 16 });
  $('#btnLocate').classList.toggle('on', S.follow);
  startGPS();
  document.addEventListener('pointerdown', function once() { startSensors(); document.removeEventListener('pointerdown', once); }, { once: true });
  const draft = await DB.get('kv', 'recDraft');
  if (draft?.pts?.length) { const ok = await dialog({ title: 'Track sin terminar', text: `Hay una grabación interrumpida con ${draft.pts.length} puntos. ¿Retomarla?`, ok: 'Retomar', cancel: 'Descartar' }); if (ok) { draft.pauseAt = null; startRec(draft); } else DB.del('kv', 'recDraft'); }
  setTimeout(cleanPhotos, 5000);
  const dis = await DB.get('kv', 'installDismissed'); installDismissed = !!dis && Date.now() - dis < 7 * 864e5; installedHere = !!(await DB.get('kv', 'installedHere')); updateInstallUi();
  matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallUi);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
init();
}

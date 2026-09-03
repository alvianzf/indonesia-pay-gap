import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, CATEGORY_LABEL, CATEGORY_ORDER, debounce, el, slugify } from './utils.js';

const COLORS = { below: '#ff3b5c', barely: '#ffc233', moderate: '#2ee673', far: '#29c8ff', nodata: '#4a6157' };

const state = {
  granularity: 'kabupaten',
  search: '',
  provinceFilter: '',
  categoryFilter: '',
  sortKey: 'umk2026',
  sortDir: 'desc',
  page: 1,
  pageSize: 25,
};

let mapInstance = null;
let geoLayer = null;
let charts = [];

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

export async function renderNational(container) {
  destroyCharts();
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  hoveredLayer = null;

  const data = await loadData();
  const { merged } = data;
  const s = merged.summary;

  container.innerHTML = '';

  // ---- methodology banner ----
  const banner = el('div', { class: 'banner' }, [
    el('div', {}, [
      el('strong', {}, '⚠ Data coverage note: '),
      `Income comparison uses province-level average wages (BPS Sakernas), ${s.provincesWithWageData === s.totalProvinces ? `available for all ${s.totalProvinces} provinces` : `available for only ${s.provincesWithWageData}/${s.totalProvinces} provinces`}. No median wage figures exist in the source data at any level, and no wage data exists below the province level — so every kabupaten/kota within a province is compared against the same reference income. `,
      el('button', { class: 'banner-toggle', onclick: (e) => {
        const d = e.target.parentElement.parentElement.querySelector('.banner-details');
        d.hidden = !d.hidden;
        e.target.textContent = d.hidden ? 'Read full methodology' : 'Hide';
      } }, 'Read full methodology'),
    ]),
    el('div', { class: 'banner-details', hidden: '' }, merged.meta.methodology),
  ]);
  container.appendChild(banner);

  // ---- KPI cards ----
  const kpiGrid = el('div', { class: 'kpi-grid' }, [
    kpiCard(s.totalRegions.toLocaleString('id-ID'), 'Kabupaten/kota tracked', ''),
    kpiCard(s.regionsBelowUmk.toLocaleString('id-ID'), 'Below UMK (avg wage < UMK)', 'below'),
    kpiCard(s.regionsBarely.toLocaleString('id-ID'), 'Barely above UMK', 'barely'),
    kpiCard(s.regionsModerate.toLocaleString('id-ID'), 'Moderately above UMK', 'moderate'),
    kpiCard(s.regionsFar.toLocaleString('id-ID'), 'Far above UMK', 'far'),
    kpiCard(s.regionsNoData.toLocaleString('id-ID'), 'No income data (province)', 'nodata'),
  ]);
  container.appendChild(kpiGrid);

  // ---- map + legend layout ----
  const mapPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'map-controls' }, [
      segControl(),
      el('select', { id: 'f-province', onchange: (e) => { state.provinceFilter = e.target.value; state.page = 1; applyFilters(data); recenterMapToFilters(); } }, provinceOptions(merged)),
      el('select', { id: 'f-category', onchange: (e) => { state.categoryFilter = e.target.value; state.page = 1; applyFilters(data); recenterMapToFilters(); } }, categoryOptions()),
    ]),
    el('div', { id: 'map' }),
  ]);

  const legendPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Pay-gap legend'),
    el('div', { class: 'legend-box' }, [
      legendRow('far', 'Far above UMK (≥150% of avg wage)'),
      legendRow('moderate', 'Moderately above UMK (115–150%)'),
      legendRow('barely', 'Barely above UMK (100–115%)'),
      legendRow('below', 'Below UMK (avg wage < UMK)'),
      legendRow('nodata', 'No province wage data'),
    ]),
    el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin-top:10px' },
      'Color = province avg. wage ÷ local UMK. Hover a region for exact figures; click to open its detail page.'),
  ]);

  const grid = el('div', { class: 'main-grid' }, [mapPanel, legendPanel]);
  container.appendChild(grid);

  // ---- charts ----
  const chartsPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Analytics'),
    el('div', { class: 'chart-grid' }, [
      el('div', {}, [el('h3', {}, 'UMK 2026 distribution by pay-gap category'), el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-category' }))]),
      el('div', {}, [el('h3', {}, 'Province: avg. wage vs UMP 2026'), el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-province' }))]),
      el('div', {}, [el('h3', {}, 'Highest 10 UMK 2026'), el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-top' }))]),
      el('div', {}, [el('h3', {}, 'Lowest 10 UMK 2026'), el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-bottom' }))]),
    ]),
  ]);
  container.appendChild(chartsPanel);

  // ---- table ----
  const tablePanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'All kabupaten/kota'),
    el('div', { class: 'map-controls' }, [
      el('input', { type: 'text', id: 'f-search', placeholder: 'Search region…', oninput: debounce((e) => { state.search = e.target.value.toLowerCase(); state.page = 1; applyFilters(data); recenterMapToFilters(); }, 200) }),
    ]),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data-table', id: 'main-table' })),
    el('div', { class: 'table-meta', id: 'table-meta' }),
  ]);
  container.appendChild(tablePanel);

  initMap(data);
  initCharts(merged);
  applyFilters(data);
}

function kpiCard(value, label, cls) {
  return el('div', { class: 'kpi-card ' + cls }, [el('div', { class: 'value' }, value), el('div', { class: 'label' }, label)]);
}

function legendRow(cat, label) {
  return el('div', { class: 'legend-row' }, [el('span', { class: 'legend-swatch', style: `background:${COLORS[cat]}` }), label]);
}

function segControl() {
  const wrap = el('div', { class: 'seg' });
  ['kabupaten', 'province'].forEach((g) => {
    const btn = el('button', {
      class: g === state.granularity ? 'active' : '',
      onclick: () => {
        state.granularity = g;
        wrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        refreshMapLayer();
      },
    }, g === 'kabupaten' ? 'Kabupaten/Kota' : 'Province');
    wrap.appendChild(btn);
  });
  return wrap;
}

function provinceOptions(merged) {
  const opts = [el('option', { value: '' }, 'All provinces')];
  [...merged.provinces].sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => opts.push(el('option', { value: p.id }, p.name)));
  return opts;
}

function categoryOptions() {
  const opts = [el('option', { value: '' }, 'All categories')];
  CATEGORY_ORDER.forEach((c) => opts.push(el('option', { value: c }, CATEGORY_LABEL[c])));
  return opts;
}

// ---------------- MAP ----------------
let dataRef = null;
let hoveredLayer = null;

function clearHover() {
  if (hoveredLayer) {
    hoveredLayer.setStyle(computeStyle(hoveredLayer.feature.properties, state.granularity === 'kabupaten'));
    hoveredLayer.closeTooltip();
    hoveredLayer = null;
  }
}

function initMap(data) {
  dataRef = data;
  mapInstance = L.map('map', { scrollWheelZoom: true }).setView([-2.3, 118], 5);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri', maxZoom: 16,
  }).addTo(mapInstance);
  // fast pointer movement can skip a layer's own mouseout (leaving the map
  // entirely, or crossing straight from one tiny polygon into another) -
  // these two catch-alls guarantee any stuck highlight/tooltip gets cleared.
  mapInstance.on('mouseout', clearHover);
  mapInstance.getContainer().addEventListener('mouseleave', clearHover);
  refreshMapLayer();
}

function styleFeature(props) {
  return {
    fillColor: COLORS[props.category] || COLORS.nodata,
    weight: 0.6,
    color: '#03110a',
    fillOpacity: 0.8,
  };
}

function hasActiveFilters() {
  return !!(state.provinceFilter || state.categoryFilter || state.search);
}

function matchesFilters(props, isKab) {
  if (state.categoryFilter && props.category !== state.categoryFilter) return false;
  if (state.provinceFilter) {
    const pid = isKab ? props.provinceId : props.id;
    if (pid !== state.provinceFilter) return false;
  }
  if (state.search) {
    const nameMatch = props.name.toLowerCase().includes(state.search);
    const provMatch = isKab && props.provinceName && props.provinceName.toLowerCase().includes(state.search);
    if (!nameMatch && !provMatch) return false;
  }
  return true;
}

function computeStyle(props, isKab) {
  const base = styleFeature(props);
  if (!hasActiveFilters()) return base;
  if (matchesFilters(props, isKab)) return { ...base, weight: 1.4, color: '#39ff8f' };
  return { ...base, fillOpacity: 0.07, color: '#0f1f16', weight: 0.3 };
}

function refreshMapHighlight() {
  if (!geoLayer) return;
  const isKab = state.granularity === 'kabupaten';
  geoLayer.eachLayer((layer) => {
    if (layer === hoveredLayer) return;
    layer.setStyle(computeStyle(layer.feature.properties, isKab));
  });
}

function recenterMapToFilters() {
  if (!mapInstance || !geoLayer) return;
  if (!hasActiveFilters()) {
    mapInstance.setView([-2.3, 118], 5);
    return;
  }
  const isKab = state.granularity === 'kabupaten';
  const matched = [];
  geoLayer.eachLayer((layer) => {
    if (matchesFilters(layer.feature.properties, isKab)) matched.push(layer);
  });
  if (!matched.length) return;
  mapInstance.fitBounds(L.featureGroup(matched).getBounds(), { padding: [24, 24], maxZoom: 11 });
}

function refreshMapLayer() {
  if (!mapInstance || !dataRef) return;
  hoveredLayer = null;
  if (geoLayer) { mapInstance.removeLayer(geoLayer); geoLayer = null; }
  const geo = state.granularity === 'kabupaten' ? dataRef.geoKab : dataRef.geoProv;
  const isKabLayer = state.granularity === 'kabupaten';

  geoLayer = L.geoJSON(geo, {
    style: (f) => computeStyle(f.properties, isKabLayer),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const isKab = state.granularity === 'kabupaten';
      const umkLabel = isKab ? (p.usesUmpFallback ? 'UMP (no separate UMK)' : 'UMK 2026') : 'UMP 2026';
      const ratioTxt = p.ratio !== null && p.ratio !== undefined ? pct(p.ratio) : 'n/a';
      const tip = `
        <div class="tip-title">${p.name}</div>
        ${isKab ? `<div class="tip-row"><span>Province</span><strong>${p.provinceName}</strong></div>` : ''}
        <div class="tip-row"><span>${umkLabel}</span><strong>${rupiah(p.umk2026 ?? p.ump2026)}</strong></div>
        <div class="tip-row"><span>Avg wage / UMK</span><strong>${ratioTxt}</strong></div>
        <div class="tip-row"><span>Category</span><strong>${CATEGORY_LABEL[p.category]}</strong></div>
      `;
      layer.bindTooltip(tip, { className: 'paygap-tip', sticky: true });
      layer.on('mouseover', () => {
        clearHover();
        layer.setStyle({ weight: 2, color: '#39ff8f' });
        hoveredLayer = layer;
      });
      layer.on('mouseout', () => {
        layer.setStyle(computeStyle(p, isKab));
        layer.closeTooltip();
        if (hoveredLayer === layer) hoveredLayer = null;
      });
      layer.on('click', () => {
        if (isKab) {
          window.location.hash = '#/region/' + p.id;
        } else {
          mapInstance.fitBounds(layer.getBounds());
          state.granularity = 'kabupaten';
          document.querySelectorAll('.seg button').forEach((b, i) => b.classList.toggle('active', i === 0));
          refreshMapLayer();
          state.provinceFilter = p.id;
          document.getElementById('f-province').value = p.id;
          applyFilters(dataRef);
        }
      });
    },
  }).addTo(mapInstance);
}

// ---------------- FILTER + TABLE ----------------
function getFilteredRegions(data) {
  let rows = data.merged.regions;
  if (state.provinceFilter) rows = rows.filter((r) => r.provinceId === state.provinceFilter);
  if (state.categoryFilter) rows = rows.filter((r) => r.category === state.categoryFilter);
  if (state.search) rows = rows.filter((r) => r.name.toLowerCase().includes(state.search) || r.provinceName.toLowerCase().includes(state.search));
  rows = [...rows].sort((a, b) => {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const av = a[state.sortKey], bv = b[state.sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  return rows;
}

function applyFilters(data) {
  const rows = getFilteredRegions(data);
  renderTableRows(rows);
  refreshMapHighlight();
}

function sortHeader(label, key) {
  const active = state.sortKey === key;
  const arrow = active ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
  return el('th', { onclick: () => {
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'desc'; }
    applyFilters(dataRef);
  } }, [label, el('span', { class: 'arrow' }, arrow)]);
}

function renderTableRows(rows) {
  const table = document.getElementById('main-table');
  table.innerHTML = '';
  const thead = el('thead', {}, el('tr', {}, [
    sortHeader('Region', 'name'),
    sortHeader('Province', 'provinceName'),
    sortHeader('Type', 'type'),
    sortHeader('UMK/UMP 2026', 'umk2026'),
    sortHeader('Ref. avg wage', 'avgWageRef'),
    sortHeader('Gap ratio', 'ratio'),
    el('th', {}, 'Category'),
  ]));
  table.appendChild(thead);

  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const tbody = el('tbody');
  pageRows.forEach((r) => {
    tbody.appendChild(el('tr', { onclick: () => { window.location.hash = '#/region/' + r.id; } }, [
      el('td', {}, r.name),
      el('td', {}, r.provinceName),
      el('td', {}, r.type),
      el('td', { class: 'num' }, rupiah(r.umk2026)),
      el('td', { class: 'num' }, rupiah(r.avgWageRef)),
      el('td', { class: 'num' }, pct(r.ratio)),
      el('td', {}, el('span', { class: 'badge ' + r.category }, CATEGORY_LABEL[r.category])),
    ]));
  });
  table.appendChild(tbody);

  const meta = document.getElementById('table-meta');
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  meta.innerHTML = '';
  meta.appendChild(el('span', {}, `${rows.length.toLocaleString('id-ID')} regions`));
  meta.appendChild(el('div', { class: 'pagination' }, [
    el('button', { disabled: state.page <= 1 ? 'true' : null, onclick: () => { state.page--; applyFilters(dataRef); } }, 'Prev'),
    el('span', {}, `Page ${state.page} / ${totalPages}`),
    el('button', { disabled: state.page >= totalPages ? 'true' : null, onclick: () => { state.page++; applyFilters(dataRef); } }, 'Next'),
  ]));
}

// ---------------- CHARTS ----------------
function initCharts(merged) {
  const catCounts = CATEGORY_ORDER.map((c) => merged.regions.filter((r) => r.category === c).length);
  charts.push(new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: {
      labels: CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]),
      datasets: [{ data: catCounts, backgroundColor: CATEGORY_ORDER.map((c) => COLORS[c]) }],
    },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } },
  }));

  const provWithWage = merged.provinces.filter((p) => p.avgWage !== null).sort((a, b) => a.ratio - b.ratio);
  charts.push(new Chart(document.getElementById('chart-province'), {
    type: 'bar',
    data: {
      labels: provWithWage.map((p) => p.name),
      datasets: [
        { label: 'UMP 2026', data: provWithWage.map((p) => p.ump2026), backgroundColor: '#4a6157' },
        { label: 'Avg. wage', data: provWithWage.map((p) => p.avgWage), backgroundColor: '#39ff8f' },
      ],
    },
    options: { indexAxis: 'y', scales: { x: { ticks: { callback: (v) => rupiahShort(v) } } }, plugins: { legend: { position: 'bottom' } } },
  }));

  const top10 = [...merged.regions].sort((a, b) => b.umk2026 - a.umk2026).slice(0, 10);
  charts.push(new Chart(document.getElementById('chart-top'), {
    type: 'bar',
    data: { labels: top10.map((r) => r.name), datasets: [{ data: top10.map((r) => r.umk2026), backgroundColor: top10.map((r) => COLORS[r.category]) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => rupiahShort(v) } } } },
  }));

  const bottom10 = [...merged.regions].sort((a, b) => a.umk2026 - b.umk2026).slice(0, 10);
  charts.push(new Chart(document.getElementById('chart-bottom'), {
    type: 'bar',
    data: { labels: bottom10.map((r) => r.name), datasets: [{ data: bottom10.map((r) => r.umk2026), backgroundColor: bottom10.map((r) => COLORS[r.category]) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => rupiahShort(v) } } } },
  }));
}

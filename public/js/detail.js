import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, CATEGORY_LABEL, el } from './utils.js';

const COLORS = { below: '#ff3b5c', barely: '#ffc233', moderate: '#2ee673', far: '#29c8ff', nodata: '#4a6157' };

// Numbeo living-cost data only covers 5 cities; map each to the province whose
// capital it is, so a region's detail page can show the closest available sample.
const PROVINCE_TO_NUMBEO_CITY = {
  'dki-jakarta': 'Jakarta',
  'jawa-timur': 'Surabaya',
  'jawa-barat': 'Bandung',
  'di-yogyakarta': 'Yogyakarta',
  'jawa-tengah': 'Semarang',
};

function khlVerdict(ratio) {
  if (ratio === null) return { label: 'No KHL data', color: COLORS.nodata };
  if (ratio < 1.0) return { label: 'Below decent-living needs', color: COLORS.below };
  if (ratio < 1.15) return { label: 'Just meets it', color: COLORS.barely };
  if (ratio < 1.5) return { label: 'Comfortably covers it', color: COLORS.moderate };
  return { label: 'Well above it', color: COLORS.far };
}

let mapInstance = null;
let charts = [];

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

export async function renderDetail(container, regionId) {
  destroyCharts();
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }

  const data = await loadData();
  const region = data.regionById.get(regionId);
  container.innerHTML = '';

  if (!region) {
    container.appendChild(el('div', { class: 'panel' }, [
      el('h2', {}, 'Region not found'),
      el('a', { href: '#/' }, '← Back to national map'),
    ]));
    return;
  }

  const province = data.provinceById.get(region.provinceId);
  const siblings = (data.regionsByProvince.get(region.provinceId) || []).slice();
  const rankInProvince = [...siblings].sort((a, b) => b.umk2026 - a.umk2026).findIndex((r) => r.id === region.id) + 1;
  const allSorted = [...data.merged.regions].sort((a, b) => b.umk2026 - a.umk2026);
  const nationalRank = allSorted.findIndex((r) => r.id === region.id) + 1;
  const nationalAvgUmk = data.merged.regions.reduce((s, r) => s + r.umk2026, 0) / data.merged.regions.length;

  container.appendChild(el('div', { class: 'breadcrumb' }, [
    el('a', { href: '#/' }, 'Home'),
    ' / ',
    el('a', { href: '#/', onclick: (e) => { e.preventDefault(); window.location.hash = '#/?province=' + region.provinceId; } }, region.provinceName),
    ' / ',
    region.name,
  ]));

  container.appendChild(el('div', { class: 'detail-header' }, [
    el('div', {}, [
      el('h1', {}, region.name),
      el('div', { class: 'sub' }, [
        region.provinceName, ' · ', region.type === 'kota' ? 'Kota' : 'Kabupaten',
        region.usesUmpFallback ? ' · uses provincial UMP (no separate UMK set)' : '',
      ]),
    ]),
    el('span', { class: 'badge ' + region.category }, CATEGORY_LABEL[region.category]),
  ]));

  const umkToKhl = province.khlTotal ? region.umk2026 / province.khlTotal : null;
  const khlVerdictInfo = khlVerdict(umkToKhl);

  const kpiGrid = el('div', { class: 'kpi-grid' }, [
    kpi(rupiah(region.umk2026), region.usesUmpFallback ? 'UMP 2026 (applies here)' : 'UMK 2026'),
    kpi(rupiah(province.ump2026), 'Province UMP 2026'),
    kpi(region.avgWageRef !== null ? rupiah(region.avgWageRef) : 'No data', `Province avg. wage${region.wagePeriod ? ' (' + region.wagePeriod + ')' : ''}`),
    kpi(region.ratio !== null ? pct(region.ratio) : '—', 'Avg wage ÷ UMK'),
    kpi('#' + rankInProvince + ' / ' + siblings.length, 'Rank in province (by UMK)'),
    kpi('#' + nationalRank + ' / ' + allSorted.length, 'National rank (by UMK)'),
    kpi(province.khlTotal !== null ? rupiah(province.khlTotal) : 'No data', 'Province KHL (decent living needs)'),
    kpi(umkToKhl !== null ? pct(umkToKhl) : '—', 'UMK ÷ KHL — ' + khlVerdictInfo.label, khlVerdictInfo.color),
    kpi(province.povertyLine !== null ? rupiah(province.povertyLine) : 'No data', 'Province poverty line (BPS)'),
  ]);
  container.appendChild(kpiGrid);

  const mapPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Location'),
    el('div', { id: 'detail-map' }),
  ]);

  const numbeoCity = PROVINCE_TO_NUMBEO_CITY[region.provinceId];
  const numbeoEntry = numbeoCity ? data.merged.numbeoCities.find((c) => c.city === numbeoCity) : null;

  const chartsCol = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Wage comparison'),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-compare' })),
    ]),
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Cost of living vs. pay (province level)'),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-khl' })),
      el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin:10px 0 0' }, [
        'KHL is Kemnaker\'s official "decent living needs" figure — the same benchmark wage councils use to set minimum wages. ',
        el('a', { href: '#/afford' }, 'Try the Salary Affordability tool →'),
      ]),
    ]),
    numbeoEntry ? el('div', { class: 'panel' }, [
      el('h2', {}, `Sample local prices — ${numbeoEntry.city} (Numbeo)`),
      el('p', { style: 'font-size:11px;color:var(--text-dim);margin:0 0 10px' },
        `Crowdsourced, not specific to ${region.name} — shown as the closest available city sample for ${region.provinceName}.`),
      buildNumbeoTable(numbeoEntry),
    ]) : null,
    el('div', { class: 'panel' }, [
      el('h2', {}, 'UMK history'),
      region.umkHistory && region.umkHistory.length > 1
        ? el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-history' }))
        : el('p', { style: 'font-size:12.5px;color:var(--text-dim)' }, 'No historical UMK series available for this region in the source data.'),
    ]),
  ]);

  container.appendChild(el('div', { class: 'detail-grid' }, [mapPanel, chartsCol]));

  // sibling table
  const tablePanel = el('div', { class: 'panel' }, [
    el('h2', {}, `Other kabupaten/kota in ${region.provinceName}`),
    el('div', { class: 'table-wrap' }, buildSiblingTable(siblings, region.id)),
  ]);
  container.appendChild(tablePanel);

  // sources
  const sources = el('ul', { class: 'source-list' }, [
    el('li', {}, ['UMK/UMP source: ', el('a', { href: region.umkSource, target: '_blank', rel: 'noopener' }, region.umkSource), ` (confidence: ${region.umkConfidence || 'n/a'})`]),
    region.wagePeriod ? el('li', {}, ['Province avg. wage source: ', el('a', { href: province.wageSource, target: '_blank', rel: 'noopener' }, province.wageSource)]) : null,
    province.khlTotal !== null ? el('li', {}, ['Province KHL source: ', el('a', { href: province.khlSource, target: '_blank', rel: 'noopener' }, province.khlSource)]) : null,
    province.povertyLine !== null ? el('li', {}, ['Province poverty line source: ', el('a', { href: province.povertyLineSource, target: '_blank', rel: 'noopener' }, province.povertyLineSource)]) : null,
    numbeoEntry ? el('li', {}, ['Local price sample source: ', el('a', { href: numbeoEntry.source, target: '_blank', rel: 'noopener' }, numbeoEntry.source)]) : null,
  ]);
  container.appendChild(el('div', { class: 'panel' }, [el('h2', {}, 'Sources'), sources]));

  initDetailMap(data, region);
  initDetailCharts(region, province, nationalAvgUmk, siblings);
}

function kpi(value, label, valueColor) {
  return el('div', { class: 'kpi-card' }, [
    el('div', { class: 'value', style: valueColor ? `color:${valueColor};text-shadow:0 0 10px ${valueColor}80` : '' }, value),
    el('div', { class: 'label' }, label),
  ]);
}

function buildSiblingTable(siblings, currentId) {
  const table = el('table', { class: 'data-table' });
  const sorted = [...siblings].sort((a, b) => b.umk2026 - a.umk2026);
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Region'), el('th', {}, 'Type'), el('th', {}, 'UMK/UMP 2026'), el('th', {}, 'Gap ratio'), el('th', {}, 'Category'),
  ])));
  const tbody = el('tbody');
  sorted.forEach((r) => {
    const row = el('tr', {
      onclick: () => { window.location.hash = '#/region/' + r.id; },
      style: r.id === currentId ? 'background:var(--bg);font-weight:700' : '',
    }, [
      el('td', {}, r.name + (r.id === currentId ? ' (this region)' : '')),
      el('td', {}, r.type),
      el('td', { class: 'num' }, rupiah(r.umk2026)),
      el('td', { class: 'num' }, pct(r.ratio)),
      el('td', {}, el('span', { class: 'badge ' + r.category }, CATEGORY_LABEL[r.category])),
    ]);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  return table;
}

function buildNumbeoTable(entry) {
  const table = el('table', { class: 'data-table' });
  const rows = [
    ['Rent, 1BR city center', entry.rentCityCenter],
    ['Rent, 1BR outside center', entry.rentOutsideCenter],
    ['Inexpensive meal out', entry.inexpensiveMeal],
    ['Basic utilities / month', entry.utilitiesMonthly],
    ['Internet / month', entry.internetMonthly],
    ['Public transport pass / month', entry.publicTransportMonthly],
  ].filter(([, v]) => v !== null && v !== undefined);
  const tbody = el('tbody');
  rows.forEach(([label, value]) => {
    tbody.appendChild(el('tr', { style: 'cursor:default' }, [el('td', {}, label), el('td', { class: 'num' }, rupiah(value))]));
  });
  table.appendChild(tbody);
  return table;
}

function initDetailMap(data, region) {
  mapInstance = L.map('detail-map', { scrollWheelZoom: false }).setView([-2.3, 118], 5);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri', maxZoom: 16,
  }).addTo(mapInstance);

  const provFeatures = data.geoKab.features.filter((f) => f.properties.provinceId === region.provinceId);
  const context = L.geoJSON({ type: 'FeatureCollection', features: provFeatures }, {
    style: (f) => ({ fillColor: f.properties.id === region.id ? COLORS[region.category] : '#233229', weight: f.properties.id === region.id ? 2 : 0.5, color: f.properties.id === region.id ? '#39ff8f' : '#03110a', fillOpacity: f.properties.id === region.id ? 0.85 : 0.55 }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(feature.properties.name, { className: 'paygap-tip' });
      if (feature.properties.id !== region.id) {
        layer.on('click', () => { window.location.hash = '#/region/' + feature.properties.id; });
      }
    },
  }).addTo(mapInstance);

  const target = context.getLayers().find((l) => l.feature.properties.id === region.id);
  if (target) mapInstance.fitBounds(target.getBounds(), { padding: [20, 20] });
  else mapInstance.fitBounds(context.getBounds());
}

function initDetailCharts(region, province, nationalAvgUmk, siblings) {
  const provAvgUmk = siblings.reduce((s, r) => s + r.umk2026, 0) / siblings.length;
  const labels = ['This region', 'Province UMP', 'Province avg. UMK', 'National avg. UMK'];
  const values = [region.umk2026, province.ump2026, provAvgUmk, nationalAvgUmk];
  if (region.avgWageRef !== null) { labels.push('Province avg. wage'); values.push(region.avgWageRef); }

  charts.push(new Chart(document.getElementById('chart-compare'), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#39ff8f', '#4a6157', '#4a6157', '#4a6157', '#29c8ff'] }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => rupiahShort(v) } } } },
  }));

  const khlLabels = ['This region UMK'];
  const khlValues = [region.umk2026];
  const khlColors = ['#39ff8f'];
  if (province.khlTotal !== null) { khlLabels.push('Province KHL'); khlValues.push(province.khlTotal); khlColors.push('#2ee673'); }
  if (province.povertyLine !== null) { khlLabels.push('Province poverty line'); khlValues.push(province.povertyLine); khlColors.push('#ff3b5c'); }
  if (region.avgWageRef !== null) { khlLabels.push('Province avg. wage'); khlValues.push(region.avgWageRef); khlColors.push('#29c8ff'); }
  charts.push(new Chart(document.getElementById('chart-khl'), {
    type: 'bar',
    data: { labels: khlLabels, datasets: [{ data: khlValues, backgroundColor: khlColors }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => rupiahShort(v) } } } },
  }));

  if (region.umkHistory && region.umkHistory.length > 1) {
    const sorted = [...region.umkHistory].sort((a, b) => a.year - b.year);
    charts.push(new Chart(document.getElementById('chart-history'), {
      type: 'line',
      data: {
        labels: sorted.map((h) => h.year),
        datasets: [{ label: 'UMK', data: sorted.map((h) => h.umk), borderColor: '#39ff8f', backgroundColor: 'rgba(57,255,143,.15)', fill: true, tension: 0.2 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => rupiahShort(v) } } } },
    }));
  }
}

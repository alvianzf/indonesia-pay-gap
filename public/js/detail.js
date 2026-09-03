import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, CATEGORY_LABEL, el } from './utils.js';

const COLORS = { below: '#ff3b5c', barely: '#ffc233', moderate: '#2ee673', far: '#29c8ff', nodata: '#4a6157' };

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
    kpi(umkToKhl !== null ? pct(umkToKhl) : '—', 'UMK ÷ KHL', khlVerdictInfo.color, khlVerdictInfo.label),
    kpi(province.povertyLine !== null ? rupiah(province.povertyLine) : 'No data', 'Province poverty line (BPS)'),
  ]);
  container.appendChild(kpiGrid);

  const mapPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Location'),
    el('div', { id: 'detail-map' }),
  ]);

  // itemized_cost_of_living_by_city covers 14/38 provinces; some (Jawa Timur,
  // Jawa Barat) have 2 cities - the source lists the provincial capital first,
  // so find() naturally picks the more representative one.
  const numbeoEntry = data.merged.numbeoCities.find((c) => c.provinceId === region.provinceId) || null;

  const chartsCol = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Wage comparison'),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-compare' })),
    ]),
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Cost of living vs. pay (province level)'),
      el('div', { class: 'gap-spectrum', html: buildGapSpectrumSvg(region, province) }),
      el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin:10px 0 0' }, [
        'KHL is Kemnaker\'s official "decent living needs" figure — the same benchmark wage councils use to set minimum wages. Dot color = above (green) or below (red) that line. ',
        el('a', { href: '#/afford' }, 'Try the Salary Affordability tool →'),
      ]),
    ]),
    numbeoEntry ? el('div', { class: 'panel' }, [
      el('h2', {}, `Sample local prices — ${numbeoEntry.city} (Numbeo)`),
      el('p', { style: 'font-size:11px;color:var(--text-dim);margin:0 0 10px' }, [
        `Crowdsourced, not specific to ${region.name} — shown as the closest available city sample for ${region.provinceName}. `,
        numbeoEntry.asOf ? `(${numbeoEntry.asOf}) ` : '',
        numbeoEntry.confidence || '',
      ]),
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

function kpi(value, label, valueColor, verdict) {
  return el('div', { class: 'kpi-card' }, [
    el('div', { class: 'value', style: valueColor ? `color:${valueColor};text-shadow:0 0 10px ${valueColor}80` : '' }, value),
    el('div', { class: 'label' }, label),
    verdict ? el('div', { class: 'kpi-verdict', style: `color:${valueColor}` }, verdict) : null,
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

// Renders KHL/UMK/avg-wage as a reference-line dot plot rather than bars, so the
// GAP between them reads as a distance/color on a shared axis instead of requiring
// the viewer to mentally subtract bar heights. All text is clamped inside the
// viewBox (clampX) so long Rupiah labels can never render outside the box.
function buildGapSpectrumSvg(region, province) {
  const khl = province.khlTotal;
  const umk = region.umk2026;
  const avgWage = region.avgWageRef;
  const hasAvg = avgWage !== null;

  const W = 640;
  const ML = 26, MR = 26;
  const trackX1 = ML, trackX2 = W - MR;
  const rowUmkY = 96;
  const rowAvgY = 160;
  const khlLineTop = 40;
  const khlLineBottom = (hasAvg ? rowAvgY : rowUmkY) + 26;
  const axisY = khlLineBottom + 22;
  const H = axisY + 22;

  const maxVal = Math.max(khl, umk, avgWage || 0) * 1.15;
  const scaleX = (v) => trackX1 + (v / maxVal) * (trackX2 - trackX1);
  const clampX = (x, half) => Math.min(Math.max(x, trackX1 + half), trackX2 - half);
  const pctDelta = (num, den) => { const p = Math.round((num / den - 1) * 100); return (p >= 0 ? '+' : '') + p + '%'; };

  const xKHL = scaleX(khl);
  const xUMK = clampX(scaleX(umk), 5);
  const xAvg = hasAvg ? clampX(scaleX(avgWage), 5) : null;
  const umkColor = umk >= khl ? '#2ee673' : '#ff3b5c';
  const avgColor = hasAvg ? (COLORS[region.category] || COLORS.nodata) : null;
  const khlLabelX = clampX(xKHL, 60);

  const row = (y, x, color, name, valueText, deltaText) => `
    <line x1="${trackX1}" y1="${y}" x2="${trackX2}" y2="${y}" stroke="#1c2a20" stroke-width="1.5" />
    <circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="#03110a" stroke-width="1.5" />
    <text x="${clampX(x, 70)}" y="${y - 16}" text-anchor="middle" font-size="13" font-weight="700" fill="${color}">${name} · ${valueText}</text>
    <text x="${clampX(x, 70)}" y="${y + 24}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${color}">${deltaText}</text>
  `;

  const axisLabel = (x, v, anchor) => `<text x="${x}" y="${axisY}" text-anchor="${anchor}" font-size="10" fill="#6f9c82">${rupiahShort(v)}</text>`;

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-label="Gap between KHL, UMK and average wage">
      <style>text { font-family: 'Rajdhani', sans-serif; }</style>
      <rect x="${trackX1}" y="${khlLineTop}" width="${xKHL - trackX1}" height="${khlLineBottom - khlLineTop}" fill="#ff3b5c" opacity="0.06" />
      <rect x="${xKHL}" y="${khlLineTop}" width="${trackX2 - xKHL}" height="${khlLineBottom - khlLineTop}" fill="#2ee673" opacity="0.06" />
      <line x1="${xKHL}" y1="${khlLineTop}" x2="${xKHL}" y2="${khlLineBottom}" stroke="#2ee673" stroke-width="1.5" stroke-dasharray="4 3" />
      <text x="${khlLabelX}" y="${khlLineTop - 12}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#2ee673">KHL (decent living) · ${rupiahShort(khl)}</text>
      ${row(rowUmkY, xUMK, umkColor, 'UMK', rupiahShort(umk), pctDelta(umk, khl) + ' vs KHL')}
      ${hasAvg ? row(rowAvgY, xAvg, avgColor, 'Avg. pay', rupiahShort(avgWage), pctDelta(avgWage, umk) + ' vs UMK') : ''}
      <line x1="${trackX1}" y1="${axisY - 8}" x2="${trackX2}" y2="${axisY - 8}" stroke="#1c2a20" stroke-width="1" />
      ${axisLabel(trackX1, 0, 'start')}
      ${axisLabel((trackX1 + trackX2) / 2, maxVal / 2, 'middle')}
      ${axisLabel(trackX2, maxVal, 'end')}
    </svg>
  `;
}

function buildNumbeoTable(entry) {
  const table = el('table', { class: 'data-table' });
  const rows = [
    ['Rent, 1BR city center', entry.rentCityCenter],
    ['Rent, 1BR outside center', entry.rentOutsideCenter],
    ['Inexpensive meal out', entry.inexpensiveMeal],
    ['Mid-range meal for 2', entry.midRangeMealFor2],
    ['Public transport pass / month', entry.transportMonthly],
    ['Basic utilities / month', entry.utilitiesMonthly],
    ['Internet / month', entry.internetMonthly],
    ['Mobile data plan (10GB) / month', entry.mobileDataMonthly],
    ['Gym membership / month', entry.gymMonthly],
    ['Preschool / month', entry.preschoolMonthly],
    ['Numbeo avg. net salary (reference)', entry.avgNetSalary],
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

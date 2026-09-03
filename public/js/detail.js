import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, CATEGORY_LABEL, el } from './utils.js';

const COLORS = { below: '#ff3b5c', barely: '#ffc233', moderate: '#2ee673', far: '#29c8ff', nodata: '#4a6157' };

const VERDICT_LABELS = {
  khl: { below: 'Below decent-living needs', barely: 'Just meets it', moderate: 'Comfortably covers it', far: 'Well above it', nodata: 'No KHL data' },
  poverty: { below: 'Below the poverty line', barely: 'Just above the poverty line', moderate: 'Comfortably above it', far: 'Well above it', nodata: 'No poverty-line data' },
};

function livingCostVerdict(ratio, kind) {
  const labels = VERDICT_LABELS[kind];
  if (ratio === null) return { label: labels.nodata, color: COLORS.nodata };
  if (ratio < 1.0) return { label: labels.below, color: COLORS.below };
  if (ratio < 1.15) return { label: labels.barely, color: COLORS.barely };
  if (ratio < 1.5) return { label: labels.moderate, color: COLORS.moderate };
  return { label: labels.far, color: COLORS.far };
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

  // KHL is almost always province-only (1 region nationwide has its own);
  // the poverty line is now genuinely region-level for 514/517 regions - both
  // fall back to the province figure where no region-specific one exists.
  const khlIsRegionLevel = region.khlTotal !== null;
  const effectiveKhl = region.khlTotal ?? province.khlTotal;
  const khlSourceUrl = region.khlTotal !== null ? region.khlSource : province.khlSource;
  const povertyIsRegionLevel = region.povertyLine !== null;
  const effectivePoverty = region.povertyLine ?? province.povertyLine;
  const povertySourceUrl = region.povertyLine !== null ? region.povertyLineSource : province.povertyLineSource;

  const umkToKhl = effectiveKhl ? region.umk2026 / effectiveKhl : null;
  const khlVerdictInfo = livingCostVerdict(umkToKhl, 'khl');
  const umkToPoverty = effectivePoverty ? region.umk2026 / effectivePoverty : null;
  const povertyVerdictInfo = livingCostVerdict(umkToPoverty, 'poverty');

  const kpiGrid = el('div', { class: 'kpi-grid' }, [
    kpi(rupiah(region.umk2026), region.usesUmpFallback ? 'UMP 2026 (applies here)' : 'UMK 2026', null, null, true),
    kpi(rupiah(province.ump2026), 'Province UMP 2026', null, null, true),
    kpi(region.avgWageRef !== null ? rupiah(region.avgWageRef) : 'No data', `Province avg. wage${region.wagePeriod ? ' (' + region.wagePeriod + ')' : ''}`, null, null, true),
    kpi(region.ratio !== null ? pct(region.ratio) : '—', 'Avg wage ÷ UMK', null, null, true),
    kpi('#' + rankInProvince + ' / ' + siblings.length, 'Rank in province (by UMK)', null, null, true),
    kpi('#' + nationalRank + ' / ' + allSorted.length, 'National rank (by UMK)', null, null, true),
    kpi(effectiveKhl !== null ? rupiah(effectiveKhl) : 'No data', khlIsRegionLevel ? "This region's KHL (decent living)" : 'Province KHL (decent living)', null, null, true),
    kpi(umkToKhl !== null ? pct(umkToKhl) : '—', 'UMK ÷ KHL', khlVerdictInfo.color, khlVerdictInfo.label, true),
    kpi(effectivePoverty !== null ? rupiah(effectivePoverty) : 'No data', povertyIsRegionLevel ? "This region's poverty line (BPS)" : 'Province poverty line (BPS)', null, null, true),
    kpi(umkToPoverty !== null ? pct(umkToPoverty) : '—', 'UMK ÷ poverty line', povertyVerdictInfo.color, povertyVerdictInfo.label, true),
  ]);
  container.appendChild(kpiGrid);

  const mapPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Location'),
    el('div', { id: 'detail-map' }),
  ]);

  // itemized_cost_of_living_by_city covers exactly 16 cities. Only show it when
  // the selected region IS one of them - no province-level "closest available
  // city" fallback. That fallback used to show e.g. Bandung's prices on Kota
  // Bekasi's page (which has no Numbeo page of its own at all - confirmed in
  // the source file's own notes), which reads as Bekasi-specific and isn't;
  // better to show nothing than a wrong-feeling approximation. Only "kota"
  // regions can match at all: Numbeo's cities are proper cities, so a same-
  // named "Kabupaten" (e.g. Kabupaten Bogor, distinct from Kota Bogor) must
  // not claim a match either.
  const normCity = (s) => s.toLowerCase().replace(/^kota |^kabupaten /, '').replace(/[^a-z0-9]/g, '');
  const numbeoEntry = region.type === 'kota'
    ? data.merged.numbeoCities.find((c) => normCity(c.city) === normCity(region.name)) || null
    : null;

  container.appendChild(mapPanel);

  const chartPanels = [
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Wage comparison'),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-compare' })),
    ]),
    el('div', { class: 'panel' }, [
      el('h2', {}, `Cost of living vs. pay (${khlIsRegionLevel ? 'this region' : 'province level'})`),
      el('div', { class: 'gap-spectrum', html: buildGapSpectrumSvg(region, effectiveKhl) }),
      el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin:10px 0 0' }, [
        'KHL is Kemnaker\'s official "decent living needs" figure — the same benchmark wage councils use to set minimum wages. Dot color = above (green) or below (red) that line. ',
        el('a', { href: '#/afford' }, 'Try the Salary Affordability tool →'),
      ]),
    ]),
    numbeoEntry ? el('div', { class: 'panel' }, [
      el('h2', {}, `Sample local prices — ${numbeoEntry.city} (Numbeo)`),
      el('p', { style: 'font-size:11px;color:var(--text-dim);margin:0 0 10px' }, [
        `Crowdsourced Numbeo data specifically for ${region.name}. `,
        numbeoEntry.asOf ? `(${numbeoEntry.asOf}) ` : '',
        numbeoEntry.confidence || '',
      ]),
      buildNumbeoBars(numbeoEntry),
    ]) : null,
    el('div', { class: 'panel' }, [
      el('h2', {}, 'UMK history'),
      region.umkHistory && region.umkHistory.length > 1
        ? el('div', { class: 'chart-box' }, el('canvas', { id: 'chart-history' }))
        : el('p', { style: 'font-size:12.5px;color:var(--text-dim)' }, 'No historical UMK series available for this region in the source data.'),
    ]),
  ];

  chartPanels.filter(Boolean).forEach((p) => container.appendChild(p));

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
    khlSourceUrl ? el('li', {}, [(khlIsRegionLevel ? "This region's" : "Province") + ' KHL source: ', el('a', { href: khlSourceUrl, target: '_blank', rel: 'noopener' }, khlSourceUrl)]) : null,
    povertySourceUrl ? el('li', {}, [(povertyIsRegionLevel ? "This region's" : "Province") + ' poverty line source: ', el('a', { href: povertySourceUrl, target: '_blank', rel: 'noopener' }, povertySourceUrl)]) : null,
    numbeoEntry ? el('li', {}, ['Local price sample source: ', el('a', { href: numbeoEntry.source, target: '_blank', rel: 'noopener' }, numbeoEntry.source)]) : null,
  ]);
  container.appendChild(el('div', { class: 'panel' }, [el('h2', {}, 'Sources'), sources]));

  initDetailMap(data, region);
  initDetailCharts(region, province, nationalAvgUmk, siblings);
}

function kpi(value, label, valueColor, verdict, wide) {
  return el('div', { class: 'kpi-card' + (wide ? ' wide' : '') }, [
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
function buildGapSpectrumSvg(region, khl) {
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

function buildNumbeoBars(entry) {
  // avg. net salary is income, not a cost - keep it out of the cost-item scale
  // (mixing it in would dwarf every other bar and make them all unreadable).
  const costRows = [
    ['Rent, 1BR city center', entry.rentCityCenter],
    ['Rent, 1BR outside center', entry.rentOutsideCenter],
    ['Mid-range meal for 2', entry.midRangeMealFor2],
    ['Preschool / month', entry.preschoolMonthly],
    ['Gym membership / month', entry.gymMonthly],
    ['Basic utilities / month', entry.utilitiesMonthly],
    ['Internet / month', entry.internetMonthly],
    ['Public transport pass / month', entry.transportMonthly],
    ['Inexpensive meal out', entry.inexpensiveMeal],
    ['Mobile data plan (10GB) / month', entry.mobileDataMonthly],
  ].filter(([, v]) => v !== null && v !== undefined);

  if (!costRows.length) return el('p', { style: 'font-size:12.5px;color:var(--text-dim)' }, 'No detailed price data available for this city.');

  const maxVal = Math.max(...costRows.map(([, v]) => v));
  const wrap = el('div', { class: 'numbeo-bars' });
  costRows
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, value]) => {
      const widthPct = Math.max((value / maxVal) * 100, 6);
      wrap.appendChild(el('div', { class: 'numbeo-row' }, [
        el('div', { class: 'numbeo-label' }, label),
        el('div', { class: 'numbeo-track' }, [
          el('div', { class: 'numbeo-fill', style: `width:${widthPct}%` }),
          el('span', { class: 'numbeo-value' }, rupiah(value)),
        ]),
      ]));
    });

  if (entry.avgNetSalary !== null && entry.avgNetSalary !== undefined) {
    wrap.appendChild(el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin:10px 0 0' },
      `Numbeo avg. net salary (reference, not part of the bars above): ${rupiah(entry.avgNetSalary)}`));
  }
  return wrap;
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

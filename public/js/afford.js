import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, el, debounce } from './utils.js';

const COLORS = { notEnough: '#dc2626', tight: '#f59e0b', comfortable: '#16a34a', veryComfortable: '#2563eb', unset: '#cbd5e1' };
const VERDICT_LABEL = {
  notEnough: "Can't cover KHL",
  tight: 'Tight',
  comfortable: 'Comfortable',
  veryComfortable: 'Very comfortable',
  unset: 'Enter a salary',
};
const VERDICT_ORDER = ['veryComfortable', 'comfortable', 'tight', 'notEnough'];
const STORAGE_KEY = 'paygap:salary';

let mapInstance = null;
let geoLayer = null;

function verdictFor(ratio) {
  if (ratio === null) return 'unset';
  if (ratio < 1.0) return 'notEnough';
  if (ratio < 1.3) return 'tight';
  if (ratio < 2.0) return 'comfortable';
  return 'veryComfortable';
}

function computeRows(provinces, salary) {
  return provinces.map((p) => {
    const ratio = salary && p.khlTotal ? salary / p.khlTotal : null;
    return {
      ...p,
      salary,
      surplus: salary && p.khlTotal ? salary - p.khlTotal : null,
      ratio,
      verdict: salary ? verdictFor(ratio) : 'unset',
    };
  });
}

export async function renderAfford(container) {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  geoLayer = null;

  const data = await loadData();
  const { merged } = data;
  container.innerHTML = '';

  const savedSalary = Number(localStorage.getItem(STORAGE_KEY)) || null;

  container.appendChild(el('div', { class: 'banner' }, [
    el('div', {}, [
      el('strong', {}, '💰 What this tool does: '),
      'It compares your monthly salary against each province\'s official KHL (Kebutuhan Hidup Layak — "decent living needs") figure from Kemnaker, the same benchmark used as an input to minimum-wage decisions. ',
      el('button', { class: 'banner-toggle', onclick: (e) => {
        const d = e.target.parentElement.parentElement.querySelector('.banner-details');
        d.hidden = !d.hidden;
        e.target.textContent = d.hidden ? 'Read full methodology' : 'Hide';
      } }, 'Read full methodology'),
    ]),
    el('div', { class: 'banner-details', hidden: '' }, merged.meta.affordabilityMethodology),
  ]));

  const salaryPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Enter your monthly salary'),
    el('div', { class: 'map-controls' }, [
      el('span', { style: 'color:var(--text-dim);font-size:13px' }, 'Rp'),
      el('input', {
        type: 'number', id: 'salary-input', placeholder: 'e.g. 6000000', min: '0', step: '50000',
        value: savedSalary || '',
        style: 'width:200px',
        oninput: debounce((e) => {
          const v = Number(e.target.value) || null;
          if (v) localStorage.setItem(STORAGE_KEY, String(v)); else localStorage.removeItem(STORAGE_KEY);
          update(v);
        }, 200),
      }),
      el('span', { id: 'salary-summary', style: 'font-size:12.5px;color:var(--text-dim)' }, ''),
    ]),
  ]);
  container.appendChild(salaryPanel);

  const kpiGrid = el('div', { class: 'kpi-grid', id: 'afford-kpis' });
  container.appendChild(kpiGrid);

  const mapPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'By province'),
    el('div', { id: 'afford-map' }),
  ]);
  const legendPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Legend'),
    el('div', { class: 'legend-box' }, VERDICT_ORDER.map((v) => el('div', { class: 'legend-row' }, [
      el('span', { class: 'legend-swatch', style: `background:${COLORS[v]}` }), VERDICT_LABEL[v],
    ]))),
    el('p', { style: 'font-size:11.5px;color:var(--text-dim);margin-top:10px' },
      'Ratio = salary ÷ province KHL. "Comfortable" starts at 1.3x (some room beyond decent-living needs); "Very comfortable" at 2x.'),
  ]);
  container.appendChild(el('div', { class: 'main-grid' }, [mapPanel, legendPanel]));

  const tablePanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'All provinces, ranked'),
    el('div', { class: 'table-wrap', id: 'afford-table-wrap' }),
  ]);
  container.appendChild(tablePanel);

  initMap(data);
  update(savedSalary);

  function update(salary) {
    const rows = computeRows(merged.provinces, salary).sort((a, b) => {
      if (a.ratio === null && b.ratio === null) return b.khlTotal - a.khlTotal;
      if (a.ratio === null) return 1;
      if (b.ratio === null) return -1;
      return b.ratio - a.ratio;
    });

    const summary = document.getElementById('salary-summary');
    if (salary) {
      const comfy = rows.filter((r) => r.verdict === 'comfortable' || r.verdict === 'veryComfortable').length;
      summary.textContent = `You can live comfortably (1.3x KHL or more) in ${comfy} of ${rows.length} provinces.`;
    } else {
      summary.textContent = 'Enter a monthly salary to see where it goes furthest.';
    }

    renderKpis(rows, salary);
    renderTable(rows);
    refreshMapColors(rows);
  }

  function renderKpis(rows, salary) {
    const grid = document.getElementById('afford-kpis');
    grid.innerHTML = '';
    if (!salary) return;
    const counts = { veryComfortable: 0, comfortable: 0, tight: 0, notEnough: 0 };
    rows.forEach((r) => { if (r.verdict !== 'unset') counts[r.verdict]++; });
    const cardMap = [
      ['veryComfortable', 'far', 'Very comfortable (≥2x KHL)'],
      ['comfortable', 'moderate', 'Comfortable (1.3–2x KHL)'],
      ['tight', 'barely', 'Tight (1–1.3x KHL)'],
      ['notEnough', 'below', "Below KHL — can't cover it"],
    ];
    cardMap.forEach(([key, cls, label]) => {
      grid.appendChild(el('div', { class: 'kpi-card ' + cls }, [
        el('div', { class: 'value' }, String(counts[key])),
        el('div', { class: 'label' }, label),
      ]));
    });
  }

  function renderTable(rows) {
    const wrap = document.getElementById('afford-table-wrap');
    wrap.innerHTML = '';
    const table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Province'), el('th', {}, 'KHL (decent living)'), el('th', {}, 'Poverty line'),
      el('th', {}, 'Your surplus'), el('th', {}, 'Ratio'), el('th', {}, 'Verdict'), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    rows.forEach((r) => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, r.name),
        el('td', { class: 'num' }, rupiah(r.khlTotal)),
        el('td', { class: 'num' }, r.povertyLine !== null ? rupiah(r.povertyLine) : '—'),
        el('td', { class: 'num' }, r.surplus !== null ? (r.surplus >= 0 ? '+' : '') + rupiah(r.surplus) : '—'),
        el('td', { class: 'num' }, r.ratio !== null ? pct(r.ratio) : '—'),
        el('td', {}, el('span', { class: 'badge outline', style: r.verdict !== 'unset' ? `background:${COLORS[r.verdict]};color:#fff;border:none` : '' }, VERDICT_LABEL[r.verdict])),
        el('td', {}, el('a', { href: '#/?province=' + r.id }, 'View regions →')),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function refreshMapColors(rows) {
    if (!geoLayer) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    geoLayer.eachLayer((layer) => {
      const r = byId.get(layer.feature.properties.id);
      if (!r) return;
      layer.setStyle({ fillColor: COLORS[r.verdict], weight: 0.6, color: '#fff', fillOpacity: 0.78 });
      const ratioTxt = r.ratio !== null ? pct(r.ratio) : 'n/a';
      layer.setTooltipContent(`
        <div class="tip-title">${r.name}</div>
        <div class="tip-row"><span>KHL</span><strong>${rupiah(r.khlTotal)}</strong></div>
        <div class="tip-row"><span>Salary/KHL</span><strong>${ratioTxt}</strong></div>
        <div class="tip-row"><span>Verdict</span><strong>${VERDICT_LABEL[r.verdict]}</strong></div>
      `);
    });
  }
}

function initMap(data) {
  mapInstance = L.map('afford-map', { scrollWheelZoom: true }).setView([-2.3, 118], 4);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri', maxZoom: 16,
  }).addTo(mapInstance);

  geoLayer = L.geoJSON(data.geoProv, {
    style: () => ({ fillColor: COLORS.unset, weight: 0.6, color: '#fff', fillOpacity: 0.6 }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(feature.properties.name, { className: 'paygap-tip', sticky: true });
      layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#111' }));
      layer.on('mouseout', () => layer.setStyle({ weight: 0.6, color: '#fff' }));
      layer.on('click', () => { window.location.hash = '#/?province=' + feature.properties.id; });
    },
  }).addTo(mapInstance);
}

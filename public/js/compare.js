import { loadData } from './store.js';
import { rupiah, rupiahShort, pct, CATEGORY_LABEL, el, debounce } from './utils.js';

const MAX_SLOTS = 4;
const STORAGE_KEY = 'paygap:compare';
const SLOT_COLORS = ['#39ff8f', '#29c8ff', '#ffc233', '#ff3b5c'];

let charts = [];
let selectedIds = [];

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function readIdsFromUrl() {
  const hash = window.location.hash || '';
  const q = hash.split('?')[1];
  if (!q) return null;
  const r = new URLSearchParams(q).get('r');
  return r ? r.split(',').filter(Boolean) : null;
}

function syncUrl() {
  const q = selectedIds.length ? ('?r=' + selectedIds.join(',')) : '';
  history.replaceState(null, '', '#/compare' + q);
  if (selectedIds.length) localStorage.setItem(STORAGE_KEY, selectedIds.join(','));
  else localStorage.removeItem(STORAGE_KEY);
}

export async function renderCompare(container) {
  destroyCharts();
  document.removeEventListener('click', closeResultsOutside);
  document.addEventListener('click', closeResultsOutside);
  const data = await loadData();

  const fromUrl = readIdsFromUrl();
  const fromStorage = localStorage.getItem(STORAGE_KEY);
  const initial = fromUrl || (fromStorage ? fromStorage.split(',') : []);
  selectedIds = initial.filter((id) => data.regionById.has(id)).slice(0, MAX_SLOTS);

  container.innerHTML = '';
  container.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Compare regions'),
    el('p', { style: 'font-size:12.5px;color:var(--text-dim);margin:0 0 12px' },
      'Pick up to 4 kabupaten/kota to compare UMK, province benchmarks, and pay-gap side by side. The link updates as you build your comparison, so you can share it.'),
    el('div', { class: 'compare-slots', id: 'compare-slots' }),
  ]));

  const resultsPanel = el('div', { id: 'compare-results' });
  container.appendChild(resultsPanel);

  renderSlots(data);
  renderResults(data);
}

function renderSlots(data) {
  const wrap = document.getElementById('compare-slots');
  wrap.innerHTML = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = selectedIds[i];
    if (id) {
      const r = data.regionById.get(id);
      wrap.appendChild(el('div', { class: 'compare-slot filled', style: `border-left:3px solid ${SLOT_COLORS[i]}` }, [
        el('div', {}, [
          el('div', { style: 'font-weight:700' }, r.name),
          el('div', { style: 'font-size:11.5px;color:var(--text-dim)' }, r.provinceName),
        ]),
        el('button', { class: 'compare-remove', onclick: () => { selectedIds.splice(i, 1); syncUrl(); renderSlots(data); renderResults(data); } }, '✕'),
      ]));
    } else {
      wrap.appendChild(buildPickerSlot(data, i));
    }
  }
}

function buildPickerSlot(data, slotIndex) {
  const slot = el('div', { class: 'compare-slot' });
  const input = el('input', { type: 'text', placeholder: `+ Add region ${slotIndex + 1}…`, autocomplete: 'off' });
  const results = el('div', { class: 'compare-slot-results', hidden: '' });
  slot.appendChild(input);
  slot.appendChild(results);

  const search = debounce((q) => {
    if (!q) { results.hidden = true; results.innerHTML = ''; return; }
    const ql = q.toLowerCase();
    const matches = data.merged.regions
      .filter((r) => !selectedIds.includes(r.id) && (r.name.toLowerCase().includes(ql) || r.provinceName.toLowerCase().includes(ql)))
      .slice(0, 10);
    results.innerHTML = '';
    if (!matches.length) {
      results.appendChild(el('div', { class: 'muted' }, 'No matches'));
    } else {
      matches.forEach((r) => {
        results.appendChild(el('a', {
          href: '#', onclick: (e) => {
            e.preventDefault();
            if (selectedIds.length >= MAX_SLOTS) return;
            selectedIds.push(r.id);
            syncUrl();
            renderSlots(data);
            renderResults(data);
          },
        }, `${r.name} — ${r.provinceName}`));
      });
    }
    results.hidden = false;
  }, 150);

  input.addEventListener('input', (e) => search(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value) search(e.target.value); });

  return slot;
}

function closeResultsOutside(e) {
  document.querySelectorAll('.compare-slot-results').forEach((r) => {
    if (!r.parentElement.contains(e.target)) r.hidden = true;
  });
}

function renderResults(data) {
  const panel = document.getElementById('compare-results');
  panel.innerHTML = '';
  destroyCharts();

  if (selectedIds.length < 2) {
    panel.appendChild(el('div', { class: 'panel' }, [
      el('p', { style: 'font-size:13px;color:var(--text-dim);text-align:center;padding:30px 0' },
        selectedIds.length === 0 ? 'Add at least 2 regions above to compare them.' : 'Add one more region to see the comparison.'),
    ]));
    return;
  }

  const regions = selectedIds.map((id) => data.regionById.get(id));
  const provinces = regions.map((r) => data.provinceById.get(r.provinceId));

  panel.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Side-by-side'),
    el('div', { class: 'table-wrap' }, buildComparisonTable(regions, provinces, data)),
  ]));

  panel.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'UMK, province KHL & avg. wage'),
    el('div', { class: 'chart-box tall' }, el('canvas', { id: 'chart-compare-bars' })),
  ]));

  initCompareChart(regions, provinces);
}

function metricRow(label, regions, provinces, fn) {
  return el('tr', {}, [el('td', { class: 'row-label' }, label), ...regions.map((r, i) => el('td', { class: 'num' }, fn(r, provinces[i])))]);
}

function buildComparisonTable(regions, provinces, data) {
  const allSorted = [...data.merged.regions].sort((a, b) => b.umk2026 - a.umk2026);
  const table = el('table', { class: 'data-table compare-table' });
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, ''),
    ...regions.map((r, i) => el('th', { style: `color:${SLOT_COLORS[i]}` }, r.name)),
  ])));

  const tbody = el('tbody');
  tbody.appendChild(metricRow('Province', regions, provinces, (r) => r.provinceName));
  tbody.appendChild(metricRow('Type', regions, provinces, (r) => (r.type === 'kota' ? 'Kota' : 'Kabupaten')));
  tbody.appendChild(metricRow('UMK/UMP 2026', regions, provinces, (r) => rupiah(r.umk2026)));
  tbody.appendChild(metricRow('Province UMP 2026', regions, provinces, (r, p) => rupiah(p.ump2026)));
  tbody.appendChild(metricRow('Province avg. wage', regions, provinces, (r) => (r.avgWageRef !== null ? rupiah(r.avgWageRef) : '—')));
  tbody.appendChild(el('tr', {}, [
    el('td', { class: 'row-label' }, 'Pay-gap category'),
    ...regions.map((r) => el('td', {}, el('span', { class: 'badge ' + r.category }, CATEGORY_LABEL[r.category]))),
  ]));
  tbody.appendChild(metricRow('KHL (decent living)', regions, provinces, (r, p) => {
    const khl = r.khlTotal ?? p.khlTotal;
    return khl !== null ? rupiah(khl) + (r.khlTotal !== null ? ' (region)' : '') : '—';
  }));
  tbody.appendChild(metricRow('UMK ÷ KHL', regions, provinces, (r, p) => {
    const khl = r.khlTotal ?? p.khlTotal;
    return khl ? pct(r.umk2026 / khl) : '—';
  }));
  tbody.appendChild(metricRow('Poverty line (BPS)', regions, provinces, (r, p) => {
    const poverty = r.povertyLine ?? p.povertyLine;
    return poverty !== null ? rupiah(poverty) + (r.povertyLine !== null ? ' (region)' : ' (province)') : '—';
  }));
  tbody.appendChild(metricRow('UMK ÷ poverty line', regions, provinces, (r, p) => {
    const poverty = r.povertyLine ?? p.povertyLine;
    return poverty ? pct(r.umk2026 / poverty) : '—';
  }));
  tbody.appendChild(metricRow('National rank (by UMK)', regions, provinces, (r) => '#' + (allSorted.findIndex((x) => x.id === r.id) + 1) + ' / ' + allSorted.length));
  table.appendChild(tbody);
  return table;
}

function initCompareChart(regions, provinces) {
  charts.push(new Chart(document.getElementById('chart-compare-bars'), {
    type: 'bar',
    data: {
      labels: regions.map((r) => r.name),
      datasets: [
        { label: 'UMK/UMP 2026', data: regions.map((r) => r.umk2026), backgroundColor: '#39ff8f' },
        { label: 'Province KHL', data: provinces.map((p) => p.khlTotal), backgroundColor: '#2ee673' },
        { label: 'Province avg. wage', data: regions.map((r) => r.avgWageRef), backgroundColor: '#29c8ff' },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { ticks: { callback: (v) => rupiahShort(v) } } },
    },
  }));
}

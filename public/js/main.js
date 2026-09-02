import { loadData } from './store.js';
import { renderNational } from './national.js';
import { renderDetail } from './detail.js';
import { debounce } from './utils.js';

const app = document.getElementById('app');

async function route() {
  const hash = window.location.hash || '#/';
  const [path, queryStr] = hash.slice(2).split('?');
  window.scrollTo(0, 0);

  if (path.startsWith('region/')) {
    const id = decodeURIComponent(path.slice('region/'.length));
    await renderDetail(app, id);
  } else {
    await renderNational(app);
    if (queryStr) {
      const params = new URLSearchParams(queryStr);
      const province = params.get('province');
      if (province) {
        const sel = document.getElementById('f-province');
        if (sel) { sel.value = province; sel.dispatchEvent(new Event('change')); }
      }
    }
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  await setupQuickSearch();
  route();
});

async function setupQuickSearch() {
  const input = document.getElementById('quick-search');
  const results = document.getElementById('quick-search-results');
  const data = await loadData();

  const search = debounce((q) => {
    if (!q) { results.hidden = true; results.innerHTML = ''; return; }
    const ql = q.toLowerCase();
    const matches = data.merged.regions
      .filter((r) => r.name.toLowerCase().includes(ql) || r.provinceName.toLowerCase().includes(ql))
      .slice(0, 12);
    results.innerHTML = '';
    if (!matches.length) {
      results.appendChild(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'No matches' }));
    } else {
      matches.forEach((r) => {
        const a = document.createElement('a');
        a.href = '#/region/' + r.id;
        a.textContent = `${r.name} — ${r.provinceName}`;
        a.addEventListener('click', () => { results.hidden = true; input.value = ''; });
        results.appendChild(a);
      });
    }
    results.hidden = false;
  }, 150);

  input.addEventListener('input', (e) => search(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value) search(e.target.value); });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
}

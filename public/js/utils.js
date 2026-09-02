export function rupiah(n) {
  if (n === null || n === undefined) return '—';
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

export function rupiahShort(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return 'Rp' + (n / 1e9).toFixed(2) + ' M';
  if (n >= 1e6) return 'Rp' + (n / 1e6).toFixed(2) + ' jt';
  return rupiah(n);
}

export function pct(ratio, digits = 0) {
  if (ratio === null || ratio === undefined) return '—';
  return (ratio * 100).toFixed(digits) + '%';
}

export const CATEGORY_LABEL = {
  below: 'Below UMK',
  barely: 'Barely above UMK',
  moderate: 'Moderately above UMK',
  far: 'Far above UMK',
  nodata: 'No income data',
};

export const CATEGORY_ORDER = ['below', 'barely', 'moderate', 'far', 'nodata'];

export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

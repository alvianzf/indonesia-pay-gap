let cache = null;

export async function loadData() {
  if (cache) return cache;
  const [merged, geoProv, geoKab] = await Promise.all([
    fetch('data/merged.json').then((r) => r.json()),
    fetch('data/geo_provinces.json').then((r) => r.json()),
    fetch('data/geo_kabupaten.json').then((r) => r.json()),
  ]);

  const regionById = new Map(merged.regions.map((r) => [r.id, r]));
  const provinceById = new Map(merged.provinces.map((p) => [p.id, p]));
  const regionsByProvince = new Map();
  merged.regions.forEach((r) => {
    if (!regionsByProvince.has(r.provinceId)) regionsByProvince.set(r.provinceId, []);
    regionsByProvince.get(r.provinceId).push(r);
  });

  cache = { merged, geoProv, geoKab, regionById, provinceById, regionsByProvince };
  return cache;
}

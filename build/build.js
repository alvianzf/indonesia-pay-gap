// Data pipeline: merges UMK/UMP + average wage data with Indonesia GeoJSON boundaries.
// Run with: node build/build.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

const umk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'umk_source.json'), 'utf-8'));
const wages = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wages_source.json'), 'utf-8'));
const livingCosts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'living_costs_source.json'), 'utf-8'));
const kabGeo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'kab_raw.json'), 'utf-8'));
const provGeo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'prov_raw.json'), 'utf-8'));

// ---------- name normalization ----------
function norm(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/^kabupaten /, '').replace(/[^a-z0-9]/g, '');
}

const PROVINCE_ALIAS = {
  'DI Yogyakarta': 'Daerah Istimewa Yogyakarta',
};

const REGION_ALIAS = {
  // 'province|region(as in umk source)': 'exact geo WADMKK name'
  'Sumatera Utara|Kota Padangsidimpuan': 'Kota Padang Sidempuan',
  'Sumatera Selatan|Kabupaten OKU Timur': 'Ogan Komering Ulu Timur',
  'Sulawesi Selatan|Kabupaten Pangkajene dan Kepulauan': 'Pangkajene Kepulauan',
  'Papua Barat|Kota Manokwari': 'Manokwari',
};

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------- gap category thresholds ----------
// ratio = reference income / UMK
const THRESHOLDS = { below: 1.0, barely: 1.15, moderate: 1.5 };
const COLORS = {
  below: '#dc2626',   // red - income below UMK
  barely: '#f59e0b',  // orange/yellow - barely above UMK
  moderate: '#16a34a',// green - not far above UMK
  far: '#2563eb',     // blue - far above UMK
  nodata: '#9ca3af',  // gray - no income reference data
};

function categorize(ratio) {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) return 'nodata';
  if (ratio < THRESHOLDS.below) return 'below';
  if (ratio < THRESHOLDS.barely) return 'barely';
  if (ratio < THRESHOLDS.moderate) return 'moderate';
  return 'far';
}

const MONTH_ORDER = { februari: 2, maret: 3, mei: 5, agustus: 8, september: 9, desember: 12 };
function periodRank(d) {
  const period = (d.period || '').toLowerCase();
  let month = 0;
  for (const [k, v] of Object.entries(MONTH_ORDER)) if (period.includes(k)) month = v;
  return d.year * 100 + month;
}

function latestWage(dataArr) {
  if (!dataArr || !dataArr.length) return null;
  const sorted = [...dataArr].sort((a, b) => periodRank(b) - periodRank(a));
  return sorted[0];
}

// ---------- index geo data ----------
const geoProvByNorm = new Map();
provGeo.features.forEach((f) => {
  geoProvByNorm.set(norm(f.properties.PROVINSI), f);
});

const geoKabByKey = new Map(); // 'provNorm|regionNorm' -> feature
kabGeo.features.forEach((f) => {
  const p = f.properties;
  if (!p.WADMPR || !p.WADMKK) return;
  geoKabByKey.set(norm(p.WADMPR) + '|' + norm(p.WADMKK), f);
});

// ---------- build wage lookup by province ----------
const wageByProvince = new Map();
wages.provinces.forEach((p) => {
  wageByProvince.set(p.province, latestWage(p.data));
});

// ---------- living cost lookups (KHL = Kemnaker's official "decent living needs" figure) ----------
const khlByProvince = new Map();
livingCosts.khl_breakdown_by_region.forEach((r) => {
  khlByProvince.set(r.region, { total: r.total_khl, source: r.source });
});

const povertyByProvince = new Map();
livingCosts.poverty_line_by_province.forEach((r) => {
  if (r.province === 'Indonesia (national)') return;
  povertyByProvince.set(r.province, { total: r.total_poverty_line, source: r.source });
});

// itemized_cost_of_living_by_city (16 cities) supersedes the older, sparser
// numbeo_cost_breakdown_by_city (5 cities, kept in the source file only for
// history/backward-compat per its own notes) - flatten the fields we use.
const numbeoCities = (livingCosts.itemized_cost_of_living_by_city || []).map((c) => ({
  city: c.city,
  provinceId: slug(c.province),
  provinceName: c.province,
  asOf: c.as_of || null,
  rentCityCenter: c.housing?.rent_1br_city_center ?? null,
  rentOutsideCenter: c.housing?.rent_1br_outside_center ?? null,
  inexpensiveMeal: c.food?.inexpensive_restaurant_meal ?? null,
  midRangeMealFor2: c.food?.mid_range_3course_meal_for_2 ?? null,
  transportMonthly: c.transportation?.monthly_pass ?? null,
  utilitiesMonthly: c.utilities?.basic_915sqft_apartment_monthly ?? null,
  internetMonthly: c.utilities?.internet_60mbps_monthly ?? null,
  mobileDataMonthly: c.utilities?.mobile_plan_10gb_monthly ?? null,
  gymMonthly: c.entertainment_leisure?.gym_membership_monthly ?? null,
  preschoolMonthly: c.childcare_education?.preschool_monthly ?? null,
  avgNetSalary: c.salary_reference?.average_monthly_net_salary ?? null,
  confidence: c.confidence || null,
  source: c.source,
}));

// ---------- build merged dataset ----------
const outProvinces = [];
const outRegions = [];
const geoProvFeatures = [];
const geoKabFeatures = [];
const usedGeoKabKeys = new Set();

umk.provinces.forEach((p) => {
  const provId = slug(p.province);
  const geoProvName = PROVINCE_ALIAS[p.province] || p.province;
  const provFeature = geoProvByNorm.get(norm(geoProvName));

  const wageEntry = wageByProvince.get(p.province) || null;
  const avgWage = wageEntry ? wageEntry.average_wage : null;
  const wagePeriod = wageEntry ? wageEntry.period : null;
  const wageSource = wageEntry ? wageEntry.source : null;
  const ratio = avgWage ? avgWage / p.ump_2026 : null;
  const category = categorize(ratio);
  const khlEntry = khlByProvince.get(p.province) || null;
  const povertyEntry = povertyByProvince.get(p.province) || null;

  outProvinces.push({
    id: provId,
    name: p.province,
    ump2026: p.ump_2026,
    umpSource: p.ump_source,
    umpConfidence: p.ump_confidence || null,
    hasUmk: p.has_umk,
    umkNote: p.notes || null,
    avgWage,
    wagePeriod,
    wageSource,
    ratio,
    category,
    umpHistory: (p.ump_history || []).map((h) => ({ year: h.year, ump: h.ump })),
    regionCount: 0, // filled below
    khlTotal: khlEntry ? khlEntry.total : null,
    khlSource: khlEntry ? khlEntry.source : null,
    povertyLine: povertyEntry && povertyEntry.total !== null ? povertyEntry.total : null,
    povertyLineSource: povertyEntry ? povertyEntry.source : null,
  });

  if (provFeature) {
    geoProvFeatures.push({
      type: 'Feature',
      properties: { id: provId, name: p.province, ump2026: p.ump_2026, avgWage, ratio, category },
      geometry: provFeature.geometry,
    });
  } else {
    console.warn('[build] MISSING geo for province:', p.province);
  }

  // explicit UMK regions
  (p.umk || []).forEach((u) => {
    const aliasKey = p.province + '|' + u.region;
    const regionGeoName = REGION_ALIAS[aliasKey] || u.region.replace(/^Kabupaten /, '');
    const geoKey = norm(geoProvName) + '|' + norm(regionGeoName);
    const feature = geoKabByKey.get(geoKey);
    if (!feature) {
      console.warn('[build] MISSING geo for region:', p.province, '/', u.region);
      return;
    }
    if (usedGeoKabKeys.has(geoKey)) {
      console.warn('[build] DUPLICATE source entry for region (skipped):', p.province, '/', u.region);
      return;
    }
    usedGeoKabKeys.add(geoKey);

    const regionRatio = avgWage ? avgWage / u.umk_2026 : null;
    const regionCategory = categorize(regionRatio);
    const regionId = provId + '--' + slug(feature.properties.WADMKK);

    outRegions.push({
      id: regionId,
      provinceId: provId,
      provinceName: p.province,
      name: u.region,
      geoName: feature.properties.WADMKK,
      type: u.type,
      umk2026: u.umk_2026,
      umkSource: u.source,
      umkConfidence: u.confidence,
      usesUmpFallback: false,
      umkHistory: (u.umk_history || []).map((h) => ({ year: h.year, umk: h.umk })),
      avgWageRef: avgWage,
      wagePeriod,
      ratio: regionRatio,
      category: regionCategory,
    });

    geoKabFeatures.push({
      type: 'Feature',
      properties: {
        id: regionId, name: u.region, provinceId: provId, provinceName: p.province,
        type: u.type, umk2026: u.umk_2026, ratio: regionRatio, category: regionCategory,
        usesUmpFallback: false,
      },
      geometry: feature.geometry,
    });
  });

  // fallback: any geo kab/kota in this province not covered by explicit UMK -> use UMP
  kabGeo.features.forEach((f) => {
    const fp = f.properties;
    if (!fp.WADMPR || !fp.WADMKK) return;
    if (norm(fp.WADMPR) !== norm(geoProvName)) return;
    const key = norm(fp.WADMPR) + '|' + norm(fp.WADMKK);
    if (usedGeoKabKeys.has(key)) return;
    usedGeoKabKeys.add(key);

    const regionRatio = avgWage ? avgWage / p.ump_2026 : null;
    const regionCategory = categorize(regionRatio);
    const regionId = provId + '--' + slug(fp.WADMKK);
    const type = fp.WADMKK.startsWith('Kota') ? 'kota' : 'kabupaten';

    outRegions.push({
      id: regionId,
      provinceId: provId,
      provinceName: p.province,
      name: fp.WADMKK,
      geoName: fp.WADMKK,
      type,
      umk2026: p.ump_2026,
      umkSource: p.ump_source,
      umkConfidence: p.ump_confidence || null,
      usesUmpFallback: true,
      umkHistory: [],
      avgWageRef: avgWage,
      wagePeriod,
      ratio: regionRatio,
      category: regionCategory,
    });

    geoKabFeatures.push({
      type: 'Feature',
      properties: {
        id: regionId, name: fp.WADMKK, provinceId: provId, provinceName: p.province,
        type, umk2026: p.ump_2026, ratio: regionRatio, category: regionCategory,
        usesUmpFallback: true,
      },
      geometry: f.geometry,
    });
  });
});

// fill regionCount
const countByProv = new Map();
outRegions.forEach((r) => countByProv.set(r.provinceId, (countByProv.get(r.provinceId) || 0) + 1));
outProvinces.forEach((p) => (p.regionCount = countByProv.get(p.id) || 0));

// ---------- national summary ----------
const withRatio = outRegions.filter((r) => r.ratio !== null);
const summary = {
  totalProvinces: outProvinces.length,
  totalRegions: outRegions.length,
  provincesWithWageData: outProvinces.filter((p) => p.avgWage !== null).length,
  provincesWithoutWageData: outProvinces.filter((p) => p.avgWage === null).length,
  regionsBelowUmk: withRatio.filter((r) => r.category === 'below').length,
  regionsBarely: withRatio.filter((r) => r.category === 'barely').length,
  regionsModerate: withRatio.filter((r) => r.category === 'moderate').length,
  regionsFar: withRatio.filter((r) => r.category === 'far').length,
  regionsNoData: outRegions.filter((r) => r.category === 'nodata').length,
  highestUmk: [...outRegions].sort((a, b) => b.umk2026 - a.umk2026).slice(0, 15)
    .map((r) => ({ id: r.id, name: r.name, province: r.provinceName, umk2026: r.umk2026 })),
  lowestUmk: [...outRegions].sort((a, b) => a.umk2026 - b.umk2026).slice(0, 15)
    .map((r) => ({ id: r.id, name: r.name, province: r.provinceName, umk2026: r.umk2026 })),
  provincesWithKhl: outProvinces.filter((p) => p.khlTotal !== null).length,
  provincesWithPovertyLine: outProvinces.filter((p) => p.povertyLine !== null).length,
};

const merged = {
  meta: {
    year: 2026,
    currency: 'IDR',
    lastUpdated: umk.last_updated,
    generatedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    colors: COLORS,
    methodology: `Pay-gap ratio = latest available province-level average net wage (BPS Sakernas, employees only) divided by the region UMK (or provincial UMP where no separate UMK exists). Average wage data exists for ${summary.provincesWithWageData} of ${outProvinces.length} provinces and is NOT available at kabupaten/kota level, so all kabupaten/kota within a province share the same income reference figure. No median wage figures exist in the source data at any level.`,
    affordabilityMethodology: `Salary affordability compares your monthly salary against each province's official KHL (Kebutuhan Hidup Layak / "decent living needs") figure from Kemnaker - the same benchmark wage councils use as an input to minimum-wage decisions. KHL is available for all ${summary.provincesWithKhl} of ${outProvinces.length} provinces, but only at province level (not kabupaten/kota), is a province-wide average (not adjusted for city vs. rural cost differences within it), and is a single-person "decent" budget, not a household one. BPS's Garis Kemiskinan (poverty line, a bare per-capita subsistence threshold - much lower than KHL) is shown alongside where available (${summary.provincesWithPovertyLine}/${outProvinces.length} provinces) as a second, stricter reference point.`,
  },
  summary,
  provinces: outProvinces,
  regions: outRegions,
  numbeoCities,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'merged.json'), JSON.stringify(merged));
fs.writeFileSync(path.join(OUT_DIR, 'geo_provinces.json'), JSON.stringify({ type: 'FeatureCollection', features: geoProvFeatures }));
fs.writeFileSync(path.join(OUT_DIR, 'geo_kabupaten.json'), JSON.stringify({ type: 'FeatureCollection', features: geoKabFeatures }));

console.log('--- build summary ---');
console.log('provinces:', outProvinces.length, ' regions:', outRegions.length);
console.log('geo province features:', geoProvFeatures.length, ' geo kab features:', geoKabFeatures.length);
console.log('unused geo kab features (no match found in any province loop):', kabGeo.features.length - usedGeoKabKeys.size);
console.log(summary);

# Indonesia Wage & Pay-Gap Explorer

Interactive map + datatables + analytics of Indonesia's 2026 minimum wages (UMP/UMK) across all 38 provinces and 517 kabupaten/kota, with a "pay-gap" view comparing local UMK against the best available wage-income reference.

## Run it

```
node server.js
```

Then open http://localhost:8787 (needs internet access for the basemap tiles and the Leaflet/Chart.js CDN scripts; all wage/geo data itself is served locally).

## Regenerate the data

Source files live in `data/` (`umk_source.json`, `wages_source.json` — copies of the two files you supplied — plus `kab_raw.json`/`prov_raw.json`, Indonesia administrative boundaries from [ardian28/GeoJson-Indonesia-38-Provinsi](https://github.com/ardian28/GeoJson-Indonesia-38-Provinsi), BIG geoservice source, MIT licensed).

```
node build/build.js
```

This merges everything and writes `public/data/merged.json`, `geo_provinces.json`, `geo_kabupaten.json`, which the frontend fetches directly. Name-matching between the wage data and the GeoJSON boundaries is handled in `build/build.js` (`PROVINCE_ALIAS`/`REGION_ALIAS` — only 5 aliases were needed out of 490 UMK entries; one duplicate source entry for "Manokwari" is deduped).

## Known data limitations (surfaced in the UI banner too)

- **No median wage exists anywhere in the source data** — every `median_wage` field in `wages_source.json` is `null`. Only the mean/average wage is available.
- **Average wage is only available at the province level**, not below it — there is no kabupaten/kota-level income data at all. (Coverage across provinces varies by data vintage; the UI banner always shows the current count.)
- Consequently, the "pay-gap" color/ratio compares a **region's UMK against its province's average wage** — every kabupaten/kota in a province shares the same income reference. This is a real proxy limitation, not a bug: it still surfaces genuine signal (high-UMK areas like Bekasi/Karawang show as tight/red because the province-wide wage average can't keep pace), but it does not capture true intra-province cost-of-living or income variation.
- DKI Jakarta and Sumatera Barat have no separate UMK — all their kabupaten/kota use the provincial UMP directly (flagged in the UI as "uses provincial UMP").

## Project structure

```
data/                 raw + source JSON (inputs to the build)
build/build.js         merges sources -> public/data/*.json
public/                static frontend (vanilla JS, ES modules, Leaflet + Chart.js via CDN)
  index.html
  css/styles.css
  js/store.js           fetches & indexes the built data
  js/national.js        home view: map, filters, datatable, charts
  js/detail.js           per-region page: mini map, KPIs, comparisons, sibling table
  js/main.js             hash router + quick search
server.js               zero-dependency static file server
```

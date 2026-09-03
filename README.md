# Indonesia Wage & Pay-Gap Explorer

**Live: [id-paygap.alvianzf.id](https://id-paygap.alvianzf.id/)**

Interactive map + datatables + analytics of Indonesia's 2026 minimum wages (UMP/UMK) across all 38 provinces and 517 kabupaten/kota, with a "pay-gap" view comparing local UMK against the best available wage-income reference.

## Why this exists

Indonesia sets minimum wages independently for 38 provinces and 517 kabupaten/kota — a nearly 3x spread, from ~Rp2.3 million to ~Rp6.0 million a month — and no single official source presents them together, let alone interactively. Every year's UMK/UMP list ships as static news tables scattered across dozens of local outlets (see the 70+ sources cited in `data/umk_source.json`), re-typed by hand every time someone wants to compare two regions.

That fragmentation hides a more useful question: is the legal minimum actually close to what people are typically paid? BPS publishes average wages, but only per province and only for specific survey rounds — nobody merges that with the minimum-wage list to ask "where has UMK outpaced real pay, and where is there room?" This app does that merge and surfaces the answer directly as a pay-gap category per region (below / barely / moderately / far above UMK) — a proxy, not a precise local figure; see the limitations below.

**Useful for:**
- **Employers/HR** scoping where to open a facility, or benchmarking local pay before it's mandated
- **Journalists & researchers** covering regional wage inequality without manually cross-referencing dozens of news articles
- **Policy and labor-council watchers** comparing how a province's kabupaten diverge from its own UMP
- **Workers and job-seekers** checking their region's minimum wage against neighboring areas

## Features

- Choropleth map (province or kabupaten/kota granularity) colored by pay-gap category — far above / moderately above / barely above / below UMK, or no data
- Click any region to open its own detail page: mini map, KPIs, wage comparison chart, UMK history trend, sibling-region table
- Sortable, searchable, paginated datatable with province/category filters that also drive the map (dims non-matches, recenters to the filtered set)
- National analytics: category distribution, province UMP-vs-avg-wage comparison, top/bottom 10 UMK rankings
- **Salary Affordability tool** (`#/afford`): enter a monthly salary and see which of the 38 provinces you could live comfortably in, ranked against Kemnaker's official KHL (decent-living-needs) figure, with a colored province map, verdict badges, and a link from each row into that province's regions on the main map
- **Compare Regions** (`#/compare`, or `#/compare?r=id1,id2,...` to share a comparison directly): pick up to 4 kabupaten/kota and see them side by side in a table (UMK, province benchmarks, pay-gap category, KHL ratio, poverty line, national rank) plus a grouped bar chart
- Quick-search jump box, full SEO metadata (OG/Twitter cards, JSON-LD, sitemap)

## Run it

```
node server.js
```

Then open http://localhost:8787 (needs internet access for the basemap tiles and the Leaflet/Chart.js CDN scripts; all wage/geo data itself is served locally).

## Regenerate the data

Source files live in `data/` (`umk_source.json`, `wages_source.json`, `living_costs_source.json` — copies of the files you supplied — plus `kab_raw.json`/`prov_raw.json`, Indonesia administrative boundaries from [ardian28/GeoJson-Indonesia-38-Provinsi](https://github.com/ardian28/GeoJson-Indonesia-38-Provinsi), BIG geoservice source, MIT licensed).

```
node build/build.js
```

This merges everything and writes `public/data/merged.json`, `geo_provinces.json`, `geo_kabupaten.json`, which the frontend fetches directly. Name-matching between the wage data and the GeoJSON boundaries is handled in `build/build.js` (`PROVINCE_ALIAS`/`REGION_ALIAS` — only 5 aliases were needed out of 490 UMK entries; one duplicate source entry for "Manokwari" is deduped). Matching the living-cost file's kabupaten/kota poverty-line rows onto the same regions uses a separate `LIVING_COST_REGION_ALIAS` (9 aliases needed out of 514 rows, mostly DKI Jakarta's "kota administrasi" naming).

## Known data limitations (surfaced in the UI banner too)

- **No median wage exists anywhere in the source data** — every `median_wage` field in `wages_source.json` is `null`. Only the mean/average wage is available.
- **Average wage is only available at the province level**, not below it — there is no kabupaten/kota-level income data at all. (Coverage across provinces varies by data vintage; the UI banner always shows the current count.)
- Consequently, the "pay-gap" color/ratio compares a **region's UMK against its province's average wage** — every kabupaten/kota in a province shares the same income reference. This is a real proxy limitation, not a bug: it still surfaces genuine signal (high-UMK areas like Bekasi/Karawang show as tight/red because the province-wide wage average can't keep pace), but it does not capture true intra-province cost-of-living or income variation.
- DKI Jakarta and Sumatera Barat have no separate UMK — all their kabupaten/kota use the provincial UMP directly (flagged in the UI as "uses provincial UMP").
- **KHL is almost entirely province-level.** Kemnaker's decent-living-needs figure covers all 38 provinces, but only 1 of 517 kabupaten/kota (Boyolali) has its own figure — no central compiler exists for kab/kota KHL, unlike BPS's poverty line (below), so every other region falls back to its province's KHL. This is what the Salary Affordability tool uses.
- **The poverty line, however, is now genuinely kabupaten/kota-level for almost the whole country**: BPS publishes it per-region (`Data dan Informasi Kemiskinan Kabupaten/Kota`, Table 2.1), and 514 of 517 regions in this app have their own figure — region detail and Compare pages show it directly, labeled "(region)" vs. the 3 regions (and their siblings, for province-wide stats) that fall back to "(province)". Neither KHL nor the poverty line feeds into the core pay-gap ratio (which stays anchored to BPS Sakernas average wage); they're shown as separate reference points and ratios (UMK ÷ KHL, UMK ÷ poverty line).
- **Numbeo's itemized cost-of-living breakdown** covers 16 cities across 14 provinces (Jawa Timur and Jawa Barat have 2 cities each; the region detail page picks the provincial-capital one) and is not used in any calculation — it's raw, unreconciled, self-selected sample data (sample sizes range from hundreds of Numbeo entries for Jakarta down to single-digit contributor counts for e.g. Padang), kept in `merged.json.numbeoCities` for reference only and shown as horizontal bars on detail pages for the provinces it covers. The file's `cpi_by_city` section remains too sparse/inconsistent to use at all and is intentionally not merged in.

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
  js/afford.js           salary affordability tool: province map + ranked table by KHL ratio
  js/compare.js           compare up to 4 regions: table + grouped bar chart, shareable via ?r=
  js/main.js             hash router + quick search
server.js               zero-dependency static file server
```

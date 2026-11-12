import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildModel, createScatterDomains, rentGrowth, baselineRent, endYearsFor, resolvePeriod, formatRent, formatRentGrowth, formatPercent, isNumber, YEARS } from "../js/model.mjs";

const require = createRequire(import.meta.url);
globalThis.d3 = require("../vendor/d3.v7.min.js");
const { sphericalGeometry, displayGeometry } = await import("../js/charts.mjs");
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const annual = read("manhattan_annual_2006_2025.json");
const comparisons = read("manhattan_comparisons_all_baselines_2006_2025.json");
const geometry = read("manhattan_puma_2000.geojson");
const landGeometry = read("manhattan_puma_2000_land.geojson");
const model = buildModel(annual, comparisons, geometry);

// 实际 JSON 验证基期与下限 / Use the real JSON to check baselines and bounds.
test("all 171 selectable year pairs use the matching baseline and endpoint", () => {
  assert.equal(model.comparisonsByPair.size, 171);
  for (const baseYear of model.baseYears) for (const year of endYearsFor(baseYear)) {
    const rows = model.comparisonsByPair.get(`${baseYear}:${year}`);
    assert.equal(rows.length, 10);
    for (const row of rows) {
      assert.equal(row.base_year, baseYear);
      const base = model.annualByKey.get(`${baseYear}:${row.puma}`);
      const end = model.annualByKey.get(`${year}:${row.puma}`);
      assert.equal(row.housing_units_base, base.housing_units);
      assert.equal(row.housing_units_end, end.housing_units);
      assert.equal(row.rent_burden_pct_base, base.rent_burden_pct);
    }
  }
});

test("map color stays comparable and each selected pair fits all its plottable values", () => {
  for (const row of comparisons) {
    const rent = baselineRent(row).value;
    assert.ok(rent >= model.domains.mapRent[0] && rent <= model.domains.mapRent[1]);
    assert.equal(row.median_gross_rent_base, model.annualByKey.get(`${row.base_year}:${row.puma}`).median_gross_rent);
  }
  for (const rows of model.comparisonsByPair.values()) {
    const domains = createScatterDomains(rows);
    for (const values of Object.values(domains)) {
      assert.ok(values.every(Number.isFinite));
      assert.ok(values[1] > values[0]);
    }
    for (const row of rows) {
      const value = rentGrowth(row).value;
      if (value === null) continue;
      // D3's nice ticks expand these padded domains, never shrink them.
      assert.ok(value > domains.y[0] && value < domains.y[1]);
      assert.ok(row.housing_growth_pct > domains.xGrowth[0] && row.housing_growth_pct < domains.xGrowth[1]);
      assert.ok(row.rent_burden_pct_base > domains.xBurden[0] && row.rent_burden_pct_base < domains.xBurden[1]);
    }
  }
});

test("percent axes change with either selected year rather than the full history", () => {
  const span = d => d[1] - d[0];
  const long = createScatterDomains(model.comparisonsByPair.get("2006:2025"));
  const short = createScatterDomains(model.comparisonsByPair.get("2024:2025"));
  const first = createScatterDomains(model.comparisonsByPair.get("2006:2007"));
  assert.ok(span(short.y) < span(long.y));
  assert.ok(span(first.y) < span(long.y));
  assert.notDeepEqual(long.xGrowth, short.xGrowth);
  assert.notDeepEqual(long.xBurden, short.xBurden);
});

test("auto scales handle constant, zero, missing and bound-only points", () => {
  const exact = value => ({ rent_growth_status: "exact", rent_growth_nominal_pct: value, housing_growth_pct: value, rent_burden_pct_base: 40 });
  for (const rows of [[], [exact(0)], [exact(5), exact(5)]]) {
    const domains = createScatterDomains(rows);
    for (const d of Object.values(domains)) assert.ok(d.every(Number.isFinite) && d[1] > d[0]);
  }
  const lower = { ...exact(null), rent_growth_status: "lower_bound", rent_growth_nominal_pct_lower_bound: 10, housing_growth_pct: 1 };
  const upper = { ...exact(null), rent_growth_status: "upper_bound", rent_growth_nominal_pct_upper_bound: 20, housing_growth_pct: 2 };
  const rows = [lower, upper];
  const domains = createScatterDomains(rows);
  assert.ok(domains.y[0] < 10 && domains.y[1] > 20);
  // Missing growth must not add a zero or an invisible outlier to fitted domains.
  assert.deepEqual(createScatterDomains([...rows, { ...exact(null), housing_growth_pct: 10000 }]), domains);
});

test("null never becomes a numeric zero", () => {
  assert.equal(isNumber(null), false);
  assert.equal(isNumber("0"), false);
  assert.equal(isNumber(0), true);
  assert.deepEqual(rentGrowth({ rent_growth_status: "exact", rent_growth_nominal_pct: null }), { value: null, kind: "unavailable" });
  assert.equal(formatPercent(null), "Not available");
});

test("all four censored comparisons retain nonzero lower bounds", () => {
  const bounds = comparisons.filter(r => r.base_year === 2006 && r.end_year <= 2011 && rentGrowth(r).kind === "lower_bound");
  assert.equal(bounds.length, 4);
  assert.deepEqual(bounds.map(r => `${r.end_year}:${r.puma}`), ["2009:03810", "2010:03810", "2011:03808", "2011:03810"]);
  for (const row of bounds) {
    assert.equal(row.rent_growth_nominal_pct, null);
    assert.ok(rentGrowth(row).value > 13);
    assert.match(formatRentGrowth(row), /^at least \+/);
  }
});

test("rent details distinguish exact values from at-least values", () => {
  assert.equal(formatRent(model.annualByKey.get("2011:03810")), "at least $2,000");
  assert.equal(formatRent(model.annualByKey.get("2006:03810")), "$1,758");
  assert.equal(formatRent(model.annualByKey.get("2024:03810")), "at least $3,500");
  assert.equal(formatRentGrowth(comparisons.find(r => r.base_year === 2006 && r.end_year === 2009 && r.puma === "03810")), "at least +13.77%");
});

test("changing the baseline keeps valid endpoints and advances invalid endpoints past gaps", () => {
  assert.equal(YEARS.includes(2020), false);
  assert.equal(model.baseYears.includes(2025), false);
  assert.deepEqual(endYearsFor(2019), [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(resolvePeriod(2019, 2025), { baseYear: 2019, endYear: 2025 });
  assert.deepEqual(resolvePeriod(2019, 2015), { baseYear: 2019, endYear: 2021 });
  assert.deepEqual(resolvePeriod(2024, 2021), { baseYear: 2024, endYear: 2025 });
  assert.deepEqual(resolvePeriod(2006, 2006), { baseYear: 2006, endYear: 2007 });
  assert.throws(() => resolvePeriod(2020, 2025), /Invalid baseline/);
  assert.throws(() => resolvePeriod(2025, 2025), /Invalid baseline/);
});

test("upper bounds and unavailable growth are never displayed as exact points", () => {
  const upper = comparisons.filter(r => r.rent_growth_status === "upper_bound");
  assert.equal(upper.length, 118);
  for (const row of upper) {
    assert.deepEqual(rentGrowth(row), { value: row.rent_growth_nominal_pct_upper_bound, kind: "upper_bound" });
    assert.match(formatRentGrowth(row), /^at most /);
  }
  const missing = comparisons.filter(r => r.rent_growth_status === "unavailable");
  assert.equal(missing.length, 49);
  for (const row of missing) assert.deepEqual(rentGrowth(row), { value: null, kind: "unavailable" });
  const coded = comparisons.find(r => r.base_year === 2024 && r.puma === "03810");
  assert.deepEqual(baselineRent(coded), { value: 3500, kind: "lower_bound" });
});

test("spherical map conversion preserves inputs and fits Manhattan rather than the world", () => {
  const before = JSON.stringify(geometry);
  const normalized = sphericalGeometry(geometry);
  const bounds = d3.geoBounds(normalized);
  assert.ok(bounds[0][0] > -74.1 && bounds[1][0] < -73.8);
  assert.ok(bounds[0][1] > 40.6 && bounds[1][1] < 41);
  assert.ok(normalized.features.every(feature => d3.geoArea(feature) < .001));
  assert.equal(JSON.stringify(geometry), before);
});

test("display map hides only the two offshore pieces and preserves source geometry", () => {
  const before = JSON.stringify(geometry);
  const displayed = displayGeometry(geometry);
  assert.equal(displayed.features.length, 10);
  const source = geometry.features.find(f => f.properties.PUMA === "03810");
  const mainland = displayed.features.find(f => f.properties.PUMA === "03810");
  assert.equal(source.geometry.type, "MultiPolygon");
  assert.equal(source.geometry.coordinates.length, 3);
  assert.equal(mainland.geometry.type, "Polygon");
  assert.ok(Math.min(...mainland.geometry.coordinates[0].map(point => point[0])) > -74.035);
  assert.deepEqual(displayed.features.filter(f => f.properties.PUMA !== "03810"), sphericalGeometry(geometry).features.filter(f => f.properties.PUMA !== "03810"));
  assert.equal(JSON.stringify(geometry), before);
});

test("historical land display retains all PUMA joins and excludes the western water area", () => {
  const before = JSON.stringify(landGeometry);
  const land = displayGeometry(landGeometry);
  assert.equal(landGeometry.puma_vintage, 2000);
  assert.equal(landGeometry.tiger_basis, 2000);
  assert.equal(buildModel(annual, comparisons, landGeometry).geography.features.length, 10);
  assert.deepEqual(land.features.map(f => f.properties.PUMA), geometry.features.map(f => f.properties.PUMA));
  for (const feature of land.features) {
    assert.ok(d3.geoContains(feature, [feature.properties.INTPTLON, feature.properties.INTPTLAT]));
  }
  const land10 = land.features.find(f => f.properties.PUMA === "03810");
  const original10 = sphericalGeometry(geometry).features.find(f => f.properties.PUMA === "03810");
  assert.ok(d3.geoContains(original10, [-74.01, 40.76]));
  assert.equal(d3.geoContains(land10, [-74.01, 40.76]), false);
  assert.ok(d3.geoArea(land10) < .65 * d3.geoArea(original10));
  assert.equal(d3.geoContains(land10, [-74.0445, 40.6895]), false);
  assert.equal(JSON.stringify(landGeometry), before);
});

test("invalid geography and duplicated comparison data fail explicitly", () => {
  assert.throws(() => buildModel(annual, comparisons, { ...geometry, features: geometry.features.slice(1) }), /ten Manhattan/);
  const duplicate = [...comparisons];
  duplicate[0] = duplicate[1];
  assert.throws(() => buildModel(annual, duplicate, geometry), /Incomplete year pair/);
});

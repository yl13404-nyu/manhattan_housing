// 数值与展示逻辑独立于 DOM / Keep data semantics separate from the DOM.
export const YEARS = Array.from({ length: 20 }, (_, i) => 2006 + i).filter(year => year !== 2020);
export const PUMAS = Array.from({ length: 10 }, (_, i) => `038${String(i + 1).padStart(2, "0")}`);
export const isNumber = value => typeof value === "number" && Number.isFinite(value);

export function rentGrowth(row) {
  if (row.rent_growth_status === "exact" && isNumber(row.rent_growth_nominal_pct)) {
    return { value: row.rent_growth_nominal_pct, kind: "exact" };
  }
  // 只绘制有明确定义的下限 / Plot a lower bound only when explicitly identified.
  if (row.rent_growth_status === "lower_bound" && isNumber(row.rent_growth_nominal_pct_lower_bound)) {
    return { value: row.rent_growth_nominal_pct_lower_bound, kind: "lower_bound" };
  }
  if (row.rent_growth_status === "upper_bound" && isNumber(row.rent_growth_nominal_pct_upper_bound)) {
    return { value: row.rent_growth_nominal_pct_upper_bound, kind: "upper_bound" };
  }
  return { value: null, kind: "unavailable" };
}

// 上限编码租金以已知下限着色，并通过星号及详情说明 / Censored rents use a labeled lower bound.
export function baselineRent(row) {
  if (isNumber(row.median_gross_rent_base)) return { value: row.median_gross_rent_base, kind: "exact" };
  if (row.median_gross_rent_status_base?.startsWith("top_coded_ge_") && isNumber(row.median_gross_rent_lower_bound_base)) {
    return { value: row.median_gross_rent_lower_bound_base, kind: "lower_bound" };
  }
  return { value: null, kind: "unavailable" };
}

export function createDomains(comparisons) {
  const baseRents = comparisons.map(r => baselineRent(r).value).filter(isNumber);
  // 地图颜色与气泡大小仍用全期比例 / Keep map color and bubble size comparable across periods.
  return {
    mapRent: [Math.floor(Math.min(...baseRents) / 250) * 250, Math.ceil(Math.max(...baseRents) / 250) * 250],
    maxHousing: Math.max(...comparisons.map(r => r.housing_units_end).filter(isNumber)),
  };
}

function paddedExtent(values) {
  if (!values.length) return [-1, 1];
  const min = Math.min(...values), max = Math.max(...values);
  // 留出点、气泡与标签的空间；常数和全零数据也保持有效范围。
  // Proportional padding, with a nonzero span for constant/zero data.
  const padding = max > min ? (max - min) * 0.12 : Math.max(Math.abs(min) * 0.12, 1);
  return [min - padding, max + padding];
}

export function createScatterDomains(rows) {
  const points = rows.map(row => ({ row, y: rentGrowth(row).value })).filter(p => isNumber(p.y));
  return {
    y: paddedExtent(points.filter(p => isNumber(p.row.housing_growth_pct) || isNumber(p.row.rent_burden_pct_base)).map(p => p.y)),
    xGrowth: paddedExtent(points.map(p => p.row.housing_growth_pct).filter(isNumber)),
    xBurden: paddedExtent(points.map(p => p.row.rent_burden_pct_base).filter(isNumber)),
  };
}

export function buildModel(annual, comparisons, geography) {
  const annualByKey = new Map(annual.map(r => [`${r.year}:${r.puma}`, r]));
  const comparisonsByPair = new Map();
  if (annual.length !== YEARS.length * 10 || annualByKey.size !== annual.length || comparisons.length !== YEARS.length * (YEARS.length - 1) / 2 * 10) throw new Error("Incomplete or duplicate annual/comparison records.");
  for (const row of comparisons) {
    const key = `${row.base_year}:${row.end_year}`;
    if (!comparisonsByPair.has(key)) comparisonsByPair.set(key, []);
    comparisonsByPair.get(key).push(row);
  }
  const mapPumas = new Set(geography.features.map(f => f.properties.PUMA));
  if (mapPumas.size !== 10 || geography.features.length !== 10) throw new Error("Expected ten Manhattan map features.");
  for (const year of YEARS) {
    if (PUMAS.some(puma => !annualByKey.has(`${year}:${puma}`))) throw new Error(`Incomplete annual year: ${year}`);
  }
  for (const baseYear of YEARS.slice(0, -1)) for (const endYear of YEARS.filter(year => year > baseYear)) {
    const rows = comparisonsByPair.get(`${baseYear}:${endYear}`);
    if (!rows || rows.length !== 10 || new Set(rows.map(r => r.puma)).size !== 10) throw new Error(`Incomplete year pair: ${baseYear}:${endYear}`);
    for (const row of rows) {
      if (!PUMAS.includes(row.puma) || !mapPumas.has(row.puma)
        || !annualByKey.has(`${baseYear}:${row.puma}`) || !annualByKey.has(`${endYear}:${row.puma}`)) throw new Error("Invalid year pair or PUMA join.");
    }
  }
  return { annualByKey, comparisonsByPair, years: YEARS, baseYears: YEARS.slice(0, -1), geography, domains: createDomains(comparisons) };
}

export const endYearsFor = baseYear => YEARS.filter(year => year > baseYear);
export function resolvePeriod(baseYear, endYear) {
  if (!YEARS.slice(0, -1).includes(baseYear)) throw new Error("Invalid baseline year.");
  const available = endYearsFor(baseYear);
  return { baseYear, endYear: available.includes(endYear) ? endYear : available[0] };
}

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const formatInteger = value => isNumber(value) ? integerFormat.format(value) : "Not available";
export function formatPercent(value, signed = false) {
  if (!isNumber(value)) return "Not available";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
export function formatRent(annual) {
  if (annual.median_gross_rent_status?.startsWith("top_coded_ge_") && isNumber(annual.median_gross_rent_lower_bound)) {
    return `at least $${formatInteger(annual.median_gross_rent_lower_bound)}`;
  }
  if (annual.median_gross_rent_status === "bottom_coded_le_100") return "at most $100";
  if (isNumber(annual.median_gross_rent)) return `$${formatInteger(annual.median_gross_rent)}`;
  return "Not available";
}
export function formatRentGrowth(row) {
  const growth = rentGrowth(row);
  return `${growth.kind === "lower_bound" ? "at least " : growth.kind === "upper_bound" ? "at most " : ""}${formatPercent(growth.value, true)}`;
}
export const formatBaselineRent = row => formatRent({ median_gross_rent: row.median_gross_rent_base, median_gross_rent_status: row.median_gross_rent_status_base, median_gross_rent_lower_bound: row.median_gross_rent_lower_bound_base });
export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

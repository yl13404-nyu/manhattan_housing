import { PUMAS, isNumber, rentGrowth } from './model.mjs?v=scale-20261112';

export const TREND_METRICS = [
  { id: 'rent', label: 'Rent growth', dash: '' },
  { id: 'burden', label: 'Rent burden', dash: '7 4' },
  { id: 'housing', label: 'Housing growth', dash: '9 3 2 3' },
];
// North is softer; south is more saturated. Shade within each family is tied
// permanently to 2006 median rent, regardless of the chosen comparison years.
export const PUMA_COLOR_GROUPS = [
  { label: '01–04', pumas: ['03801','03802','03803','03804'], hue: 165, saturation: 28, lightness: [42,56] },
  { label: '06 / 05', pumas: ['03806','03805'], hue: 210, saturation: 46, lightness: [39,53] },
  { label: '07 / 08', pumas: ['03807','03808'], hue: 275, saturation: 63, lightness: [36,50] },
  { label: '10 / 09', pumas: ['03810','03809'], hue: 12, saturation: 85, lightness: [33,47] },
];
export function createPumaColors(model) {
  const colors = {};
  for (const group of PUMA_COLOR_GROUPS) {
    const rents = group.pumas.map(puma => model.annualByKey.get(`2006:${puma}`)?.median_gross_rent);
    if (!rents.every(isNumber)) throw new Error('2006 median rents are required for PUMA colors.');
    const min = Math.min(...rents), max = Math.max(...rents);
    group.pumas.forEach((puma, i) => {
      const position = max === min ? .5 : (rents[i] - min) / (max - min);
      const lightness = group.lightness[1] - position * (group.lightness[1] - group.lightness[0]);
      colors[puma] = `hsl(${group.hue}, ${group.saturation}%, ${lightness.toFixed(2)}%)`;
    });
  }
  return colors;
}
export const isTrendExact = point => point.status === 'exact' && isNumber(point.value);
// Bound markers remain visible but break the line on both sides.
export const isTrendConnected = isTrendExact;

export function buildTrendSeries(model, selected, baseYear, endYear) {
  const colors = createPumaColors(model);
  const years = Array.from({ length: endYear - baseYear + 1 }, (_, i) => baseYear + i);
  const selectedPumas = PUMAS.filter(puma => selected.has(puma));
  const comparisons = new Map(years.filter(y => y > baseYear && y !== 2020).map(year => [year,
    new Map((model.comparisonsByPair.get(`${baseYear}:${year}`) || []).map(row => [row.puma, row]))]));
  return selectedPumas.flatMap(puma => TREND_METRICS.map(metric => ({
    ...metric, puma, key: `${puma}:${metric.id}`, color: colors[puma],
    points: years.map(year => {
      const annual = model.annualByKey.get(`${year}:${puma}`);
      const common = { year, puma, metric: metric.id, sourcePuma: annual?.source_puma ?? null };
      if (!annual) return { ...common, value: null, status: 'unavailable' };
      if (metric.id === 'burden') return { ...common, value: annual.rent_burden_pct, status: isNumber(annual.rent_burden_pct) ? 'exact' : 'unavailable' };
      // A year's change relative to itself is zero, including censored median rents.
      if (year === baseYear) return { ...common, value: 0, status: 'exact' };
      const row = comparisons.get(year)?.get(puma);
      if (!row) return { ...common, value: null, status: 'unavailable' };
      if (metric.id === 'housing') return { ...common, value: row.housing_growth_pct, status: isNumber(row.housing_growth_pct) ? 'exact' : 'unavailable' };
      const growth = rentGrowth(row);
      return { ...common, value: growth.value, status: growth.kind };
    }),
  })));
}

// Spread labels vertically without changing data-point positions.
export function layoutTrendLabels(entries, height) {
  const labels = entries.map(entry => ({ ...entry, labelY: Math.max(0, Math.min(height, entry.y)) })).sort((a,b) => a.y-b.y || a.key.localeCompare(b.key));
  const gap = Math.min(17, height / Math.max(1, labels.length - 1));
  for (let i=1; i<labels.length; i++) labels[i].labelY = Math.max(labels[i].labelY, labels[i-1].labelY + gap);
  if (labels.length) labels.at(-1).labelY = Math.min(height, labels.at(-1).labelY);
  for (let i=labels.length-2; i>=0; i--) labels[i].labelY = Math.min(labels[i].labelY, labels[i+1].labelY-gap);
  return new Map(labels.map(label => [label.key, label]));
}

export function trendDomain(series) {
  const values = series.flatMap(line => line.points.map(p => p.value)).filter(isNumber);
  if (!values.length) return [-1, 1];
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = Math.max((max - min) * .1, 1);
  return [min - pad, max + pad];
}

export const formatTrendValue = point => {
  if (!isNumber(point.value)) return 'Not available';
  const prefix = point.status === 'lower_bound' ? 'at least ' : point.status === 'upper_bound' ? 'at most ' : '';
  return `${prefix}${point.value.toFixed(2)}%`;
};

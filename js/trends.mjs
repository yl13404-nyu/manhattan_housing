import { isNumber, escapeHTML } from './model.mjs?v=scale-20261112';
import { buildTrendSeries, trendDomain, TREND_METRICS, PUMA_COLOR_GROUPS, createPumaColors, isTrendConnected, layoutTrendLabels, formatTrendValue } from './trend-model.mjs?v=four-families-20261112';

const d3 = globalThis.d3;
const SHAPES = { rent: d3.symbolCircle, burden: d3.symbolSquare, housing: d3.symbolTriangle };

export class TrendChart {
  constructor(host, model, onHover = () => {}) {
    this.host = host;
    this.model = model;
    this.pumaColors = createPumaColors(model);
    this.onHover = onHover;
    this.svg = d3.select(host).append('svg').attr('role', 'group');
    this.plot = this.svg.append('g');
    this.plot.append('g').attr('class', 'trend-grid grid');
    this.plot.append('line').attr('class', 'zero-line');
    this.plot.append('g').attr('class', 'trend-gap');
    this.plot.append('g').attr('class', 'axis x-axis');
    this.plot.append('g').attr('class', 'axis y-axis');
    this.plot.append('text').attr('class', 'axis-title y-title').attr('text-anchor', 'middle').text('Percent (%)');
    this.plot.append('text').attr('class', 'axis-title x-title').attr('text-anchor', 'middle').text('Year');
    this.lines = this.plot.append('g').attr('class', 'trend-lines');
    this.tooltip = document.querySelector('#trend-tooltip');
    this.focused = null;
    this.renderMetricLegend();
  }

  renderMetricLegend() {
    const families = d3.select('#trend-color-legend').selectAll('.trend-color-family').data(PUMA_COLOR_GROUPS).join('span').attr('class', 'trend-color-family');
    families.each(function(group) {
      const item = d3.select(this);
      item.selectAll('*').remove();
      item.append('span').attr('class', 'trend-color-ramp').attr('aria-hidden', 'true')
        .style('background', `linear-gradient(to right, hsl(${group.hue},${group.saturation}%,${group.lightness[0]}%), hsl(${group.hue},${group.saturation}%,${group.lightness[1]}%))`);
      item.append('span').text(group.label);
    });
    const items = d3.select('#trend-metric-legend').selectAll('.trend-metric').data(TREND_METRICS).join('span').attr('class', 'trend-metric');
    items.each(function(metric) {
      const item = d3.select(this);
      item.selectAll('*').remove();
      const icon = item.append('svg').attr('viewBox', '0 0 34 18').attr('aria-hidden', 'true');
      icon.append('line').attr('x1', 0).attr('x2', 34).attr('y1', 9).attr('y2', 9).attr('stroke', '#496069').attr('stroke-width', 2).attr('stroke-dasharray', metric.dash || null);
      icon.append('path').attr('transform', 'translate(17,9)').attr('d', d3.symbol(SHAPES[metric.id], 35)()).attr('fill', '#496069');
      item.append('span').text(metric.label);
    });
  }

  hideTooltip() {
    this.tooltip.hidden = true;
    if (this.focused) this.focused.removeAttribute('aria-describedby');
    this.focused = null;
  }

  showTooltip(event, point, element) {
    const metric = TREND_METRICS.find(m => m.id === point.metric);
    this.hideTooltip();
    this.focused = element;
    const description = point.metric === 'burden' ? 'Share of computable renter households with gross rent ≥30% of income.' : `Cumulative change from ${this.baseYear}; not annualized.`;
    this.tooltip.innerHTML = `<div class="tooltip-kicker">PUMA ${escapeHTML(point.puma)} · ${point.year}</div><div class="tooltip-heading"><h3>${metric.label}</h3><span>${formatTrendValue(point)}</span></div><p class="tooltip-note">${description}</p><p class="tooltip-note">Source PUMA ${escapeHTML(point.sourcePuma)}.</p>${point.status !== 'exact' ? '<p class="tooltip-note">Coding bound only; shown as a point with no connecting line.</p>' : ''}`;
    this.tooltip.hidden = false;
    element.setAttribute('aria-describedby', 'trend-tooltip');
    this.moveTooltip(event, element);
  }

  moveTooltip(event, element = this.focused) {
    if (this.tooltip.hidden) return;
    const rect = element?.getBoundingClientRect();
    const x = isNumber(event?.clientX) ? event.clientX : rect.left + rect.width / 2;
    const y = isNumber(event?.clientY) ? event.clientY : rect.top;
    const box = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(12, Math.min(document.documentElement.clientWidth - box.width - 12, x + 18))}px`;
    this.tooltip.style.top = `${Math.max(12, Math.min(innerHeight - box.height - 12, y - box.height - 12))}px`;
  }

  highlight(puma) {
    const groups = this.lines.selectAll('.trend-series');
    groups.attr('opacity', line => puma && line.puma !== puma ? .14 : 1).classed('is-active', line => line.puma === puma);
    if (puma) groups.filter(line => line.puma === puma).raise();
  }

  render(selected, baseYear, endYear) {
    this.hideTooltip();
    this.baseYear = baseYear;
    const series = buildTrendSeries(this.model, selected, baseYear, endYear);
    document.querySelector('#trend-empty').hidden = series.length > 0;
    this.host.hidden = series.length === 0;
    document.querySelector('#trend-selection-status').textContent = selected.size ? [...selected].sort().map(p => `PUMA ${p}`).join(' · ') : 'No PUMA selected';
    if (!series.length) return;
    const fullWidth = Math.max(280, this.host.clientWidth), fullHeight = 700;
    const margin = { top: 30, right: 92, bottom: 52, left: 58 };
    const width = fullWidth - margin.left - margin.right, height = fullHeight - margin.top - margin.bottom;
    const x = d3.scaleLinear([baseYear, endYear], [0, width]);
    const y = d3.scaleLinear(trendDomain(series), [height, 0]).nice(6);
    this.svg.attr('viewBox', `0 0 ${fullWidth} ${fullHeight}`).attr('data-base-year', baseYear).attr('data-end-year', endYear)
      .attr('aria-label', `Selected PUMA annual trends, ${baseYear} to ${endYear}. Rent growth and housing growth relative to ${baseYear}; annual rent burden. 2020 is missing.`);
    this.plot.attr('transform', `translate(${margin.left},${margin.top})`);
    const years = [...new Set([baseYear, ...d3.ticks(baseYear, endYear, Math.max(2, Math.min(9, Math.floor(width/85)))).filter(Number.isInteger), endYear])].sort((a,b) => a-b);
    this.plot.select('.x-axis').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).tickValues(years).tickFormat(d3.format('d')).tickSizeOuter(0));
    this.plot.select('.y-axis').call(d3.axisLeft(y).ticks(6).tickFormat(d => `${d}%`).tickSizeOuter(0));
    this.plot.select('.trend-grid').call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(''));
    this.plot.select('.zero-line').attr('x1', 0).attr('x2', width).attr('y1', y(0)).attr('y2', y(0));
    this.plot.select('.y-title').attr('transform', `translate(-44,${height/2}) rotate(-90)`);
    this.plot.select('.x-title').attr('x', width/2).attr('y', height + 40);
    const gap = this.plot.select('.trend-gap');
    gap.selectAll('*').remove();
    if (baseYear < 2020 && endYear > 2020) {
      gap.append('rect').attr('x', x(2019.7)).attr('width', x(2020.3) - x(2019.7)).attr('height', height).attr('fill', '#edf0ed');
      gap.append('text').attr('x', x(2020)).attr('y', -12).attr('text-anchor', 'middle').attr('fill', '#78878b').attr('font-size', 10).text('2020 · no data');
    }
    const line = d3.line().defined(isTrendConnected).x(p => x(p.year)).y(p => y(p.value));
    const endpoints = layoutTrendLabels(series.flatMap(s => {
      const point = s.points.findLast(p => isNumber(p.value));
      return point ? [{ key: s.key, point, y: y(point.value) }] : [];
    }), height);
    const groups = this.lines.selectAll('.trend-series').data(series, s => s.key).join('g').attr('class', 'trend-series').attr('data-puma', s => s.puma).attr('data-metric', s => s.id)
      .on('pointerenter', (_, s) => this.onHover(s.puma)).on('pointerleave', () => this.onHover(null))
      .on('focusin', (_, s) => this.onHover(s.puma)).on('focusout', () => this.onHover(null));
    groups.each((series, i, nodes) => {
      const group = d3.select(nodes[i]);
      group.selectAll('path.trend-line-hit').data([series]).join('path').attr('class', 'trend-line-hit')
        .attr('d', s => line(s.points)).attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 12).attr('pointer-events', 'stroke');
      group.selectAll('path.trend-line').data([series]).join('path').attr('class', 'trend-line')
        .attr('d', s => line(s.points)).attr('fill', 'none').attr('stroke', series.color).attr('stroke-dasharray', series.dash || null);
      const points = group.selectAll('.trend-point').data(series.points.filter(p => isNumber(p.value)), p => p.year).join(enter => {
        const point = enter.append('g').attr('class', 'trend-point');
        point.append('circle').attr('class', 'trend-hit').attr('r', 9).attr('fill', 'transparent');
        point.append('path').attr('class', 'trend-symbol');
        point.append('text').attr('class', 'trend-bound-label').attr('x', 6).attr('y', -6);
        return point;
      });
      points.attr('transform', p => `translate(${x(p.year)},${y(p.value)})`).attr('tabindex', 0).attr('role', 'img')
        .attr('data-year', p => p.year).attr('data-status', p => p.status).attr('data-value', p => p.value)
        .attr('aria-label', p => `PUMA ${p.puma}, ${p.year}, ${series.label}: ${formatTrendValue(p)}`)
        .on('pointerenter', (event, p) => this.showTooltip(event, p, event.currentTarget))
        .on('pointermove', event => this.moveTooltip(event)).on('pointerleave', () => this.hideTooltip())
        .on('focus', (event, p) => this.showTooltip(null, p, event.currentTarget)).on('blur', () => this.hideTooltip());
      points.select('.trend-symbol').attr('d', d3.symbol(SHAPES[series.id], 28)()).attr('fill', p => p.status === 'exact' ? series.color : '#fff').attr('stroke', series.color).attr('stroke-width', 1.4);
      points.select('.trend-bound-label').text(p => p.status === 'exact' ? '' : '*').attr('fill', series.color);
      const endpoint = endpoints.get(series.key);
      // Bounds receive a label but no leader, so no line touches the bound point.
      group.selectAll('.trend-end-leader').data(endpoint && isTrendConnected(endpoint.point) ? [endpoint] : []).join('path').attr('class', 'trend-end-leader')
        .attr('d', d => `M${x(d.point.year)},${d.y}L${width+8},${d.labelY}`).attr('fill', 'none').attr('stroke', series.color);
      const label = group.selectAll('.trend-end-label').data(endpoint ? [endpoint] : []).join('text').attr('class', 'trend-end-label')
        .attr('x', width + 12).attr('y', d => d.labelY).attr('dy', '.35em').attr('fill', d3.hsl(series.color).darker(.4).formatHex())
        .attr('tabindex', 0).attr('role', 'img').attr('aria-label', d => `PUMA ${series.puma}, ${series.label}, last available year ${d.point.year}: ${formatTrendValue(d.point)}`)
        .text(d => `${series.puma}${d.point.status === 'exact' ? '' : '*'}`);
      label.on('pointerenter', (event, d) => this.showTooltip(event, d.point, event.currentTarget)).on('pointerleave', () => this.hideTooltip())
        .on('focus', (event, d) => this.showTooltip(null, d.point, event.currentTarget)).on('blur', () => this.hideTooltip());
    });
    this.highlight(null);
  }
}

export function renderPumaControls(selected, onToggle, pumas, colors, onHover = () => {}) {
  const controls = d3.select('#trend-puma-controls').selectAll('button').data(pumas).join('button')
    .attr('type', 'button').attr('class', 'puma-toggle').attr('data-puma', p => p).attr('aria-label', p => `Toggle PUMA ${p}`)
    .style('--puma-color', p => colors[p])
    .attr('aria-pressed', p => String(selected.has(p))).on('click', (_, puma) => onToggle(puma))
    .on('pointerenter', (_, puma) => onHover(puma)).on('pointerleave', () => onHover(null))
    .on('focus', (_, puma) => onHover(puma)).on('blur', () => onHover(null));
  controls.each(function(puma) {
    const button = d3.select(this);
    button.selectAll('*').remove();
    button.append('svg').attr('viewBox', '0 0 12 12').attr('aria-hidden', 'true').append('circle').attr('cx', 6).attr('cy', 6).attr('r', 5).attr('fill', colors[puma]);
    button.append('span').text(puma);
  });
}

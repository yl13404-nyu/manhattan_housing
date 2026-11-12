import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildModel, PUMAS } from '../js/model.mjs';
import { buildTrendSeries, trendDomain, isTrendExact, isTrendConnected, layoutTrendLabels, createPumaColors, PUMA_COLOR_GROUPS, formatTrendValue } from '../js/trend-model.mjs';
const require = createRequire(import.meta.url);
const d3 = require('../vendor/d3.v7.min.js');
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url),'utf8'));
const model = buildModel(read('manhattan_annual_2006_2025.json'),read('manhattan_comparisons_all_baselines_2006_2025.json'),read('manhattan_puma_2000_land.geojson'));

test('no selection yields no series; each selected PUMA has three distinct metric lines', () => {
  assert.deepEqual(buildTrendSeries(model,new Set(),2006,2025),[]);
  const selected = new Set(['03801','03810']);
  const series = buildTrendSeries(model,selected,2006,2025);
  assert.equal(series.length,6);
  assert.equal(new Set(series.map(s=>s.key)).size,6);
  assert.equal(buildTrendSeries(model,new Set(PUMAS),2006,2025).length,30);
  assert.ok(series.filter(s=>s.id==='rent').every(s=>s.dash===''));
  assert.equal(series.find(s=>s.puma==='03801'&&s.id==='burden').dash,series.find(s=>s.puma==='03810'&&s.id==='burden').dash);
  assert.equal(new Set(Object.values(createPumaColors(model))).size,10);
  for(const puma of selected) {
    const own=series.filter(s=>s.puma===puma);
    assert.equal(new Set(own.map(s=>s.color)).size,1);
    assert.equal(new Set(own.map(s=>s.dash)).size,3);
  }
  assert.notEqual(series[0].color,series[3].color);
  const otherOrder=buildTrendSeries(model,new Set(['03810','03801']),2019,2025);
  for(const line of otherOrder) {
    const original=series.find(s=>s.key===line.key);
    assert.equal(line.color,original.color);
    assert.equal(line.dash,original.dash);
  }
  assert.deepEqual([...selected],['03801','03810']);
});

test('four families follow geography; shade follows 2006 rent within each family', () => {
  const colors=createPumaColors(model);
  assert.deepEqual(PUMA_COLOR_GROUPS.map(g=>g.pumas),[
    ['03801','03802','03803','03804'],['03806','03805'],['03807','03808'],['03810','03809']
  ]);
  for(const [i,group]of PUMA_COLOR_GROUPS.entries()) {
    const ranked=[...group.pumas].sort((a,b)=>model.annualByKey.get(`2006:${a}`).median_gross_rent-model.annualByKey.get(`2006:${b}`).median_gross_rent);
    for(const puma of ranked) {
      const color=d3.hsl(colors[puma]);
      assert.ok(Number.isFinite(color.h));
      assert.equal(color.h,group.hue);
      assert.equal(color.s,group.saturation/100);
    }
    for(let j=1;j<ranked.length;j++)assert.ok(d3.hsl(colors[ranked[j]]).l<d3.hsl(colors[ranked[j-1]]).l);
    if(i) {
      assert.ok(group.saturation>PUMA_COLOR_GROUPS[i-1].saturation);
      assert.ok(group.lightness[0]<PUMA_COLOR_GROUPS[i-1].lightness[0]);
      assert.ok(group.lightness[1]<PUMA_COLOR_GROUPS[i-1].lightness[1]);
    }
  }
  assert.deepEqual(['03801','03802','03803','03804'].sort((a,b)=>d3.hsl(colors[a]).l-d3.hsl(colors[b]).l),['03801','03802','03803','03804']);
  assert.ok(d3.hsl(colors['03805']).l<d3.hsl(colors['03806']).l);
  assert.ok(d3.hsl(colors['03808']).l<d3.hsl(colors['03807']).l);
  assert.ok(d3.hsl(colors['03810']).l<d3.hsl(colors['03809']).l);
});

test('all 171 periods retain exact annual burden and the correct baseline growth for all PUMAs', () => {
  for (const base of model.baseYears) for (const end of model.years.filter(y=>y>base)) {
    const series = buildTrendSeries(model,new Set(PUMAS),base,end);
    assert.equal(series.length,30);
    for(const line of series) {
      assert.equal(line.points.length,end-base+1);
      assert.equal(line.points[0].year,base);
      assert.equal(line.points.at(-1).year,end);
      for(const point of line.points) {
        if(point.year===2020){ assert.equal(point.value,null); continue; }
        const annual=model.annualByKey.get(`${point.year}:${line.puma}`);
        if(line.id==='burden')assert.equal(point.value,annual.rent_burden_pct);
        else if(point.year===base)assert.equal(point.value,0);
        else {
          const row=model.comparisonsByPair.get(`${base}:${point.year}`).find(r=>r.puma===line.puma);
          if(line.id==='housing')assert.equal(point.value,row.housing_growth_pct);
          else {
            const expected=row.rent_growth_status==='exact'?row.rent_growth_nominal_pct:row.rent_growth_status==='lower_bound'?row.rent_growth_nominal_pct_lower_bound:row.rent_growth_status==='upper_bound'?row.rent_growth_nominal_pct_upper_bound:null;
            assert.equal(point.value,expected);
          }
        }
      }
    }
    const domain=trendDomain(series);
    for(const line of series)for(const point of line.points)if(point.value!==null)assert.ok(point.value>domain[0]&&point.value<domain[1]);
  }
});

test('2020 is a true calendar gap in line paths, never connected or filled', () => {
  const series=buildTrendSeries(model,new Set(['03801']),2019,2022);
  const line=d3.line().defined(isTrendConnected).x(p=>p.year).y(p=>p.value);
  for(const s of series) {
    assert.deepEqual(s.points.map(p=>p.year),[2019,2020,2021,2022]);
    assert.equal(s.points[1].value,null);
    assert.equal((line(s.points).match(/M/g)||[]).length,2);
  }
});

test('rent bounds are isolated points, breaking the solid line on both sides', () => {
  const rent=buildTrendSeries(model,new Set(['03810']),2006,2025).find(s=>s.id==='rent');
  const bound=rent.points.find(p=>p.year===2024);
  assert.equal(bound.status,'lower_bound');
  assert.equal(isTrendExact(bound),false);
  assert.equal(isTrendConnected(bound),false);
  assert.match(formatTrendValue(bound),/^at least /);
  const upper=buildTrendSeries(model,new Set(['03810']),2009,2015).find(s=>s.id==='rent').points.at(-1);
  assert.equal(upper.status,'upper_bound');
  assert.match(formatTrendValue(upper),/^at most /);
  assert.equal(isTrendExact(upper),false);
  assert.equal(isTrendConnected(upper),false);
  const early=rent.points.filter(p=>p.year<=2014);
  const line=d3.line().defined(isTrendConnected).x(p=>p.year).y(p=>p.value);
  assert.equal((line(early).match(/M/g)||[]).length,1);
  assert.equal(line(early),line(rent.points.filter(p=>p.year<=2008)));
  const synthetic=[{metric:'rent',year:2006,value:0,status:'exact'},{metric:'rent',year:2007,value:1,status:'lower_bound'},{metric:'rent',year:2008,value:2,status:'exact'}];
  assert.equal((line(synthetic).match(/M/g)||[]).length,2);
  assert.equal(isTrendConnected({metric:'rent',value:null,status:'unavailable'}),false);
});

test('all 30 endpoint labels fit without overlap in every period; points stay in place', () => {
  for(const base of model.baseYears)for(const end of model.years.filter(y=>y>base)) {
    const series=buildTrendSeries(model,new Set(PUMAS),base,end);
    const y=d3.scaleLinear(trendDomain(series),[618,0]).nice(6);
    const endpoints=series.map(s=>({key:s.key,point:s.points.findLast(p=>p.value!==null)})).map(d=>({...d,y:y(d.point.value)}));
    const original=JSON.stringify(endpoints);
    const labels=[...layoutTrendLabels(endpoints,618).values()];
    assert.equal(labels.length,30);
    for(const [i,label]of labels.entries()) {
      assert.ok(label.labelY>=-1e-9&&label.labelY<=618);
      if(i)assert.ok(label.labelY-labels[i-1].labelY>=17-1e-9);
    }
    assert.equal(JSON.stringify(endpoints),original);
  }
});

test('changing baseline resets growth to zero but preserves annual burden levels', () => {
  const old=buildTrendSeries(model,new Set(['03801']),2006,2025);
  const recent=buildTrendSeries(model,new Set(['03801']),2019,2025);
  for(const id of ['rent','housing']) {
    assert.equal(recent.find(s=>s.id===id).points[0].value,0);
    assert.notEqual(recent.find(s=>s.id===id).points.at(-1).value,old.find(s=>s.id===id).points.at(-1).value);
  }
  assert.equal(recent.find(s=>s.id==='burden').points.at(-1).value,old.find(s=>s.id==='burden').points.at(-1).value);
  assert.deepEqual(trendDomain([]),[-1,1]);
});

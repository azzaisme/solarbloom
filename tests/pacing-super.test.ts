import { describe, it } from 'vitest';
import { fmt, toNum } from '../src/core/Big';
import { TUNING } from '../src/data/tuning';
import { mmss, runBot } from './bots';

/**
 * Phase 5 pacing pass: the merge → superstructure loop, measured with the scripted merging bot (not people).
 * `PACING=1 npx vitest run tests/pacing-super.test.ts` prints the full table (60 minutes, seeds 7 and 21, plus a
 * control bot that builds the same machines and never merges). Skipped without PACING (two 60-minute bots per seed take tens of minutes).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const FULL = !!env.PACING;
const MARKS = [15, 30, 45, 60];
// Tuning experiments: PACING_TUNE='{"super":{"stageSeconds":[45,120,240]}}' overrides those knobs for this run.
if (env.PACING_TUNE) {
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from))
      if (v && typeof v === 'object' && !Array.isArray(v)) merge(into[k] as Record<string, unknown>, v as Record<string, unknown>);
      else into[k] = v;
  };
  merge(TUNING as unknown as Record<string, unknown>, JSON.parse(env.PACING_TUNE));
}

interface Row {
  seed: number;
  bot: string;
  firstMerge?: number;
  firstCore?: number;
  firstSuper?: number;
  supers: number;
  abilities: Record<string, number>;
  biomass: Record<number, number>;
  merges: number;
}

function measure(seed: number, minutes: number, merges: boolean | 'buildOnly'): Row {
  const biomass: Record<number, number> = {};
  const abilities: Record<string, number> = {};
  let firstCore: number | undefined;
  let hooked = false;
  let supers = 0;
  const r = runBot({
    seed,
    minutes,
    merges,
    onSecond: (sim) => {
      if (!hooked) {
        hooked = true;
        sim.bus.on('super.ability', ({ machine }) => {
          const k = sim.supers.kind(machine) ?? '?';
          abilities[k] = (abilities[k] ?? 0) + 1;
        });
      }
      if (firstCore === undefined && sim.supers.cores().length) firstCore = sim.time;
      if (env.PACING_DEBUG && Math.round(sim.time) % 60 === 0) {
        const p = sim.state.machines.find((m) => m.project);
        const nc = p && sim.supers.nextCost(p);
        const fnd = sim.supers.stageCosts()[0];
        console.log(
          `${Math.round(sim.time / 60)}m cores=${sim.supers.cores().map((c) => c.type)} proj=${p ? `${p.type}@${p.project!.stage} next=${Object.entries(nc ?? {}).map(([k, v]) => `${k}:${fmt(v!)}`)}` : '-'} found=${Object.entries(fnd).map(([k, v]) => `${k}:${fmt(v!)}`)} res=${(['energy', 'water', 'biomass'] as const).map((k) => fmt(sim.state.resources[k]) + '/' + (k === 'biomass' ? '∞' : fmt(sim.state.caps[k])))} t2=${sim.state.machines.filter((m) => m.tier === 2).map((m) => m.type[0]).join('')} built=${sim.state.stats.supers ?? 0}`,
        );
      }
      for (const m of MARKS) if (biomass[m] === undefined && m <= minutes && sim.time >= m * 60 - 1.5) biomass[m] = toNum(sim.production.rates(true).biomass) * 60;
      supers = sim.state.stats.supers ?? 0;
    },
  });
  const coreMerge = r.merges.find((m) => m.type.endsWith(':core'));
  return {
    seed,
    bot: merges === true ? 'merges + supers' : merges === 'buildOnly' ? 'builds, no merges' : 'no merges',
    firstMerge: r.merges[0]?.t,
    firstCore: firstCore ?? coreMerge?.t,
    firstSuper: r.firsts.firstSuper,
    supers,
    abilities,
    biomass,
    merges: r.merges.length,
  };
}

function print(rows: Row[]) {
  const lines = ['| Seed | Bot | First merge | First core | First superstructure | Built | Abilities fired | ' + MARKS.map((m) => `${m} min`).join(' | ') + ' |'];
  for (const r of rows) {
    const ab = Object.entries(r.abilities).map(([k, n]) => `${k} ${n}`).join(', ') || '0';
    lines.push(`| ${r.seed} | ${r.bot} | ${mmss(r.firstMerge)} | ${mmss(r.firstCore)} | ${mmss(r.firstSuper)} | ${r.supers} | ${ab} | ${MARKS.map((m) => (r.biomass[m] === undefined ? '—' : fmt(r.biomass[m]))).join(' | ')} |`);
  }
  console.log(lines.join('\n'));
}

describe.skipIf(!FULL)('pacing pass (bots, full table)', () => {
  for (const seed of env.PACING_SEED ? [Number(env.PACING_SEED)] : [7, 21])
    it(`seed ${seed}`, () => {
      const minutes = Number(env.PACING_MIN ?? 60);
      const rows = [measure(seed, minutes, true), ...(env.PACING_CONTROL === '0' ? [] : [measure(seed, minutes, 'buildOnly' as const)])];
      print(rows);
    }, 1_800_000);
});

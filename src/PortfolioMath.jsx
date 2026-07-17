import { useState, useEffect, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// THE VOLUME THESIS — v17
// v17 changelog:
// - Overview loads at 30 positions; Concentrated vs Distributed opens with
//   400 distributed. The two controls are two-way synced: changing either
//   updates portfolio size on every tab.
// - Distributed portfolio is GREEN everywhere: sliders, number inputs, and
//   current-position markers on all charts.
// - Dilution & Entry Assumptions panel added to the Assumptions tab:
//   blended entry post-money input plus a per-tier effective-retention
//   slider (dilution + realization discount), decomposing each tier's
//   multiple as raw multiple x retention. Edits flow into the custom
//   distribution and every tab.
//
// Prior version (v16):
// v16 changelog:
// - Multiples recalibrated to Carta per-round dilution data (A ~19%,
//   B ~15%, C ~11%, D ~9%): seed-investor retention ~59-53% through a
//   Series C/D exit, not the ~30% v14-v15 implied. Unicorn tier 30x → 55x,
//   decacorn 300x → 400x, centicorn 2500x → 5000x, terracorn 12000x →
//   20000x, and all mid tiers raised accordingly.
// - Monte Carlo sweep now computes in chunks (3 sizes per tick) with a
//   visible progress percentage — v15 blocked the main thread and looked
//   frozen at 1,000-position range.
// - Follow-on tab now uses the global reserves state (was a separate
//   40%-defaulted control); reserves sync across all tabs.
// - Portfolio-size number inputs step by 10 and are wide enough that the
//   spinner no longer covers digits.
// - Kelly worked example updated: at honest multiples (55x, 2% cumulative
//   unicorn rate) single-tier Kelly is POSITIVE (~540 positions full
//   Kelly).
//
// Prior version (v15):
// v15 changelog:
// - Default preset: industry average (first-time visitors start from the
//   honest baseline; blend and YC one click away). Default reserves 10%,
//   default recycling 10% of committed capital.
// - Exit horizon control removed; every cohort holds a standardized 10
//   years from its capital call (Crunchbase: SaaS median 9yr to exit;
//   SaaStr: 10.0yr median for $1B+ SaaS acquisitions).
// - Fund economics rebuilt on explicit cohort cashflows with a true
//   European waterfall (LPs receive 100% until commitments returned, then
//   80/20). Gross IRR on invested capital satisfies the rule-of-72 check:
//   3x over 10 years = 11.6%.
// - Recycling reframed as % of committed capital (0-20%), replacing the
//   0-100% "fee recycling" control.
// - Full-distribution Kelly (Thorp 2006) computed live on the Kelly tab;
//   per-tier "no edge" results reframed as the limitation they are.
// - Custom assumptions can be saved as a "My assumptions" preset available
//   on every tab.
// - Chart x-axes labeled every 100 positions to 1,000; overlap fixed.
// - Per-tier probability slider ranges scaled to tier magnitude.
// - Header and all cards pure black.
//
// Prior version (v14):
// v14 changelog:
// - Distribution expanded from 7 to 12 tiers, spanning total loss through
//   terracorn ($1T+). Multiples are post-dilution returns to a ~$15M
//   blended pre-seed/seed entry (Carta 2025 medians).
// - New sub-$100M exit tier ($30–75M → 2x) capturing small acquisitions.
// - Three presets: Industry average, YC-calibrated, and a 50/50 blend
//   (default) modeling a portfolio sourced half from YC, half broader.
// - Terracorn tier added; base rate counts nine $1T+ VC-backed companies
//   including SpaceX (June 2026 IPO at $2.1T) and OpenAI (forward-looking
//   inclusion, disclosed in footer).
//
// Prior version (v13):
// An interactive model of venture portfolio construction under power-law
// outcome distributions. All distributional assumptions are editable in the
// Assumptions tab and sourced in the footer.
//
// v13 changelog:
// - Outcome tiers recalibrated to published data: centicorn 0.02%×2000x
//   (industry) / 0.05% (YC); decacorn 0.12% / 0.3%. Prior rates exceeded
//   what PitchBook/CB Insights hectocorn counts support (~25-40 VC-backed
//   companies have ever crossed $100B, out of several hundred thousand
//   funded).
// - Default preset: YC-calibrated. Default portfolio size: 150.
// - Deployment period: 4 years. Portfolio size range: 5–1,000.
// - Exit horizon input scales J-curve distribution timing (affects IRR,
//   not MOIC).
// - Fund economics: management fees reduce investable capital; adjustable
//   fee recycling (default 100%) offsets per standard seed-fund practice;
//   carry applies above 1x of committed capital (European waterfall).
// - Monte Carlo sweeps seeded per portfolio size: reproducible, smooth
//   curves. Percentile band chart added (10/25/50/75/90th).
// - Reserve/threshold/check inputs display live delta vs a shared-seed
//   zero-reserve baseline.
// - Rare-tier probability inputs display at 0.001% resolution.
// - Theme: pure black.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  preset: "blind",
  skill: 0,
  numInvestments: 30,
  reserveRatio: 0.10,
  markupThreshold: 3,
  followOnMult: 2,
  recyclePct: 0.10,   // fraction of committed capital recycled (0-20%)
};

const DEPLOYMENT_YEARS = 4;


// ─── PRESETS ─────────────────────────────────────────────────────────────────
// 12-tier outcome distributions. Multiples are post-dilution returns to a
// blended pre-seed/seed entry (~$15M post-money: Carta 2025 medians are
// $10M pre-seed SAFE caps and $20M seed post-money). Exit-value bands and
// probability sources are documented in outcome-distribution-assumptions.md
// and linked in the footer.
const PRESET_BLIND_POOL = [
  { label: "Total Loss (0x)",          multiplier: 0,     prob: 0.52,     color: "#6b1a1a", emoji: "💀" },
  { label: "Walking Dead (1x)",        multiplier: 1,     prob: 0.13,     color: "#a33d2a", emoji: "🚶" },
  { label: "Small Exit $30–75M (3x)",  multiplier: 3,     prob: 0.10,     color: "#b06035", emoji: "🤝" },
  { label: "Exit ~$100–150M (6x)",     multiplier: 6,     prob: 0.12,     color: "#c4783a", emoji: "✅" },
  { label: "Good Exit ~$400M (15x)",   multiplier: 15,    prob: 0.06,     color: "#c8a94e", emoji: "🎯" },
  { label: "Big Exit ~$750M (25x)",    multiplier: 25,    prob: 0.025,    color: "#a8b34e", emoji: "🏆" },
  { label: "Unicorn $1–3B (55x)",      multiplier: 55,    prob: 0.015,    color: "#4e9e6e", emoji: "🦄" },
  { label: "Mega $3–10B (150x)",       multiplier: 150,   prob: 0.0038,   color: "#3e8e8e", emoji: "💎" },
  { label: "Decacorn $10–25B (400x)",  multiplier: 400,   prob: 0.0007,   color: "#3a7abf", emoji: "🔥" },
  { label: "Ultra $25–100B (1200x)",   multiplier: 1200,  prob: 0.0003,   color: "#5a5fbf", emoji: "⚡" },
  { label: "Centicorn $100B–1T (5000x)", multiplier: 5000, prob: 0.00018, color: "#7c5cbf", emoji: "🚀" },
  { label: "Terracorn $1T+ (20000x)",  multiplier: 20000, prob: 0.000018, color: "#a55cbf", emoji: "🌌" },
];

const PRESET_YC = [
  { label: "Total Loss (0x)",          multiplier: 0,     prob: 0.42,     color: "#6b1a1a", emoji: "💀" },
  { label: "Walking Dead (1x)",        multiplier: 1,     prob: 0.14,     color: "#a33d2a", emoji: "🚶" },
  { label: "Small Exit $30–75M (3x)",  multiplier: 3,     prob: 0.12,     color: "#b06035", emoji: "🤝" },
  { label: "Exit ~$100–150M (6x)",     multiplier: 6,     prob: 0.14,     color: "#c4783a", emoji: "✅" },
  { label: "Good Exit ~$400M (15x)",   multiplier: 15,    prob: 0.08,     color: "#c8a94e", emoji: "🎯" },
  { label: "Big Exit ~$750M (25x)",    multiplier: 25,    prob: 0.035,    color: "#a8b34e", emoji: "🏆" },
  { label: "Unicorn $1–3B (55x)",      multiplier: 55,    prob: 0.045,    color: "#4e9e6e", emoji: "🦄" },
  { label: "Mega $3–10B (150x)",       multiplier: 150,   prob: 0.011,    color: "#3e8e8e", emoji: "💎" },
  { label: "Decacorn $10–25B (400x)",  multiplier: 400,   prob: 0.0019,   color: "#3a7abf", emoji: "🔥" },
  { label: "Ultra $25–100B (1200x)",   multiplier: 1200,  prob: 0.0006,   color: "#5a5fbf", emoji: "⚡" },
  { label: "Centicorn $100B–1T (5000x)", multiplier: 5000, prob: 0.00045, color: "#7c5cbf", emoji: "🚀" },
  { label: "Terracorn $1T+ (20000x)",  multiplier: 20000, prob: 0.00002,  color: "#a55cbf", emoji: "🌌" },
];

// 50/50 blend of industry-average and YC-calibrated — models a portfolio
// sourced half from YC batches and half from the broader early-stage market.
const PRESET_BLEND = PRESET_BLIND_POOL.map((d, i) => ({
  ...d,
  prob: (d.prob + PRESET_YC[i].prob) / 2,
}));

// ─── MATH ────────────────────────────────────────────────────────────────────
function normalize(dist) {
  const total = dist.reduce((s, d) => s + d.prob, 0);
  return dist.map(d => ({ ...d, prob: d.prob / total }));
}

// Exit-value band midpoints ($M) per tier index, used by the dilution panel
// to decompose each tier's multiple into raw multiple x effective retention.
const EXIT_MIDS = [null, null, 50, 125, 400, 750, 1750, 5500, 15000, 50000, 250000, 1500000];

function applySelection(dist, skill) {
  if (skill === 0) return dist;
  const tiltUp = skill > 0, k = Math.abs(skill);
  return dist.map(d => {
    let p = d.prob;
    if (d.multiplier >= 55) {
      p = d.prob * (tiltUp ? 1 + k * (d.multiplier >= 5000 ? 2 : d.multiplier >= 400 ? 1.5 : 1) : 1 - k * 0.6);
    } else if (d.multiplier === 0) {
      p = tiltUp ? d.prob * (1 - k * 0.15) : d.prob * (1 + k * 0.15);
    }
    return { ...d, prob: Math.max(0.0001, p) };
  });
}

function probAtLeastOne(dist, n, thresh) {
  const p = dist.filter(d => d.multiplier >= thresh).reduce((s, d) => s + d.prob, 0);
  return 1 - Math.pow(1 - p, n);
}

function expectedMultiple(dist) {
  return dist.reduce((s, d) => s + d.prob * d.multiplier, 0);
}

function kellyTotalPositions(dist) {
  const u = dist.find(d => d.label.includes("Unicorn"));
  if (!u) return 150;
  const p = u.prob, b = u.multiplier - 1;
  const f = Math.max(0.001, p - (1 - p) / b);
  return Math.round(1 / f);
}

function sampleOutcome(dist, rng = Math.random) {
  const r = rng();
  let cum = 0;
  for (const d of dist) {
    cum += d.prob;
    if (r < cum) return d.multiplier;
  }
  return dist[dist.length - 1].multiplier;
}

// Mulberry32 seeded RNG — deterministic sims for shared-seed scenarios
function seededRng(seed) {
  let s = seed >>> 0;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Map 5-point skill scale (1-5) to internal skill value (-1 to +1)
// 1 = below avg, 2 = slightly below, 3 = average, 4 = above avg, 5 = excellent
function skillValue(skillPoint) {
  return (skillPoint - 3) / 2; // 1→-1, 2→-0.5, 3→0, 4→0.5, 5→1
}

function skillLabel(skillPoint) {
  return ["Below average", "Slightly below average", "Average", "Above average", "Excellent"][skillPoint - 1] || "Average";
}

// FIXED: portfolio sim with correct reserves accounting.
// v8 addition: skill parameter affects follow-on outcome multiplier.
// Skilled GPs pick better winners to follow on into (pattern-match beyond
// the threshold signal). Skill 0 = blind threshold-based follow-on. Skill
// +1 = follow-ons outperform the threshold-signal baseline by ~20%.
function simPortfolio(n, nSim, dist, reserveRatio = 0, markupThreshold = 3, followOnMult = 2, skillPt = 3, seed = null) {
  const res = [];
  const initialCapitalFrac = 1 - reserveRatio;
  const initialPerCo = initialCapitalFrac / n;
  const desiredFollowOn = initialPerCo * followOnMult;
  const skV = skillValue(skillPt);
  const followOnSkillBoost = 1 + skV * 0.20;
  const rng = seed !== null ? seededRng(seed) : Math.random;

  for (let s = 0; s < nSim; s++) {
    const outcomes = [];
    for (let c = 0; c < n; c++) outcomes.push(sampleOutcome(dist, rng));

    const winners = outcomes.filter(m => m >= markupThreshold).length;
    const neededReserves = winners * desiredFollowOn;
    // If reserves aren't enough, pro-rate the follow-on check
    const scale = neededReserves > 0 ? Math.min(1, reserveRatio / neededReserves) : 0;
    const actualFollowOn = desiredFollowOn * scale;
    const reserveDeployed = winners * actualFollowOn;
    const reserveUnused = reserveRatio - reserveDeployed;

    let totalValue = reserveUnused; // unused reserves return at 1x
    for (const m of outcomes) {
      totalValue += initialPerCo * m;
      if (m >= markupThreshold) {
        // Follow-on valuation with skill boost
        totalValue += actualFollowOn * (m / markupThreshold) * followOnSkillBoost;
      }
    }
    res.push(totalValue);
  }

  res.sort((a, b) => a - b);
  const median = res[Math.floor(nSim * 0.5)];
  const mean = res.reduce((a, b) => a + b, 0) / nSim;
  const p1 = res.filter(x => x >= 1).length / nSim * 100;
  const p3 = res.filter(x => x >= 3).length / nSim * 100;
  const p5 = res.filter(x => x >= 5).length / nSim * 100;
  const p10 = res.filter(x => x >= 10).length / nSim * 100;
  const variance = res.reduce((a, b) => a + (b - mean) ** 2, 0) / nSim;
  return { median, mean, p1, p3, p5, p10, std: Math.sqrt(variance), res };
}

// J-curve aware fund economics — distributions paced over years per the
// IRR computed via NPV bisection.
// Fund economics:
// Committed capital is called evenly over the deployment period. Management
// fees (2% x 10yr = 20% of committed) reduce investable capital; recycling
// (reinvesting early proceeds, expressed as a % of committed capital,
// typically 0-20%) offsets part of that. Each invested cohort exits
// HOLD_YEARS after its capital call — standardized at 10 years, anchored to
// Crunchbase (SaaS median 9yr founding-to-exit) and SaaStr ($1B+ SaaS
// acquisitions: 10.0yr median). Carry follows a European waterfall: LPs
// receive 100% of distributions until their full commitment is returned,
// then 80/20 above that. Gross IRR is computed on invested-capital
// cashflows; net IRR on LP (committed-capital) cashflows.
const HOLD_YEARS = 10;
function fundEconomics(grossMOIC, recycleFrac = 0.10, mgmtFeePct = 0.02, mgmtFeeYrs = 10, carryPct = 0.20) {
  const feeFrac = Math.min(0.5, mgmtFeePct * mgmtFeeYrs);
  const investableFrac = Math.min(1, (1 - feeFrac) + Math.max(0, recycleFrac));
  const grossProceeds = grossMOIC * investableFrac;
  const D = DEPLOYMENT_YEARS;
  const maxYear = HOLD_YEARS + D;

  const grossCF = new Array(maxYear + 1).fill(0);
  for (let y = 0; y < D; y++) {
    grossCF[y] -= investableFrac / D;
    grossCF[y + HOLD_YEARS] += (investableFrac / D) * grossMOIC;
  }

  const distGross = new Array(maxYear + 1).fill(0);
  for (let y = 0; y < D; y++) distGross[y + HOLD_YEARS] += grossProceeds / D;
  const netCF = new Array(maxYear + 1).fill(0);
  let cumToLP = 0;
  for (let y = 0; y <= maxYear; y++) {
    if (y < D) netCF[y] -= 1 / D;
    let d = distGross[y];
    if (d > 0) {
      let toLP = 0;
      if (cumToLP < 1) {
        const preferred = Math.min(d, 1 - cumToLP);
        toLP += preferred;
        d -= preferred;
      }
      toLP += d * (1 - carryPct);
      cumToLP += toLP;
      netCF[y] += toLP;
    }
  }
  const carryAmt = Math.max(0, grossProceeds - cumToLP);
  const bisectIRR = (cfs) => {
    const npv = r => cfs.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
    let lo = -0.99, hi = 5.0;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    netMOIC: cumToLP,
    netIRR: bisectIRR(netCF),
    grossMOIC,
    grossProceeds,
    investableFrac,
    feeFrac,
    carryAmt,
    grossIRR: bisectIRR(grossCF),
  };
}

// Full-distribution Kelly: the generalization of Kelly (1956) to a bet
// whose payoff is drawn from a multi-outcome distribution. Maximizes
// E[log(1 + f*(R-1))] over the bet fraction f, where R is the return
// multiple. This is the standard treatment in the academic literature
// (Thorp 2006, "The Kelly Criterion in Blackjack, Sports Betting, and the
// Stock Market"; MacLean, Thorp & Ziemba 2011). Solved numerically via
// golden-section search — there is no closed form for a 12-tier
// distribution.
function fullDistributionKelly(dist) {
  const elg = f => {
    let e = 0;
    for (const d of dist) {
      const r = 1 + f * (d.multiplier - 1);
      if (r <= 0) return -Infinity;
      e += d.prob * Math.log(r);
    }
    return e;
  };
  let lo = 0, hi = 0.9999;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 200; i++) {
    const a = hi - phi * (hi - lo);
    const b = lo + phi * (hi - lo);
    if (elg(a) < elg(b)) lo = a; else hi = b;
  }
  const f = (lo + hi) / 2;
  return { f, growth: elg(f) };
}


function makeCurveSizes() {
  const s = [];
  for (let n = 20;  n <= 100; n += 10) s.push(n);
  for (let n = 125; n <= 300; n += 25) s.push(n);
  for (let n = 350; n <= 500; n += 50) s.push(n);
  for (let n = 600; n <= 1000; n += 100) s.push(n);
  return s;
}

function makeReserveSweep() {
  const s = [];
  for (let r = 0; r <= 0.7; r += 0.05) s.push(+r.toFixed(2));
  return s;
}

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
const fmtDollar = n => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const fmtPct = n => {
  const pct = n * 100;
  if (pct !== 0 && Math.abs(pct) < 0.1) return `${pct.toFixed(3)}%`;
  if (pct !== 0 && Math.abs(pct) < 1)   return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
};

// ─── DEBOUNCE HOOK ───────────────────────────────────────────────────────────
function useDebounce(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════════════════
function Tip({ children, text, width = 240 }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", borderBottom: "1px dotted #555", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "#141414", border: "1px solid #242424", color: "#e8e0d0",
          padding: "8px 12px", borderRadius: 6, fontSize: 11, lineHeight: 1.5,
          width, zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          fontFamily: "'DM Mono', monospace", letterSpacing: 0, textTransform: "none", fontWeight: 400,
        }}>{text}</span>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════════════
function CDFChart({ dataA, dataB, labelA, labelB, colorA, colorB }) {
  const W = 640, H = 240;
  const pad = { l: 48, r: 20, t: 20, b: 42 };
  const xW = W - pad.l - pad.r, yH = H - pad.t - pad.b;
  if (!dataA?.length || !dataB?.length) return null;

  const xPoints = [0, 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30, 50];
  const xMax = 50;
  const cdf = (data, x) => data.filter(v => v >= x).length / data.length;
  const curveA = xPoints.map(x => ({ x, p: cdf(dataA, x) }));
  const curveB = xPoints.map(x => ({ x, p: cdf(dataB, x) }));

  const xS = x => pad.l + (Math.log(x + 0.5) / Math.log(xMax + 0.5)) * xW;
  const yS = p => pad.t + (1 - p) * yH;
  const pathOf = pts => "M" + pts.map(p => `${xS(p.x).toFixed(1)},${yS(p.p).toFixed(1)}`).join(" L");
  const keyThresholds = [1, 3, 5, 10];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = yS(t);
        return (<g key={t}>
          <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#1a1a1a" strokeWidth="1" />
          <text x={pad.l - 6} y={y + 4} fontSize="10" fill="#555" textAnchor="end">{(t * 100).toFixed(0)}%</text>
        </g>);
      })}
      {keyThresholds.map(x => {
        const xp = xS(x);
        return (<g key={x}>
          <line x1={xp} y1={pad.t} x2={xp} y2={pad.t + yH} stroke="#1a1a1a" strokeWidth="1" strokeDasharray="2,3" />
          <text x={xp} y={H - 22} fontSize="10" fill="#666" textAnchor="middle">{x}x</text>
        </g>);
      })}
      {[0, 0.5, 2, 20, 50].map(x => (
        <text key={x} x={xS(x)} y={H - 22} fontSize="9" fill="#444" textAnchor="middle">{x === 0 ? "0" : `${x}x`}</text>
      ))}

      <path d={pathOf(curveA) + ` L${xS(xMax).toFixed(1)},${(pad.t + yH).toFixed(1)} L${pad.l},${(pad.t + yH).toFixed(1)} Z`} fill={colorA} fillOpacity="0.12" />
      <path d={pathOf(curveB) + ` L${xS(xMax).toFixed(1)},${(pad.t + yH).toFixed(1)} L${pad.l},${(pad.t + yH).toFixed(1)} Z`} fill={colorB} fillOpacity="0.12" />
      <path d={pathOf(curveA)} fill="none" stroke={colorA} strokeWidth="2.5" />
      <path d={pathOf(curveB)} fill="none" stroke={colorB} strokeWidth="2.5" />

      {[1, 3].map(x => {
        const pA = cdf(dataA, x), pB = cdf(dataB, x);
        return (<g key={`ann-${x}`}>
          <circle cx={xS(x)} cy={yS(pA)} r="4" fill={colorA} stroke="#000000" strokeWidth="1.5" />
          <circle cx={xS(x)} cy={yS(pB)} r="4" fill={colorB} stroke="#000000" strokeWidth="1.5" />
        </g>);
      })}

      <text x={W / 2} y={H - 6} fontSize="10" fill="#666" textAnchor="middle">Fund MOIC outcome →</text>
      <text x={pad.l - 36} y={pad.t + yH / 2} fontSize="10" fill="#666" textAnchor="middle"
        transform={`rotate(-90, ${pad.l - 36}, ${pad.t + yH / 2})`}>P(fund returns ≥ x)</text>

      <g transform={`translate(${W - pad.r - 180}, ${pad.t})`}>
        <line x1="0" y1="6" x2="18" y2="6" stroke={colorA} strokeWidth="2.5" />
        <text x="22" y="10" fontSize="10" fill="#aaa">{labelA}</text>
        <line x1="0" y1="22" x2="18" y2="22" stroke={colorB} strokeWidth="2.5" />
        <text x="22" y="26" fontSize="10" fill="#aaa">{labelB}</text>
      </g>
    </svg>
  );
}

// 3-point moving average — smooths Monte Carlo noise in display without
// touching underlying data.
function smooth(arr) {
  if (!arr || arr.length < 3) return arr;
  const out = new Array(arr.length);
  out[0] = arr[0];
  out[arr.length - 1] = arr[arr.length - 1];
  for (let i = 1; i < arr.length - 1; i++) {
    out[i] = (arr[i - 1] + arr[i] + arr[i + 1]) / 3;
  }
  return out;
}

// Percentile band chart — shows the outcome funnel narrowing with portfolio
// size. The visual argument for consistency: the band tightens around the
// median as n grows.
function BandChart({ sizes, med, q10, q25, q75, q90, currentN, height = 200, onSelectN = null }) {
  const W = 640, H = height;
  const pad = { l: 42, r: 14, t: 12, b: 30 };
  const maxY = Math.max(...q90) * 1.08;
  const minY = 0;
  const x = n => pad.l + ((n - sizes[0]) / (sizes[sizes.length - 1] - sizes[0])) * (W - pad.l - pad.r);
  const y = v => H - pad.b - ((v - minY) / (maxY - minY)) * (H - pad.t - pad.b);
  const line = vals => sizes.map((n, i) => `${i === 0 ? "M" : "L"} ${x(n).toFixed(1)} ${y(vals[i]).toFixed(1)}`).join(" ");
  const area = (top, bot) => {
    const fwd = sizes.map((n, i) => `${i === 0 ? "M" : "L"} ${x(n).toFixed(1)} ${y(top[i]).toFixed(1)}`).join(" ");
    const back = [...sizes].reverse().map((n) => {
      const i = sizes.indexOf(n);
      return `L ${x(n).toFixed(1)} ${y(bot[i]).toFixed(1)}`;
    }).join(" ");
    return `${fwd} ${back} Z`;
  };
  const handleClick = e => {
    if (!onSelectN) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = Math.max(0, Math.min(1, (px - pad.l) / (W - pad.l - pad.r)));
    const n = Math.round((sizes[0] + frac * (sizes[sizes.length - 1] - sizes[0])) / 5) * 5;
    onSelectN(Math.max(5, Math.min(1000, n)));
  };
  const gridVals = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", cursor: onSelectN ? "crosshair" : "default" }} onClick={handleClick}>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="#141414" strokeWidth="1" />
          <text x={pad.l - 6} y={y(v) + 3} fontSize="9" fill="#555" textAnchor="end">{v.toFixed(1)}x</text>
        </g>
      ))}
      <path d={area(q90, q10)} fill="#c8a94e" fillOpacity="0.10" />
      <path d={area(q75, q25)} fill="#c8a94e" fillOpacity="0.16" />
      <path d={line(q90)} fill="none" stroke="#c8a94e" strokeWidth="1" strokeOpacity="0.35" strokeDasharray="3,3" />
      <path d={line(q10)} fill="none" stroke="#c8a94e" strokeWidth="1" strokeOpacity="0.35" strokeDasharray="3,3" />
      <path d={line(med)} fill="none" stroke="#c8a94e" strokeWidth="2.5" strokeLinejoin="round" />
      {currentN >= sizes[0] && currentN <= sizes[sizes.length - 1] && (
        <line x1={x(currentN)} y1={pad.t} x2={x(currentN)} y2={H - pad.b} stroke="#4e9e6e" strokeWidth="1" strokeDasharray="4,4" strokeOpacity="0.7" />
      )}
      {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].filter(v => v >= sizes[0] && v <= sizes[sizes.length - 1]).map(n => (
        <text key={n} x={x(n)} y={H - pad.b + 14} fontSize="8.5" fill="#555" textAnchor="middle">{n}</text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 2} fontSize="9" fill="#555" textAnchor="middle">Portfolio size (positions over {"4"}-year deployment)</text>
      <text x={W - pad.r - 4} y={y(q90[sizes.length - 1]) - 5} fontSize="9" fill="#8a7433" textAnchor="end">90th pctile</text>
      <text x={W - pad.r - 4} y={y(q10[sizes.length - 1]) + 12} fontSize="9" fill="#8a7433" textAnchor="end">10th pctile</text>
    </svg>
  );
}

function CurveChart({ sizes, values, color, benchmarks = [], currentN, yFmt, height = 180, onSelectN = null }) {
  const W = 640, H = height;
  const pad = { l: 46, r: 20, t: 14, b: 32 };
  const xW = W - pad.l - pad.r, yH = H - pad.t - pad.b;
  if (!values?.length) return null;
  const smoothed = smooth(values);
  const minV = 0, maxV = Math.max(...smoothed) * 1.1 || 1;
  const xS = i => pad.l + (i / (sizes.length - 1)) * xW;
  const yS = v => pad.t + (1 - (v - minV) / (maxV - minV)) * yH;
  const path = "M" + smoothed.map((v, i) => `${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(" L");
  const area = path + ` L${xS(sizes.length - 1).toFixed(1)},${(pad.t + yH).toFixed(1)} L${pad.l},${(pad.t + yH).toFixed(1)} Z`;

  let currentIdx = -1;
  if (currentN) {
    currentIdx = sizes.findIndex(s => s >= currentN);
    if (currentIdx === -1) currentIdx = sizes.length - 1;
  }

  // Drag-to-select handler: maps a pointer x-coordinate to the nearest
  // sizes index and calls onSelectN with the corresponding portfolio size.
  function handlePointer(e) {
    if (!onSelectN) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const rel = Math.max(0, Math.min(1, (x - pad.l) / xW));
    const idx = Math.round(rel * (sizes.length - 1));
    onSelectN(sizes[idx]);
  }
  const interactive = !!onSelectN;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={interactive ? { cursor: "ew-resize" } : undefined}
      onPointerDown={interactive ? (e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointer(e); } : undefined}
      onPointerMove={interactive ? (e) => { if (e.buttons === 1) handlePointer(e); } : undefined}
    >
      {[0, 1, 2, 3, 4].map(i => {
        const v = minV + (maxV - minV) * (i / 4), y = yS(v);
        return (<g key={i}>
          <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#1a1a1a" strokeWidth="1" />
          <text x={pad.l - 6} y={y + 4} fontSize="9" fill="#444" textAnchor="end">{yFmt(v)}</text>
        </g>);
      })}
      <path d={area} fill={color} fillOpacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {benchmarks.map(b => {
        const idx = sizes.findIndex(s => s >= b.n);
        if (idx < 0) return null;
        const x = xS(idx);
        return (<g key={b.label}>
          <line x1={x} y1={pad.t} x2={x} y2={pad.t + yH} stroke={b.color} strokeWidth="1" strokeDasharray="3,3" />
          <text x={x + 3} y={pad.t + 10} fontSize="9" fill={b.color} fontWeight="500">{b.label}</text>
        </g>);
      })}
      {currentIdx >= 0 && (() => {
        const markerX = xS(currentIdx);
        const markerY = yS(smoothed[currentIdx]);
        // If marker is within 20% of the right edge, render label to the left
        const nearRight = currentIdx >= sizes.length * 0.8;
        const labelX = nearRight ? markerX - 7 : markerX + 7;
        const anchor = nearRight ? "end" : "start";
        return (
          <g>
            <line x1={markerX} y1={pad.t} x2={markerX} y2={pad.t + yH} stroke="#c8a94e" strokeWidth="1.5" />
            <circle cx={markerX} cy={markerY} r="5" fill="#c8a94e" stroke="#000000" strokeWidth="1.5" />
            <text x={labelX} y={markerY - 7} fontSize="10" fill="#4e9e6e" fontWeight="500" textAnchor={anchor}>
              {sizes[currentIdx]}: {yFmt(smoothed[currentIdx])}
            </text>
          </g>
        );
      })()}
      {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(n => {
        const idx = sizes.findIndex(s => s >= n);
        if (idx < 0) return null;
        return (<text key={n} x={xS(idx)} y={H - 14} fontSize="8.5" fill="#444" textAnchor="middle">{n}</text>);
      })}
      <text x={W / 2} y={H - 2} fontSize="9" fill="#555" textAnchor="middle">Portfolio size →</text>
    </svg>
  );
}

function OutlierChart({ curves, currentN }) {
  const W = 640, H = 220;
  const pad = { l: 40, r: 90, t: 14, b: 32 };
  const xW = W - pad.l - pad.r, yH = H - pad.t - pad.b;
  if (!curves?.length) return null;
  const maxN = 300;
  const xS = n => pad.l + (Math.min(n, maxN) / maxN) * xW;
  const yS = p => pad.t + (1 - p) * yH;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.25, 0.5, 0.75, 1].map(p => (
        <g key={p}>
          <line x1={pad.l} y1={yS(p)} x2={W - pad.r} y2={yS(p)} stroke="#1a1a1a" strokeWidth="1" />
          <text x={pad.l - 6} y={yS(p) + 4} fontSize="9" fill="#444" textAnchor="end">{(p * 100).toFixed(0)}%</text>
        </g>
      ))}
      {[50, 100, 150, 200, 250, 300].map(n => (
        <text key={n} x={xS(n)} y={H - 10} fontSize="9" fill="#444" textAnchor="middle">{n}</text>
      ))}
      <text x={(pad.l + (W - pad.r)) / 2} y={H} fontSize="9" fill="#555" textAnchor="middle">Portfolio size (positions over 4-year deployment)</text>

      {curves.map((c, ci) => {
        const pts = c.data.filter(d => d.n <= maxN);
        const path = pts.map((d, i) => `${i === 0 ? "M" : "L"}${xS(d.n).toFixed(1)},${yS(d.p).toFixed(1)}`).join(" ");
        // Stagger labels vertically — each series gets its own horizontal band
        // on the right edge so they never overlap regardless of where the curve ends.
        const labelY = pad.t + 12 + ci * 18;
        const lastPointY = yS(pts[pts.length - 1].p);
        return (
          <g key={ci}>
            <path d={path} fill="none" stroke={c.color} strokeWidth="2" strokeDasharray={c.dash || "0"} />
            {/* tiny connector from curve end to staggered label */}
            <line
              x1={W - pad.r}
              y1={lastPointY}
              x2={W - pad.r + 3}
              y2={labelY - 3}
              stroke={c.color}
              strokeWidth="0.5"
              strokeOpacity="0.4"
            />
            <text x={W - pad.r + 6} y={labelY} fontSize="10" fill={c.color}>{c.label}</text>
          </g>
        );
      })}
      {currentN && currentN <= maxN && (
        <line x1={xS(currentN)} y1={pad.t} x2={xS(currentN)} y2={pad.t + yH} stroke="#c8a94e" strokeWidth="1" strokeDasharray="3,3" />
      )}
    </svg>
  );
}

// Multi-line chart for follow-on strategy tab
function MultiLineChart({ xValues, series, xFmt, yFmt, xLabel, optimalX }) {
  const W = 640, H = 220;
  const pad = { l: 46, r: 100, t: 14, b: 36 };
  const xW = W - pad.l - pad.r, yH = H - pad.t - pad.b;
  if (!xValues?.length || !series?.length) return null;

  const allY = series.flatMap(s => s.values);
  const minY = 0, maxY = Math.max(...allY) * 1.1 || 1;
  const xS = i => pad.l + (i / (xValues.length - 1)) * xW;
  const yS = v => pad.t + (1 - (v - minY) / (maxY - minY)) * yH;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[0, 1, 2, 3, 4].map(i => {
        const v = minY + (maxY - minY) * (i / 4), y = yS(v);
        return (<g key={i}>
          <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#1a1a1a" strokeWidth="1" />
          <text x={pad.l - 6} y={y + 4} fontSize="9" fill="#444" textAnchor="end">{yFmt(v)}</text>
        </g>);
      })}
      {xValues.map((x, i) => {
        if (i % 2 !== 0 && i !== xValues.length - 1) return null;
        return (<text key={i} x={xS(i)} y={H - 18} fontSize="9" fill="#444" textAnchor="middle">{xFmt(x)}</text>);
      })}
      <text x={(pad.l + (W - pad.r)) / 2} y={H - 4} fontSize="10" fill="#666" textAnchor="middle">{xLabel}</text>

      {/* optimal vertical line */}
      {optimalX !== undefined && optimalX !== null && (() => {
        const idx = xValues.findIndex(x => Math.abs(x - optimalX) < 0.001);
        if (idx < 0) return null;
        return (
          <g>
            <line x1={xS(idx)} y1={pad.t} x2={xS(idx)} y2={pad.t + yH} stroke="#c8a94e" strokeWidth="1.5" strokeDasharray="4,3" />
            <text x={xS(idx) + 4} y={pad.t + 12} fontSize="10" fill="#c8a94e" fontWeight="500">optimal</text>
          </g>
        );
      })()}

      {series.map((s, si) => {
        const path = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(" ");
        const lastVal = s.values[s.values.length - 1];
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash || "0"} strokeLinejoin="round" />
            <text x={W - pad.r + 4} y={yS(lastVal) + 3} fontSize="10" fill={s.color}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [preset, setPreset] = useState(DEFAULTS.preset);
  const [customDist, setCustomDist] = useState(null);
  const [savedDist, setSavedDist] = useState(null);   // user-saved custom distribution
  const [entryVal, setEntryVal] = useState(15);        // blended entry post-money, $M
  const [skillPt, setSkillPt] = useState(3); // 5-point: 1-5, default 3 (average)
  const skill = skillValue(skillPt); // internal value -1 to +1 for applySelection
  const [numInvestments, setNumInvestments] = useState(DEFAULTS.numInvestments);
  const [activeTab, setActiveTab] = useState("overview");

  const [reserveRatio, setReserveRatio] = useState(DEFAULTS.reserveRatio);
  const [markupThreshold, setMarkupThreshold] = useState(DEFAULTS.markupThreshold);
  const [followOnMult, setFollowOnMult] = useState(DEFAULTS.followOnMult);
  const [recyclePct, setRecyclePct] = useState(DEFAULTS.recyclePct);

  const [concCount, setConcCount] = useState(30);
  const [distCount, setDistCount] = useState(400);
  // Two-way sync: the distributed portfolio IS the portfolio. Each control
  // pushes to both states on change; independent defaults (30 on load for
  // the overview narrative, 400 on the head-to-head tab) converge on the
  // first user interaction with either control.
  const setPortfolioSize = (n) => {
    const v = Math.min(1000, Math.max(5, n));
    setNumInvestments(v);
    setDistCount(Math.max(30, v));
  };
  const [concResult, setConcResult] = useState(null);
  const [distResult, setDistResult] = useState(null);

  const [mcCurves, setMcCurves] = useState(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  const [foCurves, setFoCurves] = useState(null);

  // Follow-On tab local sliders (independent from globals)
  const [foThreshold, setFoThreshold] = useState(3);
  const [foMult, setFoMult] = useState(2);
  const [foSinglePoint, setFoSinglePoint] = useState(null);

  // Context: which controls does each tab actually use?
  const tabUsesReserves = !["outlier", "kelly", "followon"].includes(activeTab);
  // (Follow-On tab sweeps reserves itself, so it doesn't need the global slider)
  const tabUsesSkill = activeTab !== "outlier";
  const tabUsesExitYears = ["overview", "irr", "inputs"].includes(activeTab);

  function resetAll() {
    setPreset(DEFAULTS.preset);
    setCustomDist(null);
    setSkillPt(3);
    setNumInvestments(DEFAULTS.numInvestments);
    setReserveRatio(DEFAULTS.reserveRatio);
    setMarkupThreshold(DEFAULTS.markupThreshold);
    setFollowOnMult(DEFAULTS.followOnMult);
    setRecyclePct(DEFAULTS.recyclePct);
  }

  const baseDist = customDist || (preset === "custom" && savedDist ? savedDist : preset === "yc" ? PRESET_YC : preset === "blend" ? PRESET_BLEND : PRESET_BLIND_POOL);
  const adjustedDist = useMemo(() => applySelection(baseDist, skill), [baseDist, skill]);
  const nd = useMemo(() => normalize(adjustedDist), [adjustedDist]);

  const em = expectedMultiple(nd);
  const kellyTotal = kellyTotalPositions(nd);
  const kellyAnnual = Math.round(kellyTotal / DEPLOYMENT_YEARS);
  const pUnicorn = probAtLeastOne(nd, numInvestments, 50);
  const pDecacorn = probAtLeastOne(nd, numInvestments, 500);

  // Debounced versions for hot paths — slider drags don't fire 20 sims
  const dNumInv = useDebounce(numInvestments, 200);
  const dReserves = useDebounce(reserveRatio, 200);
  const dThreshold = useDebounce(markupThreshold, 200);
  const dFollowOn = useDebounce(followOnMult, 200);
  const dConcCount = useDebounce(concCount, 200);
  const dDistCount = useDebounce(distCount, 200);
  const dFoReserves = useDebounce(reserveRatio, 200);
  const dFoThreshold = useDebounce(foThreshold, 200);
  const dFoMult = useDebounce(foMult, 200);

  const [currentMC, setCurrentMC] = useState(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const r = simPortfolio(dNumInv, 1500, nd, dReserves, dThreshold, dFollowOn, skillPt, 137);
      setCurrentMC(r);
    }, 10);
    return () => clearTimeout(id);
  }, [dNumInv, nd, dReserves, dThreshold, dFollowOn, skillPt]);

  // Zero-reserve baseline at the same portfolio size — shares the seed with
  // currentMC so the DELTA shown next to the reserve sliders is pure signal,
  // not sampling noise. This is what makes reserve/threshold/check effects
  // visible (v12 fix: they previously moved outcomes but nothing showed it).
  const [baselineMC, setBaselineMC] = useState(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const r = simPortfolio(dNumInv, 1500, nd, 0, dThreshold, dFollowOn, skillPt, 137);
      setBaselineMC(r);
    }, 10);
    return () => clearTimeout(id);
  }, [dNumInv, nd, dThreshold, dFollowOn, skillPt]);

  // Split conc and dist into separate effects so moving one slider doesn't
  // re-sample the OTHER strategy. Both use a shared base seed so when
  // concCount === distCount the two results are IDENTICAL (eliminates the
  // "same portfolio, different numbers" confusion).
  useEffect(() => {
    const id = setTimeout(() => {
      const r = simPortfolio(dConcCount, 5000, nd, dReserves, dThreshold, dFollowOn, skillPt, 42);
      setConcResult(r);
    }, 20);
    return () => clearTimeout(id);
  }, [dConcCount, nd, dReserves, dThreshold, dFollowOn, skillPt]);

  useEffect(() => {
    const id = setTimeout(() => {
      const r = simPortfolio(dDistCount, 5000, nd, dReserves, dThreshold, dFollowOn, skillPt, 42);
      setDistResult(r);
    }, 20);
    return () => clearTimeout(id);
  }, [dDistCount, nd, dReserves, dThreshold, dFollowOn, skillPt]);

  const runCurves = useCallback((sims = 3000) => {
    setMcRunning(true);
    const sizes = makeCurveSizes();
    const acc = { sizes, fails: [], triples: [], p5s: [], p10s: [], meds: [], vols: [], q10s: [], q25s: [], q75s: [], q90s: [], sims };
    let i = 0;
    // Chunked computation: one portfolio size per tick, so the UI never
    // freezes and progress is visible. (v15 computed all sizes in a single
    // synchronous block — at 1,000 positions x 12 tiers it locked the main
    // thread long enough to look dead.)
    const step = () => {
      const chunkEnd = Math.min(i + 3, sizes.length);
      for (; i < chunkEnd; i++) {
        const n = sizes[i];
        const scaleFactor = n <= 20 ? 4 : n <= 50 ? 3 : n <= 100 ? 2 : n <= 200 ? 1.4 : n <= 500 ? 0.8 : 0.4;
        const adjustedSims = Math.round(sims * scaleFactor);
        const r = simPortfolio(n, adjustedSims, nd, dReserves, dThreshold, dFollowOn, skillPt, 7000 + n);
        acc.fails.push(+(100 - r.p1).toFixed(1));
        acc.triples.push(+r.p3.toFixed(1));
        acc.p5s.push(+r.p5.toFixed(1));
        acc.p10s.push(+r.p10.toFixed(1));
        acc.meds.push(+r.median.toFixed(2));
        acc.vols.push(+r.std.toFixed(2));
        const q = f => r.res[Math.floor(r.res.length * f)];
        acc.q10s.push(+q(0.10).toFixed(2));
        acc.q25s.push(+q(0.25).toFixed(2));
        acc.q75s.push(+q(0.75).toFixed(2));
        acc.q90s.push(+Math.min(q(0.90), 50).toFixed(2));
      }
      setMcProgress(Math.round((i / sizes.length) * 100));
      if (i < sizes.length) {
        setTimeout(step, 0);
      } else {
        setMcCurves({ ...acc });
        setMcRunning(false);
      }
    };
    setTimeout(step, 20);
  }, [nd, dReserves, dThreshold, dFollowOn, skillPt]);

  // Auto-run standard precision on dependency change
  useEffect(() => { runCurves(3000); }, [runCurves]);

  // Follow-on strategy sweep: 3 threshold strategies × 15 reserve ratios
  const runFoCurves = useCallback(() => {
    setTimeout(() => {
      const sweep = makeReserveSweep();
      const thresholds = [
        { label: "Any up-round (1x)",   t: 1,  color: "#c4783a" },
        { label: "Material traction (3x)", t: 3,  color: "#c8a94e", dash: "4,3" },
        { label: "Only winners (10x)",  t: 10, color: "#4e9e6e" },
      ];
      const series = thresholds.map(th => {
        const medians = [], p3s = [], vols = [];
        sweep.forEach(r => {
          const result = simPortfolio(numInvestments, 600, nd, r, th.t, dFoMult, skillPt);
          medians.push(+result.median.toFixed(2));
          p3s.push(+result.p3.toFixed(1));
          vols.push(+result.std.toFixed(2));
        });
        return { label: th.label, color: th.color, dash: th.dash, medians, p3s, vols };
      });
      const balanced = series[1];
      let optIdx = 0, optVal = -Infinity;
      balanced.medians.forEach((m, i) => { if (m > optVal) { optVal = m; optIdx = i; }});
      setFoCurves({ sweep, series, optimalReserve: sweep[optIdx], optimalMedian: optVal });
    }, 20);
  }, [nd, numInvestments, dFoMult, skillPt]);

  // Single-point follow-on result responding to local FO sliders
  useEffect(() => {
    if (activeTab !== "followon") return;
    const id = setTimeout(() => {
      const r = simPortfolio(numInvestments, 1500, nd, dFoReserves, dFoThreshold, dFoMult, skillPt);
      setFoSinglePoint(r);
    }, 20);
    return () => clearTimeout(id);
  }, [activeTab, numInvestments, nd, dFoReserves, dFoThreshold, dFoMult, skillPt]);

  useEffect(() => {
    if (activeTab === "followon") runFoCurves();
  }, [activeTab, runFoCurves]);

  const medianMOIC = currentMC?.median ?? em;
  const eco = useMemo(() => fundEconomics(medianMOIC, recyclePct), [medianMOIC, recyclePct]);
  // Legacy aliases (used by render code that we haven't rewritten yet)
  const grossIRR = eco.grossIRR;
  const netMOIC_val = eco.netMOIC;
  const netIRR = eco.netIRR;

  const outlierCurves = useMemo(() => {
    const ns = [];
    for (let n = 1; n <= 300; n += 5) ns.push(n);
    return [
      { label: "Superstar (8%)", color: "#4e9e6e", data: ns.map(n => ({ n, p: 1 - Math.pow(0.92, n) })) },
      { label: "Top-tier (4.5%)", color: "#c8a94e", data: ns.map(n => ({ n, p: 1 - Math.pow(0.955, n) })), dash: "4,3" },
      { label: "Average (2%)", color: "#a33d2a", data: ns.map(n => ({ n, p: 1 - Math.pow(0.98, n) })), dash: "2,2" },
    ];
  }, []);

  return (
    <div style={{ fontFamily: "'DM Mono', 'Courier New', monospace", background: "#000000", minHeight: "100vh", color: "#e8e0d0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,300&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #000000; }
        ::-webkit-scrollbar-thumb { background: #3a2a1a; }
        input[type=range] { -webkit-appearance: none; appearance: none; height: 3px; border-radius: 2px; background: #242424; outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #c8a94e; cursor: pointer; }
        input[type=number], input[type=text] { background: #141414; border: 1px solid #242424; color: #e8e0d0; padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px; }
        .tab-btn { background: none; border: none; color: #888; cursor: pointer; font-family: 'DM Mono', monospace; font-size: 11px; padding: 8px 14px; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; }
        .tab-btn.active { color: #c8a94e; border-bottom-color: #c8a94e; }
        .tab-btn:hover { color: #e8e0d0; }
        .stat-card { background: #000000; border: 1px solid #1a1a1a; border-radius: 8px; padding: 20px; }
        .dist-row { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid #141414; }
        .dist-row:last-child { border-bottom: none; }
        .prob-bar-bg { background: #141414; border-radius: 3px; height: 6px; overflow: hidden; }
        .prob-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.25s ease forwards; }
        .pill { display: inline-block; font-size: 10px; padding: 4px 12px; border-radius: 14px; font-weight: 500; letter-spacing: 0.05em; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; user-select: none; }
        .pill.active { background: #c8a94e; color: #000000; border-color: #c8a94e; }
        .pill.inactive { color: #888; border-color: #242424; }
        .pill.inactive:hover { color: #c8a94e; border-color: #c8a94e; }
        .badge { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 10px; font-weight: 500; letter-spacing: 0.06em; margin-left: 6px; vertical-align: middle; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { padding: 7px 10px; text-align: right; color: #555; font-weight: 400; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
        td { padding: 9px 10px; text-align: right; border-bottom: 1px solid #141414; }
        .label { font-size: 10px; color: #555; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
        .serif { font-family: 'Fraunces', serif; }
        .help-bar { font-size: 10px; color: #666; margin-top: 4px; font-style: italic; font-family: 'DM Mono', monospace; letter-spacing: 0; text-transform: none; }
        .callout { padding: 12px 16px; background: #0a0a12; border-left: 2px solid #c8a94e; border-radius: 0 4px 4px 0; font-size: 12px; color: #aaa; line-height: 1.7; }
        input[type=number].inline { width: 80px; font-family: 'Fraunces', serif; font-size: 16px; color: #c8a94e; text-align: center; border: 1px solid #242424; background: transparent; }
        .reset-btn { background: transparent; border: 1px solid #242424; color: #666; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; transition: all 0.15s; }
        .reset-btn:hover { border-color: #c8a94e; color: #c8a94e; }
        .sticky-settings { position: sticky; top: 0; z-index: 50; background: #000000; padding-top: 12px; padding-bottom: 4px; margin-bottom: 16px; border-bottom: 1px solid #141414; }
        .sticky-settings::before {
          content: ""; position: absolute; left: -32px; right: -32px; top: 0; bottom: 0;
          background: #000000; z-index: -1;
        }
        .settings-card { background: #000000; border: 1px solid #1a1a1a; border-radius: 8px; padding: 14px 18px; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: "#000000", borderBottom: "1px solid #1a1a1a", padding: "28px 32px 0" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
            <span className="serif" style={{ fontSize: 26, fontWeight: 700, color: "#c8a94e", letterSpacing: "-0.02em" }}>The Volume Thesis</span>
            <span style={{ fontSize: 10, color: "#555", letterSpacing: "0.15em", textTransform: "uppercase" }}>Team Ignite Ventures</span>
          </div>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 18px", lineHeight: 1.6, maxWidth: 620 }}>
            The mathematics of venture capital's power-law distribution — why concentrated conviction underperforms volume, translated into the numbers LPs actually care about. All figures framed around a standard {DEPLOYMENT_YEARS}-year fund deployment.
          </p>

          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase" }}>Distribution:</span>
              <span className={`pill ${preset === "blind" ? "active" : "inactive"}`} onClick={() => { setPreset("blind"); setCustomDist(null); }}>Industry avg</span>
              <span className={`pill ${preset === "blend" ? "active" : "inactive"}`} onClick={() => { setPreset("blend"); setCustomDist(null); }}>50/50 Blend</span>
              <span className={`pill ${preset === "yc" ? "active" : "inactive"}`} onClick={() => { setPreset("yc"); setCustomDist(null); }}>YC-calibrated</span>
              {savedDist && <span className={`pill ${preset === "custom" ? "active" : "inactive"}`} onClick={() => { setPreset("custom"); setCustomDist(null); }}>My assumptions</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1a1a1a", overflowX: "auto" }}>
            {[
              ["overview",   "Overview"],
              ["headtohead", "Concentrated vs. Distributed"],
              ["montecarlo", "Monte Carlo"],
              ["irr",        "IRR Translation"],
              ["followon",   "Follow-On Strategy"],
              ["outlier",    "Horsley Bridge"],
              ["kelly",      "Kelly Criterion"],
              ["why",        "Why This Works"],
              ["inputs",     "Assumptions"],
            ].map(([id, label]) => (
              <button key={id} className={`tab-btn ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 32px 24px" }}>

        {/* ── STICKY GLOBAL CONTROLS ── */}
        <div className="sticky-settings">
          <div className="settings-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="label" style={{ marginBottom: 0 }}>Global Settings</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#666" }}>
                  <Tip text="Selection skill shifts tail probabilities. At +1.0 (superstar), unicorn rate roughly doubles and loss rate drops. Based on Horsley Bridge's 4.5% top-tier vs 2% industry average outlier rates.">Skill:</Tip>{" "}
                  <span style={{ color: "#c8a94e" }}>{skill === 0 ? "market avg" : skill > 0 ? `+${skill.toFixed(2)}` : skill.toFixed(2)}</span>
                </span>
                <button className="reset-btn" onClick={resetAll}>Reset</button>
              </div>
            </div>

            {/* Primary row: always visible */}
            <div style={{ display: "grid", gridTemplateColumns: tabUsesSkill && tabUsesExitYears ? "1fr 1fr 1fr" : tabUsesSkill || tabUsesExitYears ? "1fr 1fr" : "1fr", gap: 16 }}>
              <div>
                <div className="label" style={{ marginBottom: 3, fontSize: 9, color: activeTab === "headtohead" ? "#4e9e6e" : undefined }}>
                  {activeTab === "headtohead" ? (
                    <Tip text={`Distributed total positions over a ${DEPLOYMENT_YEARS}-year deployment. ≈ ${Math.round(distCount/DEPLOYMENT_YEARS)}/yr. Controls the green side of the comparison below.`}>Distributed portfolio size</Tip>
                  ) : (
                    <Tip text={`Total positions over a ${DEPLOYMENT_YEARS}-year deployment. ≈ ${Math.round(numInvestments/DEPLOYMENT_YEARS)}/yr at current setting.`}>Portfolio size</Tip>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {activeTab === "headtohead" ? (
                    <>
                      <input
                        type="range"
                        min={30}
                        max={1000}
                        step={10}
                        value={distCount}
                        onChange={e => setPortfolioSize(+e.target.value)}
                        style={{ flex: 1, accentColor: "#4e9e6e" }}
                      />
                      <input
                        type="number"
                        className="inline"
                        style={{ width: 60, fontSize: 14, color: "#4e9e6e", borderColor: "#4e9e6e44" }}
                        value={distCount}
                        onChange={e => setPortfolioSize(+e.target.value || 30)}
                      />
                    </>
                  ) : (
                    <>
                      <input type="range" min={5} max={1000} step={5} value={numInvestments} onChange={e => setPortfolioSize(+e.target.value)} style={{ flex: 1, accentColor: "#4e9e6e" }} />
                      <input type="number" className="inline" step={10} style={{ width: 76, fontSize: 14, paddingRight: 4, color: "#4e9e6e", borderColor: "#4e9e6e44" }} value={numInvestments} onChange={e => setPortfolioSize(+e.target.value || 5)} />
                    </>
                  )}
                </div>
              </div>
              {tabUsesSkill && (
                <div>
                  <div className="label" style={{ marginBottom: 3, fontSize: 9 }}>
                    <Tip text="1 = below average picker. 3 = market average. 5 = excellent picker. Shifts tail probabilities of the outcome distribution.">Selection skill</Tip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {[1, 2, 3, 4, 5].map(p => (
                      <button
                        key={p}
                        onClick={() => setSkillPt(p)}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          fontSize: 11,
                          fontFamily: "'Fraunces', serif",
                          border: "1px solid " + (skillPt === p ? "#c8a94e" : "#242424"),
                          background: skillPt === p ? "#c8a94e" : "transparent",
                          color: skillPt === p ? "#000000" : "#888",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="help-bar" style={{ marginTop: 2 }}>{skillLabel(skillPt)}</div>
                </div>
              )}
              {tabUsesExitYears && (
                <div>
                  <div className="label" style={{ marginBottom: 3, fontSize: 9 }}>
                    <Tip text="Proceeds recycled into new investments, as a percentage of committed capital. On a $100M fund, 10% recycling reinvests $10M of early exit proceeds. 20% fully offsets the management fee load; 0% means fees permanently reduce investable capital to 80% of commitments.">Recycling (% of committed)</Tip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min={0} max={0.20} step={0.05} value={recyclePct} onChange={e => setRecyclePct(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 14, color: "#c8a94e", minWidth: 40, textAlign: "right" }}>{(recyclePct * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Reserves: only on tabs where it matters */}
            {tabUsesReserves && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #1a1a1a" }}>
                <div className="label" style={{ marginBottom: 6, fontSize: 9 }}>
                  <Tip text="Capital held back from initial checks for follow-ons. 30–50% is typical. See 'Follow-On Strategy' tab for optimization.">Reserves &amp; follow-on</Tip>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, color: "#666", minWidth: 52 }}>Reserves</span>
                    <input type="range" min={0} max={0.7} step={0.05} value={reserveRatio} onChange={e => setReserveRatio(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 13, color: "#c8a94e", minWidth: 38 }}>{(reserveRatio * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, color: "#666", minWidth: 52 }}>Threshold</span>
                    <input type="range" min={1} max={10} step={0.5} value={markupThreshold} onChange={e => setMarkupThreshold(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 13, color: "#c8a94e", minWidth: 38 }}>{markupThreshold}x</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, color: "#666", minWidth: 52 }}>Check</span>
                    <input type="range" min={1} max={5} step={0.5} value={followOnMult} onChange={e => setFollowOnMult(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 13, color: "#c8a94e", minWidth: 38 }}>{followOnMult}×</span>
                  </div>
                </div>
                {/* v12: live delta vs zero-reserve baseline — makes the effect
                    of these three sliders visible at a glance */}
                {currentMC && baselineMC && (() => {
                  const dMed = currentMC.median - baselineMC.median;
                  const dP5 = currentMC.p5 - baselineMC.p5;
                  const dP3 = currentMC.p3 - baselineMC.p3;
                  const col = v => v > 0.005 ? "#4e9e6e" : v < -0.005 ? "#a33d2a" : "#666";
                  const sign = v => (v >= 0 ? "+" : "");
                  return (
                    <div style={{ marginTop: 8, display: "flex", gap: 18, alignItems: "center", fontSize: 10, color: "#666", flexWrap: "wrap" }}>
                      <span style={{ letterSpacing: 1, textTransform: "uppercase", fontSize: 8.5 }}>vs 0% reserves:</span>
                      <span>median <span className="serif" style={{ color: col(dMed), fontSize: 12 }}>{sign(dMed)}{dMed.toFixed(2)}x</span></span>
                      <span>P(≥3x) <span className="serif" style={{ color: col(dP3), fontSize: 12 }}>{sign(dP3)}{dP3.toFixed(1)}pp</span></span>
                      <span>P(≥5x) <span className="serif" style={{ color: col(dP5), fontSize: 12 }}>{sign(dP5)}{dP5.toFixed(1)}pp</span></span>
                      {Math.abs(dMed) < 0.15 && reserveRatio > 0 && (
                        <span style={{ fontStyle: "italic", color: "#555" }}>
                          — small delta is real: at a {markupThreshold}x threshold, follow-on dollars earn roughly the same expected multiple as initial checks. Push the threshold up or down to see the tradeoff.
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

          </div>
        </div>

        {/* ══════════════════════ OVERVIEW ══════════════════════ */}
        {activeTab === "overview" && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
              {[
                {
                  label: <Tip text="Median (middle) fund outcome across 1,500 simulated portfolios at your current size. This is what a typical fund would return — NOT the average, which gets skewed by rare mega-outcomes.">Median MOIC</Tip>,
                  value: currentMC ? `${currentMC.median.toFixed(2)}x` : "…",
                  sub: `${numInvestments} positions · typical fund`,
                  color: "#c8a94e"
                },
                {
                  label: <Tip text="Net IRR to LPs. Fees (2% × 10yr) reduce investable capital and are returned before carry; 20% carry applies above 1x of committed (European waterfall). Each cohort held 10 years from its capital call.">Net IRR</Tip>,
                  value: `${(eco.netIRR * 100).toFixed(1)}%`,
                  sub: `${DEPLOYMENT_YEARS}-yr deploy, 10-yr hold`,
                  color: eco.netIRR >= 0.2 ? "#4e9e6e" : eco.netIRR >= 0.1 ? "#c8a94e" : "#a33d2a"
                },
                {
                  label: <Tip text="Probability the fund returns at least 1x (breaks even on paid-in capital).">P(return ≥ 1x)</Tip>,
                  value: currentMC ? `${currentMC.p1.toFixed(1)}%` : "…",
                  sub: "doesn't lose money",
                  color: "#4e9e6e"
                },
                {
                  label: <Tip text="Probability the fund returns at least 3x gross. A 3x gross roughly equals a top-quartile outcome for seed-stage venture.">P(return ≥ 3x)</Tip>,
                  value: currentMC ? `${currentMC.p3.toFixed(1)}%` : "…",
                  sub: "strong fund",
                  color: "#3a7abf"
                },
              ].map((s, i) => (
                <div key={i} className="stat-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
                  <div className="serif" style={{ fontSize: 24, color: s.color, fontWeight: 700 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 14 }}>The Core Argument — Three Views of One Math</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.75, marginBottom: 14 }}>
                Three mathematical frameworks — the <Tip text="Horsley Bridge's analysis of what actually predicts VC fund performance: outlier rate, not loss rate.">Horsley Bridge outlier model</Tip>, the <Tip text="Optimal capital allocation under uncertainty. In venture: tells you the order-of-magnitude cadence.">Kelly Criterion</Tip>, and <Tip text="Simulating thousands of hypothetical funds to see outcome distributions.">Monte Carlo simulation</Tip> — all point to a similar portfolio-size floor.
              </div>
              <div style={{ fontSize: 11, color: "#666", fontStyle: "italic", lineHeight: 1.6, marginBottom: 14, padding: "8px 12px", background: "#0a0a12", borderRadius: 4 }}>
                <strong style={{ color: "#c4783a" }}>Honest caveat:</strong> these frameworks aren't independent — they share distributional inputs. Think of them as one argument viewed three ways, not three separate proofs. Changing the underlying outcome distribution will move all three together.
              </div>
              <div className="callout">
                <span style={{ color: "#e8e0d0", fontWeight: 500 }}>Invest in more companies. Smaller checks.</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginTop: 18 }}>
                {[
                  { label: "Kelly optimal per year",             value: `~${kellyAnnual}`,         color: "#c8a94e" },
                  { label: `Kelly over ${DEPLOYMENT_YEARS}-yr`,  value: `~${kellyTotal}`,          color: "#c8a94e" },
                  { label: "Failure rate → 0%",                  value: "~150 positions",          color: "#3a7abf" },
                  { label: "Horsley Bridge avg-VC floor",        value: "~150",                    color: "#4e9e6e" },
                ].map(r => (
                  <div key={r.label}>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>{r.label}</div>
                    <div className="serif" style={{ fontSize: 16, color: r.color }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* EV Contribution Breakdown */}
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Expected Value — Which Outcomes Drive the Math?</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 14 }}>
                Each outcome tier contributes probability × multiplier to the fund's expected value. The table below shows how much each tier contributes — a useful honesty check. If you think the centicorn rate is too generous, adjust it in the Assumptions tab and watch every number in the tool shift.
              </div>
              <table>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <th style={{ textAlign: "left" }}>Outcome</th>
                    <th>Probability</th>
                    <th>Multiple</th>
                    <th>Contribution to EV</th>
                    <th>% of total EV</th>
                  </tr>
                </thead>
                <tbody>
                  {nd.map((d, i) => {
                    const contrib = d.prob * d.multiplier;
                    const pctOfEV = em > 0 ? (contrib / em) * 100 : 0;
                    return (
                      <tr key={i}>
                        <td style={{ textAlign: "left", color: d.color, fontSize: 11 }}>
                          <span style={{ marginRight: 6 }}>{d.emoji}</span>{d.label}
                        </td>
                        <td style={{ color: "#888" }}>{fmtPct(d.prob)}</td>
                        <td style={{ color: "#888" }}>{d.multiplier}x</td>
                        <td className="serif" style={{ color: d.color, fontSize: 14 }}>{contrib.toFixed(2)}x</td>
                        <td style={{ color: pctOfEV > 30 ? "#c4783a" : "#888" }}>{pctOfEV.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "2px solid #1a1a1a", background: "#0a0a12" }}>
                    <td style={{ textAlign: "left", color: "#e8e0d0", fontSize: 11, fontWeight: 500 }}>Total expected MOIC</td>
                    <td></td>
                    <td></td>
                    <td className="serif" style={{ color: "#c8a94e", fontSize: 16 }}>{em.toFixed(2)}x</td>
                    <td style={{ color: "#555" }}>100%</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
                Notice tiers contributing over 30% are highlighted — they're doing disproportionate work. If a single low-probability tier produces most of the expected value, the model is highly sensitive to that one assumption. This is why venture math is dominated by a handful of outlier outcomes in the training data (Facebook, Google, Uber) and why returns are hard to replicate.
              </div>
            </div>

            {/* Selection Skill explainer */}
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Selection Skill — What the 1-5 Scale Means</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 14 }}>
                Models how much your picking ability shifts the outcome distribution vs. the market baseline. Anchored to <span style={{ color: "#e8e0d0" }}>Horsley Bridge's empirical finding</span> that top-tier VCs hit outliers ~4.5% per investment vs 2% for average funds.
              </div>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <th style={{ textAlign: "left" }}>Skill</th>
                    <th style={{ textAlign: "left" }}>Label</th>
                    <th>Unicorn tier ($1–3B)</th>
                    <th>Loss rate</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map(p => {
                    const adj = applySelection(baseDist, skillValue(p));
                    const norm = normalize(adj);
                    const u = norm.find(d => d.label.includes("Unicorn"))?.prob || 0;
                    const l = norm.find(d => d.label.includes("Total Loss"))?.prob || 0;
                    const isActive = p === skillPt;
                    const color = p < 3 ? "#a33d2a" : p === 3 ? "#c8a94e" : "#4e9e6e";
                    return (
                      <tr key={p} style={{ background: isActive ? "#15151f" : "transparent" }}>
                        <td className="serif" style={{ textAlign: "left", color, fontSize: 16 }}>{p}</td>
                        <td style={{ textAlign: "left", color, fontSize: 12 }}>{skillLabel(p)}</td>
                        <td style={{ color: "#aaa" }}>{(u * 100).toFixed(2)}%</td>
                        <td style={{ color: "#aaa" }}>{(l * 100).toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 10, color: "#555", lineHeight: 1.6 }}>
                At skill 5, unicorn rate roughly doubles, decacorn 1.5×, centicorn 2×, loss rate drops 15%. Inverse for below-average skill.
              </div>
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 14 }}>
                Outcome Distribution · {preset === "yc" ? "YC-calibrated" : "industry average"}
                {skill !== 0 && <span style={{ color: "#666", fontSize: 10, marginLeft: 8 }}>(skill-adjusted {skill > 0 ? "+" : ""}{skill.toFixed(2)})</span>}
              </div>
              {nd.map((d, i) => (
                <div key={i} className="dist-row">
                  <span style={{ fontSize: 15, width: 20 }}>{d.emoji}</span>
                  <span style={{ fontSize: 11, color: "#aaa", width: 155, flexShrink: 0 }}>{d.label}</span>
                  <div className="prob-bar-bg" style={{ flex: 1 }}>
                    <div className="prob-bar-fill" style={{ width: `${Math.min(100, d.prob / 0.55 * 100)}%`, background: d.color }} />
                  </div>
                  <span style={{ fontSize: 12, color: d.color, width: 48, textAlign: "right", flexShrink: 0 }}>{fmtPct(d.prob)}</span>
                  <span style={{ fontSize: 10, color: "#444", width: 38, textAlign: "right", flexShrink: 0 }}>{d.multiplier}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════ HEAD-TO-HEAD ══════════════════════ */}
        {activeTab === "headtohead" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 12 }}>Concentrated vs. Distributed</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 18 }}>
                Two strategies over a {DEPLOYMENT_YEARS}-year deployment. Same distribution, same per-position budget. Only the portfolio size differs. Which produces a better outcome shape across 5,000 simulated funds? Both sides share the same random seed, so when you set both counts equal, the results are identical by design.
              </div>
              <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, marginBottom: 16, padding: "8px 12px", background: "#0a1a14", border: "1px solid #4e9e6e44", borderRadius: 4 }}>
                <span style={{ color: "#4e9e6e" }}>→</span> Drag the <strong style={{ color: "#4e9e6e" }}>portfolio size</strong> slider up top to change the <strong style={{ color: "#4e9e6e" }}>Distributed</strong> side. Use the <strong style={{ color: "#a33d2a" }}>Concentrated</strong> slider below to set the comparison.
              </div>

              <div>
                <div className="label" style={{ color: "#a33d2a", marginBottom: 6 }}>Concentrated · total positions</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="range" min={5} max={100} step={1} value={concCount} onChange={e => setConcCount(+e.target.value)} style={{ flex: 1 }} />
                  <input type="number" className="inline" style={{ color: "#a33d2a" }} value={concCount} onChange={e => setConcCount(Math.min(100, Math.max(5, +e.target.value || 5)))} />
                </div>
                <div className="help-bar">high conviction · ≈ {Math.round(concCount / DEPLOYMENT_YEARS)}/yr</div>
              </div>
              {concCount === distCount && (
                <div style={{ marginTop: 14, padding: "10px 12px", background: "#1a0e0e22", border: "1px solid #6b1a1a44", borderRadius: 4, fontSize: 11, color: "#c4783a", lineHeight: 1.6 }}>
                  ⚠ Both sides at {concCount} positions — this is the same strategy, not a comparison. The two sides are mathematically identical by design (shared random seed). Move one of the sliders to compare.
                </div>
              )}
            </div>

            {concResult && distResult && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  <div className="stat-card">
                    <div className="label" style={{ color: "#a33d2a", marginBottom: 10 }}>Concentrated · {concCount} positions</div>
                    {[
                      [<Tip text="Middle outcome — half of funds do worse, half do better. The honest number.">Median MOIC</Tip>, `${concResult.median.toFixed(2)}x`],
                      [<Tip text="Average outcome. Can be misleading — one 50x outlier pulls the mean up dramatically even if most funds failed.">Mean MOIC</Tip>, `${concResult.mean.toFixed(2)}x`],
                      ["P(return ≥ 1x)", `${concResult.p1.toFixed(1)}%`],
                      ["P(return ≥ 3x)", `${concResult.p3.toFixed(1)}%`],
                      ["P(return ≥ 5x)", `${concResult.p5.toFixed(1)}%`],
                      [<Tip text="Volatility of outcomes. Higher = wider swing between best and worst simulated funds.">Std deviation</Tip>, `${concResult.std.toFixed(2)}x`],
                    ].map(([l, v], i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #141414" }}>
                        <span style={{ color: "#666" }}>{l}</span>
                        <span className="serif" style={{ color: "#a33d2a" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div className="stat-card">
                    <div className="label" style={{ color: "#4e9e6e", marginBottom: 10 }}>Distributed · {distCount} positions</div>
                    {[
                      [<Tip text="Middle outcome — half of funds do worse, half do better. The honest number.">Median MOIC</Tip>, `${distResult.median.toFixed(2)}x`],
                      [<Tip text="Average outcome. Can be misleading — one 50x outlier pulls the mean up dramatically even if most funds failed.">Mean MOIC</Tip>, `${distResult.mean.toFixed(2)}x`],
                      ["P(return ≥ 1x)", `${distResult.p1.toFixed(1)}%`],
                      ["P(return ≥ 3x)", `${distResult.p3.toFixed(1)}%`],
                      ["P(return ≥ 5x)", `${distResult.p5.toFixed(1)}%`],
                      [<Tip text="Volatility of outcomes. Higher = wider swing between best and worst simulated funds.">Std deviation</Tip>, `${distResult.std.toFixed(2)}x`],
                    ].map(([l, v], i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #141414" }}>
                        <span style={{ color: "#666" }}>{l}</span>
                        <span className="serif" style={{ color: "#4e9e6e" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="stat-card" style={{ marginBottom: 16 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Outcome Probability Curve (CDF)</div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 12, lineHeight: 1.6 }}>
                    Read any point as "probability the fund returns at least X." The vertical gap at <span style={{ color: "#c8a94e" }}>1x</span> and <span style={{ color: "#c8a94e" }}>3x</span> is the LP's decision.
                  </div>
                  <CDFChart
                    dataA={concResult.res}
                    dataB={distResult.res}
                    labelA={`Concentrated (${concCount})`}
                    labelB={`Distributed (${distCount})`}
                    colorA="#a33d2a"
                    colorB="#4e9e6e"
                  />
                  <div style={{ marginTop: 10, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                    The <span style={{ color: "#4e9e6e" }}>distributed curve</span> sits higher on the left (more likely to return capital) and drops off smoothly. The <span style={{ color: "#a33d2a" }}>concentrated curve</span> has a fatter right tail at the extreme — but the probability of getting there is low, and the probability of total failure is high.
                  </div>
                </div>

                <div className="stat-card">
                  <div className="label" style={{ marginBottom: 10 }}>The Key Insight</div>
                  <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                    Both strategies have roughly the <span style={{ color: "#e8e0d0" }}>same expected value</span> in theory — but the concentrated strategy has ~<span style={{ color: "#a33d2a" }}>{(concResult.std / distResult.std).toFixed(1)}× higher volatility</span>. Concentrated funds win big when they hit, lose hard when they miss, and depend on picking skill you probably don't have. Distributed wins on P(≥1x) — <span style={{ color: "#4e9e6e" }}>{distResult.p1.toFixed(1)}%</span> vs. <span style={{ color: "#a33d2a" }}>{concResult.p1.toFixed(1)}%</span> — and on P(≥3x) — <span style={{ color: "#4e9e6e" }}>{distResult.p3.toFixed(1)}%</span> vs. <span style={{ color: "#a33d2a" }}>{concResult.p3.toFixed(1)}%</span>.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════ FOLLOW-ON STRATEGY ══════════════════════ */}
        {activeTab === "followon" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>The Three Levers of Follow-On Strategy</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 14 }}>
                Three settings determine how follow-ons affect returns. Adjust each to see the impact in real time. Below the controls, the chart sweeps reserve ratio across three threshold strategies to find the mathematical optimum.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div>
                  <div className="label">
                    <Tip text="Fraction of fund held back from initial checks. Real funds reserve 30–60%. Reserves can only be deployed into companies that show traction (the threshold below).">Reserve ratio</Tip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min={0} max={0.7} step={0.05} value={reserveRatio} onChange={e => setReserveRatio(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 16, color: "#c8a94e", minWidth: 50 }}>{(reserveRatio * 100).toFixed(0)}%</span>
                  </div>
                  <div className="help-bar">e.g. 40% = $4M of a $10M fund held for follow-ons</div>
                </div>
                <div>
                  <div className="label">
                    <Tip text="The mark-up multiple a company must hit to qualify for a follow-on check. 1x = follow on in any priced up-round. 3x = wait for material traction. 10x = only follow on into clear winners. Counter-intuitive: lowering the threshold often RAISES median MOIC because it deploys reserves into more companies rather than leaving them as cash earning 1x. The catch — lower thresholds only work if you're skilled at picking winners among the many marked-up companies.">Follow-on threshold</Tip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min={1} max={10} step={0.5} value={foThreshold} onChange={e => setFoThreshold(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 16, color: "#c8a94e", minWidth: 50 }}>{foThreshold}x</span>
                  </div>
                  <div className="help-bar">company must be marked up ≥ {foThreshold}× before follow-on</div>
                </div>
                <div>
                  <div className="label">
                    <Tip text="Size of the follow-on check as a multiple of your initial check. 1× = same as initial. 2× = double down. 5× = aggressive concentration on winners.">Follow-on check size</Tip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min={1} max={5} step={0.5} value={foMult} onChange={e => setFoMult(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 16, color: "#c8a94e", minWidth: 50 }}>{foMult}×</span>
                  </div>
                  <div className="help-bar">if initial = $25K, follow-on = ${(25 * foMult).toFixed(0)}K</div>
                </div>
              </div>
            </div>

            {/* Live single-point result */}
            {foSinglePoint && (
              <div className="stat-card" style={{ marginBottom: 16 }}>
                <div className="label" style={{ marginBottom: 10 }}>Your Current Strategy → Live Result</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 12 }}>
                  {[
                    { label: "Median MOIC", value: `${foSinglePoint.median.toFixed(2)}x`, color: "#c8a94e" },
                    { label: "P(≥1x)",      value: `${foSinglePoint.p1.toFixed(0)}%`, color: "#4e9e6e" },
                    { label: "P(≥3x)",      value: `${foSinglePoint.p3.toFixed(0)}%`, color: "#3a7abf" },
                    { label: "P(≥5x)",      value: `${foSinglePoint.p5.toFixed(0)}%`, color: "#7c5cbf" },
                  ].map((s, i) => (
                    <div key={i} style={{ textAlign: "center", padding: 10, background: "#0a0a12", borderRadius: 6 }}>
                      <div style={{ fontSize: 9, color: "#555", marginBottom: 2 }}>{s.label}</div>
                      <div className="serif" style={{ fontSize: 20, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                  At {numInvestments} positions with <span style={{ color: "#c8a94e" }}>{(reserveRatio * 100).toFixed(0)}% reserves</span>, follow-on at <span style={{ color: "#c8a94e" }}>{foThreshold}× mark-up</span>, <span style={{ color: "#c8a94e" }}>{foMult}× check</span>. Compare against the optimal sweep below.
                </div>
              </div>
            )}

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>The Sweep — Finding the Mathematical Optimum</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
                Below: reserve ratio sweep from 0% to 70% at your current portfolio size ({numInvestments} positions), 600 simulations per point, across three follow-on threshold strategies. The optimal point is where median MOIC peaks.
              </div>
            </div>

            {foCurves && (
              <>
                <div className="stat-card" style={{ marginBottom: 12 }}>
                  <div className="label" style={{ marginBottom: 12 }}>
                    Median MOIC vs. Reserve Ratio
                    <span className="badge" style={{ background: "#c8a94e22", color: "#c8a94e" }}>Optimal: {(foCurves.optimalReserve * 100).toFixed(0)}% reserves</span>
                  </div>
                  <MultiLineChart
                    xValues={foCurves.sweep}
                    series={foCurves.series.map(s => ({ label: s.label, color: s.color, dash: s.dash, values: s.medians }))}
                    xFmt={x => `${(x * 100).toFixed(0)}%`}
                    yFmt={v => `${v.toFixed(1)}x`}
                    xLabel="Reserve ratio →"
                    optimalX={foCurves.optimalReserve}
                  />
                  <div style={{ marginTop: 10, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                    The peak of the <span style={{ color: "#c8a94e" }}>3x threshold curve</span> (the middle path) sits around <span style={{ color: "#c8a94e" }}>{(foCurves.optimalReserve * 100).toFixed(0)}% reserves</span>, delivering a median of <span style={{ color: "#c8a94e" }}>{foCurves.optimalMedian.toFixed(2)}x</span>. Too little reserve: you don't pour gas on winners. Too much: your initial portfolio is too small to have enough winners to pour on.
                  </div>
                </div>

                <div className="stat-card" style={{ marginBottom: 12 }}>
                  <div className="label" style={{ marginBottom: 12 }}>P(return ≥ 3x) vs. Reserve Ratio</div>
                  <MultiLineChart
                    xValues={foCurves.sweep}
                    series={foCurves.series.map(s => ({ label: s.label, color: s.color, dash: s.dash, values: s.p3s }))}
                    xFmt={x => `${(x * 100).toFixed(0)}%`}
                    yFmt={v => `${v.toFixed(0)}%`}
                    xLabel="Reserve ratio →"
                  />
                  <div style={{ marginTop: 10, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                    Probability of producing a "strong fund" (3x+ return). The <span style={{ color: "#c4783a" }}>1x curve</span> (follow on everything that marks up) wastes capital on zombies that mark up once then die. The <span style={{ color: "#4e9e6e" }}>10x curve</span> almost never fires — winners that clear a 10x threshold are too rare, so reserves sit uninvested at 1x and drag the whole portfolio down. Every dollar reserved for a signal that never arrives is a dollar you should have put into another at-bat.
                  </div>
                </div>

                <div className="stat-card" style={{ marginBottom: 16 }}>
                  <div className="label" style={{ marginBottom: 10 }}>Concentrated vs. Distributed Reserve Strategies</div>
                  <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                    The optimal reserve strategy depends on your portfolio size. For a <span style={{ color: "#a33d2a" }}>concentrated portfolio (10–25 positions)</span>, lower reserves (~25–35%) work better — you don't have enough at-bats to expect many winners, so deploying capital broadly matters more. For a <span style={{ color: "#4e9e6e" }}>distributed portfolio (200+ positions)</span>, higher reserves (~45–55%) work because you'll have meaningful numbers of winners hitting the threshold and follow-on dollars compound efficiently. The chart above is computed at <span style={{ color: "#c8a94e" }}>{numInvestments} positions</span> — change the global slider to see how the optimum shifts.
                  </div>
                </div>

                <div className="stat-card" style={{ marginBottom: 16 }}>
                  <div className="label" style={{ marginBottom: 10 }}>Honest Caveat — What This Model Assumes About Follow-On Decisions</div>
                  <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                    The simulation above implements <strong style={{ color: "#e8e0d0" }}>blind threshold-based follow-on</strong> — any company that marks up above the threshold receives a follow-on check. This under-models the benefit of <em>conviction-based</em> follow-on, where skilled GPs use late-stage signals (team performance, cohort benchmarking, Series-A investor interest) to decide which winners actually deserve more capital.
                    <br /><br />
                    The model partially accounts for this via the <span style={{ color: "#c8a94e" }}>Selection Skill</span> setting above — at skill 4–5, follow-on outcomes are boosted ~10–20% to reflect better winner selection. You're currently at <span style={{ color: "#c8a94e" }}>Skill {skillPt}/5 ({skillLabel(skillPt)})</span>. Try moving it up and down to see how the optimal reserve ratio shifts. Skilled GPs get more lift from reserves because their follow-on picks outperform blind threshold-based deployment.
                  </div>
                </div>

                <div className="stat-card">
                  <div className="label" style={{ marginBottom: 10 }}>Three LP Insights</div>
                  <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                    <strong style={{ color: "#c8a94e" }}>(1)</strong> The optimal reserve isn't zero — disciplined follow-on at 3x+ traction lifts returns measurably. <strong style={{ color: "#c8a94e" }}>(2)</strong> But the optimal isn't the industry-default 50%+ either if you're holding cash waiting for rare signals. <strong style={{ color: "#c8a94e" }}>(3)</strong> The "patient capital, only winners" strategy (10x threshold) is the quiet killer — GPs convinced they should "only double down on clear winners" end up with half their fund sitting in cash that never gets deployed.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════ IRR TRANSLATION ══════════════════════ */}
        {activeTab === "irr" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>MOIC → IRR via J-Curve Distribution Pacing</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
                Fund IRR follows directly from cashflow timing. The model calls committed capital evenly over the {DEPLOYMENT_YEARS}-year deployment and holds each cohort for a standardized 10 years — anchored to Crunchbase data (SaaS companies take a median 9 years from founding to exit) and SaaStr's analysis of $1B+ SaaS acquisitions (10.0-year median from funding). The rule-of-72 sanity check holds: a dollar that triples over 10 years earns ~11.6% — so a 3x-gross fund shows a ~11.6% gross IRR, and net IRR lands below that after the fee drag on invested capital and 20% carry.
              </div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#0a0a12", borderRadius: 4, fontSize: 11, color: "#888" }}>
                Live: <span style={{ color: "#c8a94e" }}>{numInvestments} positions</span>, gross MOIC of <span style={{ color: "#c8a94e" }}>{medianMOIC.toFixed(2)}x</span>, {DEPLOYMENT_YEARS}-year deployment, 10-year hold per investment.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div className="stat-card" style={{ textAlign: "center" }}>
                <div className="label">Gross (before fees)</div>
                <div style={{ display: "flex", justifyContent: "space-around", marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>MOIC</div>
                    <div className="serif" style={{ fontSize: 24, color: "#c8a94e" }}>{eco.grossMOIC.toFixed(2)}x</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>IRR</div>
                    <div className="serif" style={{ fontSize: 24, color: "#c8a94e" }}>{(eco.grossIRR * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </div>
              <div className="stat-card" style={{ textAlign: "center" }}>
                <div className="label">Net (after carry)</div>
                <div style={{ display: "flex", justifyContent: "space-around", marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>MOIC</div>
                    <div className="serif" style={{ fontSize: 24, color: eco.netMOIC >= 3 ? "#4e9e6e" : eco.netMOIC >= 1 ? "#c8a94e" : "#a33d2a" }}>{eco.netMOIC.toFixed(2)}x</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>IRR</div>
                    <div className="serif" style={{ fontSize: 24, color: eco.netIRR >= 0.2 ? "#4e9e6e" : eco.netIRR >= 0.1 ? "#c8a94e" : "#a33d2a" }}>{(eco.netIRR * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Cashflow Timing Model</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                Capital calls: <span style={{ color: "#e8e0d0" }}>1/{DEPLOYMENT_YEARS} of commitments per year</span> across the deployment period. Each year's cohort exits <span style={{ color: "#e8e0d0" }}>10 years after its call</span>, so distributions arrive in years 10–{DEPLOYMENT_YEARS + 9}. The waterfall pays LPs 100% of distributions until their full commitment is returned, then splits 80/20. Fees never subtract from returns directly — they reduce how much of the fund is invested (80% of commitments before recycling), which is where the gross-to-net gap comes from. Sources for the 10-year hold are linked in the footer.
              </div>
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 12 }}>MOIC → Net IRR Reference (10-yr hold)</div>
              <table>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <th style={{ textAlign: "left" }}>Gross MOIC</th>
                    <th>Net MOIC</th>
                    <th>Gross IRR</th>
                    <th>Net IRR</th>
                    <th style={{ textAlign: "left" }}>LP Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { moic: 1,  verdict: "Capital loss after fees",   color: "#6b1a1a" },
                    { moic: 2,  verdict: "Below S&P 500",             color: "#a33d2a" },
                    { moic: 3,  verdict: "Baseline acceptable",       color: "#c8a94e" },
                    { moic: 5,  verdict: "Top-quartile target",       color: "#4e9e6e" },
                    { moic: 10, verdict: "Top-decile fund",           color: "#3a7abf" },
                    { moic: 20, verdict: "Legendary vintage",         color: "#7c5cbf" },
                  ].map(r => {
                    const e = fundEconomics(r.moic, recyclePct);
                    return (
                      <tr key={r.moic}>
                        <td style={{ textAlign: "left", color: "#e8e0d0" }} className="serif">{r.moic}x</td>
                        <td className="serif" style={{ color: "#aaa" }}>{e.netMOIC.toFixed(2)}x</td>
                        <td style={{ color: "#888" }}>{(e.grossIRR * 100).toFixed(1)}%</td>
                        <td className="serif" style={{ color: r.color, fontSize: 14 }}>{(e.netIRR * 100).toFixed(1)}%</td>
                        <td style={{ textAlign: "left", color: r.color, fontSize: 11 }}>{r.verdict}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10, color: "#444", lineHeight: 1.6 }}>
                With the corrected fee model (fees reduce investable capital to 80% of commitments; carry above 1x of committed), a 3× gross MOIC produces roughly 9–12% net IRR depending on exit horizon. A 5× gross fund lands near 16–21%. Top-quartile VC vintages return 15–27% net IRR — which is why the gross bar for a genuinely good fund is higher than most pitch decks admit.
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ HORSLEY BRIDGE ══════════════════════ */}
        {activeTab === "outlier" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Horsley Bridge's "Chance of an Outlier"</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
                Horsley Bridge, one of the largest LPs in venture, analyzed decades of fund data and found the question that actually predicts performance isn't <span style={{ color: "#a33d2a" }}>loss rate</span> — it's <span style={{ color: "#4e9e6e" }}>chance of an outlier</span>. Great VCs have <span style={{ color: "#e8e0d0" }}>more losses than good VCs</span>, not fewer. Loss rate is a distractor. Outlier probability is the signal.
              </div>
              <div className="callout">
                <strong style={{ color: "#c8a94e" }}>4.5% of invested capital</strong> generates <strong style={{ color: "#c8a94e" }}>60% of top-tier VC returns.</strong> The only way to reliably capture that 4.5% is at-bats.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 14 }}>Probability of ≥1 Outlier by Skill Tier</div>
              <OutlierChart curves={outlierCurves} currentN={numInvestments} />
              <div style={{ marginTop: 10, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                Even a superstar VC needs <span style={{ color: "#4e9e6e" }}>~40 investments</span> for a 95%+ chance of at least one outlier. An average VC needs <span style={{ color: "#a33d2a" }}>~150</span> — roughly the number a standard 4-year deployment produces at a Kelly-optimal cadence.
              </div>
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 12 }}>P(≥1 Outlier) at Your Distribution</div>
              <table>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    {["Total Positions", "P(≥1 Unicorn)", "P(≥1 Decacorn)", "P(≥1 Centicorn)", "Per Year"].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[10, 25, 50, 100, 150, 200, 300, 500].map(n => {
                    const pu = probAtLeastOne(nd, n, 55);
                    const pd = probAtLeastOne(nd, n, 400);
                    const pc = probAtLeastOne(nd, n, 5000);
                    return (
                      <tr key={n} style={{ background: n === numInvestments ? "#15151f" : "transparent" }}>
                        <td className="serif" style={{ textAlign: "right", color: "#c8a94e", fontSize: 14 }}>{n}</td>
                        <td style={{ color: pu > 0.95 ? "#4e9e6e" : pu > 0.7 ? "#c8a94e" : "#a33d2a" }}>{fmtPct(pu)}</td>
                        <td style={{ color: pd > 0.5 ? "#3a7abf" : pd > 0.2 ? "#c8a94e" : "#555" }}>{fmtPct(pd)}</td>
                        <td style={{ color: pc > 0.2 ? "#7c5cbf" : "#555" }}>{fmtPct(pc)}</td>
                        <td style={{ color: "#555" }}>~{Math.round(n / DEPLOYMENT_YEARS)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════ KELLY ══════════════════════ */}
        {activeTab === "kelly" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>The Kelly Criterion — An Intuition Pump</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
                Kelly (Bell Labs, 1956) answers the question: <em style={{ color: "#e8e0d0" }}>given a bet with positive expected value, what fraction of your bankroll should you wager to maximize long-run growth?</em> The formula is elegant, but the binary version (one win probability, one payout) breaks on venture's multi-outcome distribution. The proper generalization — maximizing expected log growth over the full distribution (Thorp 2006; MacLean, Thorp &amp; Ziemba 2011) — is computed live below from the current assumptions.
              </div>
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#1a0e0e22", border: "1px solid #6b1a1a44", borderRadius: 4, fontSize: 11, color: "#c4783a", lineHeight: 1.6 }}>
                <strong>Reading the per-tier table below:</strong> applied to any single outcome tier in isolation, Kelly says "no edge" — the downside (everything else in the distribution) swamps any one tier's upside. That is a limitation of single-outcome Kelly, not evidence against investing. The correct treatment is the full-distribution Kelly above, which bets on the whole outcome mix at once.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16, border: "1px solid #3a3520" }}>
              <div className="label" style={{ marginBottom: 10 }}>Full-Distribution Kelly — Computed From Current Assumptions</div>
              {(() => {
                const k = fullDistributionKelly(nd);
                const posFull = k.f > 0.0005 ? Math.round(1 / k.f) : Infinity;
                const posHalf = k.f > 0.0005 ? Math.round(2 / k.f) : Infinity;
                const posQuarter = k.f > 0.0005 ? Math.round(4 / k.f) : Infinity;
                return (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>Optimal bet f*</div>
                        <div className="serif" style={{ fontSize: 22, color: "#c8a94e" }}>{(k.f * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>Full Kelly</div>
                        <div className="serif" style={{ fontSize: 22, color: "#e8e0d0" }}>{posFull === Infinity ? "—" : posFull} <span style={{ fontSize: 11, color: "#666" }}>positions</span></div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>Half Kelly</div>
                        <div className="serif" style={{ fontSize: 22, color: "#e8e0d0" }}>{posHalf === Infinity ? "—" : posHalf} <span style={{ fontSize: 11, color: "#666" }}>positions</span></div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>Quarter Kelly</div>
                        <div className="serif" style={{ fontSize: 22, color: "#e8e0d0" }}>{posQuarter === Infinity ? "—" : posQuarter} <span style={{ fontSize: 11, color: "#666" }}>positions</span></div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#888", lineHeight: 1.7 }}>
                      Full Kelly assumes the probabilities are exactly right and that winnings can be re-bet — neither holds in venture, where probabilities are estimates and capital locks up for a decade. Practitioners run fractional Kelly to compensate for estimation error (Thorp's recommendation). Quarter Kelly on the current distribution implies roughly <span className="serif" style={{ color: "#c8a94e" }}>{posQuarter === Infinity ? "—" : posQuarter}</span> equal positions. Note what Kelly cannot see: illiquidity, deal-flow constraints, follow-on strategy, and the one-shot nature of a fund. The Monte Carlo tab handles those; this card is the cleanest answer to "what does betting theory say about position sizing on this distribution."
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="formula-card">
              <div className="formula" style={{ fontSize: 28, textAlign: "center", padding: "8px 0" }}>
                f* = p − (1 − p) / b
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 18 }}>
                <div style={{ textAlign: "center" }}>
                  <div className="serif" style={{ fontSize: 18, color: "#c8a94e" }}>f*</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>optimal capital fraction per bet</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div className="serif" style={{ fontSize: 18, color: "#c8a94e" }}>p</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>probability of winning</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div className="serif" style={{ fontSize: 18, color: "#c8a94e" }}>b</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>net odds (multiplier − 1)</div>
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Why "Full Kelly" Is Impractical in Venture</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
                Consider a unicorn-tier outcome (55× post-dilution) at a 2% cumulative $1B+ hit rate. Full Kelly says:
              </div>
              <div style={{ padding: "12px 14px", background: "#0a0a12", borderRadius: 4, fontFamily: "'Fraunces', serif", fontSize: 13, color: "#c8a94e", lineHeight: 1.9 }}>
                f* = 0.02 − (0.98 / 54) = 0.02 − 0.018 = +0.2% per bet → ~540 positions at full Kelly
              </div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginTop: 12 }}>
                Full Kelly says <em>don't bet at all</em> on this outcome — the upside isn't large enough relative to the downside. But this ignores that venture funds bet on <em>distributions</em>, not single outcomes. The expected value across the whole distribution is materially positive. Kelly applied to a single tier undervalues the compound effect of the outcome mix.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Fractional Kelly — What Practitioners Actually Use</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                Professional gamblers and quantitative investors don't use Full Kelly — they use <strong style={{ color: "#e8e0d0" }}>Fractional Kelly</strong>, typically <strong style={{ color: "#c8a94e" }}>½ or ¼ Kelly</strong>. The intuition: Full Kelly assumes perfect knowledge of the probabilities; in reality, we don't know <em>p</em> and <em>b</em> precisely. Fractional Kelly trades a small amount of expected growth for much lower volatility and robustness to model error.
                <br /><br />
                Under log-utility, the <em>cost</em> of Half Kelly is only ~25% of the maximum growth rate, but the <em>benefit</em> is halved drawdowns and much more stable compounding. In venture — where our distributional assumptions are rough approximations — Fractional Kelly is the more honest application.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {nd.filter(d => d.multiplier > 1).map(d => {
                const b = d.multiplier - 1;
                // Cumulative "this outcome or better" — the meaningful
                // single-bet framing. Exclusive per-tier probabilities make
                // every tier look edge-less, which misreads the bet.
                const pCum = nd.filter(x => x.multiplier >= d.multiplier).reduce((s, x) => s + x.prob, 0);
                const f = Math.max(0, pCum - (1 - pCum) / b);
                const halfF = f / 2;
                const nTotal = f > 0 ? Math.round(1 / f) : null;
                const halfN = halfF > 0 ? Math.round(1 / halfF) : null;
                const hasEdge = f > 0;
                return (
                  <div key={d.label} className="stat-card">
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 20 }}>{d.emoji}</span>
                      <span style={{ fontSize: 13, color: "#aaa" }}>{d.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "#555" }}>p (≥ this)</div>
                        <div className="serif" style={{ fontSize: 14, color: "#888" }}>{fmtPct(nd.filter(x => x.multiplier >= d.multiplier).reduce((s, x) => s + x.prob, 0))}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#555" }}>b</div>
                        <div className="serif" style={{ fontSize: 14, color: "#888" }}>{d.multiplier}x</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#555" }}>f*</div>
                        <div className="serif" style={{ fontSize: 14, color: "#888" }}>{(f * 100).toFixed(2)}%</div>
                      </div>
                    </div>
                    {hasEdge ? (
                      <>
                        <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
                          Full Kelly: {nTotal.toLocaleString()} positions
                        </div>
                        <div className="serif" style={{ fontSize: 16, color: d.color }}>
                          ½ Kelly: ~{halfN.toLocaleString()} positions
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, fontStyle: "italic" }}>
                        Full Kelly on this tier alone shows <span style={{ color: "#c4783a" }}>no edge</span> — the upside multiple ({d.multiplier}×) doesn't clear the downside vs. the probability ({fmtPct(d.prob)}). This is <em>expected</em> — Kelly treats each outcome in isolation. Venture funds capture value from the <em>mix</em> of outcomes, where higher tiers do the heavy lifting. See "Why Full Kelly Is Impractical" above.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 10 }}>The Intuition, Not a Prescription</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.85 }}>
                Kelly's real contribution to venture portfolio construction isn't a specific number — it's the <strong style={{ color: "#e8e0d0" }}>directional insight that position sizes should be small relative to fund size when outcomes are highly asymmetric</strong>. Whether the "right" portfolio is 30, 100, or 300 depends on factors Kelly doesn't capture (deal flow access, operational capacity, LP expectations, fund-level carry dynamics).
                <br /><br />
                Treat Kelly as corroborating evidence for the Monte Carlo and Horsley Bridge findings, not as a third independent proof. All three lean on the same power-law assumption about outcomes. What they collectively say is simple: <span style={{ color: "#c8a94e" }}>"given venture's outcome distribution, smaller positions and more at-bats compound more reliably than fewer, larger positions."</span>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ MONTE CARLO ══════════════════════ */}
        {activeTab === "montecarlo" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 8 }}>Monte Carlo · 20 → 1,000 Positions</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
                Choose a precision level below. The <strong style={{ color: "#c8a94e" }}>gold marker</strong> on each chart tracks your current portfolio size. Small-n sims automatically run with extra iterations since rare outcomes create more variance at small portfolio sizes.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#0a0a12", border: "1px solid #1a1a1a", borderRadius: 6, marginBottom: 12, fontSize: 11, color: "#888", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 9 }}>Precision</span>
                {mcRunning && <span style={{ color: "#c8a94e" }}>· computing {mcProgress}%…</span>}
              </div>
              <div style={{ display: "flex", gap: 6, flex: 1, justifyContent: "flex-end" }}>
                {[
                  { label: "Fast",     sims: 1500,  note: "~100ms" },
                  { label: "Standard", sims: 3000,  note: "~250ms" },
                  { label: "Precise",  sims: 10000, note: "~800ms" },
                ].map(opt => {
                  const active = mcCurves?.sims === opt.sims;
                  return (
                    <button
                      key={opt.sims}
                      disabled={mcRunning}
                      onClick={() => runCurves(opt.sims)}
                      style={{
                        background: active ? "#c8a94e" : "transparent",
                        border: "1px solid " + (active ? "#c8a94e" : "#242424"),
                        color: active ? "#000000" : "#888",
                        padding: "5px 12px",
                        borderRadius: 4,
                        cursor: mcRunning ? "wait" : "pointer",
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        opacity: mcRunning ? 0.4 : 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        minWidth: 72,
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{opt.label}</span>
                      <span style={{ fontSize: 8, opacity: 0.7, marginTop: 1, textTransform: "none", letterSpacing: 0 }}>
                        {opt.sims.toLocaleString()} · {opt.note}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {mcCurves && (
              <>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 8, textAlign: "right", fontStyle: "italic" }}>
                  ↔ click or drag on any chart to set portfolio size
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>Outcome Bands — where 80% of simulated funds land</div>
                  <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 10 }}>
                    Shaded bands show the 10th–90th (light) and 25th–75th (dark) percentile range of fund outcomes; the solid line is the median. The funnel narrowing to the right is the consistency argument in one picture: more positions squeeze the range of likely outcomes toward the distribution's expected multiple of <span className="serif" style={{ color: "#c8a94e" }}>{em.toFixed(2)}x</span> — the bottom of the band rises, and the top compresses.
                  </div>
                  {mcCurves.q10s && <BandChart sizes={mcCurves.sizes} med={mcCurves.meds} q10={mcCurves.q10s} q25={mcCurves.q25s} q75={mcCurves.q75s} q90={mcCurves.q90s} currentN={numInvestments} onSelectN={setNumInvestments} />}
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>Failure Rate — P(return &lt; 1x)</div>
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.fails} color="#e24b4a" currentN={numInvestments} yFmt={v => v.toFixed(0) + "%"} onSelectN={setNumInvestments} />
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>Triple Rate — P(return ≥ 3x)</div>
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.triples} color="#4e9e6e" currentN={numInvestments} yFmt={v => v.toFixed(0) + "%"} onSelectN={setNumInvestments} />
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>P(return ≥ 5x) — top-quartile target</div>
                  {em < 5 && (
                    <div style={{ fontSize: 10.5, color: "#8a7433", lineHeight: 1.6, marginBottom: 8 }}>
                      Note: the current distribution's expected multiple is {em.toFixed(2)}x — below the 5x target. When the target exceeds the expected multiple, this curve mathematically must peak and then decline: diversification converges every fund toward the mean, and the mean is below the target. Raising deal quality (preset or skill) is the only way to move the mean itself.
                    </div>
                  )}
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.p5s} color="#3a7abf" currentN={numInvestments} yFmt={v => v.toFixed(0) + "%"} onSelectN={setNumInvestments} />
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>P(return ≥ 10x) — top-decile fund outcome</div>
                  <div style={{ fontSize: 10.5, color: "#8a7433", lineHeight: 1.6, marginBottom: 8 }}>
                    {em >= 10
                      ? "The current expected multiple exceeds 10x, so this probability rises with portfolio size."
                      : `A 10x fund requires beating the distribution's expected multiple of ${em.toFixed(2)}x. Diversification trades this moonshot probability away in exchange for consistency — the honest cost of a volume strategy. Concentrated funds keep more 10x+ probability and accept far more downside in exchange.`}
                  </div>
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.p10s} color="#7c5cbf" currentN={numInvestments} yFmt={v => v.toFixed(0) + "%"} onSelectN={setNumInvestments} />
                </div>
                <div className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="label" style={{ marginBottom: 12 }}>Median MOIC by Portfolio Size</div>
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.meds} color="#c8a94e" currentN={numInvestments} yFmt={v => v.toFixed(1) + "x"} onSelectN={setNumInvestments} />
                </div>
                <div className="stat-card">
                  <div className="label" style={{ marginBottom: 12 }}>Volatility (std dev) — lower is more consistent</div>
                  <CurveChart sizes={mcCurves.sizes} values={mcCurves.vols} color="#c4783a" currentN={numInvestments} yFmt={v => v.toFixed(1) + "x"} onSelectN={setNumInvestments} />
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════ WHY THIS WORKS ══════════════════════ */}
        {activeTab === "why" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>The Obvious Counter-Question</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
                If high-volume portfolio construction really produced better risk-adjusted returns than concentrated conviction, why isn't every sophisticated LP already doing it? The honest answer has three parts — and the math alone doesn't close the argument.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>1. Sophisticated LPs Already Own Hundreds or Thousands of Positions</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
                Large endowments, pension funds, and sovereigns rarely hold concentrated venture positions — not because the math is obscure, but because they've run it. A $500M fund-of-funds commitment, or an allocation to a mega fund like Sequoia Capital Global Growth III, typically translates to <span style={{ color: "#e8e0d0" }}>exposure across 800 to 3,000+ underlying startups</span>. Fund-of-funds back 20–40 managers, each running 30–80 positions. Mega funds at scale write dozens of checks per vintage across multiple strategies.
                <br /><br />
                Put differently: the LPs who sit at the table with the most capital have <em>already voted with their allocations</em> that venture exposure is best taken at hundreds or thousands of underlying positions, not tens. The argument in this tool isn't that diversification is novel — it's that a single high-signal fund can now produce that kind of position count directly, without the fee drag of stacked vehicles.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>2. History of High-Volume Funds That Worked</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8, marginBottom: 14 }}>
                The volume thesis isn't novel — it has an empirical track record in venture:
              </div>
              <table>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <th style={{ textAlign: "left" }}>Firm</th>
                    <th style={{ textAlign: "left" }}>Strategy</th>
                    <th style={{ textAlign: "left" }}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { firm: "Y Combinator", strat: "4 batches/yr × ~200 companies, ~$500K/co", outcome: "Airbnb, Stripe, Coinbase, DoorDash, Reddit, Dropbox, Instacart — among the most consistent venture vehicles ever run" },
                    { firm: "500 Startups / 500 Global", strat: "Early spray-and-pray, >2,500 companies across vintages", outcome: "Multiple unicorns (Canva, Grab, Credit Karma); top-quartile early funds" },
                    { firm: "SV Angel", strat: "Ron Conway's model — small checks into 100+ companies/yr", outcome: "Google, Facebook, Twitter, Airbnb, Pinterest — the template for high-volume angel investing" },
                    { firm: "Founders Fund (seed checks)", strat: "Dedicated seed vehicle with smaller, more numerous positions than the main fund", outcome: "Anduril, Ramp, Stripe entry — complements concentrated growth investing" },
                    { firm: "Techstars", strat: "Accelerator model, 200+ companies/yr across geographies", outcome: "Consistent returns via volume rather than picking brilliance" },
                    { firm: "Right Side Capital", strat: "Pre-seed, >1,400 investments, ~$100K–500K checks", outcome: "Operating model explicitly built around volume + power-law capture" },
                  ].map(r => (
                    <tr key={r.firm}>
                      <td style={{ textAlign: "left", color: "#c8a94e", fontSize: 12 }} className="serif">{r.firm}</td>
                      <td style={{ textAlign: "left", color: "#aaa", fontSize: 11 }}>{r.strat}</td>
                      <td style={{ textAlign: "left", color: "#888", fontSize: 11 }}>{r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                In every case, volume worked because it was paired with a <span style={{ color: "#e8e0d0" }}>strong deal-flow filter</span> — YC's selection process, Conway's network, Techstars' accelerator funnel. Volume without a filter is spray-and-pray. Volume with a filter is <em>systematic power-law capture</em>.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>3. The Binding Constraint Is Deal Flow, Not Capital</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
                Here's what the tool's math can't show you: a 150-position portfolio requires <em>access to 150 investable companies per 4-year window</em>. Most seed funds can't reach that threshold at quality — their deal flow simply runs out. This is why most concentrated funds aren't concentrated by strategic choice; they're concentrated by <span style={{ color: "#e8e0d0" }}>necessity</span>.
                <br /><br />
                YC produces <strong style={{ color: "#c8a94e" }}>roughly 800 pre-vetted companies per year</strong> (4 batches × ~200 companies). For a fund with structural access to that deal flow, a Kelly-scale portfolio becomes operationally reachable. The math in this tool describes what <em>becomes possible</em> when deal flow stops being the binding constraint. For funds without that access, Kelly-scale portfolios aren't a choice — they're unreachable.
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>What This Tool Does Not Model</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                In the spirit of honesty, the simulations above exclude several real-world frictions that matter to LPs:
                <ul style={{ marginTop: 10, paddingLeft: 20, lineHeight: 1.8 }}>
                  <li><strong style={{ color: "#aaa" }}>Deal flow access:</strong> assumes unlimited availability of investable deals at the modeled distribution.</li>
                  <li><strong style={{ color: "#aaa" }}>Anti-selection:</strong> investing in every YC batch means catching every reject too. The volume model assumes the distribution holds across all 150 positions equally.</li>
                  <li><strong style={{ color: "#aaa" }}>Pro-rata rights:</strong> small initial checks may not secure meaningful follow-on participation in later rounds.</li>
                  <li><strong style={{ color: "#aaa" }}>Operational load:</strong> managing 150+ positions requires infrastructure — portfolio tracking, LP communications, tax reporting — that most GPs underprice.</li>
                  <li><strong style={{ color: "#aaa" }}>GP economics:</strong> carry math on a small fund with many positions differs materially from larger concentrated funds; may not retain top-tier GP talent.</li>
                  <li><strong style={{ color: "#aaa" }}>Conviction-based follow-on:</strong> the model follows on based on a threshold mark-up. Real GPs deploy reserves based on late-stage signals the model can't see.</li>
                </ul>
              </div>
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 10 }}>The Honest Positioning</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.85 }}>
                This tool is a <span style={{ color: "#e8e0d0" }}>model of what's mathematically achievable</span> under a set of stated, editable assumptions. It models portfolio construction only. It does not evaluate any specific fund's deal flow, selection ability, track record, or economics — those require independent due diligence.
                <br /><br />
                If the math is right and the deal-flow access is real, Team Ignite's strategy should outperform traditional concentrated seed funds on a risk-adjusted basis. If either assumption fails, the strategy reduces to expensive beta exposure to an asset class LPs can access more cheaply through fund-of-funds. We believe the first case holds. This tool helps you evaluate whether you agree.
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ ASSUMPTIONS ══════════════════════ */}
        {activeTab === "inputs" && (
          <div className="fade-in">
            <div className="stat-card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div className="label" style={{ marginBottom: 0 }}>Edit Outcome Distribution</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className={`pill ${preset === "blind" ? "active" : "inactive"}`} onClick={() => { setPreset("blind"); setCustomDist(null); }}>Industry avg</span>
                  <span className={`pill ${preset === "blend" ? "active" : "inactive"}`} onClick={() => { setPreset("blend"); setCustomDist(null); }}>50/50 Blend</span>
                  <span className={`pill ${preset === "yc" ? "active" : "inactive"}`} onClick={() => { setPreset("yc"); setCustomDist(null); }}>YC historical</span>
                  {savedDist && <span className={`pill ${preset === "custom" ? "active" : "inactive"}`} onClick={() => { setPreset("custom"); setCustomDist(null); }}>My assumptions</span>}
                  {customDist && (
                    <span className="pill inactive" style={{ borderColor: "#3a3520", color: "#c8a94e" }}
                      onClick={() => { setSavedDist(customDist); setPreset("custom"); setCustomDist(null); }}>
                      ✓ Save as my assumptions
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 14, lineHeight: 1.6 }}>
                Currently showing: <span style={{ color: "#c8a94e" }}>{preset === "yc" ? "YC-calibrated (≈6% cumulative unicorn rate, per Garry Tan and PitchBook)" : preset === "blend" ? "50/50 blend of YC-calibrated and industry average (≈4% cumulative unicorn rate)" : "Industry average (≈2% cumulative unicorn rate, per Correlation Ventures, Carta, and Horsley Bridge)"}</span>. Multiples assume a ~$15M blended pre-seed/seed entry (Carta 2025 medians) net of dilution.
              </div>
              {(customDist || baseDist).map((d, i) => (
                <div key={i} className="dist-row">
                  <span style={{ fontSize: 15, width: 20 }}>{d.emoji}</span>
                  <span style={{ fontSize: 11, color: "#aaa", width: 160, flexShrink: 0 }}>{d.label}</span>
                  <input type="range" min={0} max={d.multiplier >= 400 ? 0.02 : d.multiplier >= 150 ? 0.05 : d.multiplier >= 55 ? 0.15 : d.multiplier >= 15 ? 0.4 : 0.9} step={d.multiplier >= 400 ? 0.0001 : d.multiplier >= 150 ? 0.0005 : d.multiplier >= 55 ? 0.001 : 0.005} value={d.prob}
                    onChange={e => {
                      const nd2 = [...(customDist || baseDist)];
                      nd2[i] = { ...d, prob: parseFloat(e.target.value) };
                      setCustomDist(nd2);
                    }}
                    style={{ width: 120 }}
                  />
                  <span style={{ fontSize: 12, color: d.color, width: 62, textAlign: "right", flexShrink: 0 }}>
                    {fmtPct(normalize(customDist || baseDist)[i].prob)}
                  </span>
                </div>
              ))}
              {customDist && (
                <button onClick={() => setCustomDist(null)}
                  style={{ marginTop: 16, background: "#141414", border: "1px solid #242424", color: "#888", padding: "7px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>
                  Reset to preset
                </button>
              )}
            </div>
            <div className="stat-card" style={{ marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 8 }}>
                <Tip text="Each tier's return multiple = (exit value ÷ entry post-money) × effective retention. Retention captures cumulative dilution from later rounds (Carta medians: ~19% at A, ~15% at B, ~11% at C, ~9% at D) plus, for the deepest tiers, a realization discount between peak marks and realized proceeds. Move a slider to see the tier's multiple change everywhere in the tool.">Dilution &amp; Entry Assumptions</Tip>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "#888" }}>Blended entry post-money</span>
                <input type="number" className="inline" step={1} style={{ width: 64, fontSize: 13 }} value={entryVal}
                  onChange={e => setEntryVal(Math.min(60, Math.max(3, +e.target.value || 15)))} />
                <span style={{ fontSize: 11, color: "#666" }}>$M (Carta 2025 medians: $10M pre-seed caps, $20M seed post)</span>
              </div>
              {(customDist || baseDist).map((d, i) => {
                if (!EXIT_MIDS[i]) return null;
                const raw = EXIT_MIDS[i] / entryVal;
                const retention = Math.min(1, d.multiplier / raw);
                const setRetention = (r) => {
                  const src2 = customDist || baseDist;
                  const next = src2.map((x, j) => j === i ? { ...x, multiplier: Math.max(1, Math.round(raw * r)) } : { ...x });
                  setCustomDist(next);
                };
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{d.emoji}</span>
                    <span style={{ fontSize: 10.5, color: "#888", width: 168, flexShrink: 0 }}>{d.label.replace(/ \(\d+x\)$/, "")}</span>
                    <input type="range" min={0.1} max={1} step={0.01} value={retention}
                      onChange={e => setRetention(+e.target.value)} style={{ flex: 1 }} />
                    <span className="serif" style={{ fontSize: 11.5, color: "#c8a94e", width: 148, textAlign: "right", flexShrink: 0 }}>
                      {(retention * 100).toFixed(0)}% of raw {raw >= 100 ? Math.round(raw).toLocaleString() : raw.toFixed(1)}x → {d.multiplier.toLocaleString()}x
                    </span>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: "#555", marginTop: 8, lineHeight: 1.6 }}>
                Defaults imply ~90% retention on early exits declining to ~47% at unicorn, ~40% at decacorn, and 20–30% at the deepest tiers, where an additional realization discount (peak private marks vs realized proceeds) is applied on top of pure dilution. Sources linked in the footer.
              </div>
            </div>

            <div className="stat-card">
              <div className="label" style={{ marginBottom: 10 }}>Live Stats at Current Portfolio Size</div>
              {[
                ["Median MOIC (Monte Carlo)",        currentMC ? `${currentMC.median.toFixed(2)}x` : "…"],
                ["Mean MOIC (Monte Carlo)",          currentMC ? `${currentMC.mean.toFixed(2)}x` : "…"],
                ["Net MOIC (after carry)",           `${netMOIC_val.toFixed(2)}x`],
                ["Net IRR (10-yr hold)",             `${(netIRR * 100).toFixed(1)}%`],
                ["P(≥1 Unicorn)",                    fmtPct(pUnicorn)],
                ["P(≥1 Decacorn)",                   fmtPct(pDecacorn)],
                [`Kelly optimal per year`,           `~${kellyAnnual}`],
                [`Kelly total over ${DEPLOYMENT_YEARS}-yr`, `~${kellyTotal}`],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #141414", fontSize: 12 }}>
                  <span style={{ color: "#666" }}>{label}</span>
                  <span className="serif" style={{ color: "#c8a94e" }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 36, fontSize: 10, color: "#333", lineHeight: 1.7, borderTop: "1px solid #141414", paddingTop: 18 }}>
          <div style={{ color: "#666", fontWeight: 500, marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase", fontSize: 9 }}>Disclaimer</div>
          <div style={{ color: "#444", marginBottom: 10 }}>
            This tool is for educational and informational purposes only. It is <strong style={{ color: "#666" }}>not investment advice</strong>, not an offer to sell or a solicitation of an offer to buy any security, and not a recommendation to pursue any particular investment strategy. Past performance of venture capital funds does not guarantee future results. All venture investments involve significant risk including total loss of capital, illiquidity, and long holding periods. Before making any investment decision, <strong style={{ color: "#666" }}>conduct your own due diligence</strong> and consult with qualified legal, tax, and financial advisors. Team Ignite Ventures makes no representation that the modeled distributions, assumptions, or simulated outcomes reflect any actual fund's past or future performance.
          </div>
          <div style={{ color: "#333" }}>
            Probabilistic framework. Portfolio size represents total positions over a {DEPLOYMENT_YEARS}-year fund deployment. Twelve outcome tiers span total loss through terracorn ($1T+); multiples are post-dilution returns to a ~$15M blended pre-seed/seed entry (Carta 2025 medians: ~$10M pre-seed SAFE caps, ~$20M seed post-money). Dilution applied per Carta per-round medians (Series A ~19%, B ~15%, C ~11%, D ~9%, plus option-pool refreshes): a seed investor retains roughly 79% of their stake through Series A, ~67% through B, ~59% through C, ~53% through D, and ~45% through E/F — so a $1.5B exit after Series C/D returns ~55x on a $15M entry, and a $15B exit after E/F returns ~400x. Three presets: industry average (cumulative $1B+ rate ≈2%, calibrated to Correlation Ventures' 21K-financings dataset, Carta cohort data, Horsley Bridge outlier rates, and PitchBook/CB Insights rare-outcome counts), YC-calibrated (cumulative unicorn rate ≈6% per Garry Tan's stated 6–12% for recent batches, low end used), and a 50/50 blend of the two. The terracorn base rate (≈0.002%) counts nine VC-backed companies at $1T+: Apple, Microsoft, Alphabet, Amazon, Meta, Nvidia, Tesla, SpaceX (June 2026 IPO), and OpenAI — the last a forward-looking inclusion at its $852B March 2026 mark with an S-1 filed. Selection skill shifts tail probabilities per Horsley Bridge findings via Ulu Ventures (top-tier 4.5% outlier rate, market average 2%, hypothetical superstar 7% — the latter is Ulu's construct, not an empirical observation). Monte Carlo: seeded per portfolio size for reproducible curves; 3,000 sims/size standard (scaled up to 12,000 at n≤20), 10,000 in high-precision mode, 5,000 per side for head-to-head. Reserves model simulates follow-on deployment into companies above the mark-up threshold. Fund economics: management fees (2% × 10yr) reduce investable capital to 80% of commitments and are returned to LPs before carry; recycling (adjustable, default 10% of committed capital) reinvests early proceeds; 20% carry applies via European waterfall (LPs receive 100% of distributions until commitments are returned, 80/20 thereafter); every invested cohort is held a standardized 10 years from its capital call, anchored to Crunchbase exit-timing data and SaaStr's 10.0-year median for $1B+ SaaS acquisitions.
          </div>
          <div style={{ marginTop: 14, fontSize: 10, color: "#555", lineHeight: 1.9 }}>
            <span style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 9, color: "#666" }}>Sources — read the underlying data yourself: </span>
            <a href="https://sethlevine.com/archives/2014/08/venture-outcomes-are-even-more-skewed-than-you-think.html" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Correlation Ventures 21K financings (via Seth Levine)</a>
            {" · "}
            <a href="https://www.saastr.com/carta-of-seed-funded-start-ups-fail-and-1-3-become-unicorns/" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Carta Class of 2018 cohort</a>
            {" · "}
            <a href="https://carta.com/data/state-of-private-markets-q3-2025/" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Carta seed/pre-seed valuations</a>
            {" · "}
            <a href="https://carta.com/data/founder-ownership-2026/" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Carta dilution by round</a>
            {" · "}
            <a href="https://about.crunchbase.com/blog/startup-exit" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Crunchbase exit timing</a>
            {" · "}
            <a href="https://www.saastr.com/dear-saastr-how-long-does-it-take-the-average-saas-startup-to-exit" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>SaaStr $1B+ exit timing</a>
            {" · "}
            <a href="https://uluventures.com/picking-winners-is-a-myth/" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Horsley Bridge outlier rates (via Ulu Ventures)</a>
            {" · "}
            <a href="https://uluventures.com/invest/portfolio_construction/" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Ulu Ventures portfolio construction</a>
            {" · "}
            <a href="https://x.com/garrytan/status/1953069914132238775" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>Garry Tan on YC unicorn rates</a>
            {" · "}
            <a href="https://finance.yahoo.com/news/y-combinator-leads-accelerators-unicorn-050000756.html" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>PitchBook accelerator analysis</a>
            {" · "}
            <a href="https://pitchbook.com/news/articles/unicorn-startups-list-trends" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>PitchBook unicorn tracker</a>
            {" · "}
            <a href="https://github.com/BrianBeezy/tiv-volume-thesis" target="_blank" rel="noopener noreferrer" style={{ color: "#8a7433" }}>View source on GitHub</a>
          </div>
        </div>
      </div>
    </div>
  );
}

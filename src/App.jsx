import { useState, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
  ReferenceLine, LabelList
} from "recharts";

// ══════════════════════════════════════════════════════════════
//  SAFE ARRAY HELPERS
// ══════════════════════════════════════════════════════════════
const accessor = (f) => typeof f === "function" ? f : (o) => (o != null && o[f] != null ? Number(o[f]) : 0);
const safeSum = (a, f) => { if (!a || !a.length) return 0; const g = accessor(f); return a.reduce((s, v) => s + (g(v) || 0), 0); };
const safeMean = (a, f) => { if (!a || !a.length) return 0; return safeSum(a, f) / a.length; };
const safeMax = (a, f) => { if (!a || !a.length) return 0; const g = accessor(f); return Math.max(0, ...a.map(v => g(v) || 0)); };
const safeMin = (a, f) => { if (!a || !a.length) return 0; const g = accessor(f); return Math.min(...a.map(v => g(v) || 0)); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ══════════════════════════════════════════════════════════════
//  P-OPT DESIGN TOKENS
// ══════════════════════════════════════════════════════════════
const C = {
  base: "#0A1929", elev: "#0F2440", overlay: "#132D4F",
  t1: "#E2ECF5", t2: "#7B8DA0", t3: "#6B8099",
  brd: "#1E3450", focus: "#00B4D8", dec: "#7C3AED",
  pos: "#00E676", neg: "#FF5252", warn: "#FFB74D", info: "#00B4D8",
  val: "#00E5FF",
  thermal: "#E67E22", solar: "#F1C40F", wind: "#3498DB", hydro: "#1ABC9C",
  bess: "#FF5252", psp: "#00E676", hybrid: "#00BFA5",
  dam: "#00B4D8", rtm: "#26C6DA", gdam: "#2ECC71", bilat: "#FFB74D", bank: "#7C3AED",
  peak: "#0D2E4A",
  coal: "#8D6E63", gas: "#FF7043", lignite: "#A1887F", nuclear: "#7E57C2",
  curtail: "#E91E63", panel: "#0B1D33",
};
const FC = { Thermal: C.thermal, Solar: C.solar, Wind: C.wind, Hydro: C.hydro, BESS: C.bess, PSP: C.psp, Hybrid: C.hybrid, Market: C.dam, Nuclear: "#7E57C2", Gas: "#FF7043" };
const FUEL_CLR = { coal_fsa: "#8D6E63", coal_auction: "#A1887F", coal_import: "#D7CCC8", gas_apm: "#FF7043", gas_spot: "#FF8A65", lignite: "#BCAAA4", nuclear: "#7E57C2", none: "#78909C" };
const SEG_ORDER = ["Nuclear", "Thermal", "Gas", "Solar", "Wind", "Hydro", "BESS", "PSP", "Hybrid", "FDRE", "STOA", "DAM", "GDAM", "RTM"];
const SEG_CLR = { Thermal: "#455A64", Solar: "#FFD600", Wind: "#2196F3", Hydro: "#00897B", BESS: "#E53935", PSP: "#8E24AA", Hybrid: "#00BFA5", FDRE: "#43A047", STOA: "#FF8F00", DAM: "#00ACC1", GDAM: "#7CB342", RTM: "#F06292", Nuclear: "#7E57C2", Gas: "#FF7043" };
const mono = { fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", letterSpacing: "0.02em" };
const ui = { fontFamily: "'IBM Plex Sans',-apple-system,sans-serif" };
const lbl = { fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", textTransform: "uppercase", letterSpacing: "0.08em" };
const ttStyle = { background: C.overlay, border: `1px solid ${C.brd}`, borderRadius: 4, ...mono, fontSize: 11, color: C.t1 };

// ══════════════════════════════════════════════════════════════
//  TIME CONSTANTS — rolling 12-month window
// ══════════════════════════════════════════════════════════════
const CAL_MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CAL_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const buildMonths = (startCal) => Array.from({ length: 12 }, (_, i) => {
  const cm = (startCal + i) % 12;
  return { name: CAL_MO[cm], cal: cm, fi: (cm - 3 + 12) % 12, days: CAL_DAYS[cm] };
});
const DEF_START = 3; // April — default to FY
// Backward compat: pre-built for default start (used only for default data sizing)
const MO = buildMonths(DEF_START).map(m => m.name);
const DAYS = buildMonths(DEF_START).map(m => m.days);
const TB = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4), m = (i % 4) * 15;
  return { i, lbl: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, h };
});
const PK0 = 32, PK1 = 67; // peak 08:00–17:00

// ══════════════════════════════════════════════════════════════
//  96-BLOCK SHAPE GENERATORS (with stochastic variant)
// ══════════════════════════════════════════════════════════════
function demandShape(pk, mi, noise = 0) {
  const s = [1, 2, 3, 4].includes(mi), w = [8, 9, 10].includes(mi);
  return Array.from({ length: 96 }, (_, t) => {
    const h = t / 4; let f = 0.55;
    if (h >= 5 && h < 8) f = 0.55 + (h - 5) / 3 * 0.3;
    else if (h >= 8 && h < 11) f = 0.85 + (h - 8) / 3 * 0.1;
    else if (h >= 11 && h < 14) f = s ? 0.97 : 0.88;
    else if (h >= 14 && h < 17) f = s ? 1.0 : 0.9;
    else if (h >= 17 && h < 19) f = 0.92;
    else if (h >= 19 && h < 22) f = s ? 0.93 : w ? 0.97 : 0.95;
    else if (h >= 22) f = 0.72 - (h - 22) * 0.05;
    else if (h < 5) f = w ? 0.52 : 0.48;
    f += Math.sin(t * 0.73) * 0.015;
    if (noise) f *= (1 + (Math.sin(t * 1.37 + noise * 7) * noise * 0.1));
    return Math.round(pk * Math.max(0.42, Math.min(1.0, f)));
  });
}
function solarShape(pm, mi, noise = 0) {
  const sr = [6, 5.8, 5.5, 5.8, 6, 6.2, 6.3, 6, 5.8, 6.5, 6.8, 6.5][mi];
  const ss = [18.5, 19, 19, 18.8, 18.5, 18.2, 17.8, 17.5, 17.8, 17.5, 17.8, 18.2][mi];
  const pc = [.75, .82, .78, .65, .58, .55, .62, .7, .74, .68, .72, .74][mi];
  const nf = noise ? (1 + (Math.sin(mi * 3.1 + noise * 5) * noise * 0.15)) : 1;
  return Array.from({ length: 96 }, (_, t) => {
    const h = t / 4; if (h < sr || h > ss) return 0;
    const x = (h - (sr + ss) / 2) / ((ss - sr) / 2);
    return Math.round(pm * pc * nf * Math.max(0, Math.pow(Math.cos(x * Math.PI / 2), 1.8)));
  });
}
function windShape(pm, mi, noise = 0) {
  const cf = [.08, .12, .25, .38, .42, .35, .28, .15, .1, .06, .05, .07][mi];
  const nf = noise ? (1 + (Math.cos(mi * 2.7 + noise * 4) * noise * 0.2)) : 1;
  return Array.from({ length: 96 }, (_, t) => {
    const h = t / 4;
    return Math.round(pm * Math.max(0, Math.min(.95, cf * nf * (1 + .25 * Math.sin((h - 6) * Math.PI / 12) + Math.sin(t * .37) * .12))));
  });
}
function hydroShape(pm, mi) {
  const cf = [.3, .25, .35, .65, .75, .7, .6, .5, .45, .35, .3, .28][mi];
  return Array.from({ length: 96 }, (_, t) => { const h = t / 4; return Math.round(pm * Math.max(0, Math.min(.95, cf * (h >= 8 && h < 20 ? 1.15 : .75)))); });
}
function hybridShape(pm, mi, noise = 0) {
  const s = solarShape(pm * .5, mi, noise), w = windShape(pm * .35, mi, noise);
  return Array.from({ length: 96 }, (_, t) => Math.min(pm, s[t] + w[t] + Math.round(pm * .08)));
}
function nuclearShape(pm, avail = 90) {
  // Nuclear runs flat (baseload), availability-limited
  const mw = Math.round(pm * avail / 100);
  return Array.from({ length: 96 }, () => mw);
}
function gasShape(pm, mi, avail = 88, noise = 0) {
  // Gas peaker — higher output during peak hours, reduced off-peak
  return Array.from({ length: 96 }, (_, t) => {
    const h = t / 4; let f = 0.4;
    if (h >= 8 && h < 11) f = 0.75;
    else if (h >= 11 && h < 14) f = 0.85;
    else if (h >= 14 && h < 18) f = 0.9;
    else if (h >= 18 && h < 22) f = 0.95;
    if (noise) f *= (1 + Math.sin(t * 1.2 + noise * 5) * noise * 0.08);
    return Math.round(pm * avail / 100 * Math.max(0.3, Math.min(1, f)));
  });
}

// ══════════════════════════════════════════════════════════════
//  DEFAULT DATA — ENHANCED WITH FUEL & TWO-PART TARIFF
// ══════════════════════════════════════════════════════════════
const DEF_PLANTS = [
  { id: 1, name: "STPS-1", type: "Thermal", fuel: "coal_fsa", pMax: 500, pMin: 200, ecr: 3.20, fixedCost: 1450, startCost: 25, avail: 92, mustRun: false, rampUp: 5, rampDn: 4, minUp: 8, minDn: 6 },
  { id: 2, name: "STPS-2", type: "Thermal", fuel: "coal_fsa", pMax: 500, pMin: 200, ecr: 3.25, fixedCost: 1420, startCost: 25, avail: 90, mustRun: false, rampUp: 5, rampDn: 4, minUp: 8, minDn: 6 },
  { id: 3, name: "KTPS-1", type: "Thermal", fuel: "coal_auction", pMax: 210, pMin: 100, ecr: 3.80, fixedCost: 1280, startCost: 15, avail: 85, mustRun: false, rampUp: 3, rampDn: 3, minUp: 6, minDn: 4 },
  { id: 4, name: "GTPS Gas", type: "Gas", fuel: "gas_apm", pMax: 120, pMin: 40, ecr: 5.50, fixedCost: 980, startCost: 8, avail: 88, mustRun: false, rampUp: 15, rampDn: 12, minUp: 2, minDn: 1 },
  { id: 5, name: "Solar Park A", type: "Solar", fuel: "none", pMax: 400, pMin: 0, ecr: 2.50, fixedCost: 0, startCost: 0, avail: 100, mustRun: true, rampUp: 100, rampDn: 100, minUp: 0, minDn: 0 },
  { id: 6, name: "Solar Park B", type: "Solar", fuel: "none", pMax: 300, pMin: 0, ecr: 2.65, fixedCost: 0, startCost: 0, avail: 100, mustRun: true, rampUp: 100, rampDn: 100, minUp: 0, minDn: 0 },
  { id: 7, name: "Wind Farm 1", type: "Wind", fuel: "none", pMax: 250, pMin: 0, ecr: 2.80, fixedCost: 0, startCost: 0, avail: 100, mustRun: true, rampUp: 50, rampDn: 50, minUp: 0, minDn: 0 },
  { id: 8, name: "Wind Farm 2", type: "Wind", fuel: "none", pMax: 200, pMin: 0, ecr: 3.00, fixedCost: 0, startCost: 0, avail: 100, mustRun: true, rampUp: 50, rampDn: 50, minUp: 0, minDn: 0 },
  { id: 9, name: "Hydro Stn", type: "Hydro", fuel: "none", pMax: 300, pMin: 50, ecr: 1.50, fixedCost: 800, startCost: 2, avail: 100, mustRun: false, rampUp: 20, rampDn: 20, minUp: 1, minDn: 1, pondage: "with", storageHrs: 6 },
  { id: 10, name: "BESS 100/400", type: "BESS", fuel: "none", pMax: 100, pMin: 0, ecr: 0, fixedCost: 0, startCost: 0, avail: 95, mustRun: false, rampUp: 100, rampDn: 100, minUp: 0, minDn: 0, mwh: 400, eff: 88, socMin: 10, socMax: 90, degradCost: 0.50, cycles: 1, transitionMins: 5 },
  { id: 11, name: "PSP Nagarjuna", type: "PSP", fuel: "none", pMax: 200, pMin: 0, ecr: 0, fixedCost: 600, startCost: 3, avail: 90, mustRun: false, rampUp: 30, rampDn: 30, minUp: 2, minDn: 2, mwh: 1200, eff: 78, socMin: 5, socMax: 95, degradCost: 0.10, storageHrs: 6, transitionMins: 15 },
  { id: 12, name: "Hybrid S+W+B", type: "Hybrid", fuel: "none", pMax: 350, pMin: 0, ecr: 2.90, fixedCost: 0, startCost: 0, avail: 100, mustRun: true, rampUp: 80, rampDn: 80, minUp: 0, minDn: 0 },
  { id: 13, name: "Nuclear NPCIL", type: "Nuclear", fuel: "nuclear", pMax: 700, pMin: 500, ecr: 2.10, fixedCost: 1800, startCost: 50, avail: 85, mustRun: true, rampUp: 1, rampDn: 1, minUp: 48, minDn: 48 },
];
// Calendar-month indexed (Jan=0 ... Dec=11) — seasonal pattern stays correct regardless of rolling window start
const DEF_DEMAND = [3700, 3600, 3900, 4200, 4800, 5200, 4900, 4600, 4400, 4100, 3900, 3800];
const DEF_MKT = {
  // Calendar-month indexed (Jan=0 ... Dec=11)
  damMCP: [3.2, 3.1, 3.5, 3.8, 4.2, 5.1, 4.8, 4.5, 4.1, 3.9, 3.6, 3.4],
  rtmPrem: 15,
  gdamMCP: [2.9, 2.8, 3.2, 3.5, 3.9, 4.8, 4.5, 4.2, 3.8, 3.6, 3.3, 3.1],
  bilatRate: [2.9, 2.8, 3.2, 3.5, 3.8, 4.6, 4.3, 4.0, 3.7, 3.5, 3.3, 3.1],
  bankRate: [2.7, 2.6, 2.9, 3.2, 3.5, 4.2, 3.9, 3.6, 3.4, 3.2, 3.0, 2.8],
  damLim: 500, rtmLim: 200, gdamLim: 300, bilatLim: 800, bankLim: 300,
  recSolarPrice: 2.00, recNonSolarPrice: 1.50, carbonPrice: 0,
};
// Calendar-month indexed (Jan=0 ... Dec=11)
const DEF_STOA = [
  { id: 1, seg: "Bilateral", name: "NTPC Bilateral", cpty: "NTPC Vidyut Vyapar", dir: "BUY", mw: 200, rate: 3.40, months: [1,1,1,1,1,1,1,1,1,1,1,1], hrs: "RTC", status: "ACTIVE" },
  { id: 2, seg: "Bilateral", name: "Adani Wind PPA", cpty: "Adani Green", dir: "BUY", mw: 150, rate: 2.85, months: [1,1,1,1,1,1,1,1,1,1,1,1], hrs: "RTC", status: "ACTIVE" },
  { id: 3, seg: "Bilateral", name: "Peak Bilateral", cpty: "NHPC Ltd", dir: "BUY", mw: 100, rate: 4.10, months: [0,0,0,0,1,1,1,1,0,0,0,0], hrs: "PEAK", status: "ACTIVE" },
  { id: 4, seg: "Bilateral", name: "Surplus Sale", cpty: "Tata Power Trading", dir: "SELL", mw: 80, rate: 3.60, months: [1,1,0,0,0,0,0,0,0,0,1,1], hrs: "OFF-PEAK", status: "ACTIVE" },
  { id: 5, seg: "Banking", name: "AP-TS Banking", cpty: "APTRANSCO", dir: "BUY", mw: 120, rate: 0.10, months: [1,1,1,1,1,1,1,1,1,1,1,1], hrs: "RTC", status: "ACTIVE", injectMo: [1,1,0,0,0,0,0,0,0,0,1,1], withdrawMo: [0,0,0,0,1,1,1,1,0,0,0,0], lossPct: 2, bankRatio: 100 },
  { id: 6, seg: "Banking", name: "KA-TS Banking", cpty: "KPTCL", dir: "BUY", mw: 80, rate: 0.15, months: [1,1,1,1,1,1,1,1,1,1,1,1], hrs: "RTC", status: "ACTIVE", injectMo: [1,1,1,1,0,0,0,0,0,0,0,1], withdrawMo: [0,0,0,0,1,1,1,1,1,1,1,0], lossPct: 3, bankRatio: 100 },
];
const DEF_RPO = {
  solarPct: 10.44, nonSolarPct: 18.17, hydroPct: 1.12, esoPct: 1.0,
  totalPct: 30.73,
  recPriceSolar: 2000, recPriceNonSolar: 1500, recPriceHydro: 1000,
  year: "Rolling 12M",
};
const DEF_FDRE = [
  { id: 1, name: "SECI FDRE Tranche I", developer: "NTPC REL", capacity: 250, tariff: 4.35,
    profile: "PEAK", guaranteedCUF: 55, penaltyRate: 1.50, storageMWh: 500,
    reTech: "Solar+BESS", months: [1,1,1,1,1,1,1,1,1,1,1,1], status: "ACTIVE",
    deliveryStart: 8, deliveryEnd: 18 },
  { id: 2, name: "SECI FDRE Tranche II", developer: "Adani Green", capacity: 200, tariff: 4.55,
    profile: "RTC", guaranteedCUF: 80, penaltyRate: 1.25, storageMWh: 800,
    reTech: "Hybrid+BESS", months: [1,1,1,1,1,1,1,1,1,1,1,1], status: "ACTIVE",
    deliveryStart: 0, deliveryEnd: 24 },
];

// Fuel cost reference (reserved for future fuel cost modeling)
// const DEF_FUEL = { coal_fsa: {...}, coal_auction: {...}, ... };

// Scenarios
const DEF_SCENARIOS = [
  { id: "base", name: "Base Case", demMult: 1.0, reMult: 1.0, priceMult: 1.0, fuelMult: 1.0, color: C.focus, active: true },
  { id: "high_dem", name: "High Demand", demMult: 1.12, reMult: 0.95, priceMult: 1.15, fuelMult: 1.05, color: C.neg, active: true },
  { id: "high_re", name: "High RE", demMult: 1.0, reMult: 1.25, priceMult: 0.85, fuelMult: 1.0, color: C.pos, active: true },
  { id: "fuel_stress", name: "Fuel Stress", demMult: 1.05, reMult: 0.90, priceMult: 1.30, fuelMult: 1.40, color: C.warn, active: false },
];

// ══════════════════════════════════════════════════════════════
//  FDRE PROFILE GENERATOR
// ══════════════════════════════════════════════════════════════
function fdreProfile96(fdre, mi) {
  if (!fdre || fdre.status !== "ACTIVE" || !fdre.months[mi]) return Array(96).fill(0);
  const cuf = (fdre.guaranteedCUF || 55) / 100;
  return Array.from({ length: 96 }, (_, t) => {
    const h = t / 4;
    if (fdre.profile === "RTC") return Math.round(fdre.capacity * cuf);
    if (fdre.profile === "PEAK") {
      const ds = fdre.deliveryStart || 8, de = fdre.deliveryEnd || 18;
      return (h >= ds && h < de) ? Math.round(fdre.capacity * cuf * 24 / (de - ds)) : 0;
    }
    if (fdre.profile === "CUSTOM") {
      const ds = fdre.deliveryStart || 0, de = fdre.deliveryEnd || 24;
      return (h >= ds && h < de) ? Math.round(fdre.capacity * cuf * 24 / (de - ds)) : 0;
    }
    return Math.round(fdre.capacity * cuf);
  });
}

// ══════════════════════════════════════════════════════════════
//  RPO COMPUTATION ENGINE
// ══════════════════════════════════════════════════════════════
function computeRPO(allRes, plants, stoa, fdre, rpo, mkt) {
  const totMU = safeSum(allRes, r => r.agg.demMU);
  if (totMU <= 0) return { totMU: 0, targets: {}, fulfilled: {}, pct: {}, shortfall: {}, recCost: {}, fdreMU: 0 };
  let solMU = 0, wndMU = 0, hydMU = 0, esoMU = 0, fdrMU = 0;
  allRes.forEach(r => {
    Object.values(r.agg.srcE).forEach(s => {
      if (s.tp === "Solar") solMU += s.mu;
      else if (s.tp === "Wind") wndMU += s.mu;
      else if (s.tp === "Hydro") hydMU += s.mu;
      else if (s.tp === "Hybrid") { solMU += s.mu * 0.5; wndMU += s.mu * 0.3; }
      else if (s.tp === "BESS" || s.tp === "PSP") esoMU += s.mu;
    });
  });
  (stoa || []).filter(s => s.status === "ACTIVE" && s.dir === "BUY").forEach(s => {
    const nm = ((s.name || "") + (s.cpty || "")).toLowerCase();
    const isRE = ["solar", "wind", "green", " re ", "renewable"].some(k => nm.includes(k));
    if (isRE) { const mu = s.mw * safeSum(s.months, v => v) * 30 * 24 / 1000 * 0.22; nm.includes("solar") ? solMU += mu : wndMU += mu; }
  });
  (fdre || []).filter(f => f.status === "ACTIVE").forEach(f => {
    const mu = f.capacity * (f.guaranteedCUF / 100) * safeSum(f.months, v => v) * 30 * 24 / 1000;
    fdrMU += mu; const tech = (f.reTech || "").toLowerCase();
    if (tech.includes("solar")) solMU += mu * 0.6;
    if (tech.includes("wind")) wndMU += mu * 0.2;
  });
  const tgt = { solar: +(totMU * rpo.solarPct / 100).toFixed(1), nonSolar: +(totMU * rpo.nonSolarPct / 100).toFixed(1), hydro: +(totMU * rpo.hydroPct / 100).toFixed(1), eso: +(totMU * rpo.esoPct / 100).toFixed(1) };
  tgt.total = +(tgt.solar + tgt.nonSolar + tgt.hydro + tgt.eso).toFixed(1);
  const ful = { solar: +solMU.toFixed(1), nonSolar: +wndMU.toFixed(1), hydro: +hydMU.toFixed(1), eso: +esoMU.toFixed(1) };
  ful.total = +(ful.solar + ful.nonSolar + ful.hydro + ful.eso).toFixed(1);
  const pct = { solar: +(solMU / totMU * 100).toFixed(1), nonSolar: +(wndMU / totMU * 100).toFixed(1), hydro: +(hydMU / totMU * 100).toFixed(1), eso: +(esoMU / totMU * 100).toFixed(1) };
  const sh = { solar: +Math.max(0, tgt.solar - ful.solar).toFixed(1), nonSolar: +Math.max(0, tgt.nonSolar - ful.nonSolar).toFixed(1), hydro: +Math.max(0, tgt.hydro - ful.hydro).toFixed(1), eso: +Math.max(0, tgt.eso - ful.eso).toFixed(1) };
  // Use mkt REC prices (Rs/kWh) → Rs/MWh * 1000 → Cr / 100000. Shortfall in MU (= GWh), so MU * Rs/kWh * 1000 / 100000 = MU * Rs/kWh / 100
  const recSolar = (mkt && mkt.recSolarPrice) || rpo.recPriceSolar / 1000 || 2.0;
  const recNonSolar = (mkt && mkt.recNonSolarPrice) || rpo.recPriceNonSolar / 1000 || 1.5;
  const recHydro = rpo.recPriceHydro / 1000 || 1.0;
  const rc = { solar: +(sh.solar * recSolar / 100).toFixed(2), nonSolar: +(sh.nonSolar * recNonSolar / 100).toFixed(2), hydro: +(sh.hydro * recHydro / 100).toFixed(2) };
  rc.total = +(rc.solar + rc.nonSolar + rc.hydro).toFixed(2);
  return { totMU, targets: tgt, fulfilled: ful, pct, shortfall: sh, recCost: rc, fdreMU: +fdrMU.toFixed(1) };
}

// ══════════════════════════════════════════════════════════════
//  DISPATCH ENGINE v2 — TWO-PART TARIFF, BESS ARBITRAGE,
//  RAMP CONSTRAINTS, START COSTS, CURTAILMENT, MULTI-FUEL
// ══════════════════════════════════════════════════════════════
function dispatch96(plants, peakMW, mi, stoa, mkt, fdreList, scenarioMult = {}, shapeMi = mi, monthDays = null) {
  const daysInMonth = monthDays || DAYS[mi] || 30;
  const demMult = scenarioMult.demMult || 1.0;
  const reMult = scenarioMult.reMult || 1.0;
  const priceMult = scenarioMult.priceMult || 1.0;
  const fuelMult = scenarioMult.fuelMult || 1.0;
  const noise = scenarioMult.noise || 0;

  const dem = demandShape(Math.round(peakMW * demMult), shapeMi, noise);
  // Filter out plants not yet commissioned in this month
  const activePlants = plants.filter(p => {
    if (p.commissionMonth == null) return true;
    return mi >= p.commissionMonth; // calendar month comparison
  });
  const re = {};
  activePlants.forEach(p => {
    if (p.type === "Solar") re[p.id] = solarShape(Math.round(p.pMax * reMult), shapeMi, noise);
    else if (p.type === "Wind") re[p.id] = windShape(Math.round(p.pMax * reMult), shapeMi, noise);
    else if (p.type === "Hydro" && p.pondage !== "with") re[p.id] = hydroShape(p.pMax, shapeMi);
    else if (p.type === "Hybrid") re[p.id] = hybridShape(Math.round(p.pMax * reMult), shapeMi, noise);
    else if (p.type === "Nuclear") re[p.id] = nuclearShape(p.pMax, p.avail);
  });
  const thermals = activePlants.filter(p => p.type === "Thermal" || p.type === "Gas").sort((a, b) => (a.ecr * fuelMult) - (b.ecr * fuelMult));
  const stor = activePlants.filter(p => p.type === "BESS" || p.type === "PSP" || (p.type === "Hydro" && p.pondage === "with"));

  // Active STOA for this month
  const activeSTOA = (stoa || []).filter(s => s.status === "ACTIVE" && s.months && s.months[mi]);
  const computeSTOA = (tb, dir) => {
    let totalBilat = 0, totalBank = 0;
    const isPk = tb >= PK0 && tb <= PK1;
    activeSTOA.forEach(s => {
      if (s.dir !== dir) return;
      if (dir === "BUY" && s.seg === "Banking" && s.withdrawMo && !s.withdrawMo[mi]) return;
      if (dir === "SELL" && s.seg === "Banking" && s.injectMo && !s.injectMo[mi]) return;
      if (s.hrs === "PEAK" && !isPk) return;
      if (s.hrs === "OFF-PEAK" && isPk) return;
      if (s.hrs === "CUSTOM") {
        const h = tb / 4;
        if (h < (s.fromHr || 0) || h >= (s.toHr || 24)) return;
      }
      const lf = (dir === "BUY" && s.seg === "Banking") ? (1 - (s.lossPct || 0) / 100) : 1;
      const mw = Math.round(s.mw * lf);
      if (s.seg === "Banking") totalBank += mw; else totalBilat += mw;
    });
    return Math.min(totalBilat, bilatLim) + Math.min(totalBank, bankLim);
  };
  const stoaAvgRate = (() => {
    const buys = activeSTOA.filter(s => s.dir === "BUY");
    const totalMW = safeSum(buys, "mw");
    return totalMW > 0 ? safeSum(buys, s => s.mw * s.rate) / totalMW : 0;
  })();

  // Market rates
  const damRate = ((mkt && mkt.damMCP) ? mkt.damMCP[mi] || 3.5 : 3.5) * priceMult;
  const rtmRate = damRate * (1 + ((mkt && mkt.rtmPrem) || 15) / 100);
  const gdamRate = ((mkt && mkt.gdamMCP) ? mkt.gdamMCP[mi] || 3.2 : 3.2) * priceMult;
  const damLim = (mkt && mkt.damLim) || 9999;
  const rtmLim = (mkt && mkt.rtmLim) || 9999;
  const gdamLim = (mkt && mkt.gdamLim) || 9999;
  const bilatLim = (mkt && mkt.bilatLim) || 9999;
  const bankLim = (mkt && mkt.bankLim) || 9999;

  // FDRE
  const fdreProfs = (fdreList || []).map(f => ({ ...f, prof: fdreProfile96(f, mi) }));
  const fdreTotal96 = Array.from({ length: 96 }, (_, t) => safeSum(fdreProfs, f => f.prof[t]));
  const fdreAvgRate = (() => {
    const active = (fdreList || []).filter(f => f.status === "ACTIVE");
    const totCap = safeSum(active, "capacity");
    return totCap > 0 ? safeSum(active, f => f.capacity * f.tariff) / totCap : 0;
  })();

  // ── Pre-compute marginal cost curve for BESS arbitrage ──
  // Estimate system marginal cost per block (before storage) to decide charge/discharge
  const margCostEst = Array(96).fill(0);
  for (let t = 0; t < 96; t++) {
    let residual = dem[t];
    plants.forEach(p => { if (re[p.id] != null) residual -= (re[p.id][t] || 0); });
    residual -= (fdreTotal96[t] || 0);
    residual -= computeSTOA(t, "BUY");
    // Find which thermal would be marginal
    let mc = damRate; // default to DAM if all thermal exhausted
    let cumCap = 0;
    for (const p of thermals) {
      const av = Math.round(p.pMax * p.avail / 100);
      cumCap += av;
      if (cumCap >= residual) { mc = p.ecr * fuelMult; break; }
    }
    if (residual <= 0) mc = Math.min(...thermals.map(p => p.ecr * fuelMult), damRate) * 0.5; // surplus — low cost
    margCostEst[t] = mc;
  }

  // BESS/PSP optimal charge/discharge thresholds
  const avgMC = safeMean(margCostEst.map(v => ({ v })), "v");
  const chargeThresh = avgMC * 0.75; // charge when system cost < 75% of average
  const dischargeThresh = avgMC * 1.1; // discharge when system cost > 110% of average

  // ── State tracking across blocks ──
  const prevMW = {}; // previous block MW for ramp constraints
  const commitState = {}; // { blocksOn, blocksOff } for min up/down
  thermals.forEach(p => { prevMW[p.id] = 0; commitState[p.id] = { on: 0, off: 99 }; });

  // Storage SoC tracking
  const storSoC = {};
  const storCycleUsed = {}; // track energy cycled for BESS cycle limits
  stor.forEach(p => {
    storSoC[p.id] = (p.socMax || 90) * 0.6; // start at 60% of max
    const maxCycles = p.cycles || (p.type === "BESS" ? 1 : 99);
    const cap = p.mwh || (p.type === "Hydro" ? (p.storageHrs || 6) * p.pMax : 400);
    storCycleUsed[p.id] = { used: 0, limit: maxCycles * cap }; // MWh discharged per day
  });

  const blks = [];
  let totalCurtailment = 0;
  let totalStartCosts = 0;
  let totalFixedCosts = 0;

  for (let t = 0; t < 96; t++) {
    const d = dem[t]; let rem = d; const src = {}; let gen = 0; let chargingLoad = 0;
    let curtailment = 0;

    // 1) Must-run RE + Hydro
    let reTotal = 0;
    plants.forEach(p => {
      if (re[p.id] != null) {
        const mw = re[p.id][t] || 0;
        src[p.id] = { id: p.id, n: p.name, tp: p.type, mw, ecr: p.ecr, st: mw > 0 ? "MUST-RUN" : "OFF", fuel: p.fuel || "none" };
        rem -= mw; gen += mw; reTotal += mw;
      }
    });

    // 1.5) FDRE
    const fdreMW = fdreTotal96[t] || 0;
    rem -= fdreMW;

    // ── Curtailment check: if RE + FDRE exceeds demand + min thermal loading ──
    const minThermalLoad = safeSum(thermals.filter(p => commitState[p.id]?.on > 0), "pMin");
    if (rem < -minThermalLoad * 0.5) {
      // Must curtail RE — can't go below min loading of committed thermals
      curtailment = Math.abs(rem) - minThermalLoad * 0.3;
      if (curtailment < 0) curtailment = 0;
      totalCurtailment += curtailment;
    }

    // 2) STOA + Thermal interleaved by cost
    const sBuy = computeSTOA(t, "BUY");
    const sSell = computeSTOA(t, "SELL");
    const meritSlots = [];
    if (sBuy > 0) meritSlots.push({ type: "STOA", mw: sBuy, cost: stoaAvgRate });
    thermals.forEach(p => meritSlots.push({ type: "THERMAL", plant: p, cost: p.ecr * fuelMult }));
    meritSlots.sort((a, b) => a.cost - b.cost);

    let stoaUsed = 0; let startCostBlock = 0;
    meritSlots.forEach(slot => {
      if (rem <= 0) {
        if (slot.type === "THERMAL") {
          const p = slot.plant;
          // Check min up time — if unit was on, must respect min up
          if (commitState[p.id].on > 0 && commitState[p.id].on < (p.minUp || 1) * 4) {
            // Must keep running at pMin
            const dp = p.pMin;
            src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: dp, ecr: p.ecr * fuelMult, st: "MIN-LOAD", fuel: p.fuel || "none" };
            rem -= dp; gen += dp;
            commitState[p.id].on++;
            prevMW[p.id] = dp;
            return;
          }
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: p.ecr * fuelMult, st: "STANDBY", fuel: p.fuel || "none" };
          if (commitState[p.id].on > 0) { commitState[p.id].on = 0; commitState[p.id].off = 0; }
          commitState[p.id].off++;
          prevMW[p.id] = 0;
        }
        return;
      }
      if (slot.type === "STOA") {
        const used = Math.min(sBuy, rem);
        stoaUsed = used; rem -= used;
      } else {
        const p = slot.plant;
        const av = Math.round(p.pMax * p.avail / 100);
        // Min down time check
        if (commitState[p.id].off > 0 && commitState[p.id].off < (p.minDn || 1) * 4) {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: p.ecr * fuelMult, st: "MIN-DN", fuel: p.fuel || "none" };
          commitState[p.id].off++;
          prevMW[p.id] = 0;
          return;
        }
        if (rem >= p.pMin * 0.5) {
          // Ramp constraint
          const maxRamp = (p.rampUp || p.rampUp === 0 ? p.rampUp : 999) * 15; // MW per 15-min block
          const prev = prevMW[p.id] || 0;
          let targetMW = Math.min(av, Math.max(p.pMin, rem));
          if (prev > 0) {
            targetMW = Math.min(targetMW, prev + maxRamp);
            const maxDn = (p.rampDn || p.rampUp || 999) * 15;
            targetMW = Math.max(targetMW, prev - maxDn, p.pMin);
          }
          const dp = Math.round(clamp(targetMW, p.pMin, av));

          // Start cost
          const wasOff = commitState[p.id].on === 0;
          if (wasOff) {
            startCostBlock += (p.startCost || 0);
            totalStartCosts += (p.startCost || 0);
          }

          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: dp, ecr: p.ecr * fuelMult, st: wasOff ? "STARTING" : "COMMITTED", fuel: p.fuel || "none" };
          rem -= dp; gen += dp;
          commitState[p.id].on++;
          commitState[p.id].off = 0;
          prevMW[p.id] = dp;
        } else {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: p.ecr * fuelMult, st: "STANDBY", fuel: p.fuel || "none" };
          if (commitState[p.id].on > 0) { commitState[p.id].on = 0; commitState[p.id].off = 0; }
          commitState[p.id].off++;
          prevMW[p.id] = 0;
        }
      }
    });
    thermals.forEach(p => { if (!src[p.id]) { src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: p.ecr * fuelMult, st: "STANDBY", fuel: p.fuel || "none" }; prevMW[p.id] = 0; } });
    rem += sSell;

    // 3) Storage — SMART arbitrage-based dispatch (BESS, PSP, Hydro w/ pondage)
    const sysPrice = margCostEst[t];
    stor.forEach(p => {
      const cap = p.mwh || (p.type === "Hydro" ? (p.storageHrs || 6) * p.pMax : 400);
      const eff = (p.eff || (p.type === "Hydro" ? 90 : 85)) / 100;
      const socMinPct = p.socMin || 5;
      const socMaxPct = p.socMax || 95;
      const soc = storSoC[p.id];
      const degrad = p.degradCost || 0;

      const cycleRemain = storCycleUsed[p.id].limit - storCycleUsed[p.id].used; // MWh remaining
      if (rem > 0 && sysPrice >= dischargeThresh && soc > socMinPct + 5 && cycleRemain > 0) {
        // Discharge — high system cost, energy needed
        const maxBySOC = (soc - socMinPct) / 100 * cap / 0.25; // MW available for 15-min
        const maxByCycle = cycleRemain / 0.25; // MW limited by remaining cycle budget
        const dp = Math.round(Math.min(p.pMax, rem, maxBySOC, maxByCycle));
        if (dp > 0) {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: dp, ecr: degrad, st: "DISCHARGE", fuel: "none" };
          storSoC[p.id] -= (dp * 0.25 / cap) * 100;
          storCycleUsed[p.id].used += dp * 0.25;
          rem -= dp; gen += dp;
        } else {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: 0, st: "IDLE", fuel: "none" };
        }
      } else if (sysPrice <= chargeThresh && soc < socMaxPct - 5) {
        // Charge — low system cost
        const maxBySOC = (socMaxPct - soc) / 100 * cap * eff / 0.25; // MW can absorb
        const ch = Math.round(Math.min(p.pMax * 0.8, maxBySOC));
        if (ch > 0) {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: -ch, ecr: 0, st: "CHARGING", fuel: "none" };
          storSoC[p.id] += (ch * 0.25 * eff / cap) * 100;
          chargingLoad += ch; rem += ch;
        } else {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: 0, st: "IDLE", fuel: "none" };
        }
      } else if (rem > 0 && soc > socMinPct + 2 && cycleRemain > 0) {
        // Deficit exists even if not above threshold — still discharge
        const maxBySOC = (soc - socMinPct) / 100 * cap / 0.25;
        const maxByCycle = cycleRemain / 0.25;
        const dp = Math.round(Math.min(p.pMax, rem, maxBySOC, maxByCycle));
        if (dp > 0) {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: dp, ecr: degrad, st: "DISCHARGE", fuel: "none" };
          storSoC[p.id] -= (dp * 0.25 / cap) * 100;
          storCycleUsed[p.id].used += dp * 0.25;
          rem -= dp; gen += dp;
        } else {
          src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: 0, st: "IDLE", fuel: "none" };
        }
      } else {
        src[p.id] = { id: p.id, n: p.name, tp: p.type, mw: 0, ecr: 0, st: "IDLE", fuel: "none" };
      }
      storSoC[p.id] = clamp(storSoC[p.id], socMinPct, socMaxPct);
    });

    // 4) Open market — DAM → GDAM → RTM with limits
    const deficit = Math.max(0, rem);
    const surplus = Math.max(0, -rem);
    let mktDAM = 0, mktGDAM = 0, mktRTM = 0, mktRemain = deficit;
    if (mktRemain > 0) { mktDAM = Math.min(mktRemain, damLim); mktRemain -= mktDAM; }
    if (mktRemain > 0) { mktGDAM = Math.min(mktRemain, gdamLim); mktRemain -= mktGDAM; }
    if (mktRemain > 0) { mktRTM = Math.min(mktRemain, rtmLim); mktRemain -= mktRTM; }
    const mktTotal = mktDAM + mktGDAM + mktRTM + mktRemain;

    // Cost for this block (₹ lakhs per 15-min block)
    const blockHrs = 0.25;
    let varCost = 0; // variable energy cost
    const carbonRate = (mkt && mkt.carbonPrice) || 0; // Rs/tCO2
    Object.values(src).forEach(s => {
      if (s.mw > 0 && s.ecr > 0) {
        varCost += s.mw * s.ecr * blockHrs * 10 / 1000;
        // Carbon cost: ~0.9 tCO2/MWh for coal, 0.4 for gas, 0 for nuclear
        if (carbonRate > 0 && (s.tp === "Thermal" || s.tp === "Gas")) {
          const emFactor = (s.fuel || "").includes("gas") || s.tp === "Gas" ? 0.4 : 0.9;
          varCost += s.mw * blockHrs * emFactor * carbonRate / 100000; // Rs lakhs
        }
      }
    });
    varCost += fdreMW * fdreAvgRate * blockHrs * 10 / 1000;
    varCost += stoaUsed * stoaAvgRate * blockHrs * 10 / 1000;
    varCost += mktDAM * damRate * blockHrs * 10 / 1000;
    varCost += mktGDAM * gdamRate * blockHrs * 10 / 1000;
    varCost += mktRTM * rtmRate * blockHrs * 10 / 1000;

    // Fixed capacity cost (pro-rated per 15-min block: fixedCost ₹/MW/month → per block)
    const fixedCostBlock = safeSum(thermals, p => (p.fixedCost || 0) * p.pMax / (daysInMonth * 96)) / 1000; // ₹ lakhs
    totalFixedCosts = safeSum(thermals, p => (p.fixedCost || 0) * p.pMax) / 100000; // ₹ Cr per month

    // Surplus sale revenue (sell at DAM rate, offset against cost)
    const surplusRevenue = surplus > 0 ? Math.round(surplus * 0.6) * damRate * blockHrs * 10 / 1000 : 0;
    const blockCost = varCost + startCostBlock / 1000 - surplusRevenue; // net of surplus sale

    blks.push({
      t, lbl: TB[t].lbl, dem: d, src, gen, chg: chargingLoad,
      def: deficit, sur: surplus, curtailment: Math.round(curtailment),
      fdreMW, fdreRate: fdreAvgRate,
      stoaBuy: stoaUsed, stoaSell: sSell, stoaRate: stoaAvgRate,
      mkt: mktTotal, mktDAM, mktGDAM: mktGDAM || 0, mktRTM, mktSell: Math.round(surplus * 0.6),
      damRate, rtmRate, gdamRate,
      varCost: +varCost.toFixed(2), fixedCost: +fixedCostBlock.toFixed(3), surRevenue: +surplusRevenue.toFixed(2),
      startCost: startCostBlock,
      cost: +blockCost.toFixed(2),
      margCost: +sysPrice.toFixed(2),
      soc: { ...storSoC },
    });
  }

  // Attach summary metadata
  blks._meta = {
    totalCurtailmentMW: Math.round(totalCurtailment),
    totalStartCosts: +totalStartCosts.toFixed(1),
    totalFixedCostsCr: +totalFixedCosts.toFixed(2),
    chargeThresh: +chargeThresh.toFixed(2),
    dischargeThresh: +dischargeThresh.toFixed(2),
  };
  return blks;
}

// ══════════════════════════════════════════════════════════════
//  AGGREGATION
// ══════════════════════════════════════════════════════════════
function aggHourly(b96) {
  if (!b96 || b96.length < 96) return [];
  const hrs = [];
  for (let h = 0; h < 24; h++) {
    const s = b96.slice(h * 4, h * 4 + 4).filter(Boolean);
    if (!s.length) continue;
    const src = {};
    const ids = Object.keys(s[0].src);
    ids.forEach(id => { src[id] = { ...s[0].src[id], mw: Math.round(safeMean(s, b => b.src[id] ? b.src[id].mw : 0)) }; });
    // Propagate SoC — use last block's SoC as representative for the hour
    const lastBlock = s[s.length - 1];
    const soc = lastBlock && lastBlock.soc ? { ...lastBlock.soc } : {};
    hrs.push({
      h, lbl: `${String(h).padStart(2, "0")}:00`,
      dem: Math.round(safeMean(s, "dem")), gen: Math.round(safeMean(s, "gen")),
      def: Math.round(safeMean(s, "def")), sur: Math.round(safeMean(s, "sur")),
      curtailment: Math.round(safeSum(s, "curtailment")),
      mkt: Math.round(safeMean(s, "mkt")),
      mktDAM: Math.round(safeMean(s, "mktDAM")), mktGDAM: Math.round(safeMean(s, b => b.mktGDAM || 0)), mktRTM: Math.round(safeMean(s, "mktRTM")),
      fdreMW: Math.round(safeMean(s, b => b.fdreMW || 0)),
      stoaBuy: Math.round(safeMean(s, "stoaBuy")), stoaSell: Math.round(safeMean(s, b => b.stoaSell || 0)),
      mktSell: Math.round(safeMean(s, b => b.mktSell || 0)),
      cost: +safeSum(s, "cost").toFixed(2), varCost: +safeSum(s, "varCost").toFixed(2),
      margCost: +safeMean(s, "margCost").toFixed(2),
      damRate: s[0].damRate || 0, rtmRate: s[0].rtmRate || 0, gdamRate: s[0].gdamRate || 0,
      src, soc,
    });
  }
  return hrs;
}
function aggMonthly(b96, days) {
  if (!b96 || !b96.length) return { demMU: 0, genMU: 0, mktMU: 0, mktDAM_MU: 0, mktGDAM_MU: 0, mktRTM_MU: 0, defMU: 0, surMU: 0, stoaBuyMU: 0, curtailMU: 0, costCr: 0, varCostCr: 0, fixedCostCr: 0, avgCost: "0.00", srcE: {} };
  const f = 0.25 * days / 1000;
  const srcE = {};
  Object.keys(b96[0].src).forEach(id => {
    const ref = b96[0].src[id];
    const avg = safeMean(b96, b => Math.max(0, b.src[id] ? b.src[id].mw : 0));
    srcE[id] = { ...ref, mw: Math.round(avg), mu: +(avg * 24 * days / 1000).toFixed(1) };
  });
  const varCostCr = +(safeSum(b96, "varCost") * days / 100).toFixed(2);
  const fixedCostCr = b96._meta ? b96._meta.totalFixedCostsCr : 0;
  const energyCostCr = +(safeSum(b96, "cost") * days / 100).toFixed(2);
  const costCr = +(energyCostCr + fixedCostCr).toFixed(2); // total = variable+start+fixed
  return {
    demMU: +(safeSum(b96, "dem") * f).toFixed(1),
    genMU: +(safeSum(b96, "gen") * f).toFixed(1),
    mktMU: +(safeSum(b96, "mkt") * f).toFixed(1),
    mktDAM_MU: +(safeSum(b96, "mktDAM") * f).toFixed(1),
    mktGDAM_MU: +(safeSum(b96, b => b.mktGDAM || 0) * f).toFixed(1),
    mktRTM_MU: +(safeSum(b96, "mktRTM") * f).toFixed(1),
    defMU: +(safeSum(b96, "def") * f).toFixed(1),
    surMU: +(safeSum(b96, "sur") * f).toFixed(1),
    stoaBuyMU: +(safeSum(b96, "stoaBuy") * f).toFixed(1),
    fdreMU: +(safeSum(b96, b => b.fdreMW || 0) * f).toFixed(1),
    curtailMU: +(safeSum(b96, "curtailment") * f).toFixed(1),
    costCr, varCostCr, fixedCostCr,
    startCosts: b96._meta ? b96._meta.totalStartCosts : 0,
    avgCost: +(costCr > 0 ? (costCr * 100 / (safeSum(b96, "dem") * 0.25 * days / 1000 * 10)) : 0).toFixed(2),
    srcE,
  };
}

// ══════════════════════════════════════════════════════════════
//  SHARED COMPONENTS — PROFESSIONAL UI
// ══════════════════════════════════════════════════════════════
function KPI({ label, value, unit, color, accent, sub }) {
  return (
    <div style={{ background: C.panel, borderRadius: 2, padding: "8px 12px", border: `1px solid ${C.brd}`, flex: 1, minWidth: 120, borderLeft: `3px solid ${accent || C.brd}`, position: "relative" }}>
      <div style={{ ...lbl, fontSize: 10, color: C.t3, marginBottom: 4, letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: color || C.val, lineHeight: 1.1 }}>{value}<span style={{ fontSize: 11, fontWeight: 500, color: C.t2, marginLeft: 3 }}>{unit}</span></div>
      {sub && <div style={{ ...mono, fontSize: 10, color: C.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
function Panel({ title, accent, toolbar, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 2, overflow: "hidden", background: C.panel }}>
      <div style={{ display: "flex", alignItems: "center", height: 32, padding: "0 12px", background: C.overlay, borderBottom: open ? `1px solid ${C.brd}` : "none", borderLeft: `3px solid ${accent || C.focus}`, cursor: "pointer", userSelect: "none" }} onClick={() => setOpen(!open)}>
        <span style={{ ...lbl, fontSize: 11, fontWeight: 700, color: C.t2, flex: 1 }}>{title}</span>
        {toolbar && <div style={{ display: "flex", gap: 6, marginRight: 8 }}>{toolbar}</div>}
        <span style={{ ...mono, fontSize: 11, color: C.t3, transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}>&#9662;</span>
      </div>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
}
function ResBtn({ active, onClick, children, disabled }) {
  return <button onClick={disabled ? undefined : onClick} style={{ ...lbl, fontSize: 10, padding: "3px 10px", borderRadius: 2, border: active ? `1px solid ${C.focus}` : `1px solid ${C.brd}88`, cursor: disabled ? "not-allowed" : "pointer", background: active ? C.focus + "22" : C.elev, color: active ? C.focus : C.t1, fontWeight: active ? 700 : 500, opacity: disabled ? 0.35 : 1 }}>{children}</button>;
}
function Minimap({ total, offset, onSeek }) {
  const vis = 600; const pct = total > 0 ? vis / total : 1; const l = total > 0 ? offset / total : 0;
  return <div onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width); }} style={{ height: 5, background: C.brd + "66", borderRadius: 2, position: "relative", cursor: "pointer", margin: "3px 8px" }}><div style={{ position: "absolute", top: 0, left: `${l * 100}%`, width: `${Math.max(pct * 100, 5)}%`, height: "100%", background: C.focus, borderRadius: 2 }} /></div>;
}
function StatusDot({ color, label }) {
  return <span style={{ ...lbl, fontSize: 10, color: C.t2, display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 4px ${color}55` }} />{label}</span>;
}
// Sidebar nav items
const NAV = [
  { id: "overview", label: "Overview", icon: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" },
  { id: "config", label: "Configure", icon: "M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 0 01-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0014 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z" },
  { id: "grid", label: "96-Block", icon: "M3 3h4v4H3zm7 0h4v4h-4zm7 0h4v4h-4zM3 10h4v4H3zm7 0h4v4h-4zm7 0h4v4h-4zM3 17h4v4H3zm7 0h4v4h-4zm7 0h4v4h-4z" },
  { id: "dispatch", label: "Dispatch", icon: "M4 20h16V4H4v16zm2-7h3v5H6v-5zm5 0h3v5h-3v-5zm5-4h3v9h-3V9z" },
  { id: "market", label: "Market", icon: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zm0-10v2h14V7H7z" },
  { id: "rpo", label: "RPO", icon: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" },
  { id: "scenarios", label: "Scenarios", icon: "M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22l-9-12z" },
  { id: "balance", label: "Balance", icon: "M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" },
];

// ══════════════════════════════════════════════════════════════
//  EDIT CELL (click-to-edit)
// ══════════════════════════════════════════════════════════════
function EditCell({ value, onChange, type, min, max, width, disabled }) {
  const [editing, setEditing] = useState(false);
  const [tmp, setTmp] = useState(String(value));
  const commit = () => {
    setEditing(false);
    const v = type === "number" ? Number(tmp) : tmp;
    if (type === "number" && isNaN(v)) return;
    if (min != null && v < min) return;
    if (max != null && v > max) return;
    onChange(v);
  };
  if (disabled) return <span style={{ ...mono, fontSize: 12, color: C.t3 }}>{value}</span>;
  if (!editing) return (
    <span onClick={() => { setEditing(true); setTmp(String(value)); }}
      style={{ ...mono, fontSize: 12, color: C.t1, cursor: "pointer", padding: "2px 4px", borderRadius: 3, border: `1px solid transparent`, display: "inline-block", minWidth: width || 50, textAlign: "right" }}
      onMouseEnter={e => e.target.style.borderColor = C.focus + "66"}
      onMouseLeave={e => e.target.style.borderColor = "transparent"}>
      {value}
    </span>
  );
  return (
    <input autoFocus value={tmp} onChange={e => setTmp(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ ...mono, fontSize: 12, color: C.t1, background: C.overlay, border: `2px solid ${C.focus}`, borderRadius: 3, padding: "1px 4px", width: width || 55, textAlign: "right", outline: "none" }}
    />
  );
}

// ══════════════════════════════════════════════════════════════
//  PLANT EDITOR — with fuel type and two-part tariff
// ══════════════════════════════════════════════════════════════
function PlantEditor({ plants, setPlants }) {
  const update = (id, key, val) => setPlants(prev => prev.map(p => p.id === id ? { ...p, [key]: val } : p));
  const addPlant = () => {
    const id = Math.max(0, ...plants.map(p => p.id)) + 1;
    setPlants(prev => [...prev, { id, name: `New Unit ${id}`, type: "Thermal", fuel: "coal_fsa", pMax: 100, pMin: 40, ecr: 4.0, fixedCost: 1200, startCost: 10, avail: 90, mustRun: false, rampUp: 5, rampDn: 4, minUp: 4, minDn: 2 }]);
  };
  const delPlant = (id) => setPlants(prev => prev.filter(p => p.id !== id));
  const types = ["Thermal", "Solar", "Wind", "Hydro", "BESS", "PSP", "Hybrid", "Nuclear", "Gas"];
  const fuels = ["coal_fsa", "coal_auction", "coal_import", "gas_apm", "gas_spot", "lignite", "nuclear", "none"];
  const fuelLabels = { coal_fsa: "Coal FSA", coal_auction: "Coal Auction", coal_import: "Coal Import", gas_apm: "Gas APM", gas_spot: "Gas Spot", lignite: "Lignite", nuclear: "Nuclear", none: "—" };
  const isStor = (p) => p.type === "BESS" || p.type === "PSP";
  const isHydro = (p) => p.type === "Hydro";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button onClick={addPlant} style={{ ...lbl, fontSize: 10, padding: "3px 10px", background: C.pos + "15", color: C.pos, border: `1px solid ${C.pos}33`, borderRadius: 2, cursor: "pointer" }}>+ ADD UNIT</button>
        <span style={{ ...mono, fontSize: 10, color: C.t3, marginLeft: "auto" }}>Click to edit | Fixed (₹/MW/mo) + Variable (ECR ₹/kWh)</span>
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 2, maxHeight: 400 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["", "Name", "Type", "Fuel", "From", "PMax", "PMin", "ECR ₹/kWh", "Fixed ₹/MW/mo", "Start ₹L", "Avail%", "Must", "Ramp Up", "Ramp Dn", "MinUp", "MinDn", "MWh", "Eff%", "Deg₹", "Cyc/StoHr", "Trans", "Pondage"].map((h, i) => (
              <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "7px 5px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 4 ? "right" : "left", position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{plants.map((p, ri) => (
            <tr key={p.id} style={{ background: ri % 2 === 0 ? C.elev : C.elev + "99" }}>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}>
                <button onClick={() => delPlant(p.id)} style={{ background: "none", border: "none", color: C.neg, cursor: "pointer", fontSize: 12 }}>x</button>
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}><EditCell value={p.name} onChange={v => update(p.id, "name", v)} type="text" width={80} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}>
                <select value={p.type} onChange={e => update(p.id, "type", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: FC[p.type] || C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}>
                <select value={p.fuel || "none"} onChange={e => update(p.id, "fuel", e.target.value)} style={{ ...ui, fontSize: 9, background: C.overlay, color: FUEL_CLR[p.fuel] || C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer" }}>
                  {fuels.map(f => <option key={f} value={f}>{fuelLabels[f]}</option>)}
                </select>
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}>
                <select value={p.commissionMonth ?? ""} onChange={e => update(p.id, "commissionMonth", e.target.value === "" ? null : parseInt(e.target.value))} style={{ ...ui, fontSize: 9, background: C.overlay, color: p.commissionMonth != null ? C.focus : C.t3, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer", minWidth: 38 }}>
                  <option value="">—</option>
                  {CAL_MO.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.pMax} onChange={v => update(p.id, "pMax", v)} type="number" min={0} width={40} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.pMin} onChange={v => update(p.id, "pMin", v)} type="number" min={0} width={35} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", background: (p.ecr || 0) < 2.5 ? C.pos + "18" : (p.ecr || 0) < 4 ? C.warn + "15" : C.neg + "15" }}><EditCell value={p.ecr} onChange={v => update(p.id, "ecr", v)} type="number" min={0} width={40} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.fixedCost || 0} onChange={v => update(p.id, "fixedCost", v)} type="number" min={0} width={45} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.startCost || 0} onChange={v => update(p.id, "startCost", v)} type="number" min={0} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.avail} onChange={v => update(p.id, "avail", v)} type="number" min={0} max={100} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "center" }}>
                <input type="checkbox" checked={p.mustRun} onChange={e => update(p.id, "mustRun", e.target.checked)} style={{ cursor: "pointer" }} />
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.rampUp || 0} onChange={v => update(p.id, "rampUp", v)} type="number" min={0} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.rampDn || p.rampUp || 0} onChange={v => update(p.id, "rampDn", v)} type="number" min={0} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.minUp || 0} onChange={v => update(p.id, "minUp", v)} type="number" min={0} width={25} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.minDn || 0} onChange={v => update(p.id, "minDn", v)} type="number" min={0} width={25} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.mwh || "—"} onChange={v => update(p.id, "mwh", v)} type="number" min={0} disabled={p.type !== "BESS" && p.type !== "PSP"} width={35} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.eff || "—"} onChange={v => update(p.id, "eff", v)} type="number" min={0} max={100} disabled={p.type !== "BESS" && p.type !== "PSP"} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}><EditCell value={p.degradCost || "—"} onChange={v => update(p.id, "degradCost", v)} type="number" min={0} disabled={!isStor(p)} width={30} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}>
                {p.type === "BESS" ? (
                  <select value={p.cycles || 1} onChange={e => update(p.id, "cycles", parseInt(e.target.value))} style={{ ...ui, fontSize: 9, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer", width: 36 }}>
                    {[1, 1.5, 2, 2.5, 3].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (isStor(p) || isHydro(p)) ? (
                  <EditCell value={p.storageHrs || 0} onChange={v => update(p.id, "storageHrs", v)} type="number" min={0} max={24} width={30} />
                ) : <span style={{ ...mono, fontSize: 9, color: C.t3 }}>—</span>}
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}>
                {(isStor(p) || (isHydro(p) && p.pondage === "with")) ? (
                  <EditCell value={p.transitionMins || 0} onChange={v => update(p.id, "transitionMins", v)} type="number" min={0} max={60} width={25} />
                ) : <span style={{ ...mono, fontSize: 9, color: C.t3 }}>—</span>}
              </td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}15` }}>
                {isHydro(p) ? (
                  <select value={p.pondage || "without"} onChange={e => update(p.id, "pondage", e.target.value)} style={{ ...ui, fontSize: 9, background: C.overlay, color: p.pondage === "with" ? C.pos : C.t2, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer", minWidth: 48 }}>
                    <option value="with">With</option>
                    <option value="without">Without</option>
                  </select>
                ) : <span style={{ ...mono, fontSize: 9, color: C.t3 }}>—</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function DemandEditor({ demand, setDemand, moNames, months }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {moNames.map((m, i) => (
          <div key={i} style={{ background: C.elev, border: `1px solid ${C.brd}`, borderRadius: 5, padding: "6px 10px", textAlign: "center", minWidth: 70 }}>
            <div style={{ ...ui, fontSize: 11, color: C.t2, marginBottom: 4 }}>{m}</div>
            <EditCell value={demand[months[i].cal]} onChange={v => { const d = [...demand]; d[months[i].cal] = v; setDemand(d); }} type="number" min={0} width={55} />
            <div style={{ ...mono, fontSize: 10, color: C.t3, marginTop: 2 }}>{months[i].days}d</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketEditor({ mkt, setMkt, moNames, months }) {
  const up = (key, i, v) => { const m = { ...mkt }; if (Array.isArray(m[key])) { m[key] = [...m[key]]; m[key][i] = v; } else { m[key] = v; } setMkt(m); };
  const rows = [
    { key: "damMCP", label: "DAM MCP ₹/kWh", color: C.dam },
    { key: "gdamMCP", label: "GDAM MCP ₹/kWh", color: C.gdam },
    { key: "bilatRate", label: "Bilateral ₹/kWh", color: C.bilat },
    { key: "bankRate", label: "Banking ₹/kWh", color: C.bank },
  ];
  return (
    <div>
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 2 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "7px 8px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>PARAMETER</th>
            {moNames.map((m, i) => <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "7px 6px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: "right" }}>{m}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.key} style={{ background: ri % 2 === 0 ? C.elev : C.elev + "99" }}>
                <td style={{ ...ui, fontSize: 11, padding: "4px 8px", borderBottom: `1px solid ${C.brd}15`, color: r.color, fontWeight: 500, position: "sticky", left: 0, background: ri % 2 === 0 ? C.elev : C.overlay, zIndex: 1 }}>{r.label}</td>
                {moNames.map((_, i) => (
                  <td key={i} style={{ padding: "3px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right" }}>
                    <EditCell value={mkt[r.key][months[i].cal]} onChange={v => up(r.key, months[i].cal, v)} type="number" min={0} width={45} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        {[
          { key: "rtmPrem", label: "RTM Premium %", min: 0, max: 100 },
          { key: "damLim", label: "DAM Limit MW", min: 0 },
          { key: "gdamLim", label: "GDAM Limit MW", min: 0 },
          { key: "rtmLim", label: "RTM Limit MW", min: 0 },
          { key: "bilatLim", label: "Bilateral Limit MW", min: 0 },
          { key: "bankLim", label: "Banking Limit MW", min: 0 },
          { key: "recSolarPrice", label: "REC Solar ₹/kWh", min: 0 },
          { key: "recNonSolarPrice", label: "REC Non-Sol ₹/kWh", min: 0 },
          { key: "carbonPrice", label: "Carbon ₹/tCO2", min: 0 },
        ].map(p => (
          <div key={p.key} style={{ background: C.elev, border: `1px solid ${C.brd}`, borderRadius: 5, padding: "6px 10px", minWidth: 110 }}>
            <div style={{ ...ui, fontSize: 10, color: C.t2, textTransform: "uppercase", marginBottom: 4 }}>{p.label}</div>
            <EditCell value={mkt[p.key] || 0} onChange={v => up(p.key, null, v)} type="number" min={p.min} max={p.max} width={55} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  DATA UPLOADER — CSV template download + file upload
// ══════════════════════════════════════════════════════════════
const UPLOAD_ROWS = [
  { key: "demand", label: "Peak Demand (MW)" },
  { key: "damMCP", label: "DAM MCP (Rs/kWh)" },
  { key: "gdamMCP", label: "GDAM MCP (Rs/kWh)" },
  { key: "bilatRate", label: "Bilateral Rate (Rs/kWh)" },
  { key: "bankRate", label: "Banking Rate (Rs/kWh)" },
];

function DataUploader({ demand, setDemand, mkt, setMkt, months, moNames }) {
  const [status, setStatus] = useState(null); // { type: "ok"|"err", msg }
  const fileRef = useRef(null);

  const downloadTemplate = () => {
    const hdr = ["Parameter", ...CAL_MO];
    const rows = [hdr];
    UPLOAD_ROWS.forEach(r => {
      const vals = CAL_MO.map((_, ci) => {
        if (r.key === "demand") return demand[ci];
        return mkt[r.key]?.[ci] ?? 0;
      });
      rows.push([r.label, ...vals]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "UCED_upload_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const lines = text.trim().split(/\r?\n/).map(l => l.split(",").map(c => c.trim()));
        if (lines.length < 2) { setStatus({ type: "err", msg: "File has no data rows" }); return; }

        // Parse header — find month column indices
        const hdr = lines[0];
        const moIdx = {}; // cal month index → column index
        CAL_MO.forEach((m, ci) => {
          const col = hdr.findIndex(h => h.toLowerCase() === m.toLowerCase());
          if (col >= 0) moIdx[ci] = col;
        });
        if (Object.keys(moIdx).length < 12) {
          setStatus({ type: "err", msg: `Found ${Object.keys(moIdx).length}/12 month columns. Use Jan–Dec headers.` });
          return;
        }

        // Parse data rows by label matching
        const newDemand = [...demand];
        const newMkt = { ...mkt };
        let matched = 0;

        for (let li = 1; li < lines.length; li++) {
          const row = lines[li];
          const label = (row[0] || "").toLowerCase();
          const spec = UPLOAD_ROWS.find(r => label.includes(r.label.split("(")[0].trim().toLowerCase()));
          if (!spec) continue;
          matched++;
          const vals = CAL_MO.map((_, ci) => {
            const v = parseFloat(row[moIdx[ci]]);
            return isNaN(v) ? null : v;
          });
          if (spec.key === "demand") {
            vals.forEach((v, ci) => { if (v !== null) newDemand[ci] = v; });
          } else {
            newMkt[spec.key] = [...(mkt[spec.key] || [])];
            vals.forEach((v, ci) => { if (v !== null) newMkt[spec.key][ci] = v; });
          }
        }

        if (matched === 0) {
          setStatus({ type: "err", msg: "No matching rows found. Use template labels in column A." });
          return;
        }

        setDemand(newDemand);
        setMkt(newMkt);
        setStatus({ type: "ok", msg: `Loaded ${matched} parameter${matched > 1 ? "s" : ""} across 12 months` });
      } catch (err) {
        setStatus({ type: "err", msg: "Parse error: " + err.message });
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-uploaded
  };

  const btnStyle = { ...lbl, fontSize: 10, padding: "5px 14px", borderRadius: 3, cursor: "pointer", border: `1px solid ${C.brd}`, fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...ui, fontSize: 11, color: C.t2, lineHeight: 1.5 }}>
        Upload monthly demand and market price forecasts via CSV. Download the template, fill in your values, and upload.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={downloadTemplate} style={{ ...btnStyle, background: C.focus + "18", color: C.focus, borderColor: C.focus + "44" }}>
          ↓ DOWNLOAD TEMPLATE
        </button>
        <button onClick={() => fileRef.current?.click()} style={{ ...btnStyle, background: C.pos + "18", color: C.pos, borderColor: C.pos + "44" }}>
          ↑ UPLOAD CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleUpload} style={{ display: "none" }} />
        <button onClick={() => { setDemand(DEF_DEMAND); setMkt(DEF_MKT); setStatus({ type: "ok", msg: "Reset to defaults" }); }} style={{ ...btnStyle, background: C.elev, color: C.t2 }}>
          ↺ RESET DEFAULTS
        </button>
      </div>
      {status && (
        <div style={{ ...mono, fontSize: 11, padding: "6px 10px", borderRadius: 3, background: status.type === "ok" ? C.pos + "15" : C.neg + "15", color: status.type === "ok" ? C.pos : C.neg, border: `1px solid ${status.type === "ok" ? C.pos + "33" : C.neg + "33"}` }}>
          {status.type === "ok" ? "✓ " : "✗ "}{status.msg}
        </div>
      )}
      <div style={{ ...ui, fontSize: 10, color: C.t3, lineHeight: 1.6 }}>
        <strong style={{ color: C.t2 }}>Template format:</strong> Row 1 = headers (Parameter, Jan, Feb, ... Dec). Rows 2–6 = Peak Demand (MW), DAM MCP, GDAM MCP, Bilateral Rate, Banking Rate. Partial uploads accepted — only matched rows are updated.
      </div>
      {/* Preview current values */}
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 2, maxHeight: 200 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...lbl, fontSize: 9, fontWeight: 700, color: C.t2, padding: "5px 6px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: "left", position: "sticky", left: 0, zIndex: 2, minWidth: 100 }}>PARAMETER</th>
            {moNames.map((m, i) => <th key={i} style={{ ...lbl, fontSize: 9, fontWeight: 700, color: C.t2, padding: "5px 4px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: "right", minWidth: 40 }}>{m}</th>)}
          </tr></thead>
          <tbody>
            {UPLOAD_ROWS.map((r, ri) => (
              <tr key={r.key} style={{ background: ri % 2 === 0 ? C.elev : C.elev + "99" }}>
                <td style={{ ...ui, fontSize: 10, padding: "3px 6px", borderBottom: `1px solid ${C.brd}15`, color: r.key === "demand" ? C.warn : r.key === "damMCP" ? C.dam : r.key === "gdamMCP" ? C.gdam : r.key === "bilatRate" ? C.bilat : C.bank, fontWeight: 500, position: "sticky", left: 0, background: ri % 2 === 0 ? C.elev : C.overlay, zIndex: 1 }}>{r.label}</td>
                {moNames.map((_, i) => {
                  const ci = months[i].cal;
                  const v = r.key === "demand" ? demand[ci] : (mkt[r.key]?.[ci] ?? 0);
                  return <td key={i} style={{ ...mono, fontSize: 10, padding: "3px 4px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: C.t1 }}>{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  SCENARIO EDITOR
// ══════════════════════════════════════════════════════════════
function ScenarioEditor({ scenarios, setScenarios }) {
  const update = (id, key, val) => setScenarios(prev => prev.map(s => s.id === id ? { ...s, [key]: val } : s));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        {scenarios.map(s => (
          <div key={s.id} style={{ background: C.elev, border: `1px solid ${s.active ? s.color : C.brd}`, borderRadius: 6, padding: 12, borderLeft: `4px solid ${s.color}`, opacity: s.active ? 1 : 0.65 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={s.active} onChange={e => update(s.id, "active", e.target.checked)} style={{ cursor: "pointer" }} />
              <span style={{ ...ui, fontSize: 12, fontWeight: 600, color: s.color }}>{s.name}</span>
            </div>
            {[
              { key: "demMult", label: "Demand x" },
              { key: "reMult", label: "RE Gen x" },
              { key: "priceMult", label: "Price x" },
              { key: "fuelMult", label: "Fuel Cost x" },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ ...ui, fontSize: 10, color: C.t2 }}>{f.label}</span>
                <EditCell value={s[f.key]} onChange={v => update(s.id, f.key, v)} type="number" min={0.1} max={3.0} width={45} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  96-BLOCK GRID
// ══════════════════════════════════════════════════════════════
function BlockGrid({ data, plants, resolution }) {
  const ref = useRef(null);
  const [sp, setSP] = useState(0);
  const [exp, setExp] = useState(new Set());
  const is15 = resolution === "15min";

  const cols = useMemo(() => {
    if (is15) return TB.map(t => ({ ...t, w: 52, k: `t${t.i}` }));
    const c = [];
    for (let h = 0; h < 24; h++) {
      if (exp.has(h)) { for (let q = 0; q < 4; q++) { const i = h * 4 + q; c.push({ i, lbl: TB[i].lbl, h, w: 52, k: `t${i}`, ex: true }); } }
      else c.push({ i: h, lbl: `${String(h).padStart(2, "0")}:00`, h, w: 74, k: `h${h}`, grp: true });
    }
    return c;
  }, [is15, exp]);

  const totalW = safeSum(cols, "w");
  const toggleH = useCallback(h => setExp(p => { const n = new Set(p); n.has(h) ? n.delete(h) : n.add(h); return n; }), []);

  const getVal = useCallback((col, block96, key) => {
    if (col.grp) {
      const s = [0, 1, 2, 3].map(q => block96[col.h * 4 + q]).filter(Boolean);
      return Math.round(safeMean(s, key));
    }
    const b = block96[col.i];
    return b ? (b[key] || 0) : 0;
  }, []);
  const getSrcMW = useCallback((col, block96, pid) => {
    if (col.grp) {
      const s = [0, 1, 2, 3].map(q => block96[col.h * 4 + q]).filter(Boolean);
      return Math.round(safeMean(s, b => b.src && b.src[pid] ? b.src[pid].mw : 0));
    }
    const b = block96[col.i];
    return b && b.src && b.src[pid] ? b.src[pid].mw : 0;
  }, []);
  const getSrcSt = useCallback((col, block96, pid) => {
    const idx = col.grp ? col.h * 4 : col.i;
    const b = block96[idx];
    return b && b.src && b.src[pid] ? b.src[pid].st : "OFF";
  }, []);

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 2, overflow: "hidden", background: C.panel }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: C.overlay, borderBottom: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.focus}` }}>
        <span style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2 }}>96-BLOCK DISPATCH MATRIX</span>
        <span style={{ ...mono, fontSize: 10, color: C.t3, marginLeft: "auto" }}>{is15 ? "96 x 15min" : "24H GROUPED"} | {cols.length} cols</span>
      </div>
      <div style={{ display: "flex" }}>
        <div style={{ minWidth: 135, flexShrink: 0, borderRight: `2px solid ${C.brd}`, zIndex: 2, background: C.panel }}>
          <div style={{ height: 24, display: "flex", alignItems: "center", padding: "0 8px", background: C.overlay, borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2 }}>UNIT / SOURCE</span>
          </div>
          <div style={{ height: 24, display: "flex", alignItems: "center", padding: "0 8px", background: C.warn + "08", borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.warn }}>DEMAND</span>
          </div>
          {plants.map(p => (
            <div key={p.id} style={{ height: 24, display: "flex", alignItems: "center", padding: "0 6px", gap: 4, borderBottom: `1px solid ${C.brd}10` }}>
              <span style={{ width: 6, height: 6, borderRadius: 1, background: FC[p.type] || C.t3, flexShrink: 0 }} />
              <span style={{ ...ui, fontSize: 10, color: C.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{p.name}</span>
            </div>
          ))}
          {[{ l: "STOA", c: C.bilat }, { l: "GDAM", c: C.gdam }, { l: "DAM", c: C.dam }, { l: "RTM", c: C.rtm }, { l: "CURTAIL", c: C.curtail }].map(r => (
            <div key={r.l} style={{ height: 24, display: "flex", alignItems: "center", padding: "0 6px", background: r.c + "08", borderBottom: `1px solid ${C.brd}` }}>
              <span style={{ ...lbl, fontSize: 10, fontWeight: 700, color: r.c }}>{r.l}</span>
            </div>
          ))}
        </div>

        <div ref={ref} onScroll={() => ref.current && setSP(ref.current.scrollLeft)} style={{ overflowX: "auto", overflowY: "hidden", flex: 1 }}>
          <div style={{ minWidth: totalW }}>
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => {
                const pk = c.grp ? (c.h >= 8 && c.h < 17) : (c.i >= PK0 && c.i <= PK1);
                return <div key={c.k} onClick={() => !is15 && c.grp && toggleH(c.h)} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: pk ? C.peak : C.overlay, borderRight: `1px solid ${C.brd}12`, cursor: c.grp ? "pointer" : "default" }}>
                  <span style={{ ...mono, fontSize: 10, color: pk ? C.warn : C.t2, fontWeight: c.grp ? 600 : 400 }}>{c.lbl}</span>
                  {c.grp && <span style={{ fontSize: 8, color: C.t3, marginLeft: 1 }}>&#9662;</span>}
                </div>;
              })}
            </div>
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.warn + "05", borderRight: `1px solid ${C.brd}06` }}><span style={{ ...mono, fontSize: 10, color: C.warn, fontWeight: 700 }}>{getVal(c, data, "dem")}</span></div>)}
            </div>
            {plants.map(p => (
              <div key={p.id} style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}06` }}>
                {cols.map(c => {
                  const mw = getSrcMW(c, data, p.id);
                  const st = getSrcSt(c, data, p.id);
                  const isDec = ["COMMITTED", "DISCHARGE", "MUST-RUN", "STARTING"].includes(st) && mw > 0;
                  const isCh = st === "CHARGING";
                  const isMin = st === "MIN-LOAD";
                  return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDec ? C.dec + "06" : isCh ? C.info + "08" : isMin ? C.warn + "08" : "transparent", borderRight: `1px solid ${C.brd}04` }}>
                    <span style={{ ...mono, fontSize: 10, color: mw === 0 ? C.t3 + "44" : isCh ? C.info : isMin ? C.warn : C.val, fontWeight: mw > 0 ? 600 : 400 }}>{mw === 0 ? "." : mw}</span>
                  </div>;
                })}
              </div>
            ))}
            {/* STOA */}
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => { const v = getVal(c, data, "stoaBuy"); return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: v > 0 ? C.bilat + "08" : "transparent", borderRight: `1px solid ${C.brd}05` }}><span style={{ ...mono, fontSize: 10, color: v > 0 ? C.bilat : C.t3 + "44", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "."}</span></div>; })}
            </div>
            {/* GDAM */}
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => { const v = getVal(c, data, "mktGDAM"); return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: v > 0 ? C.gdam + "08" : "transparent", borderRight: `1px solid ${C.brd}05` }}><span style={{ ...mono, fontSize: 10, color: v > 0 ? C.gdam : C.t3 + "44", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "."}</span></div>; })}
            </div>
            {/* DAM */}
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => { const v = getVal(c, data, "mktDAM"); return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: v > 0 ? C.dam + "08" : "transparent", borderRight: `1px solid ${C.brd}05` }}><span style={{ ...mono, fontSize: 10, color: v > 0 ? C.dam : C.t3 + "44", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "."}</span></div>; })}
            </div>
            {/* RTM */}
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => { const v = getVal(c, data, "mktRTM"); return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: v > 0 ? C.rtm + "08" : "transparent", borderRight: `1px solid ${C.brd}05` }}><span style={{ ...mono, fontSize: 10, color: v > 0 ? C.rtm : C.t3 + "44", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "."}</span></div>; })}
            </div>
            {/* Curtailment */}
            <div style={{ display: "flex", height: 24, borderBottom: `1px solid ${C.brd}` }}>
              {cols.map(c => { const v = getVal(c, data, "curtailment"); return <div key={c.k} style={{ width: c.w, minWidth: c.w, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: v > 0 ? C.curtail + "12" : "transparent", borderRight: `1px solid ${C.brd}05` }}><span style={{ ...mono, fontSize: 10, color: v > 0 ? C.curtail : C.t3 + "44", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "."}</span></div>; })}
            </div>
          </div>
          <Minimap total={totalW} offset={sp} onSeek={p => { if (ref.current) { ref.current.scrollLeft = p * totalW; setSP(p * totalW); } }} />
        </div>

        <div style={{ minWidth: 52, flexShrink: 0, borderLeft: `2px solid ${C.brd}`, zIndex: 2, background: C.panel }}>
          <div style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: C.overlay, borderBottom: `1px solid ${C.brd}` }}><span style={{ ...mono, fontSize: 10, color: C.t2, fontWeight: 600 }}>AVG</span></div>
          <div style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: C.warn + "08", borderBottom: `1px solid ${C.brd}` }}><span style={{ ...mono, fontSize: 10, color: C.warn, fontWeight: 700 }}>{Math.round(safeMean(data, "dem"))}</span></div>
          {plants.map(p => {
            const avg = Math.round(safeMean(data, b => b.src && b.src[p.id] ? b.src[p.id].mw : 0));
            return <div key={p.id} style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${C.brd}06` }}><span style={{ ...mono, fontSize: 10, color: avg > 0 ? C.t1 : C.t3 }}>{avg}</span></div>;
          })}
          {[{ k: "stoaBuy", c: C.bilat }, { k: "mktGDAM", c: C.gdam }, { k: "mktDAM", c: C.dam }, { k: "mktRTM", c: C.rtm }, { k: "curtailment", c: C.curtail }].map(r => (
            <div key={r.k} style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: r.c + "08", borderBottom: `1px solid ${C.brd}` }}><span style={{ ...mono, fontSize: 10, color: r.c, fontWeight: 700 }}>{Math.round(safeMean(data, r.k))}</span></div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "3px 8px", background: C.overlay, borderTop: `1px solid ${C.brd}`, flexWrap: "wrap" }}>
        <span style={{ ...ui, fontSize: 10, color: C.t2 }}><span style={{ display: "inline-block", width: 8, height: 8, background: C.peak, border: `1px solid ${C.warn}33`, borderRadius: 1, marginRight: 2, verticalAlign: "middle" }} />Peak</span>
        <span style={{ ...lbl, fontSize: 10, color: C.warn }}>MIN-LOAD</span>
        <span style={{ ...lbl, fontSize: 10, color: C.curtail }}>CURTAIL</span>
        {Object.entries(FC).map(([k, v]) => <span key={k} style={{ ...ui, fontSize: 10, color: C.t2 }}><span style={{ display: "inline-block", width: 6, height: 6, background: v, borderRadius: 1, marginRight: 2, verticalAlign: "middle" }} />{k}</span>)}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  CHART COMPONENTS
// ══════════════════════════════════════════════════════════════
function StackChart({ data, plants, res }) {
  const { cd, segs } = useMemo(() => {
    if (!data || !data.length) return { cd: [], segs: [] };
    const src = res === "15min" ? data : aggHourly(data);
    const segSet = new Set();
    const rows = src.map((b, i) => {
      const row = { lbl: res === "15min" ? (TB[i] ? TB[i].lbl : i) : `${String(b.h != null ? b.h : i).padStart(2, "0")}:00`, Demand: b.dem || 0 };
      // Group plant output by type
      const byType = {};
      if (b.src) Object.values(b.src).forEach(s => { if (s.mw > 0) byType[s.tp] = (byType[s.tp] || 0) + s.mw; });
      SEG_ORDER.forEach(seg => {
        let val = 0;
        if (seg === "FDRE") val = b.fdreMW || 0;
        else if (seg === "STOA") val = b.stoaBuy || 0;
        else if (seg === "DAM") val = b.mktDAM || 0;
        else if (seg === "GDAM") val = b.mktGDAM || 0;
        else if (seg === "RTM") val = b.mktRTM || 0;
        else val = byType[seg] || 0;
        if (val > 0) { row[seg] = Math.round(val); segSet.add(seg); }
      });
      return row;
    });
    return { cd: rows, segs: SEG_ORDER.filter(s => segSet.has(s)) };
  }, [data, plants, res]);
  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={cd} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="lbl" tick={{ fill: C.t2, fontSize: 10 }} interval={res === "15min" ? 7 : 2} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} label={{ value: "MW", angle: -90, position: "insideLeft", fill: C.t2, fontSize: 11 }} />
          <Tooltip contentStyle={ttStyle} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
          {segs.map(seg => <Bar key={seg} dataKey={seg} stackId="s" fill={SEG_CLR[seg] || C.t3} fillOpacity={0.9} />)}
          <Line type="monotone" dataKey="Demand" stroke="#1565C0" strokeWidth={2.5} dot={false} name="Demand" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AggView({ all, res }) {
  const { d, segs } = useMemo(() => {
    const segSet = new Set();
    const buildRow = (lbl, agg) => {
      const row = { lbl, Demand: +agg.demMU };
      // Break own gen by type
      const byType = {};
      Object.values(agg.srcE).forEach(s => { if (s.mu > 0) byType[s.tp] = (byType[s.tp] || 0) + s.mu; });
      SEG_ORDER.forEach(seg => {
        let val = 0;
        if (seg === "FDRE") val = +(agg.fdreMU || 0);
        else if (seg === "STOA") val = +(agg.stoaBuyMU || 0);
        else if (seg === "DAM") val = +(agg.mktDAM_MU || 0);
        else if (seg === "GDAM") val = +(agg.mktGDAM_MU || 0);
        else if (seg === "RTM") val = +(agg.mktRTM_MU || 0);
        else val = byType[seg] || 0;
        if (val > 0) { row[seg] = +val.toFixed(1); segSet.add(seg); }
      });
      // Total supply for label
      row._total = Math.round(SEG_ORDER.reduce((s, seg) => s + (row[seg] || 0), 0));
      return row;
    };
    let rows;
    if (res === "monthly") {
      rows = all.map(r => buildRow(r.mo, r.agg));
    } else {
      rows = [];
      all.forEach(r => {
        const d1 = Math.ceil(r.days / 2), d2 = r.days - d1;
        rows.push(buildRow(`${r.mo} 1-${d1}`, aggMonthly(r.b96, d1)));
        rows.push(buildRow(`${r.mo} ${d1 + 1}-${r.days}`, aggMonthly(r.b96, d2)));
      });
    }
    return { d: rows, segs: SEG_ORDER.filter(s => segSet.has(s)) };
  }, [all, res]);
  const isFN = res === "fortnightly";
  // Custom label to show total on top of stacked bars
  const renderTotal = (props) => {
    const { x, y, width, index } = props;
    const total = d[index]?._total;
    if (!total) return null;
    return <text x={x + width / 2} y={y - 6} fill={C.t1} fontSize={isFN ? 7 : 9} fontFamily="JetBrains Mono,monospace" textAnchor="middle" fontWeight={600}>{total}</text>;
  };
  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={d} margin={{ top: 22, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="lbl" tick={{ fill: C.t2, fontSize: isFN ? 9 : 10 }} angle={isFN ? -45 : 0} textAnchor={isFN ? "end" : "middle"} height={isFN ? 55 : 30} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} label={{ value: "MU", angle: -90, position: "insideLeft", fill: C.t2, fontSize: 10 }} />
          <Tooltip contentStyle={ttStyle} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
          {segs.map((seg, si) => <Bar key={seg} dataKey={seg} stackId="s" fill={SEG_CLR[seg] || C.t3} fillOpacity={0.9} radius={si === segs.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}>{si === segs.length - 1 && <LabelList content={renderTotal} />}</Bar>)}
          <Line type="monotone" dataKey="Demand" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3, fill: "#1565C0", stroke: C.t1, strokeWidth: 1 }} name="Demand" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  DAILY VIEW — per-day dispatch for current month (today+1 → month-end)
// ══════════════════════════════════════════════════════════════
function DailyView({ dailyData, moName }) {
  const { rows, segs } = useMemo(() => {
    const segSet = new Set();
    const built = dailyData.map(dd => {
      const row = { lbl: dd.lbl, day: dd.day, dow: dd.dow, Demand: +dd.agg.demMU };
      const byType = {};
      Object.values(dd.agg.srcE).forEach(s => { if (s.mu > 0) byType[s.tp] = (byType[s.tp] || 0) + s.mu; });
      SEG_ORDER.forEach(seg => {
        let val = 0;
        if (seg === "FDRE") val = +(dd.agg.fdreMU || 0);
        else if (seg === "STOA") val = +(dd.agg.stoaBuyMU || 0);
        else if (seg === "DAM") val = +(dd.agg.mktDAM_MU || 0);
        else if (seg === "GDAM") val = +(dd.agg.mktGDAM_MU || 0);
        else if (seg === "RTM") val = +(dd.agg.mktRTM_MU || 0);
        else val = byType[seg] || 0;
        if (val > 0) { row[seg] = +val.toFixed(2); segSet.add(seg); }
      });
      row._total = +SEG_ORDER.reduce((s, seg) => s + (row[seg] || 0), 0).toFixed(2);
      row.costCr = dd.agg.costCr;
      row.avgCost = dd.agg.avgCost;
      row.defMU = dd.agg.defMU;
      row.surMU = dd.agg.surMU;
      return row;
    });
    return { rows: built, segs: SEG_ORDER.filter(s => segSet.has(s)) };
  }, [dailyData]);

  const renderTotal = (props) => {
    const { x, y, width, index } = props;
    const t = rows[index]?._total;
    return t ? <text x={x + width / 2} y={y - 5} fill={C.t1} fontSize={8} fontFamily="JetBrains Mono,monospace" textAnchor="middle" fontWeight={600}>{t.toFixed(1)}</text> : null;
  };

  if (!rows.length) return <div style={{ ...ui, fontSize: 12, color: C.t3, padding: 20, textAlign: "center" }}>No remaining days in {moName}. Select a future or current month.</div>;

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} margin={{ top: 22, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="lbl" tick={{ fill: C.t2, fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} label={{ value: "MU", angle: -90, position: "insideLeft", fill: C.t2, fontSize: 10 }} />
          <Tooltip contentStyle={ttStyle} formatter={(v, name) => [typeof v === "number" ? v.toFixed(2) : v, name]} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
          {segs.map((seg, si) => <Bar key={seg} dataKey={seg} stackId="s" fill={SEG_CLR[seg] || C.t3} fillOpacity={0.9} radius={si === segs.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}>{si === segs.length - 1 && <LabelList content={renderTotal} />}</Bar>)}
          <Line type="monotone" dataKey="Demand" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3, fill: "#1565C0", stroke: C.t1, strokeWidth: 1 }} name="Demand" />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Daily summary table */}
      <div style={{ overflow: "auto", marginTop: 8, border: `1px solid ${C.brd}`, borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["Day", "DoW", "Demand", "Supply", "Deficit", "Surplus", "Cost Cr", "Rs/kWh"].map((h, i) => (
              <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "6px 6px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 1 ? "right" : "left", position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{rows.map((r, ri) => (
            <tr key={ri} style={{ background: r.dow === "Sat" || r.dow === "Sun" ? C.overlay + "88" : ri % 2 === 0 ? C.elev : C.elev + "99" }}>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, color: C.t1 }}>{r.lbl}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, color: r.dow === "Sat" || r.dow === "Sun" ? C.warn : C.t2 }}>{r.dow}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: C.warn }}>{r.Demand.toFixed(2)}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: C.pos }}>{r._total.toFixed(2)}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: r.defMU > 0 ? C.neg : C.t3 }}>{r.defMU}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: r.surMU > 0 ? C.pos : C.t3 }}>{r.surMU}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: C.neg }}>{r.costCr}</td>
              <td style={{ ...mono, fontSize: 10, padding: "4px 6px", borderBottom: `1px solid ${C.brd}15`, textAlign: "right", color: C.thermal }}>{r.avgCost}</td>
            </tr>
          ))}</tbody>
          {rows.length > 1 && <tfoot><tr style={{ background: C.overlay }}>
            <td colSpan={2} style={{ ...lbl, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, color: C.t1 }}>TOTAL ({rows.length}d)</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", fontWeight: 700, color: C.warn }}>{rows.reduce((s, r) => s + r.Demand, 0).toFixed(1)}</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", fontWeight: 700, color: C.pos }}>{rows.reduce((s, r) => s + r._total, 0).toFixed(1)}</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", color: C.neg }}>{rows.reduce((s, r) => s + +r.defMU, 0).toFixed(1)}</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", color: C.pos }}>{rows.reduce((s, r) => s + +r.surMU, 0).toFixed(1)}</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", fontWeight: 700, color: C.neg }}>{rows.reduce((s, r) => s + +r.costCr, 0).toFixed(2)}</td>
            <td style={{ ...mono, fontSize: 10, padding: "6px 6px", borderTop: `2px solid ${C.brd}`, textAlign: "right", color: C.thermal }}>
              {(() => { const tC = rows.reduce((s, r) => s + +r.costCr, 0); const tE = rows.reduce((s, r) => s + r.Demand, 0); return tE > 0 ? (tC * 100 / (tE * 10)).toFixed(2) : "0.00"; })()}
            </td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

function MeritTable({ data, plants, days }) {
  const rows = useMemo(() => {
    if (!data || !data.length) return [];
    return plants.map(p => {
      const avg = Math.round(safeMean(data, b => Math.max(0, b.src && b.src[p.id] ? b.src[p.id].mw : 0)));
      const mu = +(avg * 24 * days / 1000).toFixed(1);
      const statCounts = {};
      data.forEach(b => { const s = b.src && b.src[p.id] ? b.src[p.id].st : "OFF"; statCounts[s] = (statCounts[s] || 0) + 1; });
      const st = Object.entries(statCounts).sort((a, b) => b[1] - a[1])[0][0];
      const ecr = data[0]?.src?.[p.id]?.ecr || p.ecr || 0;
      const varCost = +(mu * ecr * 10).toFixed(1);
      const fixedCost = +((p.fixedCost || 0) * p.pMax / 100000).toFixed(1); // ₹ Cr/month
      return { ...p, avg, mu, st, ecr, varCost, fixedCost, totalCost: +(varCost + fixedCost * 100).toFixed(1), plf: p.pMax > 0 ? +((avg / p.pMax) * 100).toFixed(0) : 0, fuel: p.fuel || "none" };
    }).sort((a, b) => a.ecr - b.ecr);
  }, [data, plants, days]);

  return (
    <div style={{ overflow: "auto", borderRadius: 2 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          {["Plant", "Type", "Fuel", "ECR", "PMax", "Avg MW", "MU", "PLF%", "Status", "Var ₹L", "Fix ₹Cr"].map((h, i) => (
            <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "5px 5px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 2 ? "right" : "left" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? C.panel : C.elev }}>
            <td style={{ ...ui, fontSize: 11, padding: "3px 5px", borderBottom: `1px solid ${C.brd}08`, fontWeight: 500 }}>{r.name}</td>
            <td style={{ ...ui, fontSize: 9, padding: "3px 5px", borderBottom: `1px solid ${C.brd}08`, color: FC[r.type] }}>{r.type}</td>
            <td style={{ ...ui, fontSize: 10, padding: "3px 5px", borderBottom: `1px solid ${C.brd}08`, color: FUEL_CLR[r.fuel] || C.t3 }}>{r.fuel === "none" ? "-" : r.fuel.replace("_", " ")}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08`, background: r.ecr < 2.5 ? C.pos + "18" : r.ecr < 4 ? C.warn + "12" : C.neg + "12" }}>{r.ecr.toFixed(2)}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08` }}>{r.pMax}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08`, color: r.avg > 0 ? C.val : C.t3 }}>{r.avg}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08` }}>{r.mu}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08`, color: C.t2 }}>{r.plf}%</td>
            <td style={{ ...lbl, fontSize: 10, padding: "3px 5px", borderBottom: `1px solid ${C.brd}08`, color: r.st === "MUST-RUN" ? C.solar : r.st === "COMMITTED" ? C.pos : r.st === "DISCHARGE" ? C.info : r.st === "MIN-LOAD" ? C.warn : r.st === "STARTING" ? C.dec : C.t3 }}>{r.st}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08` }}>{r.varCost}</td>
            <td style={{ ...mono, fontSize: 11, padding: "3px 5px", textAlign: "right", borderBottom: `1px solid ${C.brd}08`, color: r.fixedCost > 0 ? C.warn : C.t3 }}>{r.fixedCost}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PriceChart({ data, res }) {
  const cd = useMemo(() => {
    if (!data || !data.length) return [];
    const src = res === "15min" ? data : aggHourly(data);
    return src.map((b, i) => {
      const dispatched = b.src ? Object.values(b.src).filter(s => s.mw > 0 && s.ecr > 0) : [];
      const margCost = dispatched.length > 0 ? Math.max(...dispatched.map(s => s.ecr)) : 0;
      return { lbl: res === "15min" ? (TB[i] ? TB[i].lbl : i) : `${String(b.h != null ? b.h : i).padStart(2, "0")}:00`, dam: b.damRate || 0, rtm: b.rtmRate || 0, gdam: b.gdamRate || 0, marginal: margCost };
    });
  }, [data, res]);
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={cd} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="lbl" tick={{ fill: C.t2, fontSize: 10 }} interval={res === "15min" ? 7 : 1} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} orientation="right" />
          <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="dam" stroke={C.dam} strokeWidth={2} dot={false} name="DAM MCP" />
          <Line type="monotone" dataKey="gdam" stroke={C.gdam} strokeWidth={1.5} dot={false} name="GDAM" />
          <Line type="monotone" dataKey="rtm" stroke={C.rtm} strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="RTM" />
          <Line type="monotone" dataKey="marginal" stroke={C.thermal} strokeWidth={2} dot={false} name="Marginal Cost" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SoCChart({ data, plants, res }) {
  const storages = plants.filter(p => p.type === "BESS" || p.type === "PSP");
  if (!storages.length) return null;
  const cd = useMemo(() => {
    if (!data || !data.length) return [];
    const src = res === "15min" ? data : aggHourly(data);
    return src.map((b, i) => {
      const row = { lbl: res === "15min" ? (TB[i] ? TB[i].lbl : i) : `${String(b.h != null ? b.h : i).padStart(2, "0")}:00` };
      storages.forEach(p => { row[p.name] = b.soc && b.soc[p.id] ? +b.soc[p.id].toFixed(1) : 50; });
      return row;
    });
  }, [data, storages, res]);
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={cd} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="lbl" tick={{ fill: C.t2, fontSize: 10 }} interval={res === "15min" ? 11 : 1} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} domain={[0, 100]} />
          <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />
          {storages.map(p => <Area key={p.id} type="monotone" dataKey={p.name} fill={(FC[p.type] || C.t3) + "33"} stroke={FC[p.type] || C.t3} strokeWidth={2} />)}
          <ReferenceLine y={10} stroke={C.neg + "55"} strokeDasharray="4 4" />
          <ReferenceLine y={90} stroke={C.pos + "55"} strokeDasharray="4 4" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  PRICE DURATION CURVE
// ══════════════════════════════════════════════════════════════
function PriceDurationCurve({ data }) {
  const cd = useMemo(() => {
    if (!data || !data.length) return [];
    const prices = data.map(b => b.margCost || 0).sort((a, b) => b - a);
    return prices.map((p, i) => ({ pct: +((i / prices.length) * 100).toFixed(1), price: +p.toFixed(2) }));
  }, [data]);
  if (!cd.length) return null;
  const p25 = cd[Math.floor(cd.length * 0.25)]?.price || 0;
  const p50 = cd[Math.floor(cd.length * 0.50)]?.price || 0;
  const p75 = cd[Math.floor(cd.length * 0.75)]?.price || 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ ...mono, fontSize: 10, color: C.t3 }}>P25=<span style={{ color: C.val }}>{p25}</span> | P50=<span style={{ color: C.val }}>{p50}</span> | P75=<span style={{ color: C.val }}>{p75}</span></span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={cd} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="pct" tick={{ fill: C.t2, fontSize: 10 }} label={{ value: "% Time", position: "bottom", fill: C.t3, fontSize: 10 }} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} orientation="right" />
          <Tooltip contentStyle={ttStyle} />
          <Area type="monotone" dataKey="price" fill={C.thermal + "33"} stroke={C.thermal} strokeWidth={2} name="Marginal Cost" />
          <ReferenceLine y={p50} stroke={C.focus + "66"} strokeDasharray="4 4" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  SCENARIO COMPARISON CHART
// ══════════════════════════════════════════════════════════════
function ScenarioCompare({ scenarioResults }) {
  if (!scenarioResults || scenarioResults.length < 2) return null;
  const data = scenarioResults.map(s => ({
    name: s.name,
    cost: s.costCr,
    demand: s.demMU,
    avgCost: s.avgCost,
    curtail: s.curtailMU,
    market: s.mktMU,
  }));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${scenarioResults.length}, 1fr)`, gap: 8, marginBottom: 12 }}>
        {scenarioResults.map(s => (
          <div key={s.id} style={{ background: C.overlay, borderRadius: 2, padding: 10, borderLeft: `3px solid ${s.color}` }}>
            <div style={{ ...ui, fontSize: 11, fontWeight: 600, color: s.color, marginBottom: 6 }}>{s.name}</div>
            <div style={{ ...mono, fontSize: 10, color: C.t2, lineHeight: 1.8 }}>
              <div>Demand: <span style={{ color: C.val }}>{s.demMU}</span> MU</div>
              <div>Cost: <span style={{ color: C.neg }}>{s.costCr}</span> Cr</div>
              <div>Avg: <span style={{ color: C.warn }}>{s.avgCost}</span> Rs/kWh</div>
              <div>Market: <span style={{ color: C.dam }}>{s.mktMU}</span> MU</div>
              <div>Curtail: <span style={{ color: s.curtailMU > 0 ? C.curtail : C.pos }}>{s.curtailMU}</span> MU</div>
            </div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fill: C.t2, fontSize: 10 }} />
          <YAxis tick={{ fill: C.t2, fontSize: 10 }} />
          <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="cost" fill={C.neg + "aa"} name="Cost (Cr)" radius={[2,2,0,0]} />
          <Bar dataKey="market" fill={C.dam + "88"} name="Market (MU)" radius={[2,2,0,0]} />
          <Bar dataKey="curtail" fill={C.curtail + "88"} name="Curtail (MU)" radius={[2,2,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  FDRE, RPO, STOA EDITORS (compact versions)
// ══════════════════════════════════════════════════════════════
function FDREEditor({ fdre, setFdre, moNames, months }) {
  const update = (id, key, val) => setFdre(prev => prev.map(f => f.id === id ? { ...f, [key]: val } : f));
  const toggleMo = (id, mi) => { const ci = months[mi].cal; setFdre(prev => prev.map(f => { if (f.id !== id) return f; const m = [...f.months]; m[ci] = m[ci] ? 0 : 1; return { ...f, months: m }; })); };
  const addFDRE = () => {
    const id = Math.max(0, ...fdre.map(f => f.id)) + 1;
    setFdre(prev => [...prev, { id, name: `FDRE ${id}`, developer: "", capacity: 100, tariff: 4.50, profile: "RTC", guaranteedCUF: 55, penaltyRate: 1.50, storageMWh: 200, reTech: "Solar+BESS", months: Array(12).fill(1), status: "DRAFT", deliveryStart: 0, deliveryEnd: 24 }]);
  };
  const del = (id) => setFdre(prev => prev.filter(f => f.id !== id));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button onClick={addFDRE} style={{ ...lbl, fontSize: 10, padding: "3px 10px", background: C.psp + "15", color: C.psp, border: `1px solid ${C.psp}33`, borderRadius: 2, cursor: "pointer" }}>+ ADD</button>
        <span style={{ ...mono, fontSize: 10, color: C.t3, marginLeft: "auto" }}>{fdre.filter(f => f.status === "ACTIVE").length} active | {safeSum(fdre.filter(f => f.status === "ACTIVE"), "capacity")} MW</span>
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["", "Name", "Developer", "MW", "Tariff", "Profile", "CUF%", "Tech", "Months", "Status"].map((h, i) => (
              <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "6px 5px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 2 && i < 7 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{fdre.length === 0 ? <tr><td colSpan={10} style={{ ...ui, fontSize: 12, color: C.t3, padding: 12, textAlign: "center" }}>No FDRE contracts.</td></tr> : fdre.map(f => (
            <tr key={f.id} style={{ background: f.status === "DRAFT" ? C.warn + "08" : "transparent" }}>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}><button onClick={() => del(f.id)} style={{ background: "none", border: "none", color: C.neg, cursor: "pointer", fontSize: 11 }}>x</button></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={f.name} onChange={v => update(f.id, "name", v)} type="text" width={90} /></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={f.developer} onChange={v => update(f.id, "developer", v)} type="text" width={70} /></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={f.capacity} onChange={v => update(f.id, "capacity", v)} type="number" min={0} width={40} /></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={f.tariff} onChange={v => update(f.id, "tariff", v)} type="number" min={0} width={40} /></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <select value={f.profile} onChange={e => update(f.id, "profile", e.target.value)} style={{ ...ui, fontSize: 9, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer", minWidth: 42 }}>
                    <option value="RTC">RTC</option><option value="PEAK">PEAK</option><option value="CUSTOM">Custom</option>
                  </select>
                  {f.profile === "CUSTOM" && (
                    <span style={{ display: "flex", alignItems: "center", gap: 1, ...mono, fontSize: 9 }}>
                      <EditCell value={f.deliveryStart || 0} onChange={v => update(f.id, "deliveryStart", v)} type="number" min={0} max={23} width={22} />
                      <span style={{ color: C.t3 }}>–</span>
                      <EditCell value={f.deliveryEnd || 24} onChange={v => update(f.id, "deliveryEnd", v)} type="number" min={1} max={24} width={22} />
                    </span>
                  )}
                </div>
              </td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={f.guaranteedCUF} onChange={v => update(f.id, "guaranteedCUF", v)} type="number" min={0} max={100} width={30} /></td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}>
                <select value={f.reTech} onChange={e => update(f.id, "reTech", e.target.value)} style={{ ...ui, fontSize: 9, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer" }}>
                  {["Solar+BESS", "Wind+BESS", "Hybrid+BESS"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}>
                <div style={{ display: "flex", gap: 1 }}>{(moNames || MO).map((m, i) => { const ci = months[i].cal; return <button key={i} onClick={() => toggleMo(f.id, i)} style={{ ...mono, fontSize: 9, width: 22, height: 18, border: "none", borderRadius: 2, cursor: "pointer", background: f.months[ci] ? C.pos + "33" : C.brd + "88", color: f.months[ci] ? C.pos : C.t2, fontWeight: f.months[ci] ? 700 : 400 }}>{m[0]}</button>; })}</div>
              </td>
              <td style={{ padding: "4px 5px", borderBottom: `1px solid ${C.brd}12` }}>
                <select value={f.status} onChange={e => update(f.id, "status", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: f.status === "ACTIVE" ? C.pos : C.warn, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="ACTIVE">ACTIVE</option><option value="DRAFT">DRAFT</option></select>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function RPOEditor({ rpo, setRpo }) {
  const up = (key, v) => setRpo(prev => ({ ...prev, [key]: v }));
  const fields = [
    { key: "solarPct", label: "Solar RPO %", color: C.solar },
    { key: "nonSolarPct", label: "Non-Solar RPO %", color: C.wind },
    { key: "hydroPct", label: "Hydro RPO %", color: C.hydro },
    { key: "esoPct", label: "ESO (Storage) %", color: C.bess },
    { key: "recPriceSolar", label: "REC Solar Rs/MWh", color: C.solar },
    { key: "recPriceNonSolar", label: "REC Non-Sol Rs/MWh", color: C.wind },
    { key: "recPriceHydro", label: "REC Hydro Rs/MWh", color: C.hydro },
  ];
  return (
    <div>
      <div style={{ ...mono, fontSize: 10, color: C.t3, marginBottom: 6 }}>{rpo.year}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {fields.map(f => (
          <div key={f.key} style={{ background: C.elev, border: `1px solid ${C.brd}`, borderRadius: 5, padding: "6px 10px", minWidth: 120, borderLeft: `3px solid ${f.color}` }}>
            <div style={{ ...ui, fontSize: 10, color: C.t2, textTransform: "uppercase", marginBottom: 4 }}>{f.label}</div>
            <EditCell value={rpo[f.key]} onChange={v => up(f.key, v)} type="number" min={0} width={55} />
          </div>
        ))}
        <div style={{ background: C.elev, border: `1px solid ${C.brd}`, borderRadius: 5, padding: "6px 10px", minWidth: 120, borderLeft: `3px solid ${C.pos}` }}>
          <div style={{ ...ui, fontSize: 10, color: C.t2, textTransform: "uppercase", marginBottom: 4 }}>TOTAL RPO %</div>
          <span style={{ ...mono, fontSize: 16, fontWeight: 700, color: C.pos }}>{(rpo.solarPct + rpo.nonSolarPct + rpo.hydroPct + rpo.esoPct).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function RPODashboard({ rpoData, rpo }) {
  if (!rpoData || !rpoData.totMU) return <div style={{ ...ui, color: C.t3, padding: 20 }}>No data.</div>;
  const cats = [
    { key: "solar", label: "Solar", color: C.solar },
    { key: "nonSolar", label: "Non-Solar", color: C.wind },
    { key: "hydro", label: "Hydro", color: C.hydro },
    { key: "eso", label: "Storage", color: C.bess },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <KPI label="Total Consumption" value={Math.round(rpoData.totMU).toLocaleString()} unit="MU" accent={C.warn} />
        <KPI label="RE Fulfilled" value={Math.round(rpoData.fulfilled.total)} unit="MU" color={C.pos} accent={C.pos} />
        <KPI label="RPO Target" value={Math.round(rpoData.targets.total)} unit="MU" accent={C.focus} />
        <KPI label="REC Cost" value={rpoData.recCost.total} unit="Cr" color={rpoData.recCost.total > 0 ? C.neg : C.pos} accent={rpoData.recCost.total > 0 ? C.neg : C.pos} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {cats.map(c => {
          const tgt = rpoData.targets[c.key] || 0;
          const ful = rpoData.fulfilled[c.key] || 0;
          const sh = rpoData.shortfall[c.key] || 0;
          const met = sh <= 0;
          return (
            <div key={c.key} style={{ background: C.elev, borderRadius: 6, padding: 12, border: `1px solid ${C.brd}`, borderLeft: `4px solid ${c.color}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ ...ui, fontSize: 12, fontWeight: 600, color: c.color }}>{c.label}</span>
                <span style={{ ...mono, fontSize: 9, padding: "1px 6px", borderRadius: 8, marginLeft: "auto", background: met ? C.pos + "22" : C.neg + "22", color: met ? C.pos : C.neg }}>{met ? "MET" : "SHORT"}</span>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.t2 }}>
                Target: {tgt} MU | Fulfilled: {ful} MU | Gap: {sh} MU
              </div>
              <div style={{ height: 5, background: C.brd, borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
                <div style={{ height: "100%", width: `${Math.min(100, tgt > 0 ? ful / tgt * 100 : 0)}%`, background: met ? C.pos : c.color, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function STOAEditor({ stoa, setStoa, moNames, months }) {
  const update = (id, key, val) => setStoa(prev => prev.map(s => s.id === id ? { ...s, [key]: val } : s));
  const toggleMonth = (id, mi, field) => {
    const calIdx = months[mi].cal;
    setStoa(prev => prev.map(s => {
      if (s.id !== id) return s;
      const arr = [...(s[field] || Array(12).fill(0))];
      arr[calIdx] = arr[calIdx] ? 0 : 1;
      return { ...s, [field]: arr };
    }));
  };
  const addDeal = (seg) => {
    const id = Math.max(0, ...stoa.map(s => s.id)) + 1;
    const base = { id, seg, name: `New ${seg} ${id}`, cpty: "", dir: "BUY", mw: 100, rate: seg === "Banking" ? 0.10 : 3.50, months: Array(12).fill(1), hrs: "RTC", status: "DRAFT" };
    if (seg === "Banking") { base.injectMo = Array(12).fill(0); base.withdrawMo = Array(12).fill(0); base.lossPct = 2; base.bankRatio = 100; }
    setStoa(prev => [...prev, base]);
  };
  const del = (id) => setStoa(prev => prev.filter(s => s.id !== id));
  const bilateral = stoa.filter(s => s.seg === "Bilateral");
  const banking = stoa.filter(s => s.seg === "Banking");
  const moChips = (deal, field) => (
    <div style={{ display: "flex", gap: 1 }}>
      {(moNames || MO).map((m, i) => {
        const arr = deal[field] || deal.months || [];
        const ci = months[i].cal;
        return <button key={i} onClick={() => toggleMonth(deal.id, i, field)} style={{ ...mono, fontSize: 9, width: 22, height: 18, border: "none", borderRadius: 2, cursor: "pointer", background: arr[ci] ? C.pos + "33" : C.brd + "88", color: arr[ci] ? C.pos : C.t2, fontWeight: arr[ci] ? 700 : 400 }}>{m[0]}</button>;
      })}
    </div>
  );
  const hdrs = ["", "Name", "Cpty", "Dir", "MW", "Rate", "Hrs", "Months", "Status"];
  const dealRow = (s) => (
    <tr key={s.id} style={{ background: s.status === "DRAFT" ? C.warn + "08" : "transparent" }}>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><button onClick={() => del(s.id)} style={{ background: "none", border: "none", color: C.neg, cursor: "pointer", fontSize: 11 }}>x</button></td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={s.name} onChange={v => update(s.id, "name", v)} type="text" width={85} /></td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={s.cpty} onChange={v => update(s.id, "cpty", v)} type="text" width={80} /></td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>
        <select value={s.dir} onChange={e => update(s.id, "dir", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: s.dir === "BUY" ? C.pos : C.neg, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="BUY">BUY</option><option value="SELL">SELL</option></select>
      </td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={s.mw} onChange={v => update(s.id, "mw", v)} type="number" min={0} width={40} /></td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={s.rate} onChange={v => update(s.id, "rate", v)} type="number" min={0} width={40} /></td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <select value={s.hrs} onChange={e => update(s.id, "hrs", e.target.value)} style={{ ...ui, fontSize: 9, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 2px", cursor: "pointer", minWidth: 42 }}>
            <option value="RTC">RTC</option><option value="PEAK">PEAK</option><option value="OFF-PEAK">OFF-PK</option><option value="CUSTOM">Custom</option>
          </select>
          {s.hrs === "CUSTOM" && (
            <span style={{ display: "flex", alignItems: "center", gap: 1, ...mono, fontSize: 9 }}>
              <EditCell value={s.fromHr || 0} onChange={v => update(s.id, "fromHr", v)} type="number" min={0} max={23} width={22} />
              <span style={{ color: C.t3 }}>–</span>
              <EditCell value={s.toHr || 24} onChange={v => update(s.id, "toHr", v)} type="number" min={1} max={24} width={22} />
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>{moChips(s, "months")}</td>
      <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>
        <select value={s.status} onChange={e => update(s.id, "status", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: s.status === "ACTIVE" ? C.pos : C.warn, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="ACTIVE">ACTIVE</option><option value="DRAFT">DRAFT</option><option value="EXPIRED">EXPIRED</option></select>
      </td>
    </tr>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ ...lbl, fontSize: 11, fontWeight: 700, color: C.bilat }}>BILATERAL</span>
        <button onClick={() => addDeal("Bilateral")} style={{ ...lbl, fontSize: 10, padding: "3px 10px", background: C.bilat + "15", color: C.bilat, border: `1px solid ${C.bilat}33`, borderRadius: 2, cursor: "pointer" }}>+ ADD</button>
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 6, marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{hdrs.map((h, i) => <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "5px 4px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 3 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>{bilateral.length === 0 ? <tr><td colSpan={9} style={{ ...ui, fontSize: 12, color: C.t3, padding: 8, textAlign: "center" }}>None</td></tr> : bilateral.map(dealRow)}</tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, marginTop: 8 }}>
        <span style={{ ...lbl, fontSize: 11, fontWeight: 700, color: C.bank }}>BANKING</span>
        <button onClick={() => addDeal("Banking")} style={{ ...lbl, fontSize: 10, padding: "3px 10px", background: C.bank + "15", color: C.bank, border: `1px solid ${C.bank}33`, borderRadius: 2, cursor: "pointer" }}>+ ADD</button>
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${C.brd}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{[...hdrs, "Inject", "Withdraw", "Loss%"].map((h, i) => <th key={i} style={{ ...lbl, fontSize: 10, fontWeight: 700, color: C.t2, padding: "5px 4px", background: C.base, borderBottom: `1px solid ${C.brd}`, textAlign: i > 3 && i < 9 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>{banking.length === 0 ? <tr><td colSpan={12} style={{ ...ui, fontSize: 12, color: C.t3, padding: 8, textAlign: "center" }}>None</td></tr> : banking.map(s => (
            <tr key={s.id}>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><button onClick={() => del(s.id)} style={{ background: "none", border: "none", color: C.neg, cursor: "pointer", fontSize: 11 }}>x</button></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={s.name} onChange={v => update(s.id, "name", v)} type="text" width={80} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><EditCell value={s.cpty} onChange={v => update(s.id, "cpty", v)} type="text" width={75} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><select value={s.dir} onChange={e => update(s.id, "dir", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: s.dir === "BUY" ? C.pos : C.neg, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={s.mw} onChange={v => update(s.id, "mw", v)} type="number" min={0} width={40} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={s.rate} onChange={v => update(s.id, "rate", v)} type="number" min={0} width={35} /></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><select value={s.hrs} onChange={e => update(s.id, "hrs", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="RTC">RTC</option><option value="PEAK">PEAK</option><option value="OFF-PEAK">OFF-PK</option></select></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>{moChips(s, "months")}</td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}><select value={s.status} onChange={e => update(s.id, "status", e.target.value)} style={{ ...ui, fontSize: 10, background: C.overlay, color: s.status === "ACTIVE" ? C.pos : C.warn, border: `1px solid ${C.brd}`, borderRadius: 3, padding: "2px 3px", cursor: "pointer" }}><option value="ACTIVE">ACTIVE</option><option value="DRAFT">DRAFT</option></select></td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>{moChips(s, "injectMo")}</td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12` }}>{moChips(s, "withdrawMo")}</td>
              <td style={{ padding: "3px 4px", borderBottom: `1px solid ${C.brd}12`, textAlign: "right" }}><EditCell value={s.lossPct || 0} onChange={v => update(s.id, "lossPct", v)} type="number" min={0} max={20} width={30} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  MAIN APP — PROFESSIONAL LAYOUT
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [plants, setPlants] = useState(DEF_PLANTS);
  const [demand, setDemand] = useState(DEF_DEMAND);
  const [mkt, setMkt] = useState(DEF_MKT);
  const [stoa, setStoa] = useState(DEF_STOA);
  const [fdre, setFdre] = useState(DEF_FDRE);
  const [rpo, setRpo] = useState(DEF_RPO);
  const [scenarios, setScenarios] = useState(DEF_SCENARIOS);
  const [res, setRes] = useState("hourly");
  const [mo, setMo] = useState(2);
  const [tab, setTab] = useState("overview");
  const [sideOpen, setSideOpen] = useState(true);
  const [startMo, setStartMo] = useState(DEF_START);

  const months = useMemo(() => buildMonths(startMo), [startMo]);
  const moNames = useMemo(() => months.map(m => m.name), [months]);

  const all = useMemo(() => {
    return months.map((m, i) => {
      const b96 = dispatch96(plants, demand[m.cal], m.cal, stoa, mkt, fdre, {}, m.cal, m.days);
      const agg = aggMonthly(b96, m.days);
      return { mo: m.name, mi: i, cal: m.cal, days: m.days, pk: demand[m.cal], b96, agg, stoaMW: Math.round(safeMean(b96, "stoaBuy")) };
    });
  }, [plants, demand, stoa, mkt, fdre, months]);

  const scenarioResults = useMemo(() => {
    return scenarios.filter(s => s.active).map(sc => {
      let demMU = 0, costCr = 0, mktMU = 0, curtailMU = 0, genMU = 0;
      months.forEach((m, i) => {
        const b96 = dispatch96(plants, demand[m.cal], m.cal, stoa, mkt, fdre, sc, m.cal, m.days);
        const agg = aggMonthly(b96, m.days);
        demMU += agg.demMU; costCr += agg.costCr; mktMU += agg.mktMU; curtailMU += (agg.curtailMU || 0); genMU += agg.genMU;
      });
      return { ...sc, demMU: Math.round(demMU), costCr: +costCr.toFixed(1), mktMU: Math.round(mktMU), curtailMU: +curtailMU.toFixed(1), genMU: Math.round(genMU), avgCost: demMU > 0 ? +(costCr * 100 / (demMU * 10)).toFixed(2) : 0 };
    });
  }, [plants, demand, stoa, mkt, fdre, scenarios, months]);

  const rpoData = useMemo(() => computeRPO(all, plants, stoa, fdre, rpo, mkt), [all, plants, stoa, fdre, rpo, mkt]);

  const R = all[mo];
  const gRes = (res === "15min" || res === "hourly") ? res : "hourly";
  const isAgg = res === "monthly" || res === "fortnightly";
  // isDaily is declared below after today/currentCalMo

  const annual = useMemo(() => ({
    dem: Math.round(safeSum(all, r => r.agg.demMU)),
    gen: Math.round(safeSum(all, r => r.agg.genMU)),
    mkt: Math.round(safeSum(all, r => r.agg.mktMU)),
    fdreMU: Math.round(safeSum(all, r => r.agg.fdreMU || 0)),
    pk: safeMax(all, "pk"),
    cap: safeSum(plants, "pMax"),
    curtailMU: +safeSum(all, r => r.agg.curtailMU || 0).toFixed(1),
    costCr: +safeSum(all, r => r.agg.costCr).toFixed(1),
    varCostCr: +safeSum(all, r => r.agg.varCostCr).toFixed(1),
    fixedCostCr: +safeSum(all, r => r.agg.fixedCostCr).toFixed(1),
    avgCost: (() => { const tC = safeSum(all, r => r.agg.costCr); const tE = safeSum(all, r => r.agg.demMU); return tE > 0 ? +(tC * 100 / (tE * 10)).toFixed(2) : 0; })(),
  }), [all, plants]);

  // ── Daily resolution: detect if selected month is current calendar month ──
  const today = new Date();
  const currentCalMo = today.getMonth(); // 0=Jan
  const isCurrentMonth = months[mo].cal === currentCalMo;
  const isDaily = res === "daily";

  const dailyData = useMemo(() => {
    if (!isDaily || !R) return [];
    const calMo = months[mo].cal;
    const yr = today.getFullYear();
    const daysInMo = months[mo].days;
    const todayDate = isCurrentMonth ? today.getDate() : 0; // show all days if not current month
    const startDay = todayDate + 1; // tomorrow
    if (startDay > daysInMo) return []; // month already over

    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const results = [];
    for (let d = startDay; d <= daysInMo; d++) {
      const dt = new Date(yr, calMo, d);
      const dow = DOW[dt.getDay()];
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      // Weekend demand ~88%, Friday slightly lower ~96%
      const dayFactor = isWeekend ? 0.88 : (dt.getDay() === 5 ? 0.96 : 1.0);
      // Slight daily noise based on day number
      const noise = Math.sin(d * 2.71) * 0.02;
      const adjPeak = Math.round(demand[calMo] * (dayFactor + noise));

      const b96 = dispatch96(plants, adjPeak, calMo, stoa, mkt, fdre, {}, calMo, 1);
      const agg = aggMonthly(b96, 1); // 1-day aggregation
      results.push({
        day: d,
        lbl: `${d} ${CAL_MO[calMo]}`,
        dow,
        isWeekend,
        pk: adjPeak,
        b96, agg,
      });
    }
    return results;
  }, [isDaily, R, mo, months, demand, plants, stoa, mkt, fdre]);

  const exportCSV = useCallback(() => {
    const rows = [["Block", "Time", "Demand_MW", ...plants.map(p => p.name + "_MW"), "STOA_MW", "GDAM_MW", "DAM_MW", "RTM_MW", "Curtail_MW", "Marg_Cost", "Block_Cost_Lakhs"]];
    R.b96.forEach(b => {
      rows.push([b.t, b.lbl, b.dem, ...plants.map(p => b.src[p.id]?.mw || 0), b.stoaBuy, b.mktGDAM || 0, b.mktDAM, b.mktRTM, b.curtailment || 0, b.margCost, b.cost]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `UCED_${R.mo}_dispatch.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [R, plants]);

  const nowTB = Math.floor(new Date().getHours() * 4 + new Date().getMinutes() / 15);
  const sideW = sideOpen ? 170 : 46;
  const yearLabel = useMemo(() => {
    const s = CAL_MO[startMo]; const e = CAL_MO[(startMo + 11) % 12];
    const now = new Date(); const sy = startMo <= now.getMonth() ? now.getFullYear() : now.getFullYear();
    return `${s} ${sy} — ${e} ${startMo > 0 ? sy + 1 : sy}`;
  }, [startMo]);

  return (
    <div style={{ background: C.base, color: C.t1, height: "100vh", ...ui, fontSize: 13, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* ─── HEADER BAR ─── */}
      <div style={{ background: C.elev, borderBottom: `1px solid ${C.brd}`, padding: "0 12px", display: "flex", alignItems: "center", minHeight: 36, flexShrink: 0, zIndex: 50, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setSideOpen(!sideOpen)}>
          <div style={{ width: 22, height: 22, borderRadius: 3, background: `linear-gradient(135deg, ${C.focus}, ${C.focus}66)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#fff" }}>P</span>
          </div>
          <span style={{ ...mono, fontSize: 14, fontWeight: 800, color: C.focus, letterSpacing: 2 }}>P-OPT</span>
        </div>
        <span style={{ ...lbl, fontSize: 10, color: C.t2 }}>UC/ED</span>
        <span style={{ ...mono, fontSize: 10, color: C.t3 }}>{yearLabel}</span>
        <div style={{ width: 1, height: 16, background: C.brd, margin: "0 4px" }} />
        {/* Start month picker */}
        <select value={startMo} onChange={e => setStartMo(+e.target.value)} style={{ ...mono, fontSize: 10, background: C.overlay, color: C.t1, border: `1px solid ${C.brd}`, borderRadius: 2, padding: "2px 4px", cursor: "pointer" }}>
          {CAL_MO.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <div style={{ width: 1, height: 14, background: C.brd }} />
        {/* Month selector inline */}
        <div style={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {moNames.map((m, i) => (
            <button key={i} onClick={() => { setMo(i); if (res === "daily" && months[i].cal !== currentCalMo) setRes("15min"); }} style={{
              ...mono, fontSize: 10, padding: "2px 6px", borderRadius: 2, cursor: "pointer",
              border: mo === i ? `1px solid ${C.focus}` : `1px solid ${C.brd}88`,
              background: mo === i ? C.focus + "22" : C.elev,
              color: mo === i ? C.focus : C.t1, fontWeight: mo === i ? 700 : 500,
            }}>{m.toUpperCase()}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ ...mono, fontSize: 10, color: C.t2 }}>Rs<span style={{ color: C.warn, fontWeight: 600 }}>{R.agg.avgCost}</span>/kWh</span>
          <div style={{ width: 1, height: 14, background: C.brd }} />
          <div style={{ display: "flex", gap: 1, background: C.base, borderRadius: 2, padding: 1, border: `1px solid ${C.brd}` }}>
            {[["daily", "1D"], ["15min", "15M"], ["hourly", "1H"], ["fortnightly", "FN"], ["monthly", "MO"]].map(([id, l]) =>
              <ResBtn key={id} active={res === id} onClick={() => setRes(id)} disabled={id === "daily" && !isCurrentMonth}>{l}</ResBtn>
            )}
          </div>
          <button onClick={exportCSV} style={{ ...lbl, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: `1px solid ${C.brd}88`, cursor: "pointer", background: C.elev, color: C.t1 }}>CSV</button>
          <span style={{ ...mono, fontSize: 10, padding: "2px 6px", borderRadius: 2, background: C.focus + "15", color: C.focus, border: `1px solid ${C.focus}33` }}>PLAN</span>
        </div>
      </div>

      {/* ─── BODY: SIDEBAR + CONTENT ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* SIDEBAR */}
        <div style={{ width: sideW, flexShrink: 0, background: C.elev, borderRight: `1px solid ${C.brd}`, display: "flex", flexDirection: "column", transition: "width 0.15s ease", overflow: "hidden" }}>
          <div style={{ flex: 1, paddingTop: 6 }}>
            {NAV.map(n => {
              const active = tab === n.id;
              return (
                <div key={n.id} onClick={() => setTab(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px", cursor: "pointer",
                  background: active ? C.focus + "12" : "transparent",
                  borderLeft: active ? `3px solid ${C.focus}` : "3px solid transparent",
                }} title={n.label}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? C.focus : C.t2} style={{ flexShrink: 0 }}><path d={n.icon} /></svg>
                  {sideOpen && <span style={{ ...lbl, fontSize: 11, color: active ? C.focus : C.t2, fontWeight: active ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden" }}>{n.label}</span>}
                </div>
              );
            })}
          </div>
          {/* Sidebar footer — summary */}
          {sideOpen && (
            <div style={{ borderTop: `1px solid ${C.brd}`, padding: "8px 12px" }}>
              <div style={{ ...mono, fontSize: 10, color: C.t2, lineHeight: 1.6 }}>
                <div>CAP <span style={{ color: C.val }}>{annual.cap}MW</span></div>
                <div>PEAK <span style={{ color: C.warn }}>{R.pk}MW</span></div>
                <div>COST <span style={{ color: C.neg }}>Rs{annual.costCr}Cr</span></div>
                <div>RPO <span style={{ color: rpoData.recCost?.total > 0 ? C.warn : C.pos }}>{(rpoData.totMU > 0 ? rpoData.fulfilled?.total / rpoData.totMU * 100 : 0).toFixed(1)}%</span></div>
              </div>
            </div>
          )}
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, overflow: "auto", padding: 10, paddingBottom: 32 }}>

          {tab === "config" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Panel title="DATA UPLOAD" accent={C.focus}><DataUploader demand={demand} setDemand={setDemand} mkt={mkt} setMkt={setMkt} months={months} moNames={moNames} /></Panel>
              <Panel title="GENERATION PORTFOLIO" accent={C.thermal}><PlantEditor plants={plants} setPlants={setPlants} /></Panel>
              <Panel title="MONTHLY PEAK DEMAND" accent={C.warn}><DemandEditor demand={demand} setDemand={setDemand} moNames={moNames} months={months} /></Panel>
              <Panel title="MARKET PRICES & LIMITS" accent={C.dam}><MarketEditor mkt={mkt} setMkt={setMkt} moNames={moNames} months={months} /></Panel>
              <Panel title="STOA CONTRACTS" accent={C.bilat}><STOAEditor stoa={stoa} setStoa={setStoa} moNames={moNames} months={months} /></Panel>
              <Panel title="FDRE CONTRACTS" accent={C.psp}><FDREEditor fdre={fdre} setFdre={setFdre} moNames={moNames} months={months} /></Panel>
              <Panel title="RPO TARGETS" accent={C.pos}><RPOEditor rpo={rpo} setRpo={setRpo} /></Panel>
              <Panel title="STOCHASTIC SCENARIOS" accent={C.dec}><ScenarioEditor scenarios={scenarios} setScenarios={setScenarios} /></Panel>
            </div>
          )}

          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <KPI label="Annual Demand" value={annual.dem.toLocaleString()} unit="MU" accent={C.warn} />
                <KPI label="Own Generation" value={annual.gen.toLocaleString()} unit="MU" color={C.pos} accent={C.pos} />
                <KPI label="Open Market" value={annual.mkt.toLocaleString()} unit="MU" color={C.dam} accent={C.dam} />
                <KPI label="Curtailment" value={annual.curtailMU} unit="MU" color={annual.curtailMU > 0 ? C.curtail : C.pos} accent={annual.curtailMU > 0 ? C.curtail : C.pos} />
                <KPI label="Avg Cost" value={annual.avgCost} unit="Rs/kWh" color={C.thermal} accent={C.thermal} />
                <KPI label="Variable Cost" value={annual.varCostCr} unit="Cr" color={C.neg} accent={C.neg} />
                <KPI label="Fixed Cost" value={annual.fixedCostCr} unit="Cr" color={C.warn} accent={C.warn} />
                <KPI label="Total Cost" value={annual.costCr} unit="Cr" color={C.neg} accent={C.neg} />
                <KPI label="RPO" value={(rpoData.totMU > 0 ? rpoData.fulfilled?.total / rpoData.totMU * 100 : 0).toFixed(1)} unit="%" color={rpoData.recCost?.total > 0 ? C.warn : C.pos} accent={rpoData.recCost?.total > 0 ? C.warn : C.pos} />
              </div>
              {isDaily ? (
                <Panel title={`${R.mo} DAILY DISPATCH (D+1 → ${months[mo].days})`} accent={C.focus}><DailyView dailyData={dailyData} moName={R.mo} /></Panel>
              ) : isAgg ? (
                <Panel title="ENERGY BALANCE" accent={C.pos}><AggView all={all} res={res} /></Panel>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Panel title={`${R.mo} GENERATION STACK`} accent={C.thermal}><StackChart data={R.b96} plants={plants} res={gRes} /></Panel>
                  <Panel title="ANNUAL ENERGY BALANCE" accent={C.pos}><AggView all={all} res="monthly" /></Panel>
                </div>
              )}
              <Panel title="MERIT ORDER" accent={C.val}><MeritTable data={R.b96} plants={plants} days={R.days} /></Panel>
            </div>
          )}

          {tab === "grid" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <KPI label={`${R.mo} Peak`} value={R.pk} unit="MW" color={C.warn} accent={C.warn} />
                <KPI label="Own Gen" value={Math.round(safeMean(R.b96, "gen"))} unit="MW avg" color={C.pos} accent={C.pos} />
                <KPI label="Market" value={Math.round(safeMean(R.b96, "mkt"))} unit="MW avg" color={C.dam} accent={C.dam} />
                <KPI label="Curtailment" value={R.agg.curtailMU || 0} unit="MU" color={(R.agg.curtailMU || 0) > 0 ? C.curtail : C.pos} accent={(R.agg.curtailMU || 0) > 0 ? C.curtail : C.pos} />
              </div>
              {isDaily ? <Panel title={`${R.mo} DAILY DISPATCH`} accent={C.focus}><DailyView dailyData={dailyData} moName={R.mo} /></Panel> : isAgg ? <Panel title="ENERGY BALANCE" accent={C.pos}><AggView all={all} res={res} /></Panel> : <BlockGrid data={R.b96} plants={plants} resolution={gRes} />}
            </div>
          )}

          {tab === "dispatch" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {isDaily ? <Panel title={`${R.mo} DAILY DISPATCH`} accent={C.focus}><DailyView dailyData={dailyData} moName={R.mo} /></Panel> : isAgg ? <Panel title="ENERGY BALANCE" accent={C.pos}><AggView all={all} res={res} /></Panel> : (
                <>
                  <Panel title={`${R.mo} GENERATION STACK`} accent={C.thermal}><StackChart data={R.b96} plants={plants} res={gRes} /></Panel>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Panel title="STORAGE STATE OF CHARGE" accent={C.bess}><SoCChart data={R.b96} plants={plants} res={gRes} /></Panel>
                    <Panel title="PRICE DURATION CURVE" accent={C.thermal}><PriceDurationCurve data={R.b96} /></Panel>
                  </div>
                </>
              )}
              <Panel title="MERIT ORDER" accent={C.val}><MeritTable data={R.b96} plants={plants} days={R.days} /></Panel>
            </div>
          )}

          {tab === "market" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <KPI label="DAM" value={(mkt.damMCP[months[mo].cal] || 0).toFixed(2)} unit="Rs/kWh" color={C.dam} accent={C.dam} />
                <KPI label="GDAM" value={(mkt.gdamMCP[months[mo].cal] || 0).toFixed(2)} unit="Rs/kWh" color={C.gdam} accent={C.gdam} />
                <KPI label="RTM" value={((mkt.damMCP[months[mo].cal] || 0) * (1 + mkt.rtmPrem / 100)).toFixed(2)} unit="Rs/kWh" color={C.rtm} accent={C.rtm} />
                <KPI label="Bilateral" value={(mkt.bilatRate[months[mo].cal] || 0).toFixed(2)} unit="Rs/kWh" color={C.bilat} accent={C.bilat} />
                <KPI label={`${R.mo} Cost`} value={R.agg.costCr} unit="Cr" color={C.neg} accent={C.neg} />
                <KPI label="Avg Cost" value={R.agg.avgCost} unit="Rs/kWh" color={C.thermal} accent={C.thermal} />
                <KPI label="Deficit" value={R.agg.defMU} unit="MU" color={C.neg} accent={C.neg} />
                <KPI label="Surplus" value={R.agg.surMU} unit="MU" color={C.pos} accent={C.pos} />
              </div>
              {isDaily ? <Panel title={`${R.mo} DAILY COST`} accent={C.focus}><DailyView dailyData={dailyData} moName={R.mo} /></Panel> : !isAgg && <Panel title="PRICE CURVES" accent={C.dam}><PriceChart data={R.b96} res={gRes} /></Panel>}
              <Panel title="ANNUAL PRICE TRAJECTORY" accent={C.dam}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={moNames.map((m, i) => { const ci = months[i].cal; return { mo: m, DAM: mkt.damMCP[ci], GDAM: mkt.gdamMCP[ci], RTM: +(mkt.damMCP[ci] * (1 + mkt.rtmPrem / 100)).toFixed(2), Bilateral: mkt.bilatRate[ci] }; })} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
                    <XAxis dataKey="mo" tick={{ fill: C.t2, fontSize: 10 }} />
                    <YAxis tick={{ fill: C.t2, fontSize: 10 }} orientation="right" />
                    <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="DAM" stroke={C.dam} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="GDAM" stroke={C.gdam} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="RTM" stroke={C.rtm} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Bilateral" stroke={C.bilat} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="ENERGY BALANCE" accent={C.pos}><AggView all={all} res={isAgg ? res : "monthly"} /></Panel>
            </div>
          )}

          {tab === "rpo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Panel title={`RPO COMPLIANCE | ${rpo.year}`} accent={C.pos}>
                <RPODashboard rpoData={rpoData} rpo={rpo} />
              </Panel>
              <Panel title="MONTHLY RE vs RPO TARGET" accent={C.pos}>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={all.map(r => {
                    let sol = 0, wnd = 0, hyd = 0, sto = 0;
                    Object.values(r.agg.srcE).forEach(s => {
                      if (s.tp === "Solar") sol += s.mu;
                      else if (s.tp === "Wind") wnd += s.mu;
                      else if (s.tp === "Hydro") hyd += s.mu;
                      else if (s.tp === "BESS" || s.tp === "PSP") sto += s.mu;
                    });
                    const rpoTgt = r.agg.demMU * (rpo.solarPct + rpo.nonSolarPct + rpo.hydroPct + rpo.esoPct) / 100;
                    return { mo: r.mo, Solar: +sol.toFixed(1), Wind: +wnd.toFixed(1), Hydro: +hyd.toFixed(1), Storage: +sto.toFixed(1), FDRE: +(r.agg.fdreMU || 0), target: +rpoTgt.toFixed(1) };
                  })} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
                    <XAxis dataKey="mo" tick={{ fill: C.t2, fontSize: 10 }} />
                    <YAxis tick={{ fill: C.t2, fontSize: 10 }} />
                    <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="Solar" stackId="a" fill={C.solar + "aa"} />
                    <Bar dataKey="Wind" stackId="a" fill={C.wind + "aa"} />
                    <Bar dataKey="Hydro" stackId="a" fill={C.hydro + "aa"} />
                    <Bar dataKey="FDRE" stackId="a" fill={C.psp + "aa"} />
                    <Bar dataKey="Storage" stackId="a" fill={C.bess + "88"} />
                    <Line type="monotone" dataKey="target" stroke={C.warn} strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 4, fill: C.warn }} name="RPO Target" />
                  </ComposedChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          )}

          {tab === "scenarios" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Panel title="SCENARIO COMPARISON" accent={C.dec}><ScenarioCompare scenarioResults={scenarioResults} /></Panel>
              <Panel title="SCENARIO PARAMETERS" accent={C.dec}><ScenarioEditor scenarios={scenarios} setScenarios={setScenarios} /></Panel>
            </div>
          )}

          {tab === "balance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <KPI label={`${R.mo} Demand`} value={R.agg.demMU} unit="MU" accent={C.warn} />
                <KPI label="Own Gen" value={R.agg.genMU} unit="MU" color={C.pos} accent={C.pos} />
                <KPI label="Market" value={R.agg.mktMU} unit="MU" color={C.dam} accent={C.dam} />
                <KPI label="STOA" value={R.agg.stoaBuyMU} unit="MU" color={C.bilat} accent={C.bilat} />
                <KPI label="FDRE" value={R.agg.fdreMU || 0} unit="MU" color={C.psp} accent={C.psp} />
                <KPI label="Curtail" value={R.agg.curtailMU || 0} unit="MU" color={(R.agg.curtailMU || 0) > 0 ? C.curtail : C.pos} accent={(R.agg.curtailMU || 0) > 0 ? C.curtail : C.pos} />
                <KPI label="Cost" value={R.agg.costCr} unit="Cr" color={C.neg} accent={C.neg} />
              </div>
              {isDaily ? <Panel title={`${R.mo} DAILY BALANCE`} accent={C.focus}><DailyView dailyData={dailyData} moName={R.mo} /></Panel> : <Panel title="ENERGY BALANCE" accent={C.pos}><AggView all={all} res={isAgg ? res : "monthly"} /></Panel>}
              <Panel title="ANNUAL SUPPLY MIX" accent={C.thermal}>
                {(() => {
                  const mixData = all.map(r => {
                    const row = { mo: r.mo, Demand: +r.agg.demMU, FDRE: +(r.agg.fdreMU || 0), STOA: +(r.agg.stoaBuyMU || 0), DAM: +(r.agg.mktDAM_MU || 0), GDAM: +(r.agg.mktGDAM_MU || 0), RTM: +(r.agg.mktRTM_MU || 0) };
                    Object.values(r.agg.srcE).forEach(s => { if (s.mu > 0) row[s.tp] = (row[s.tp] || 0) + +s.mu.toFixed(1); });
                    row._total = Math.round(SEG_ORDER.reduce((s, seg) => s + (row[seg] || 0), 0));
                    return row;
                  });
                  const activeSegs = SEG_ORDER.filter(s => mixData.some(r => (r[s] || 0) > 0));
                  const renderMixLabel = (props) => { const { x, y, width, index } = props; const t = mixData[index]?._total; return t ? <text x={x + width / 2} y={y - 6} fill={C.t1} fontSize={9} fontFamily="JetBrains Mono,monospace" textAnchor="middle" fontWeight={600}>{t}</text> : null; };
                  return (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={mixData} margin={{ top: 22, right: 10, bottom: 5, left: 10 }}>
                        <CartesianGrid stroke={C.brd + "66"} strokeDasharray="3 3" />
                        <XAxis dataKey="mo" tick={{ fill: C.t2, fontSize: 10 }} />
                        <YAxis tick={{ fill: C.t2, fontSize: 10 }} label={{ value: "MU", angle: -90, position: "insideLeft", fill: C.t2, fontSize: 11 }} />
                        <Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
                        {activeSegs.map((seg, si) => <Bar key={seg} dataKey={seg} stackId="s" fill={SEG_CLR[seg] || C.t3} fillOpacity={0.9} radius={si === activeSegs.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}>{si === activeSegs.length - 1 && <LabelList content={renderMixLabel} />}</Bar>)}
                        <Line type="monotone" dataKey="Demand" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3, fill: "#1565C0", stroke: C.t1, strokeWidth: 1 }} name="Demand" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  );
                })()}
              </Panel>
            </div>
          )}
        </div>
      </div>

      {/* ─── STATUS BAR ─── */}
      <div style={{ minHeight: 26, flexShrink: 0, background: C.elev, borderTop: `1px solid ${C.brd}`, display: "flex", alignItems: "center", padding: "0 12px", gap: 12, zIndex: 50 }}>
        <StatusDot color={C.pos} label="SCADA" />
        <StatusDot color={C.pos} label="IEX" />
        <StatusDot color={C.pos} label="SLDC" />
        <div style={{ width: 1, height: 12, background: C.brd }} />
        <span style={{ ...mono, fontSize: 10, color: C.t2 }}>TB <span style={{ color: C.val }}>{nowTB + 1}/96</span></span>
        <span style={{ ...mono, fontSize: 10, color: rpoData.recCost?.total > 0 ? C.warn : C.pos }}>
          RPO {(rpoData.totMU > 0 ? rpoData.fulfilled?.total / rpoData.totMU * 100 : 0).toFixed(1)}%
        </span>
        <span style={{ ...mono, fontSize: 10, color: C.t2 }}>{R.mo} | Pk {R.pk}MW | Rs{R.agg.avgCost}/kWh</span>
        <span style={{ ...lbl, fontSize: 10, color: C.t2, marginLeft: "auto" }}>P-OPT UCED v4.0 | {plants.length} UNITS | {scenarios.filter(s => s.active).length} SCENARIOS</span>
      </div>
    </div>
  );
}
import { useState, useEffect, useRef, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/* ─── Growth phases ──────────────────────────────────────────────── */
const GROWTH_PHASES: { img: string; duration: number }[] = [
  { img: "/DerevoFaza1.webp", duration: 120 },
  { img: "/DerevoFaza2.webp", duration: 120 },
  { img: "/DerevoFaza3.webp", duration: 120 },
  { img: "/DerevoFaza4.webp", duration: 120 },
  { img: "/DerevoFaza5.webp", duration: 120 },
  { img: "/DerevoFaza6.webp", duration: 240 },
  { img: "/DerevoFaza7.webp", duration: 240 },
  { img: "/DerevoFaza8.webp", duration: 30  },
];

const PHASE_ASPECT       = "660 / 700";
const PHASE6_IDX         = 5;
const HARVEST_PHASE_IDX  = 6;
const WINDDOWN_PHASE_IDX = 7;
const BASE_YIELD         = 400;
const REFERRAL_BONUS     = 1200;  /* fruit given to invitee on first plant */
const PLANTING_DURATION  = 30;
const CIRCUMFERENCE      = 2 * Math.PI * 40;

const NAV = [
  { id: "druzya",   path: "/druzya",   img: "/PanelDRUZYA.webp",   label: "Друзья"  },
  { id: "zadaniya", path: "/zadaniya", img: "/PanelZADANIYA.webp", label: "Задания" },
  { id: "sklad",    path: "/sklad",    img: "/PanelSKLAD.webp",    label: "Склад"   },
  { id: "magazin",  path: "/magazin",  img: "/PanelMAGAZIN.webp",  label: "Магазин" },
];

type ItemKey = "sazhenec" | "uchastok" | "avtopoliv" | "avtosbor" | "udobrenie";

const SHOP_ITEMS: { key: ItemKey; img: string; label: string }[] = [
  { key: "sazhenec",  img: "/ItemSazhenec.webp",  label: "Саженец"   },
  { key: "uchastok",  img: "/ItemUchastok.webp",  label: "Участок"   },
  { key: "avtopoliv", img: "/ItemAvtopoliv.webp", label: "Автополив" },
  { key: "avtosbor",  img: "/ItemAvtosbor.webp",  label: "Автосбор"  },
  { key: "udobrenie", img: "/ItemUdobrenie.webp", label: "Удобрение" },
];

/* ─── Formatters ────────────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1_000_000_000) { const v = n / 1_000_000_000; return `${v % 1 === 0 ? v : v.toFixed(1)}b`; }
  if (n >= 1_000_000)     { const v = n / 1_000_000;     return `${v % 1 === 0 ? v : v.toFixed(1)}m`; }
  if (n >= 10_000)        { const v = n / 1_000;         return `${v % 1 === 0 ? v : v.toFixed(1)}к`; }
  return n.toLocaleString("ru-RU");
}

/* ─── Peer-store: shared localStorage for referral data ─────────── *
 * orchard_peer_<referrerId>  →  PeerEntry[]
 * Written by invitees so the inviter can read their progress.
 * In production this would be replaced by a real backend.
 * ────────────────────────────────────────────────────────────────── */
interface PeerEntry {
  id: string;
  displayName: string;
  hasPlantedFirstTree: boolean;
  totalHarvested: number;   /* lifetime fruit harvested by this invitee */
}

function peerKey(referrerId: string) { return `orchard_peer_${referrerId}`; }

function readPeerStore(referrerId: string): PeerEntry[] {
  try { return JSON.parse(localStorage.getItem(peerKey(referrerId)) ?? "[]"); } catch { return []; }
}

function writePeerStore(referrerId: string, entries: PeerEntry[]) {
  localStorage.setItem(peerKey(referrerId), JSON.stringify(entries));
}

function peerRegister(referrerId: string, inviteeId: string, displayName: string) {
  const entries = readPeerStore(referrerId);
  const idx = entries.findIndex(e => e.id === inviteeId);
  if (idx < 0) entries.push({ id: inviteeId, displayName, hasPlantedFirstTree: true, totalHarvested: 0 });
  else { entries[idx].hasPlantedFirstTree = true; entries[idx].displayName = displayName; }
  writePeerStore(referrerId, entries);
}

function peerAddHarvest(referrerId: string, inviteeId: string, amount: number) {
  const entries = readPeerStore(referrerId);
  const idx = entries.findIndex(e => e.id === inviteeId);
  if (idx >= 0) { entries[idx].totalHarvested += amount; writePeerStore(referrerId, entries); }
}

/* ─── Player ID ─────────────────────────────────────────────────── */
function genPlayerId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/* ─── State types ───────────────────────────────────────────────── */
type GameState = "idle" | "planting" | "growing";

interface PlotState {
  gameState: GameState;
  phaseIdx: number;
  phaseStartedAt: number;
  harvestPresses: number;
}

interface Inventory {
  sazhenec: number; uchastok: number; avtopoliv: number;
  avtosbor: number; udobrenie: number;
}

/* Per-friend record stored on the INVITER's side */
interface FriendEntry {
  id: string;
  seedlingAwarded: boolean;   /* has 1-seedling bonus been given for this friend? */
  claimedHarvested: number;   /* friend's totalHarvested that was already claimed (for 15% diff) */
}

interface PersistedState {
  plots: PlotState[];
  currentPlotIdx: number;
  cedro: number;
  fruit: number;
  inventory: Inventory;
  /* Referral */
  playerId: string;
  referredBy: string | null;
  referralBonusReceived: boolean;
  friendEntries: FriendEntry[];
}

/* ─── State helpers ─────────────────────────────────────────────── */
function emptyPlot(): PlotState {
  return { gameState: "idle", phaseIdx: 0, phaseStartedAt: 0, harvestPresses: 0 };
}

function resolvePlot(plot: PlotState, now: number): PlotState {
  let cur = { ...plot };
  for (;;) {
    if (cur.gameState === "idle") break;
    const duration = cur.gameState === "planting"
      ? PLANTING_DURATION : (GROWTH_PHASES[cur.phaseIdx]?.duration ?? 120);
    const elapsed = (now - cur.phaseStartedAt) / 1000;
    if (elapsed < duration) break;
    const overflow = (elapsed - duration) * 1000;
    const nextStart = now - overflow;
    if (cur.gameState === "planting") {
      cur = { ...cur, gameState: "growing", phaseIdx: 0, phaseStartedAt: nextStart };
    } else {
      const nextIdx = cur.phaseIdx + 1;
      cur = nextIdx < GROWTH_PHASES.length
        ? { ...cur, phaseIdx: nextIdx, phaseStartedAt: nextStart }
        : { ...cur, phaseIdx: PHASE6_IDX, phaseStartedAt: nextStart };
    }
  }
  return cur;
}

function resolveState(s: PersistedState, now: number): PersistedState {
  return { ...s, plots: s.plots.map((p) => resolvePlot(p, now)) };
}

const STORAGE_KEY = "orchard_v9";

function loadState(): PersistedState {
  /* Read referral param from URL before loading */
  const urlRef = new URLSearchParams(window.location.search).get("ref") ?? null;
  if (urlRef) window.history.replaceState({}, "", window.location.pathname);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as PersistedState;
      /* If new ref param appeared and not yet stored */
      if (urlRef && !s.referredBy) return { ...s, referredBy: urlRef };
      return s;
    }
  } catch {}

  return {
    plots: [emptyPlot()], currentPlotIdx: 0,
    cedro: 0, fruit: 0,
    inventory: { sazhenec: 0, uchastok: 0, avtopoliv: 0, avtosbor: 0, udobrenie: 0 },
    playerId: genPlayerId(),
    referredBy: urlRef,
    referralBonusReceived: false,
    friendEntries: [],
  };
}

function saveState(s: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/* Derive computed friend view for the Friends screen */
interface ComputedFriend {
  id: string;
  displayName: string;
  pendingFruit: number;
  claimedHarvested: number;
  seedlingAwarded: boolean;
}

function computeFriends(state: PersistedState): ComputedFriend[] {
  const peers = readPeerStore(state.playerId);
  return peers
    .filter((p) => p.hasPlantedFirstTree)
    .map((p) => {
      const entry = state.friendEntries.find((e) => e.id === p.id);
      const claimed = entry?.claimedHarvested ?? 0;
      return {
        id: p.id,
        displayName: p.displayName,
        pendingFruit: Math.max(0, Math.floor((p.totalHarvested - claimed) * 0.15)),
        claimedHarvested: claimed,
        seedlingAwarded: entry?.seedlingAwarded ?? false,
      };
    })
    .sort((a, b) => b.pendingFruit - a.pendingFruit);
}

/* ─── Game shell ─────────────────────────────────────────────────── */
function GameShell({ children, bg = "/FonOSNOVNOI.webp" }: { children?: React.ReactNode; bg?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: "-8%",
        backgroundImage: `url('${bg}')`,
        backgroundSize: "cover", backgroundPosition: "center",
        filter: "blur(14px) brightness(0.45)", zIndex: 0,
      }} />
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(100vw, calc(100vh * 9 / 16))",
        height: "min(100vh, calc(100vw * 16 / 9))",
        overflow: "hidden", containerType: "inline-size", zIndex: 1,
      }}>
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: `url('${bg}')`,
          backgroundSize: "cover", backgroundPosition: "center",
        }} />
        {children}
      </div>
    </div>
  );
}

/* ─── Top balance bar ───────────────────────────────────────────── */
function TopBar({ cedro, fruit }: { cedro: number; fruit: number }) {
  return (
    <div style={{
      position: "absolute", top: "2.2%", left: "3%", right: "3%",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "2%", zIndex: 20,
    }}>
      {[
        { src: "/BalanzCDR.webp", val: cedro },
        { src: "/OrchardZENTR.webp", val: null },
        { src: "/BalanzPLD.webp", val: fruit },
      ].map(({ src, val }, i) => (
        <div key={i} style={{ position: "relative", flex: "0 0 30%" }}>
          <img src={src} alt="" draggable={false}
            style={{ width: "100%", display: "block", userSelect: "none" }} />
          {val !== null && (
            <span style={{
              position: "absolute", left: "63%", top: "50%",
              transform: "translate(-50%,-50%)",
              fontSize: "3.8cqw", fontWeight: "700", color: "#3b1f00",
              lineHeight: 1, whiteSpace: "nowrap",
              pointerEvents: "none", userSelect: "none",
            }}>{fmt(val)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── NavBar ────────────────────────────────────────────────────── */
function NavBar() {
  const [, navigate] = useLocation();
  return (
    <div style={{
      position: "absolute", bottom: "5.2%", left: "3%", right: "3%",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "2%", zIndex: 30,
    }}>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => navigate(item.path)}
          style={{
            flex: "0 0 22%", padding: 0, border: "none",
            background: "transparent", cursor: "pointer", transition: "transform 0.12s",
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.92)"; }}
          onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        >
          <img src={item.img} alt={item.label} draggable={false}
            style={{ width: "100%", display: "block", userSelect: "none" }} />
        </button>
      ))}
    </div>
  );
}

/* ─── Close button ──────────────────────────────────────────────── */
function CloseBtn({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <div onClick={onClose} style={{
      position: "absolute", top: "3%", left: "4%", width: "11%", aspectRatio: "1",
      cursor: "pointer", zIndex: 35, userSelect: "none",
    }}
      onPointerDown={() => { if (ref.current) ref.current.style.transform = "scale(0.9)"; }}
      onPointerUp={()   => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
      onPointerLeave={() => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
    >
      <span ref={ref} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        <img src="/KnopkaX.webp" alt="Закрыть" draggable={false} loading="eager"
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </span>
    </div>
  );
}

/* ─── Screen header ─────────────────────────────────────────────── */
function ScreenHeader({ src, alt }: { src: string; alt: string }) {
  return (
    <div style={{
      position: "absolute", top: "3%", left: "50%", transform: "translateX(-50%)",
      width: "50%", zIndex: 34, pointerEvents: "none",
    }}>
      <img src={src} alt={alt} draggable={false} loading="eager"
        style={{ width: "100%", display: "block", userSelect: "none" }} />
    </div>
  );
}

/* ─── PressBtn ──────────────────────────────────────────────────── */
function PressBtn({ onClick, style, children, disabled }: {
  onClick?: () => void; style?: React.CSSProperties;
  children: React.ReactNode; disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const scale = (v: string) => { if (ref.current) ref.current.style.transform = v; };
  return (
    <div onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? "default" : "pointer", userSelect: "none", ...style }}
      onPointerDown={() => { if (!disabled) scale("scale(0.92)"); }}
      onPointerUp={()   => scale("scale(1)")}
      onPointerLeave={() => scale("scale(1)")}
    >
      <span ref={ref} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        {children}
      </span>
    </div>
  );
}

/* ─── ArrowBtn ──────────────────────────────────────────────────── */
function ArrowBtn({ direction, onClick, visible }: {
  direction: "left" | "right"; onClick: () => void; visible: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const scale = (v: string) => { if (ref.current) ref.current.style.transform = v; };
  if (!visible) return null;
  return (
    <div onClick={onClick} style={{
      position: "absolute", bottom: "32%",
      [direction === "left" ? "left" : "right"]: "1%",
      width: "13%", aspectRatio: "1", zIndex: 28, cursor: "pointer", userSelect: "none",
    }}
      onPointerDown={() => scale("scale(0.88)")}
      onPointerUp={()   => scale("scale(1)")}
      onPointerLeave={() => scale("scale(1)")}
    >
      <span ref={ref} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        <img src={direction === "left" ? "/StrelkaLeft.webp" : "/StrelkaRight.webp"} alt="" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </span>
    </div>
  );
}

/* ─── Plot dots ─────────────────────────────────────────────────── */
function PlotDots({ total, current }: { total: number; current: number }) {
  if (total <= 1) return null;
  return (
    <div style={{
      position: "absolute", bottom: "18%", left: "50%", transform: "translateX(-50%)",
      display: "flex", gap: "1.5cqw", zIndex: 28, pointerEvents: "none",
    }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: "2.5cqw", height: "2.5cqw", borderRadius: "50%",
          background: i === current ? "#f4c842" : "rgba(255,255,255,0.5)",
          boxShadow: i === current ? "0 0 6px rgba(244,200,66,0.9)" : "none",
          transition: "background 0.2s",
        }} />
      ))}
    </div>
  );
}

/* ─── Planting timer ────────────────────────────────────────────── */
function PlantingTimer({ phaseStartedAt }: { phaseStartedAt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, PLANTING_DURATION - (Date.now() - phaseStartedAt) / 1000)
  );
  useEffect(() => {
    const id = setInterval(() =>
      setRemaining(Math.max(0, PLANTING_DURATION - (Date.now() - phaseStartedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [phaseStartedAt]);
  const dashOffset = CIRCUMFERENCE * (1 - remaining / PLANTING_DURATION);
  return (
    <div style={{
      position: "absolute", left: "50%", bottom: "37%", transform: "translateX(-50%)",
      width: "13%", aspectRatio: "1", zIndex: 25, pointerEvents: "none",
    }}>
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="40" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="#f4c842" strokeWidth="8"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={dashOffset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.22s linear" }} />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "3.2cqw", fontWeight: "700",
        textShadow: "0 1px 4px rgba(0,0,0,0.9)", lineHeight: 1,
      }}>{Math.ceil(remaining)}</span>
    </div>
  );
}

/* ─── Harvest pop ───────────────────────────────────────────────── */
interface HarvestPop { id: number; amount: number }
function HarvestPopLabel({ amount, onDone }: { amount: number; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1400); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{
      position: "absolute", left: "50%", bottom: "52%", transform: "translateX(-50%)",
      zIndex: 40, pointerEvents: "none", animation: "harvestPop 1.4s ease-out forwards",
      color: "#f4c842", fontSize: "7cqw", fontWeight: "800",
      textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(244,200,66,0.6)", whiteSpace: "nowrap",
    }}>+{fmt(amount)}</div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   GAME SCREEN
════════════════════════════════════════════════════════════════════ */
function Game() {
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [pops, setPops] = useState<HarvestPop[]>([]);
  const popIdRef = useRef(0);

  useEffect(() => { saveState(persisted); }, [persisted]);
  const ref = useRef(persisted); ref.current = persisted;

  const { plots, currentPlotIdx, cedro, fruit } = persisted;
  const currentPlot = plots[currentPlotIdx] ?? emptyPlot();
  const { gameState, phaseIdx } = currentPlot;
  const hasSeedling = persisted.inventory.sazhenec > 0;
  const anyActive   = plots.some((p) => p.gameState !== "idle");

  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => {
      const next = resolveState(ref.current, Date.now());
      const changed = next.plots.some((p, i) =>
        p.gameState !== ref.current.plots[i]?.gameState || p.phaseIdx !== ref.current.plots[i]?.phaseIdx);
      if (changed) setPersisted(next);
    }, 500);
    return () => clearInterval(id);
  }, [anyActive]);

  const plotImg = gameState === "idle" || gameState === "planting"
    ? "/DerevoFaza0.webp"
    : GROWTH_PHASES[phaseIdx]?.img ?? GROWTH_PHASES[GROWTH_PHASES.length - 1].img;

  const showHarvestBtn = gameState === "growing" && phaseIdx === HARVEST_PHASE_IDX;

  function handlePlant() {
    if (!hasSeedling) return;
    setPersisted((p) => {
      const isFirstEver = p.plots.every(pl => pl.gameState === "idle" && pl.harvestPresses === 0)
        && !p.referralBonusReceived;

      /* Referral bonus: +1200 fruit on very first plant, and register with referrer */
      let extraFruit = 0;
      if (isFirstEver && p.referredBy) {
        extraFruit = REFERRAL_BONUS;
        peerRegister(p.referredBy, p.playerId, `#${p.playerId.slice(0, 6)}`);
      }

      const newPlots = p.plots.map((pl, i) =>
        i === p.currentPlotIdx
          ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() }
          : pl
      );
      return {
        ...p,
        plots: newPlots,
        fruit: p.fruit + extraFruit,
        inventory: { ...p.inventory, sazhenec: p.inventory.sazhenec - 1 },
        referralBonusReceived: isFirstEver && p.referredBy ? true : p.referralBonusReceived,
      };
    });
  }

  function handleHarvest() {
    const id = ++popIdRef.current;
    setTimeout(() => { setPops((prev) => [...prev, { id, amount: BASE_YIELD }]); }, 0);
    setPersisted((s) => {
      /* If referred, add harvest to peer store so referrer gets 15% */
      if (s.referredBy) peerAddHarvest(s.referredBy, s.playerId, BASE_YIELD);
      return {
        ...s,
        fruit: s.fruit + BASE_YIELD,
        plots: s.plots.map((p, i) =>
          i === s.currentPlotIdx
            ? { ...p, phaseIdx: WINDDOWN_PHASE_IDX, phaseStartedAt: Date.now(), harvestPresses: p.harvestPresses + 1 }
            : p
        ),
      };
    });
  }

  const goLeft  = () => setPersisted((s) => ({ ...s, currentPlotIdx: Math.max(0, s.currentPlotIdx - 1) }));
  const goRight = () => setPersisted((s) => ({ ...s, currentPlotIdx: Math.min(s.plots.length - 1, s.currentPlotIdx + 1) }));
  const removePop = (id: number) => setPops((prev) => prev.filter((p) => p.id !== id));

  return (
    <>
      <style>{`
        @keyframes harvestPop {
          0%   { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
          20%  { opacity:1; transform:translateX(-50%) translateY(-8%) scale(1.15); }
          100% { opacity:0; transform:translateX(-50%) translateY(-30%) scale(0.9); }
        }
      `}</style>
      <GameShell>
        <TopBar cedro={cedro} fruit={fruit} />

        {/* Phase image — fixed container prevents shift between transitions */}
        <div style={{
          position: "absolute", left: "50%", bottom: "19.2%",
          width: "93.6%", aspectRatio: PHASE_ASPECT,
          transform: "translateX(-50%)", zIndex: 15, pointerEvents: "none",
        }}>
          <img src={plotImg} alt="" draggable={false} style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "fill", userSelect: "none",
          }} />
        </div>

        {/* Shovel — disabled/faded when no seedlings */}
        {gameState === "idle" && (
          <button onClick={hasSeedling ? handlePlant : undefined} style={{
            position: "absolute", left: "50%", bottom: "37%", transform: "translateX(-50%)",
            width: "14%", aspectRatio: "1", padding: 0, border: "none",
            background: "transparent", cursor: hasSeedling ? "pointer" : "default",
            zIndex: 25, transition: "transform 0.12s", opacity: hasSeedling ? 1 : 0.45,
          }}
            onPointerDown={(e) => { if (hasSeedling) (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(0.9)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/KnopkaPOSADIT.webp" alt="Посадить" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </button>
        )}

        {gameState === "planting" && <PlantingTimer phaseStartedAt={currentPlot.phaseStartedAt} />}

        {showHarvestBtn && (
          <button onClick={handleHarvest} style={{
            position: "absolute", left: "50%", top: "8%", transform: "translateX(-50%)",
            width: "26%", padding: 0, border: "none", background: "transparent",
            cursor: "pointer", zIndex: 25, transition: "transform 0.12s",
          }}
            onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(0.93)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/SborPlodov.webp" alt="Собрать плоды" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </button>
        )}

        {pops.map((pop) => <HarvestPopLabel key={pop.id} amount={pop.amount} onDone={() => removePop(pop.id)} />)}

        <ArrowBtn direction="left"  onClick={goLeft}  visible={currentPlotIdx > 0} />
        <ArrowBtn direction="right" onClick={goRight} visible={currentPlotIdx < plots.length - 1} />
        <PlotDots total={plots.length} current={currentPlotIdx} />
        <NavBar />
      </GameShell>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   FRIENDS SCREEN
════════════════════════════════════════════════════════════════════ */
const FRIENDS_CAROUSEL_VISIBLE = 3; /* max cards shown at once */

function FriendsScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [topIdx, setTopIdx] = useState(0);
  const [copyMsg, setCopyMsg] = useState("");

  useEffect(() => { saveState(persisted); }, [persisted]);

  /* Build referral link */
  const base = window.location.origin + (import.meta.env.BASE_URL?.replace(/\/$/, "") || "");
  const refLink = `${base}/?ref=${persisted.playerId}`;

  /* Compute friends from peer store */
  const friends = computeFriends(persisted);

  /* On mount: check if any friends triggered seedling awards */
  useEffect(() => {
    const newFriends = friends.filter((f) => !f.seedlingAwarded);
    if (newFriends.length === 0) return;
    setPersisted((s) => {
      const awarded = newFriends.length;
      const updatedEntries: FriendEntry[] = [...s.friendEntries];
      newFriends.forEach((f) => {
        const idx = updatedEntries.findIndex((e) => e.id === f.id);
        if (idx >= 0) updatedEntries[idx] = { ...updatedEntries[idx], seedlingAwarded: true };
        else updatedEntries.push({ id: f.id, seedlingAwarded: true, claimedHarvested: f.claimedHarvested });
      });
      return {
        ...s,
        inventory: { ...s.inventory, sazhenec: s.inventory.sazhenec + awarded },
        friendEntries: updatedEntries,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Carousel scroll */
  const maxTop = Math.max(0, friends.length - FRIENDS_CAROUSEL_VISIBLE);
  const canScrollUp   = topIdx > 0;
  const canScrollDown = topIdx < maxTop;
  const visibleFriends = friends.slice(topIdx, topIdx + FRIENDS_CAROUSEL_VISIBLE);

  /* Invite via Web Share API or clipboard */
  async function handleInvite() {
    const text = `Играй в ORCHARD! Посади своё первое дерево и получи +${REFERRAL_BONUS} плодов 🌳\n${refLink}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "ORCHARD", text, url: refLink });
      } else {
        await navigator.clipboard.writeText(refLink);
        setCopyMsg("Ссылка скопирована!");
        setTimeout(() => setCopyMsg(""), 2500);
      }
    } catch {
      await navigator.clipboard.writeText(refLink).catch(() => {});
      setCopyMsg("Ссылка скопирована!");
      setTimeout(() => setCopyMsg(""), 2500);
    }
  }

  /* Copy link from white field tap */
  async function handleCopyLink() {
    await navigator.clipboard.writeText(refLink).catch(() => {});
    setCopyMsg("Скопировано!");
    setTimeout(() => setCopyMsg(""), 2000);
  }

  /* Claim pending fruit from a friend */
  function handleClaim(friendId: string, pendingFruit: number, totalFriendHarvested: number) {
    if (pendingFruit <= 0) return;
    setPersisted((s) => {
      const entries = [...s.friendEntries];
      const idx = entries.findIndex((e) => e.id === friendId);
      if (idx >= 0) entries[idx] = { ...entries[idx], claimedHarvested: totalFriendHarvested };
      else entries.push({ id: friendId, seedlingAwarded: true, claimedHarvested: totalFriendHarvested });
      return { ...s, fruit: s.fruit + pendingFruit, friendEntries: entries };
    });
  }

  return (
    <GameShell bg="/FonDRUZYA.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderDRUZYA.webp" alt="Друзья" />

      <div style={{
        position: "absolute",
        top: "13%", left: "2%", right: "2%", bottom: "2%",
        zIndex: 20, display: "flex", flexDirection: "column", gap: "2%",
        overflow: "hidden",
      }}>

        {/* ── Invite panel ────────────────────────────────────── */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <img src="/DruzyaPanelInvite.webp" alt="" draggable={false}
            style={{ width: "100%", display: "block", userSelect: "none" }} />

          {/* White link field overlay */}
          <div onClick={handleCopyLink} style={{
            position: "absolute",
            top: "27%", left: "6%", right: "6%", height: "26%",
            display: "flex", alignItems: "center",
            cursor: "pointer", borderRadius: "2cqw",
            overflow: "hidden",
          }}>
            <span style={{
              width: "100%", fontSize: "2.9cqw", color: "#3a2200",
              fontWeight: "600", textAlign: "center",
              padding: "0 2cqw",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              lineHeight: 1.2,
            }}>{refLink}</span>
          </div>

          {/* Copy notification */}
          {copyMsg && (
            <div style={{
              position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: "#f4c842",
              fontSize: "3cqw", fontWeight: "700",
              borderRadius: "2cqw", padding: "1cqw 3cqw",
              whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
            }}>{copyMsg}</div>
          )}

          {/* Invite button */}
          <div onClick={handleInvite} style={{
            position: "absolute",
            bottom: "10%", left: "50%", transform: "translateX(-50%)",
            width: "55%", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#f4c842,#e8a020)",
            borderRadius: "8cqw", padding: "2.5cqw 0",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            userSelect: "none",
          }}
            onPointerDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(0.95)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <span style={{
              fontSize: "3.8cqw", fontWeight: "800", color: "#3a1400",
              textShadow: "0 1px 2px rgba(255,255,255,0.3)",
            }}>📨 Пригласить</span>
          </div>
        </div>

        {/* ── Friends carousel ─────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: "1.5%" }}>

          {friends.length === 0 && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.65)", fontSize: "4cqw", fontWeight: "600",
              textAlign: "center", textShadow: "0 1px 6px rgba(0,0,0,0.8)",
              lineHeight: 1.4, padding: "0 8%",
            }}>
              Пригласите друзей по реферальной ссылке 🌳
            </div>
          )}

          {/* Cards */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: "2%" }}>
            {visibleFriends.map((friend) => {
              const peer = readPeerStore(persisted.playerId).find(p => p.id === friend.id);
              const totalHarvested = peer?.totalHarvested ?? 0;
              return (
                <FriendCard
                  key={friend.id}
                  friend={friend}
                  onClaim={() => handleClaim(friend.id, friend.pendingFruit, totalHarvested)}
                />
              );
            })}
          </div>

          {/* Carousel scroll controls */}
          {friends.length > FRIENDS_CAROUSEL_VISIBLE && (
            <div style={{
              display: "flex", justifyContent: "center", gap: "4%",
              flexShrink: 0, paddingBottom: "1%",
            }}>
              <CarouselArrow dir="up"   active={canScrollUp}   onClick={() => setTopIdx((i) => Math.max(0, i - 1))} />
              <span style={{
                color: "rgba(255,255,255,0.7)", fontSize: "3.5cqw",
                display: "flex", alignItems: "center",
              }}>{topIdx + 1}–{Math.min(topIdx + FRIENDS_CAROUSEL_VISIBLE, friends.length)} / {friends.length}</span>
              <CarouselArrow dir="down" active={canScrollDown} onClick={() => setTopIdx((i) => Math.min(maxTop, i + 1))} />
            </div>
          )}
        </div>
      </div>
    </GameShell>
  );
}

/* ─── Friend profile card ───────────────────────────────────────── */
function FriendCard({ friend, onClaim }: { friend: ComputedFriend; onClaim: () => void }) {
  const hasBalance = friend.pendingFruit > 0;
  return (
    <div style={{ position: "relative", width: "100%", flexShrink: 0 }}>
      <img src="/DruzyaPanelProfile.webp" alt="" draggable={false}
        style={{ width: "100%", display: "block", userSelect: "none" }} />

      {/* Nickname — between avatar icon area and orange */}
      <div style={{
        position: "absolute",
        top: "20%", left: "22%", right: "42%", bottom: "20%",
        display: "flex", alignItems: "center",
        overflow: "hidden",
      }}>
        <span style={{
          fontSize: "3.5cqw", fontWeight: "700", color: "#3a1a00",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          lineHeight: 1,
        }}>{friend.displayName}</span>
      </div>

      {/* Orange with balance */}
      <div style={{
        position: "absolute",
        top: "15%", right: "26%", bottom: "15%",
        width: "12%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: "5cqw", lineHeight: 1 }}>🍊</span>
        <span style={{
          fontSize: "2.8cqw", fontWeight: "800", color: "#3a1a00",
          lineHeight: 1.1, marginTop: "0.5cqw", whiteSpace: "nowrap",
        }}>{fmt(friend.pendingFruit)}</span>
      </div>

      {/* Claim button */}
      <PressBtn
        onClick={hasBalance ? onClaim : undefined}
        disabled={!hasBalance}
        style={{
          position: "absolute", right: "2%", top: "50%", transform: "translateY(-50%)",
          width: "22%", opacity: hasBalance ? 1 : 0.45,
        }}
      >
        <img src="/DruzyaKnopkaClaim.webp" alt="Получить" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </PressBtn>
    </div>
  );
}

/* ─── Carousel scroll arrow ─────────────────────────────────────── */
function CarouselArrow({ dir, active, onClick }: { dir: "up" | "down"; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} onClick={active ? onClick : undefined} style={{
      width: "8cqw", height: "8cqw", borderRadius: "50%",
      background: active ? "rgba(244,200,66,0.85)" : "rgba(255,255,255,0.2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: active ? "pointer" : "default",
      fontSize: "4cqw", lineHeight: 1, userSelect: "none",
      border: active ? "0.5cqw solid rgba(180,120,0,0.5)" : "0.5cqw solid rgba(255,255,255,0.15)",
      transition: "transform 0.12s",
    }}
      onPointerDown={() => { if (active && ref.current) ref.current.style.transform = "scale(0.88)"; }}
      onPointerUp={()   => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
      onPointerLeave={() => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
    >
      {dir === "up" ? "▲" : "▼"}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SHOP SCREEN
════════════════════════════════════════════════════════════════════ */
function ShopScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  useEffect(() => { saveState(persisted); }, [persisted]);

  function handleBuy(key: ItemKey) {
    setPersisted((p) => ({ ...p, inventory: { ...p.inventory, [key]: p.inventory[key] + 1 } }));
  }

  return (
    <GameShell bg="/FonMAGAZIN.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderMAGAZIN.webp" alt="Магазин" />
      <div style={{
        position: "absolute", top: "14%", left: "3%", right: "3%", bottom: "2%",
        overflowY: "auto", zIndex: 20, scrollbarWidth: "none",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3%", padding: "2% 1% 4%" }}>
          {SHOP_ITEMS.map((item) => (
            <div key={item.key} style={{ position: "relative", width: "100%" }}>
              <img src={item.img} alt={item.label} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />
              <PressBtn onClick={() => handleBuy(item.key)}
                style={{ position: "absolute", right: "2%", top: "50%", transform: "translateY(-50%)", width: "22%" }}>
                <img src="/KnopkaKUPIT.webp" alt="Купить" draggable={false}
                  style={{ width: "100%", display: "block", userSelect: "none" }} />
              </PressBtn>
            </div>
          ))}
        </div>
      </div>
    </GameShell>
  );
}

/* ════════════════════════════════════════════════════════════════════
   WAREHOUSE SCREEN
════════════════════════════════════════════════════════════════════ */
function WarehouseScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  useEffect(() => { saveState(persisted); }, [persisted]);

  const currentPlot   = persisted.plots[persisted.currentPlotIdx] ?? emptyPlot();
  const currentIdle   = currentPlot.gameState === "idle";
  const hasAnyIdle    = persisted.plots.some((pl) => pl.gameState === "idle");
  const ownedItems    = SHOP_ITEMS.filter((item) => persisted.inventory[item.key] > 0);

  function handleUse(key: ItemKey) {
    setPersisted((p) => {
      if (p.inventory[key] <= 0) return p;
      const newInv = { ...p.inventory, [key]: p.inventory[key] - 1 };

      if (key === "uchastok") {
        const newState = { ...p, inventory: newInv, plots: [...p.plots, emptyPlot()] };
        saveState(newState); navigate("/"); return newState;
      }
      if (key === "sazhenec") {
        const idlePlotIdx = p.plots.findIndex((pl) => pl.gameState === "idle");
        if (idlePlotIdx === -1) return p;
        const newPlots = p.plots.map((pl, i) =>
          i === idlePlotIdx
            ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() }
            : pl
        );
        const newState = { ...p, inventory: newInv, plots: newPlots, currentPlotIdx: idlePlotIdx };
        saveState(newState); navigate("/"); return newState;
      }
      return { ...p, inventory: newInv };
    });
  }

  return (
    <GameShell bg="/FonSKLAD.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderSKLAD.webp" alt="Склад" />
      <div style={{
        position: "absolute", top: "14%", left: "3%", right: "3%", bottom: "2%",
        overflowY: "auto", zIndex: 20, scrollbarWidth: "none",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3%", padding: "2% 1% 4%" }}>
          {ownedItems.length === 0 && (
            <div style={{
              color: "rgba(255,255,255,0.7)", fontSize: "4.5cqw", fontWeight: "600",
              textAlign: "center", marginTop: "20%",
              textShadow: "0 1px 6px rgba(0,0,0,0.8)",
            }}>Склад пуст</div>
          )}
          {ownedItems.map((item) => {
            const count   = persisted.inventory[item.key];
            const isDisabled = item.key === "sazhenec" && !hasAnyIdle;
            return (
              <div key={item.key} style={{ position: "relative", width: "100%" }}>
                <img src={item.img} alt={item.label} draggable={false}
                  style={{ width: "100%", display: "block", userSelect: "none" }} />
                <div style={{
                  position: "absolute", left: "3%", top: "50%", transform: "translateY(-50%)",
                  background: "rgba(0,0,0,0.65)", color: "#fff",
                  fontSize: "4.5cqw", fontWeight: "800",
                  borderRadius: "2cqw", padding: "0.5cqw 1.5cqw",
                  border: "0.3cqw solid rgba(255,255,255,0.3)", lineHeight: 1,
                  pointerEvents: "none", minWidth: "5cqw", textAlign: "center",
                }}>{count}</div>
                <PressBtn onClick={() => handleUse(item.key)} disabled={isDisabled}
                  style={{
                    position: "absolute", right: "2%", top: "50%",
                    transform: "translateY(-50%)", width: "22%",
                  }}>
                  <img src={isDisabled ? "/KnopkaISPOLZOVAT2.webp" : "/KnopkaISPOLZOVAT.webp"}
                    alt="Использовать" draggable={false}
                    style={{ width: "100%", display: "block", userSelect: "none" }} />
                </PressBtn>
              </div>
            );
          })}
        </div>
      </div>
    </GameShell>
  );
}

/* ─── Generic nav screen ────────────────────────────────────────── */
function NavScreen({ bg, headerSrc, headerAlt }: { bg: string; headerSrc: string; headerAlt: string }) {
  const [, navigate] = useLocation();
  return (
    <GameShell bg={bg}>
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src={headerSrc} alt={headerAlt} />
    </GameShell>
  );
}

/* ─── Router ────────────────────────────────────────────────────── */
function Router() {
  return (
    <Switch>
      <Route path="/"         component={Game} />
      <Route path="/druzya"   component={FriendsScreen} />
      <Route path="/zadaniya" component={() => (
        <NavScreen bg="/FonDOSTIZHENIYA.webp" headerSrc="/HeaderDOSTIZHENIYA.webp" headerAlt="Достижения" />
      )} />
      <Route path="/sklad"    component={WarehouseScreen} />
      <Route path="/magazin"  component={ShopScreen} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

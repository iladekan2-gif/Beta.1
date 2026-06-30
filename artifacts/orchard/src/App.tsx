import { useState, useEffect, useRef } from "react";
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
const REFERRAL_BONUS     = 1200;
const PLANTING_DURATION  = 30;
const CIRCUMFERENCE      = 2 * Math.PI * 40;

const NAV = [
  { id: "druzya",   path: "/druzya",   img: "/PanelDRUZYA.webp",   label: "Друзья"  },
  { id: "zadaniya", path: "/zadaniya", img: "/PanelZADANIYA.webp", label: "Задания" },
  { id: "sklad",    path: "/sklad",    img: "/PanelSKLAD.webp",    label: "Склад"   },
  { id: "magazin",  path: "/magazin",  img: "/PanelMAGAZIN.webp",  label: "Магазин" },
];

type ItemKey = "sazhenec" | "uchastok" | "avtopoliv" | "avtosbor" | "udobrenie";

const SHOP_ITEMS: { key: ItemKey; img: string; label: string; desc: string }[] = [
  { key: "sazhenec",  img: "/ItemSazhenec.webp",  label: "Саженец",    desc: "Посади новое дерево на участке" },
  { key: "uchastok",  img: "/ItemUchastok.webp",  label: "Участок",    desc: "Добавь новый участок для деревьев" },
  { key: "avtopoliv", img: "/ItemAvtopoliv.webp", label: "Автополив",  desc: "Автоматический полив деревьев" },
  { key: "avtosbor",  img: "/ItemAvtosbor.webp",  label: "Автосбор",   desc: "Автоматический сбор урожая" },
  { key: "udobrenie", img: "/ItemUdobrenie.webp", label: "Удобрение",  desc: "Ускоряет рост дерева" },
];

interface Task {
  id: string;
  label: string;
  desc: string;
  reward: { type: "fruit" | "sazhenec"; amount: number };
  check: (s: PersistedState) => boolean;
}

const TASKS: Task[] = [
  {
    id: "plant_first",
    label: "Первое дерево",
    desc: "Посади своё первое дерево",
    reward: { type: "sazhenec", amount: 1 },
    check: (s) => s.plots.some((p) => p.gameState !== "idle" || p.harvestPresses > 0),
  },
  {
    id: "harvest_first",
    label: "Первый урожай",
    desc: "Собери свой первый урожай",
    reward: { type: "fruit", amount: 500 },
    check: (s) => s.plots.some((p) => p.harvestPresses > 0),
  },
  {
    id: "invite_friend",
    label: "Пригласи друга",
    desc: "Пригласи друга по реферальной ссылке",
    reward: { type: "sazhenec", amount: 2 },
    check: (s) => s.friendEntries.length > 0,
  },
  {
    id: "harvest_5",
    label: "Опытный садовод",
    desc: "Собери урожай 5 раз",
    reward: { type: "fruit", amount: 2000 },
    check: (s) => s.plots.reduce((acc, p) => acc + p.harvestPresses, 0) >= 5,
  },
  {
    id: "harvest_10",
    label: "Мастер сада",
    desc: "Собери урожай 10 раз",
    reward: { type: "fruit", amount: 5000 },
    check: (s) => s.plots.reduce((acc, p) => acc + p.harvestPresses, 0) >= 10,
  },
];

/* ─── Formatters ────────────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1_000_000_000) { const v = n / 1_000_000_000; return `${v % 1 === 0 ? v : v.toFixed(1)}b`; }
  if (n >= 1_000_000)     { const v = n / 1_000_000;     return `${v % 1 === 0 ? v : v.toFixed(1)}m`; }
  if (n >= 10_000)        { const v = n / 1_000;         return `${v % 1 === 0 ? v : v.toFixed(1)}к`; }
  return n.toLocaleString("ru-RU");
}

/* ─── Peer-store: localStorage referral bridge ───────────────────── */
interface PeerEntry {
  id: string;
  displayName: string;
  hasPlantedFirstTree: boolean;
  totalHarvested: number;
}

function pKey(rid: string) { return `orchard_peer_${rid}`; }
function readPeerStore(rid: string): PeerEntry[] {
  try { return JSON.parse(localStorage.getItem(pKey(rid)) ?? "[]"); } catch { return []; }
}
function writePeerStore(rid: string, e: PeerEntry[]) {
  localStorage.setItem(pKey(rid), JSON.stringify(e));
}
function peerRegister(rid: string, id: string, name: string) {
  const e = readPeerStore(rid);
  const i = e.findIndex((x) => x.id === id);
  if (i < 0) e.push({ id, displayName: name, hasPlantedFirstTree: true, totalHarvested: 0 });
  else { e[i].hasPlantedFirstTree = true; e[i].displayName = name; }
  writePeerStore(rid, e);
}
function peerAddHarvest(rid: string, id: string, amount: number) {
  const e = readPeerStore(rid);
  const i = e.findIndex((x) => x.id === id);
  if (i >= 0) { e[i].totalHarvested += amount; writePeerStore(rid, e); }
}

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

interface FriendEntry {
  id: string;
  seedlingAwarded: boolean;
  claimedHarvested: number;
}

interface PersistedState {
  plots: PlotState[];
  currentPlotIdx: number;
  cedro: number;
  fruit: number;
  inventory: Inventory;
  playerId: string;
  referredBy: string | null;
  referralBonusReceived: boolean;
  friendEntries: FriendEntry[];
  claimedTaskIds: string[];
}

function emptyPlot(): PlotState {
  return { gameState: "idle", phaseIdx: 0, phaseStartedAt: 0, harvestPresses: 0 };
}

function resolvePlot(plot: PlotState, now: number): PlotState {
  let cur = { ...plot };
  for (;;) {
    if (cur.gameState === "idle") break;
    const dur = cur.gameState === "planting"
      ? PLANTING_DURATION : (GROWTH_PHASES[cur.phaseIdx]?.duration ?? 120);
    const elapsed = (now - cur.phaseStartedAt) / 1000;
    if (elapsed < dur) break;
    const overflow = (elapsed - dur) * 1000;
    const nextStart = now - overflow;
    if (cur.gameState === "planting") {
      cur = { ...cur, gameState: "growing", phaseIdx: 0, phaseStartedAt: nextStart };
    } else {
      const ni = cur.phaseIdx + 1;
      cur = ni < GROWTH_PHASES.length
        ? { ...cur, phaseIdx: ni, phaseStartedAt: nextStart }
        : { ...cur, phaseIdx: PHASE6_IDX, phaseStartedAt: nextStart };
    }
  }
  return cur;
}

function resolveState(s: PersistedState, now: number): PersistedState {
  return { ...s, plots: s.plots.map((p) => resolvePlot(p, now)) };
}

const STORAGE_KEY = "orchard_v10";

function loadState(): PersistedState {
  const urlRef = new URLSearchParams(window.location.search).get("ref") ?? null;
  if (urlRef) window.history.replaceState({}, "", window.location.pathname);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as PersistedState;
      if (urlRef && !s.referredBy) return { ...s, referredBy: urlRef };
      return s;
    }
  } catch {}
  return {
    plots: [emptyPlot()], currentPlotIdx: 0, cedro: 0, fruit: 0,
    inventory: { sazhenec: 1, uchastok: 0, avtopoliv: 0, avtosbor: 0, udobrenie: 0 },
    playerId: genPlayerId(),
    referredBy: urlRef,
    referralBonusReceived: false,
    friendEntries: [],
    claimedTaskIds: [],
  };
}

function saveState(s: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface ComputedFriend {
  id: string; displayName: string;
  pendingFruit: number; claimedHarvested: number; seedlingAwarded: boolean;
}

function computeFriends(state: PersistedState): ComputedFriend[] {
  return readPeerStore(state.playerId)
    .filter((p) => p.hasPlantedFirstTree)
    .map((p) => {
      const e = state.friendEntries.find((x) => x.id === p.id);
      const claimed = e?.claimedHarvested ?? 0;
      return {
        id: p.id, displayName: p.displayName,
        pendingFruit: Math.max(0, Math.floor((p.totalHarvested - claimed) * 0.15)),
        claimedHarvested: claimed,
        seedlingAwarded: e?.seedlingAwarded ?? false,
      };
    })
    .sort((a, b) => b.pendingFruit - a.pendingFruit);
}

/* ══════════════════════════════════════════════════════════════════
   SHELL & SHARED UI
══════════════════════════════════════════════════════════════════ */
function GameShell({ children, bg = "/FonOSNOVNOI.webp" }: { children?: React.ReactNode; bg?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: "-8%",
        backgroundImage: `url('${bg}')`, backgroundSize: "cover", backgroundPosition: "center",
        filter: "blur(14px) brightness(0.45)", zIndex: 0,
      }} />
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: "min(100vw, calc(100vh * 9 / 16))",
        height: "min(100vh, calc(100vw * 16 / 9))",
        overflow: "hidden", containerType: "inline-size", zIndex: 1,
      }}>
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: `url('${bg}')`, backgroundSize: "cover", backgroundPosition: "center",
        }} />
        {children}
      </div>
    </div>
  );
}

function TopBar({ cedro, fruit }: { cedro: number; fruit: number }) {
  return (
    <div style={{
      position: "absolute", top: "2.2%", left: "3%", right: "3%",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2%", zIndex: 20,
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
              lineHeight: 1, whiteSpace: "nowrap", pointerEvents: "none", userSelect: "none",
            }}>{fmt(val)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function NavBar() {
  const [, navigate] = useLocation();
  return (
    <div style={{
      position: "absolute", bottom: "5.2%", left: "3%", right: "3%",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2%", zIndex: 30,
    }}>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => navigate(item.path)}
          style={{ flex: "0 0 22%", padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
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
        <img src="/KnopkaX.webp" alt="Закрыть" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </span>
    </div>
  );
}

function ScreenHeader({ src, alt }: { src: string; alt: string }) {
  return (
    <div style={{
      position: "absolute", top: "3%", left: "50%", transform: "translateX(-50%)",
      width: "50%", zIndex: 34, pointerEvents: "none",
    }}>
      <img src={src} alt={alt} draggable={false}
        style={{ width: "100%", display: "block", userSelect: "none" }} />
    </div>
  );
}

function PressBtn({ onClick, style, children, disabled }: {
  onClick?: () => void; style?: React.CSSProperties;
  children: React.ReactNode; disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const s = (v: string) => { if (ref.current) ref.current.style.transform = v; };
  return (
    <div onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? "default" : "pointer", userSelect: "none", ...style }}
      onPointerDown={() => { if (!disabled) s("scale(0.92)"); }}
      onPointerUp={()   => s("scale(1)")}
      onPointerLeave={() => s("scale(1)")}
    >
      <span ref={ref} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        {children}
      </span>
    </div>
  );
}

/* Horizontal item carousel — left/right arrows, one item at a time */
function ItemCarousel({ children, total, index, onPrev, onNext }: {
  children: React.ReactNode; total: number; index: number;
  onPrev: () => void; onNext: () => void;
}) {
  const arrowStyle = (side: "left" | "right", active: boolean): React.CSSProperties => ({
    position: "absolute", bottom: "50%", transform: "translateY(50%)",
    [side]: "-6%",
    width: "12%", aspectRatio: "1", zIndex: 10,
    cursor: active ? "pointer" : "default",
    opacity: active ? 1 : 0.3,
    transition: "transform 0.12s, opacity 0.15s",
    userSelect: "none",
  });
  const arrowRef1 = useRef<HTMLDivElement>(null);
  const arrowRef2 = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: "relative", width: "86%", margin: "0 auto" }}>
      {/* Left arrow */}
      <div ref={arrowRef1} onClick={index > 0 ? onPrev : undefined}
        style={arrowStyle("left", index > 0)}
        onPointerDown={() => { if (arrowRef1.current && index > 0) arrowRef1.current.style.transform = "translateY(50%) scale(0.88)"; }}
        onPointerUp={()   => { if (arrowRef1.current) arrowRef1.current.style.transform = "translateY(50%) scale(1)"; }}
        onPointerLeave={() => { if (arrowRef1.current) arrowRef1.current.style.transform = "translateY(50%) scale(1)"; }}
      >
        <img src="/StrelkaLeft.webp" alt="" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </div>

      {/* Item */}
      <div style={{ overflow: "hidden" }}>{children}</div>

      {/* Right arrow */}
      <div ref={arrowRef2} onClick={index < total - 1 ? onNext : undefined}
        style={arrowStyle("right", index < total - 1)}
        onPointerDown={() => { if (arrowRef2.current && index < total - 1) arrowRef2.current.style.transform = "translateY(50%) scale(0.88)"; }}
        onPointerUp={()   => { if (arrowRef2.current) arrowRef2.current.style.transform = "translateY(50%) scale(1)"; }}
        onPointerLeave={() => { if (arrowRef2.current) arrowRef2.current.style.transform = "translateY(50%) scale(1)"; }}
      >
        <img src="/StrelkaRight.webp" alt="" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </div>

      {/* Dots */}
      {total > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "1.5cqw", marginTop: "2%" }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{
              width: "2cqw", height: "2cqw", borderRadius: "50%",
              background: i === index ? "#f4c842" : "rgba(255,255,255,0.45)",
              boxShadow: i === index ? "0 0 5px rgba(244,200,66,0.8)" : "none",
              transition: "background 0.2s",
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* Vertical friends carousel — topIdx scroll with ▲▼ */
const FRIENDS_VISIBLE = 3;
function CarouselArrow({ dir, active, onClick }: { dir: "up" | "down"; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} onClick={active ? onClick : undefined} style={{
      width: "8cqw", height: "8cqw", borderRadius: "50%",
      background: active ? "rgba(244,200,66,0.85)" : "rgba(255,255,255,0.2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: active ? "pointer" : "default", fontSize: "4cqw", lineHeight: 1, userSelect: "none",
      border: active ? "0.5cqw solid rgba(180,120,0,0.5)" : "0.5cqw solid rgba(255,255,255,0.15)",
      transition: "transform 0.12s",
    }}
      onPointerDown={() => { if (active && ref.current) ref.current.style.transform = "scale(0.88)"; }}
      onPointerUp={()   => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
      onPointerLeave={() => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
    >{dir === "up" ? "▲" : "▼"}</div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   GAME SCREEN
══════════════════════════════════════════════════════════════════ */
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

function ArrowBtn({ direction, onClick, visible }: {
  direction: "left" | "right"; onClick: () => void; visible: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  if (!visible) return null;
  return (
    <div onClick={onClick} style={{
      position: "absolute", bottom: "32%",
      [direction === "left" ? "left" : "right"]: "1%",
      width: "13%", aspectRatio: "1", zIndex: 28, cursor: "pointer", userSelect: "none",
    }}
      onPointerDown={() => { if (ref.current) ref.current.style.transform = "scale(0.88)"; }}
      onPointerUp={()   => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
      onPointerLeave={() => { if (ref.current) ref.current.style.transform = "scale(1)"; }}
    >
      <span ref={ref} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        <img src={direction === "left" ? "/StrelkaLeft.webp" : "/StrelkaRight.webp"} alt="" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </span>
    </div>
  );
}

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
  const anyActive = plots.some((p) => p.gameState !== "idle");

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
      const isFirstEver = p.plots.every((pl) => pl.gameState === "idle" && pl.harvestPresses === 0)
        && !p.referralBonusReceived;
      let extraFruit = 0;
      if (isFirstEver && p.referredBy) {
        extraFruit = REFERRAL_BONUS;
        peerRegister(p.referredBy, p.playerId, `#${p.playerId.slice(0, 6)}`);
      }
      return {
        ...p,
        plots: p.plots.map((pl, i) =>
          i === p.currentPlotIdx
            ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() }
            : pl
        ),
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
      if (s.referredBy) peerAddHarvest(s.referredBy, s.playerId, BASE_YIELD);
      return {
        ...s, fruit: s.fruit + BASE_YIELD,
        plots: s.plots.map((p, i) =>
          i === s.currentPlotIdx
            ? { ...p, phaseIdx: WINDDOWN_PHASE_IDX, phaseStartedAt: Date.now(), harvestPresses: p.harvestPresses + 1 }
            : p
        ),
      };
    });
  }

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

        {pops.map((pop) => (
          <HarvestPopLabel key={pop.id} amount={pop.amount}
            onDone={() => setPops((prev) => prev.filter((p) => p.id !== pop.id))} />
        ))}

        <ArrowBtn direction="left"  onClick={() => setPersisted((s) => ({ ...s, currentPlotIdx: Math.max(0, s.currentPlotIdx - 1) }))} visible={currentPlotIdx > 0} />
        <ArrowBtn direction="right" onClick={() => setPersisted((s) => ({ ...s, currentPlotIdx: Math.min(s.plots.length - 1, s.currentPlotIdx + 1) }))} visible={currentPlotIdx < plots.length - 1} />
        <PlotDots total={plots.length} current={currentPlotIdx} />
        <NavBar />
      </GameShell>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FRIENDS SCREEN
══════════════════════════════════════════════════════════════════ */
function FriendsScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [topIdx, setTopIdx] = useState(0);
  const [copyMsg, setCopyMsg] = useState("");

  useEffect(() => { saveState(persisted); }, [persisted]);

  const base = window.location.origin + (import.meta.env.BASE_URL?.replace(/\/$/, "") || "");
  const refLink = `${base}/?ref=${persisted.playerId}`;

  const friends = computeFriends(persisted);

  /* Award seedlings for newly planted friends */
  useEffect(() => {
    const newFriends = friends.filter((f) => !f.seedlingAwarded);
    if (newFriends.length === 0) return;
    setPersisted((s) => {
      const entries = [...s.friendEntries];
      newFriends.forEach((f) => {
        const idx = entries.findIndex((e) => e.id === f.id);
        if (idx >= 0) entries[idx] = { ...entries[idx], seedlingAwarded: true };
        else entries.push({ id: f.id, seedlingAwarded: true, claimedHarvested: f.claimedHarvested });
      });
      return {
        ...s,
        inventory: { ...s.inventory, sazhenec: s.inventory.sazhenec + newFriends.length },
        friendEntries: entries,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxTop = Math.max(0, friends.length - FRIENDS_VISIBLE);
  const canUp   = topIdx > 0;
  const canDown = topIdx < maxTop;
  const visible = friends.slice(topIdx, topIdx + FRIENDS_VISIBLE);

  async function handleInvite() {
    const text = `Играй в ORCHARD! Посади первое дерево и получи +${REFERRAL_BONUS} плодов 🌳\n${refLink}`;
    try {
      if (navigator.share) await navigator.share({ title: "ORCHARD", text, url: refLink });
      else throw new Error("no share");
    } catch {
      await navigator.clipboard.writeText(refLink).catch(() => {});
      setCopyMsg("Ссылка скопирована!");
      setTimeout(() => setCopyMsg(""), 2500);
    }
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(refLink).catch(() => {});
    setCopyMsg("Скопировано!");
    setTimeout(() => setCopyMsg(""), 2000);
  }

  function handleClaim(friendId: string, pendingFruit: number, totalHarvested: number) {
    if (pendingFruit <= 0) return;
    setPersisted((s) => {
      const entries = [...s.friendEntries];
      const idx = entries.findIndex((e) => e.id === friendId);
      if (idx >= 0) entries[idx] = { ...entries[idx], claimedHarvested: totalHarvested };
      else entries.push({ id: friendId, seedlingAwarded: true, claimedHarvested: totalHarvested });
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

        {/* ── Invite panel ──────────────────────────────────────── */}
        {/* Container is taller than the native image ratio to prevent squishing */}
        <div style={{ position: "relative", flexShrink: 0, height: "46cqw" }}>
          <img src="/DruzyaPanelInvite.webp" alt="" draggable={false} style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "fill", userSelect: "none", display: "block",
          }} />

          {/* Referral link field — fits inside white area */}
          <div onClick={handleCopyLink} style={{
            position: "absolute",
            top: "20%", left: "5%", right: "5%", height: "34%",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", overflow: "hidden", padding: "0 2cqw",
          }}>
            <span style={{
              fontSize: "2.4cqw", color: "#3a2200", fontWeight: "600", textAlign: "center",
              wordBreak: "break-all", lineHeight: 1.3,
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
              overflow: "hidden",
            }}>{refLink}</span>
          </div>

          {/* Copy toast */}
          {copyMsg && (
            <div style={{
              position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: "#f4c842",
              fontSize: "3cqw", fontWeight: "700",
              borderRadius: "2cqw", padding: "1cqw 3cqw",
              whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
            }}>{copyMsg}</div>
          )}

          {/* Invite button — image from DruzyaKnopkaInvite.webp */}
          <div style={{
            position: "absolute",
            bottom: "8%", left: "50%", transform: "translateX(-50%)",
            width: "58%", cursor: "pointer", userSelect: "none",
          }}
            onClick={handleInvite}
            onPointerDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(0.95)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLDivElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/DruzyaKnopkaInvite.webp" alt="Пригласить" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </div>
        </div>

        {/* ── Friends list ───────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: "1.5%" }}>
          {friends.length === 0 ? (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.65)", fontSize: "4cqw", fontWeight: "600",
              textAlign: "center", textShadow: "0 1px 6px rgba(0,0,0,0.8)",
              lineHeight: 1.5, padding: "0 8%",
            }}>
              Пригласите друзей по реферальной ссылке 🌳
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: "2%" }}>
              {visible.map((friend) => {
                const peer = readPeerStore(persisted.playerId).find((p) => p.id === friend.id);
                return (
                  <FriendCard key={friend.id} friend={friend}
                    onClaim={() => handleClaim(friend.id, friend.pendingFruit, peer?.totalHarvested ?? 0)} />
                );
              })}
            </div>
          )}

          {friends.length > FRIENDS_VISIBLE && (
            <div style={{ display: "flex", justifyContent: "center", gap: "4%", flexShrink: 0, paddingBottom: "1%" }}>
              <CarouselArrow dir="up"   active={canUp}   onClick={() => setTopIdx((i) => Math.max(0, i - 1))} />
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "3.5cqw", display: "flex", alignItems: "center" }}>
                {topIdx + 1}–{Math.min(topIdx + FRIENDS_VISIBLE, friends.length)} / {friends.length}
              </span>
              <CarouselArrow dir="down" active={canDown} onClick={() => setTopIdx((i) => Math.min(maxTop, i + 1))} />
            </div>
          )}
        </div>
      </div>
    </GameShell>
  );
}

/* ─── Friend profile card ───────────────────────────────────────── */
function FriendCard({ friend, onClaim }: { friend: ComputedFriend; onClaim: () => void }) {
  const has = friend.pendingFruit > 0;
  return (
    /* Taller container to prevent squished appearance (native: 940×170) */
    <div style={{ position: "relative", width: "100%", height: "24cqw", flexShrink: 0 }}>
      <img src="/DruzyaPanelProfile.webp" alt="" draggable={false} style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "fill", display: "block", userSelect: "none",
      }} />

      {/* Nickname */}
      <div style={{
        position: "absolute", top: "15%", left: "22%", right: "44%", bottom: "15%",
        display: "flex", alignItems: "center", overflow: "hidden",
      }}>
        <span style={{
          fontSize: "3.8cqw", fontWeight: "700", color: "#3a1a00",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1,
        }}>{friend.displayName}</span>
      </div>

      {/* Orange + balance */}
      <div style={{
        position: "absolute", top: "10%", right: "24%", bottom: "10%", width: "14%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: "5.5cqw", lineHeight: 1 }}>🍊</span>
        <span style={{
          fontSize: "3cqw", fontWeight: "800", color: "#3a1a00",
          lineHeight: 1.1, marginTop: "0.5cqw", whiteSpace: "nowrap",
        }}>{fmt(friend.pendingFruit)}</span>
      </div>

      {/* Claim button */}
      <PressBtn onClick={has ? onClaim : undefined} disabled={!has}
        style={{
          position: "absolute", right: "1.5%", top: "50%", transform: "translateY(-50%)",
          width: "21%", opacity: has ? 1 : 0.4,
        }}
      >
        <img src="/DruzyaKnopkaClaim.webp" alt="Получить" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </PressBtn>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SHOP SCREEN — carousel
══════════════════════════════════════════════════════════════════ */
function ShopScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => { saveState(persisted); }, [persisted]);

  const item = SHOP_ITEMS[idx];

  function handleBuy() {
    setPersisted((p) => ({
      ...p, inventory: { ...p.inventory, [item.key]: p.inventory[item.key] + 1 },
    }));
  }

  return (
    <GameShell bg="/FonMAGAZIN.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderMAGAZIN.webp" alt="Магазин" />

      <div style={{
        position: "absolute", top: "14%", left: "2%", right: "2%", bottom: "2%",
        zIndex: 20, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <ItemCarousel total={SHOP_ITEMS.length} index={idx}
          onPrev={() => setIdx((i) => Math.max(0, i - 1))}
          onNext={() => setIdx((i) => Math.min(SHOP_ITEMS.length - 1, i + 1))}
        >
          <div style={{ position: "relative", width: "100%" }}>
            <img src={item.img} alt={item.label} draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
            <PressBtn onClick={handleBuy}
              style={{ position: "absolute", right: "2%", top: "50%", transform: "translateY(-50%)", width: "22%" }}>
              <img src="/KnopkaKUPIT.webp" alt="Купить" draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />
            </PressBtn>
          </div>
        </ItemCarousel>
      </div>
    </GameShell>
  );
}

/* ══════════════════════════════════════════════════════════════════
   WAREHOUSE SCREEN — carousel
══════════════════════════════════════════════════════════════════ */
function WarehouseScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => { saveState(persisted); }, [persisted]);

  const ownedItems = SHOP_ITEMS.filter((it) => persisted.inventory[it.key] > 0);
  const hasAnyIdle = persisted.plots.some((p) => p.gameState === "idle");

  const safeIdx = Math.min(idx, Math.max(0, ownedItems.length - 1));
  const item = ownedItems[safeIdx];

  function handleUse() {
    if (!item) return;
    setPersisted((p) => {
      if (p.inventory[item.key] <= 0) return p;
      const newInv = { ...p.inventory, [item.key]: p.inventory[item.key] - 1 };
      if (item.key === "uchastok") {
        const s = { ...p, inventory: newInv, plots: [...p.plots, emptyPlot()] };
        saveState(s); navigate("/"); return s;
      }
      if (item.key === "sazhenec") {
        const idle = p.plots.findIndex((pl) => pl.gameState === "idle");
        if (idle === -1) return p;
        const newPlots = p.plots.map((pl, i) =>
          i === idle ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() } : pl);
        const s = { ...p, inventory: newInv, plots: newPlots, currentPlotIdx: idle };
        saveState(s); navigate("/"); return s;
      }
      return { ...p, inventory: newInv };
    });
  }

  return (
    <GameShell bg="/FonSKLAD.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderSKLAD.webp" alt="Склад" />

      <div style={{
        position: "absolute", top: "14%", left: "2%", right: "2%", bottom: "2%",
        zIndex: 20, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        {ownedItems.length === 0 ? (
          <div style={{
            color: "rgba(255,255,255,0.7)", fontSize: "4.5cqw", fontWeight: "600",
            textAlign: "center", textShadow: "0 1px 6px rgba(0,0,0,0.8)",
          }}>Склад пуст</div>
        ) : (
          <ItemCarousel total={ownedItems.length} index={safeIdx}
            onPrev={() => setIdx((i) => Math.max(0, i - 1))}
            onNext={() => setIdx((i) => Math.min(ownedItems.length - 1, i + 1))}
          >
            <div style={{ position: "relative", width: "100%" }}>
              <img src={item.img} alt={item.label} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />

              {/* Count badge */}
              <div style={{
                position: "absolute", left: "3%", top: "50%", transform: "translateY(-50%)",
                background: "rgba(0,0,0,0.65)", color: "#fff",
                fontSize: "4.5cqw", fontWeight: "800",
                borderRadius: "2cqw", padding: "0.5cqw 1.5cqw",
                border: "0.3cqw solid rgba(255,255,255,0.3)", lineHeight: 1,
                pointerEvents: "none", minWidth: "5cqw", textAlign: "center",
              }}>{persisted.inventory[item.key]}</div>

              {/* Use button */}
              {(() => {
                const disabled = item.key === "sazhenec" && !hasAnyIdle;
                return (
                  <PressBtn onClick={disabled ? undefined : handleUse} disabled={disabled}
                    style={{ position: "absolute", right: "2%", top: "50%", transform: "translateY(-50%)", width: "22%" }}>
                    <img src={disabled ? "/KnopkaISPOLZOVAT2.webp" : "/KnopkaISPOLZOVAT.webp"}
                      alt="Использовать" draggable={false}
                      style={{ width: "100%", display: "block", userSelect: "none" }} />
                  </PressBtn>
                );
              })()}
            </div>
          </ItemCarousel>
        )}
      </div>
    </GameShell>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TASKS SCREEN — carousel
══════════════════════════════════════════════════════════════════ */
function TasksScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => { saveState(persisted); }, [persisted]);

  const task = TASKS[idx];
  const isDone    = task.check(persisted);
  const isClaimed = persisted.claimedTaskIds.includes(task.id);
  const canClaim  = isDone && !isClaimed;

  function handleClaim() {
    if (!canClaim) return;
    setPersisted((p) => {
      const inv = { ...p.inventory };
      if (task.reward.type === "sazhenec") inv.sazhenec += task.reward.amount;
      return {
        ...p,
        fruit: task.reward.type === "fruit" ? p.fruit + task.reward.amount : p.fruit,
        inventory: inv,
        claimedTaskIds: [...p.claimedTaskIds, task.id],
      };
    });
  }

  const statusColor = isClaimed ? "#88c888" : isDone ? "#f4c842" : "rgba(255,255,255,0.6)";
  const statusText  = isClaimed ? "✓ Получено" : isDone ? "Выполнено!" : "В процессе...";

  return (
    <GameShell bg="/FonDOSTIZHENIYA.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderDOSTIZHENIYA.webp" alt="Задания" />

      <div style={{
        position: "absolute", top: "14%", left: "2%", right: "2%", bottom: "2%",
        zIndex: 20, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "4%",
      }}>
        <ItemCarousel total={TASKS.length} index={idx}
          onPrev={() => setIdx((i) => Math.max(0, i - 1))}
          onNext={() => setIdx((i) => Math.min(TASKS.length - 1, i + 1))}
        >
          {/* Task card */}
          <div style={{
            background: "rgba(20,10,0,0.72)", borderRadius: "4cqw",
            border: `0.5cqw solid ${isDone ? "rgba(244,200,66,0.7)" : "rgba(255,255,255,0.15)"}`,
            padding: "5cqw 6cqw",
            boxShadow: isDone ? "0 0 20px rgba(244,200,66,0.25)" : "0 4px 20px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", gap: "3cqw",
          }}>
            {/* Title */}
            <div style={{
              fontSize: "5.5cqw", fontWeight: "800", color: "#f4c842",
              textShadow: "0 1px 6px rgba(0,0,0,0.8)", textAlign: "center",
            }}>{task.label}</div>

            {/* Description */}
            <div style={{
              fontSize: "3.8cqw", color: "rgba(255,255,255,0.85)", textAlign: "center",
              lineHeight: 1.4, fontWeight: "500",
            }}>{task.desc}</div>

            {/* Reward */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "2cqw",
              background: "rgba(244,200,66,0.12)", borderRadius: "3cqw", padding: "2cqw 4cqw",
            }}>
              <span style={{ fontSize: "5cqw" }}>
                {task.reward.type === "fruit" ? "🍊" : "🌱"}
              </span>
              <span style={{ fontSize: "4.5cqw", fontWeight: "800", color: "#f4c842" }}>
                +{task.reward.amount} {task.reward.type === "fruit" ? "плодов" : "саженцев"}
              </span>
            </div>

            {/* Status */}
            <div style={{
              fontSize: "4cqw", fontWeight: "700", color: statusColor,
              textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            }}>{statusText}</div>

            {/* Claim button */}
            {canClaim && (
              <div onClick={handleClaim} style={{
                background: "linear-gradient(135deg,#f4c842,#e8a020)",
                borderRadius: "8cqw", padding: "3cqw 0",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", userSelect: "none",
                boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                fontSize: "4.5cqw", fontWeight: "800", color: "#3a1400",
              }}
                onPointerDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96)"; }}
                onPointerUp={(e)   => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
                onPointerLeave={(e)=> { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
              >
                Забрать награду
              </div>
            )}
          </div>
        </ItemCarousel>
      </div>
    </GameShell>
  );
}

/* ─── Router ────────────────────────────────────────────────────── */
function Router() {
  return (
    <Switch>
      <Route path="/"         component={Game} />
      <Route path="/druzya"   component={FriendsScreen} />
      <Route path="/zadaniya" component={TasksScreen} />
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

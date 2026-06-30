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

/* All phase images are 660×700 — same aspect ratio used as a stable container */
const PHASE_ASPECT = "660 / 700";

const PHASE6_IDX         = 5;
const HARVEST_PHASE_IDX  = 6;
const WINDDOWN_PHASE_IDX = 7;
const BASE_YIELD         = 400;
const PLANTING_DURATION  = 30;
const CIRCUMFERENCE      = 2 * Math.PI * 40;

const NAV = [
  { id: "druzya",   path: "/druzya",   img: "/PanelDRUZYA.webp",   label: "Друзья"  },
  { id: "zadaniya", path: "/zadaniya", img: "/PanelZADANIYA.webp", label: "Задания" },
  { id: "sklad",    path: "/sklad",    img: "/PanelSKLAD.webp",    label: "Склад"   },
  { id: "magazin",  path: "/magazin",  img: "/PanelMAGAZIN.webp",  label: "Магазин" },
];

/* ─── Shop items ────────────────────────────────────────────────── */
type ItemKey = "sazhenec" | "uchastok" | "avtopoliv" | "avtosbor" | "udobrenie";

const SHOP_ITEMS: { key: ItemKey; img: string; label: string }[] = [
  { key: "sazhenec",  img: "/ItemSazhenec.webp",  label: "Саженец"   },
  { key: "uchastok",  img: "/ItemUchastok.webp",  label: "Участок"   },
  { key: "avtopoliv", img: "/ItemAvtopoliv.webp", label: "Автополив" },
  { key: "avtosbor",  img: "/ItemAvtosbor.webp",  label: "Автосбор"  },
  { key: "udobrenie", img: "/ItemUdobrenie.webp", label: "Удобрение" },
];

/* ─── Number formatter ──────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1_000_000_000) { const v = n / 1_000_000_000; return `${v % 1 === 0 ? v : v.toFixed(1)}b`; }
  if (n >= 1_000_000)     { const v = n / 1_000_000;     return `${v % 1 === 0 ? v : v.toFixed(1)}m`; }
  if (n >= 10_000)        { const v = n / 1_000;         return `${v % 1 === 0 ? v : v.toFixed(1)}к`; }
  return n.toLocaleString("ru-RU");
}

/* ─── Persistent state ──────────────────────────────────────────── */
type GameState = "idle" | "planting" | "growing";

interface PlotState {
  gameState: GameState;
  phaseIdx: number;
  phaseStartedAt: number;
  harvestPresses: number;
}

interface Inventory {
  sazhenec:  number;
  uchastok:  number;
  avtopoliv: number;
  avtosbor:  number;
  udobrenie: number;
}

interface PersistedState {
  plots: PlotState[];
  currentPlotIdx: number;
  cedro: number;
  fruit: number;
  inventory: Inventory;
}

function emptyPlot(): PlotState {
  return { gameState: "idle", phaseIdx: 0, phaseStartedAt: 0, harvestPresses: 0 };
}

function resolvePlot(plot: PlotState, now: number): PlotState {
  let cur = { ...plot };
  for (;;) {
    if (cur.gameState === "idle") break;
    const duration = cur.gameState === "planting"
      ? PLANTING_DURATION
      : (GROWTH_PHASES[cur.phaseIdx]?.duration ?? 120);
    const elapsed = (now - cur.phaseStartedAt) / 1000;
    if (elapsed < duration) break;
    const overflow  = (elapsed - duration) * 1000;
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

const STORAGE_KEY = "orchard_v8";

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedState;
  } catch {}
  return {
    plots: [emptyPlot()],
    currentPlotIdx: 0,
    cedro: 0, fruit: 0,
    inventory: { sazhenec: 0, uchastok: 0, avtopoliv: 0, avtosbor: 0, udobrenie: 0 },
  };
}

function saveState(s: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/* ─── Game shell ─────────────────────────────────────────────────
   The inner container is 9:16 (contain mode — no cropping of UI).
   Outside the container, a blurred/darkened version of the same
   background fills the viewport instead of ugly black bars.
──────────────────────────────────────────────────────────────── */
function GameShell({ children, bg = "/FonOSNOVNOI.webp" }: { children?: React.ReactNode; bg?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      {/* Blurred ambient background — fills the letterbox bars area */}
      <div style={{
        position: "absolute",
        inset: "-8%",           /* slightly oversize to avoid blur edge */
        backgroundImage: `url('${bg}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        filter: "blur(14px) brightness(0.45)",
        zIndex: 0,
      }} />

      {/* 9:16 game container — centred, never crops critical UI */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        /* Contain: fit within viewport maintaining 9:16 */
        width:  "min(100vw, calc(100vh * 9 / 16))",
        height: "min(100vh, calc(100vw * 16 / 9))",
        overflow: "hidden",
        containerType: "inline-size",
        zIndex: 1,
      }}>
        {/* Actual background */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: `url('${bg}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
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
      <div style={{ position: "relative", flex: "0 0 30%" }}>
        <img src="/BalanzCDR.webp" alt="Cedro" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
        <span style={{
          position: "absolute", left: "63%", top: "50%",
          transform: "translate(-50%,-50%)",
          fontSize: "3.8cqw", fontWeight: "700",
          color: "#3b1f00", lineHeight: 1, whiteSpace: "nowrap",
          pointerEvents: "none", userSelect: "none",
        }}>{fmt(cedro)}</span>
      </div>
      <div style={{ flex: "0 0 30%" }}>
        <img src="/OrchardZENTR.webp" alt="Orchard" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </div>
      <div style={{ position: "relative", flex: "0 0 30%" }}>
        <img src="/BalanzPLD.webp" alt="Fruit" draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
        <span style={{
          position: "absolute", left: "63%", top: "50%",
          transform: "translate(-50%,-50%)",
          fontSize: "3.8cqw", fontWeight: "700",
          color: "#3b1f00", lineHeight: 1, whiteSpace: "nowrap",
          pointerEvents: "none", userSelect: "none",
        }}>{fmt(fruit)}</span>
      </div>
    </div>
  );
}

/* ─── Bottom nav bar ────────────────────────────────────────────── */
function NavBar() {
  const [, navigate] = useLocation();
  return (
    <div style={{
      position: "absolute", bottom: "5.2%", left: "3%", right: "3%",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "2%", zIndex: 30,
    }}>
      {NAV.map((item) => (
        <button key={item.id} aria-label={item.label}
          onClick={() => navigate(item.path)}
          style={{
            flex: "0 0 22%", padding: 0, border: "none",
            background: "transparent", cursor: "pointer",
            borderRadius: "16%", transition: "transform 0.12s",
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
  const innerRef = useRef<HTMLSpanElement>(null);
  return (
    <div aria-label="Закрыть" onClick={onClose}
      style={{
        position: "absolute", top: "3%", left: "4%",
        width: "11%", aspectRatio: "1",
        cursor: "pointer", zIndex: 35,
        userSelect: "none",
      }}
      onPointerDown={() => { if (innerRef.current) innerRef.current.style.transform = "scale(0.9)"; }}
      onPointerUp={()   => { if (innerRef.current) innerRef.current.style.transform = "scale(1)"; }}
      onPointerLeave={() => { if (innerRef.current) innerRef.current.style.transform = "scale(1)"; }}
    >
      <span ref={innerRef} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
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
      position: "absolute", top: "3%", left: "50%",
      transform: "translateX(-50%)",
      width: "50%", zIndex: 34, pointerEvents: "none",
    }}>
      <img src={src} alt={alt} draggable={false} loading="eager"
        style={{ width: "100%", display: "block", userSelect: "none" }} />
    </div>
  );
}

/* ─── Press button (inner span handles scale, outer keeps position) ─ */
function PressBtn({
  onClick, style, children, disabled,
}: {
  onClick?: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const innerRef = useRef<HTMLSpanElement>(null);
  const scale = (v: string) => { if (innerRef.current) innerRef.current.style.transform = v; };
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? "default" : "pointer", userSelect: "none", ...style }}
      onPointerDown={() => { if (!disabled) scale("scale(0.92)"); }}
      onPointerUp={()   => scale("scale(1)")}
      onPointerLeave={() => scale("scale(1)")}
    >
      <span ref={innerRef} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        {children}
      </span>
    </div>
  );
}

/* ─── Arrow navigation button ───────────────────────────────────── */
function ArrowBtn({
  direction, onClick, visible,
}: { direction: "left" | "right"; onClick: () => void; visible: boolean }) {
  const innerRef = useRef<HTMLSpanElement>(null);
  const scale = (v: string) => { if (innerRef.current) innerRef.current.style.transform = v; };
  if (!visible) return null;
  const src = direction === "left" ? "/StrelkaLeft.webp" : "/StrelkaRight.webp";
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        /* Vertically centred on the plot image */
        bottom: "32%",
        [direction === "left" ? "left" : "right"]: "1%",
        width: "13%",
        aspectRatio: "1",
        zIndex: 28, cursor: "pointer", userSelect: "none",
      }}
      onPointerDown={() => scale("scale(0.88)")}
      onPointerUp={()   => scale("scale(1)")}
      onPointerLeave={() => scale("scale(1)")}
    >
      <span ref={innerRef} style={{ display: "block", transition: "transform 0.12s", transformOrigin: "center" }}>
        <img src={src} alt={direction === "left" ? "◀" : "▶"} draggable={false}
          style={{ width: "100%", display: "block", userSelect: "none" }} />
      </span>
    </div>
  );
}

/* ─── Plot indicator dots ────────────────────────────────────────── */
function PlotDots({ total, current }: { total: number; current: number }) {
  if (total <= 1) return null;
  return (
    <div style={{
      position: "absolute", bottom: "18%", left: "50%",
      transform: "translateX(-50%)",
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

/* ─── Planting countdown ─────────────────────────────────────────── */
function PlantingTimer({ phaseStartedAt }: { phaseStartedAt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, PLANTING_DURATION - (Date.now() - phaseStartedAt) / 1000)
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, PLANTING_DURATION - (Date.now() - phaseStartedAt) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [phaseStartedAt]);
  const r = Math.ceil(remaining);
  const dashOffset = CIRCUMFERENCE * (1 - remaining / PLANTING_DURATION);
  return (
    <div style={{
      position: "absolute", left: "50%", bottom: "37%",
      transform: "translateX(-50%)",
      width: "13%", aspectRatio: "1",
      zIndex: 25, pointerEvents: "none",
    }}>
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="40" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
        <circle cx="50" cy="50" r="40" fill="none"
          stroke="#f4c842" strokeWidth="8"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.22s linear" }} />
      </svg>
      <span style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "3.2cqw", fontWeight: "700",
        textShadow: "0 1px 4px rgba(0,0,0,0.9)", lineHeight: 1,
      }}>{r}</span>
    </div>
  );
}

/* ─── Harvest pop label ─────────────────────────────────────────── */
interface HarvestPop { id: number; amount: number }

function HarvestPopLabel({ amount, onDone }: { amount: number; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1400); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{
      position: "absolute", left: "50%", bottom: "52%",
      transform: "translateX(-50%)",
      zIndex: 40, pointerEvents: "none",
      animation: "harvestPop 1.4s ease-out forwards",
      color: "#f4c842", fontSize: "7cqw", fontWeight: "800",
      textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(244,200,66,0.6)",
      whiteSpace: "nowrap",
    }}>+{fmt(amount)}</div>
  );
}

/* ─── Main game screen ──────────────────────────────────────────── */
function Game() {
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [pops, setPops] = useState<HarvestPop[]>([]);
  const popIdRef = useRef(0);

  useEffect(() => { saveState(persisted); }, [persisted]);

  const ref = useRef(persisted);
  ref.current = persisted;

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
        p.gameState !== ref.current.plots[i]?.gameState ||
        p.phaseIdx  !== ref.current.plots[i]?.phaseIdx
      );
      if (changed) setPersisted(next);
    }, 500);
    return () => clearInterval(id);
  }, [anyActive]);

  /* Phase image: all phases share a fixed-size container (660×700 aspect)
     anchored at the bottom so images never shift between transitions. */
  const plotImg = gameState === "idle" || gameState === "planting"
    ? "/DerevoFaza0.webp"
    : GROWTH_PHASES[phaseIdx]?.img ?? GROWTH_PHASES[GROWTH_PHASES.length - 1].img;

  const showHarvestBtn = gameState === "growing" && phaseIdx === HARVEST_PHASE_IDX;

  function handlePlant() {
    if (!hasSeedling) return;
    setPersisted((p) => {
      const newPlots = p.plots.map((pl, i) =>
        i === p.currentPlotIdx
          ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() }
          : pl
      );
      return {
        ...p,
        plots: newPlots,
        inventory: { ...p.inventory, sazhenec: p.inventory.sazhenec - 1 },
      };
    });
  }

  function handleHarvest() {
    const id = ++popIdRef.current;
    setTimeout(() => { setPops((prev) => [...prev, { id, amount: BASE_YIELD }]); }, 0);
    setPersisted((s) => ({
      ...s,
      fruit: s.fruit + BASE_YIELD,
      plots: s.plots.map((p, i) =>
        i === s.currentPlotIdx
          ? { ...p, phaseIdx: WINDDOWN_PHASE_IDX, phaseStartedAt: Date.now(), harvestPresses: p.harvestPresses + 1 }
          : p
      ),
    }));
  }

  function goLeft()  { setPersisted((s) => ({ ...s, currentPlotIdx: Math.max(0, s.currentPlotIdx - 1) })); }
  function goRight() { setPersisted((s) => ({ ...s, currentPlotIdx: Math.min(s.plots.length - 1, s.currentPlotIdx + 1) })); }
  function removePop(id: number) { setPops((prev) => prev.filter((p) => p.id !== id)); }

  return (
    <>
      <style>{`
        @keyframes harvestPop {
          0%   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1);    }
          20%  { opacity: 1; transform: translateX(-50%) translateY(-8%)  scale(1.15); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-30%) scale(0.9);  }
        }
      `}</style>
      <GameShell>
        <TopBar cedro={cedro} fruit={fruit} />

        {/* Phase image — fixed 660:700 container anchored at bottom.
            All phases occupy the exact same rectangle → no visual shift. */}
        <div style={{
          position: "absolute",
          left: "50%",
          bottom: "19.2%",
          width: "93.6%",
          aspectRatio: PHASE_ASPECT,
          transform: "translateX(-50%)",
          zIndex: 15,
          pointerEvents: "none",
        }}>
          <img
            src={plotImg}
            alt="Growth phase"
            draggable={false}
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "fill",
              userSelect: "none",
            }}
          />
        </div>

        {/* Shovel button — active only when player has a seedling */}
        {gameState === "idle" && (
          <button
            aria-label="Посадить саженец"
            onClick={hasSeedling ? handlePlant : undefined}
            style={{
              position: "absolute", left: "50%", bottom: "37%",
              transform: "translateX(-50%)",
              width: "14%", aspectRatio: "1",
              padding: 0, border: "none", background: "transparent",
              cursor: hasSeedling ? "pointer" : "default",
              zIndex: 25, transition: "transform 0.12s",
              opacity: hasSeedling ? 1 : 0.45,
            }}
            onPointerDown={(e) => {
              if (hasSeedling) (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(0.9)";
            }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/KnopkaPOSADIT.webp" alt="Посадить" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </button>
        )}

        {/* Planting countdown */}
        {gameState === "planting" && (
          <PlantingTimer phaseStartedAt={currentPlot.phaseStartedAt} />
        )}

        {/* Harvest button */}
        {showHarvestBtn && (
          <button aria-label="Собрать плоды" onClick={handleHarvest}
            style={{
              position: "absolute", left: "50%", top: "8%",
              transform: "translateX(-50%)",
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

        {/* Harvest pop labels */}
        {pops.map((pop) => (
          <HarvestPopLabel key={pop.id} amount={pop.amount} onDone={() => removePop(pop.id)} />
        ))}

        {/* Arrow navigation — on both sides of the plot */}
        <ArrowBtn direction="left"  onClick={goLeft}  visible={currentPlotIdx > 0} />
        <ArrowBtn direction="right" onClick={goRight} visible={currentPlotIdx < plots.length - 1} />

        {/* Plot indicator dots */}
        <PlotDots total={plots.length} current={currentPlotIdx} />

        <NavBar />
      </GameShell>
    </>
  );
}

/* ─── Shop screen ───────────────────────────────────────────────── */
function ShopScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  useEffect(() => { saveState(persisted); }, [persisted]);

  function handleBuy(key: ItemKey) {
    setPersisted((p) => ({
      ...p,
      inventory: { ...p.inventory, [key]: p.inventory[key] + 1 },
    }));
  }

  return (
    <GameShell bg="/FonMAGAZIN.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderMAGAZIN.webp" alt="Магазин" />
      <div style={{
        position: "absolute",
        top: "14%", left: "3%", right: "3%", bottom: "2%",
        overflowY: "auto", zIndex: 20, scrollbarWidth: "none",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3%", padding: "2% 1% 4%" }}>
          {SHOP_ITEMS.map((item) => (
            <div key={item.key} style={{ position: "relative", width: "100%" }}>
              <img src={item.img} alt={item.label} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />
              <PressBtn
                onClick={() => handleBuy(item.key)}
                style={{ position: "absolute", right: "2%", top: "50%", transform: "translateY(-50%)", width: "22%" }}
              >
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

/* ─── Warehouse screen ──────────────────────────────────────────── */
function WarehouseScreen() {
  const [, navigate] = useLocation();
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  useEffect(() => { saveState(persisted); }, [persisted]);

  const currentPlot = persisted.plots[persisted.currentPlotIdx] ?? emptyPlot();
  const currentPlotIdle = currentPlot.gameState === "idle";

  function handleUse(key: ItemKey) {
    setPersisted((p) => {
      if (p.inventory[key] <= 0) return p;
      const newInv = { ...p.inventory, [key]: p.inventory[key] - 1 };

      if (key === "uchastok") {
        /* Add new plot, navigate to game so user can see it */
        const newState = { ...p, inventory: newInv, plots: [...p.plots, emptyPlot()] };
        saveState(newState);
        navigate("/");
        return newState;
      }

      if (key === "sazhenec") {
        /* Find first idle plot (prefer current), plant there, then go to game */
        const idlePlotIdx = p.plots.findIndex((pl) => pl.gameState === "idle");
        if (idlePlotIdx === -1) return p; /* no idle plot — button should be disabled */
        const newPlots = p.plots.map((pl, i) =>
          i === idlePlotIdx
            ? { ...pl, gameState: "planting" as GameState, phaseIdx: 0, phaseStartedAt: Date.now() }
            : pl
        );
        const newState = {
          ...p,
          inventory: newInv,
          plots: newPlots,
          currentPlotIdx: idlePlotIdx,
        };
        saveState(newState);
        navigate("/");
        return newState;
      }

      return { ...p, inventory: newInv };
    });
  }

  const hasAnyIdlePlot = persisted.plots.some((pl) => pl.gameState === "idle");
  const ownedItems = SHOP_ITEMS.filter((item) => persisted.inventory[item.key] > 0);

  return (
    <GameShell bg="/FonSKLAD.webp">
      <CloseBtn onClose={() => navigate("/")} />
      <ScreenHeader src="/HeaderSKLAD.webp" alt="Склад" />
      <div style={{
        position: "absolute",
        top: "14%", left: "3%", right: "3%", bottom: "2%",
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
            const count = persisted.inventory[item.key];
            /* Саженец disabled if no idle plots; Участок always available */
            const isDisabled = item.key === "sazhenec" && !hasAnyIdlePlot;
            const useImg = isDisabled ? "/KnopkaISPOLZOVAT2.webp" : "/KnopkaISPOLZOVAT.webp";
            return (
              <div key={item.key} style={{ position: "relative", width: "100%" }}>
                <img src={item.img} alt={item.label} draggable={false}
                  style={{ width: "100%", display: "block", userSelect: "none" }} />
                {/* Count badge */}
                <div style={{
                  position: "absolute", left: "3%", top: "50%", transform: "translateY(-50%)",
                  background: "rgba(0,0,0,0.65)", color: "#fff",
                  fontSize: "4.5cqw", fontWeight: "800",
                  borderRadius: "2cqw", padding: "0.5cqw 1.5cqw",
                  border: "0.3cqw solid rgba(255,255,255,0.3)",
                  lineHeight: 1, pointerEvents: "none", minWidth: "5cqw", textAlign: "center",
                }}>{count}</div>
                {/* Use button */}
                <PressBtn
                  onClick={() => handleUse(item.key)}
                  disabled={isDisabled}
                  style={{
                    position: "absolute", right: "2%", top: "50%",
                    transform: "translateY(-50%)", width: "22%",
                  }}
                >
                  <img src={useImg} alt="Использовать" draggable={false}
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

/* ─── Generic nav screen (Friends / Achievements) ───────────────── */
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
      <Route path="/druzya"   component={() => (
        <NavScreen bg="/FonDRUZYA.webp" headerSrc="/HeaderDRUZYA.webp" headerAlt="Друзья" />
      )} />
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

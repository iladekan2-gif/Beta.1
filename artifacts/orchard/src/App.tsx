import { useState, useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/* ─── Growth phases ───────────────────────────────────────────────
   0–4  : phases 1–5, 2 min each
   5    : phase 6, 4 min — GREEN fruits
   6    : phase 7, 4 min — harvest button active
   7    : phase 8, 30 sec — wind-down
   After phase 8 → restart from phase 6 (index 5)
──────────────────────────────────────────────────────────────────── */
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

/* ─── Number formatter ─────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1_000_000_000) { const v = n / 1_000_000_000; return `${v % 1 === 0 ? v : v.toFixed(1)}b`; }
  if (n >= 1_000_000)     { const v = n / 1_000_000;     return `${v % 1 === 0 ? v : v.toFixed(1)}m`; }
  if (n >= 10_000)        { const v = n / 1_000;         return `${v % 1 === 0 ? v : v.toFixed(1)}к`; }
  return n.toLocaleString("ru-RU");
}

/* ─── Persistent state ────────────────────────────────────────────── */
type GameState = "idle" | "planting" | "growing";

interface PersistedState {
  gameState: GameState;
  phaseIdx: number;
  phaseStartedAt: number;
  cedro: number;
  fruit: number;
  waterUsed6: boolean;
  waterUsed7: boolean;
  waterActivations: number;
  fertActivations: number;
  harvestPresses: number;
}

function phaseDuration(idx: number, s: PersistedState): number {
  const base = GROWTH_PHASES[idx]?.duration ?? 120;
  if (idx === PHASE6_IDX        && s.waterUsed6) return base * 0.5;
  if (idx === HARVEST_PHASE_IDX && s.waterUsed7) return base * 0.5;
  return base;
}

function calcYield(s: PersistedState): number {
  return Math.round(BASE_YIELD * (1 + s.waterActivations * 0.1 + s.fertActivations * 0.2));
}

const STORAGE_KEY = "orchard_v5";

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedState;
  } catch {}
  return {
    gameState: "idle", phaseIdx: 0, phaseStartedAt: 0,
    cedro: 0, fruit: 0,
    waterUsed6: false, waterUsed7: false, waterActivations: 0,
    fertActivations: 0, harvestPresses: 0,
  };
}

function saveState(s: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function resolveState(s: PersistedState, now: number): PersistedState {
  let cur = { ...s };
  while (true) {
    if (cur.gameState === "idle") break;
    const duration = cur.gameState === "planting"
      ? PLANTING_DURATION
      : phaseDuration(cur.phaseIdx, cur);
    const elapsed = (now - cur.phaseStartedAt) / 1000;
    if (elapsed < duration) break;
    const overflow  = (elapsed - duration) * 1000;
    const nextStart = now - overflow;
    if (cur.gameState === "planting") {
      cur = { ...cur, gameState: "growing", phaseIdx: 0, phaseStartedAt: nextStart };
    } else {
      const nextIdx = cur.phaseIdx + 1;
      if (nextIdx < GROWTH_PHASES.length) {
        cur = { ...cur, phaseIdx: nextIdx, phaseStartedAt: nextStart };
      } else {
        // Phase 8 done → loop back to phase 6, reset per-cycle water flags, then continue
        cur = { ...cur, phaseIdx: PHASE6_IDX, phaseStartedAt: nextStart, waterUsed6: false, waterUsed7: false };
      }
    }
  }
  return cur;
}

/* ─── Planting countdown (30 s) ────────────────────────────────── */
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
      position: "absolute", left: "50%", bottom: "38%",
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

/* ─── Harvest pop (+N floating label) ──────────────────────────── */
interface HarvestPop { id: number; amount: number }

function HarvestPopLabel({ amount, onDone }: { amount: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: "absolute",
      left: "50%", bottom: "52%",
      transform: "translateX(-50%)",
      zIndex: 40, pointerEvents: "none",
      animation: "harvestPop 1.4s ease-out forwards",
      color: "#f4c842",
      fontSize: "7cqw", fontWeight: "800",
      textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(244,200,66,0.6)",
      whiteSpace: "nowrap",
    }}>
      +{fmt(amount)}
    </div>
  );
}

/* ─── Static background ─────────────────────────────────────────── */
const StaticBackground = ({ src = "/FonOSNOVNOI.webp" }: { src?: string }) => (
  <div style={{
    position: "absolute", inset: 0,
    backgroundImage: `url('${src}')`,
    backgroundSize: "cover", backgroundPosition: "center",
    backgroundRepeat: "no-repeat", zIndex: 0,
  }} />
);

/* ─── Shared game shell ─────────────────────────────────────────── */
function GameShell({ children, bg }: { children?: React.ReactNode; bg?: string }) {
  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#000", overflow: "hidden",
    }}>
      <div style={{
        position: "relative",
        aspectRatio: "1080 / 1920",
        height: "100vh",
        maxWidth: "100vw",
        maxHeight: "calc(100vw * 1920 / 1080)",
        overflow: "hidden", flexShrink: 0,
        containerType: "inline-size",
      }}>
        <StaticBackground src={bg} />
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
      gap: "2%", zIndex: 20, willChange: "transform",
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
      gap: "2%", zIndex: 30, willChange: "transform",
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

/* ─── Close button (top-left) ───────────────────────────────────── */
function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      aria-label="Закрыть"
      onClick={onClose}
      style={{
        position: "absolute", top: "3%", left: "4%",
        width: "11%", aspectRatio: "1",
        padding: 0, border: "none", background: "transparent",
        cursor: "pointer", zIndex: 35,
        transition: "transform 0.12s", willChange: "transform",
      }}
      onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.9)"; }}
      onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
    >
      <img src="/KnopkaKREST.webp" alt="Закрыть" draggable={false}
        style={{ width: "100%", display: "block", userSelect: "none" }} />
    </button>
  );
}

/* ─── Action button (decorative, no functionality) ─────────────── */
function ActionBtn({ inactiveImg, label }: { inactiveImg: string; label: string }) {
  return (
    <div aria-label={label} style={{ width: "100%", opacity: 0.7 }}>
      <img src={inactiveImg} alt={label} draggable={false}
        style={{ width: "100%", display: "block", userSelect: "none" }} />
    </div>
  );
}

/* ─── Main game screen ──────────────────────────────────────────── */
function Game() {
  const [persisted, setPersisted] = useState<PersistedState>(() =>
    resolveState(loadState(), Date.now())
  );
  const [pops, setPops] = useState<HarvestPop[]>([]);
  const popIdRef = useRef(0);

  const { gameState, phaseIdx, cedro, fruit } = persisted;

  useEffect(() => { saveState(persisted); }, [persisted]);

  const ref = useRef(persisted);
  ref.current = persisted;

  useEffect(() => {
    if (gameState === "idle") return;
    const id = setInterval(() => {
      const next = resolveState(ref.current, Date.now());
      if (next.gameState !== ref.current.gameState || next.phaseIdx !== ref.current.phaseIdx) {
        setPersisted(next);
      }
    }, 500);
    return () => clearInterval(id);
  }, [gameState]);

  const plotImg = gameState === "idle" || gameState === "planting"
    ? "/DerevoFaza0.webp"
    : GROWTH_PHASES[phaseIdx]?.img ?? GROWTH_PHASES[GROWTH_PHASES.length - 1].img;

  const showActionBtns = gameState === "growing";
  const showHarvestBtn = gameState === "growing" && phaseIdx === HARVEST_PHASE_IDX;

  function handlePlant() {
    setPersisted((p) => ({ ...p, gameState: "planting", phaseIdx: 0, phaseStartedAt: Date.now() }));
  }

  function handleHarvest() {
    setPersisted((p) => {
      const gained = calcYield(p);
      const id = ++popIdRef.current;
      // schedule pop in next tick so gained is captured
      setTimeout(() => {
        setPops((prev) => [...prev, { id, amount: gained }]);
      }, 0);
      return {
        ...p,
        fruit: p.fruit + gained,
        harvestPresses: p.harvestPresses + 1,
        phaseIdx: WINDDOWN_PHASE_IDX,
        phaseStartedAt: Date.now(),
      };
    });
  }

  function removePop(id: number) {
    setPops((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <>
      {/* keyframe animation injected once */}
      <style>{`
        @keyframes harvestPop {
          0%   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1);    }
          20%  { opacity: 1; transform: translateX(-50%) translateY(-8%)  scale(1.15); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-30%) scale(0.9);  }
        }

      `}</style>
      <GameShell>
        <TopBar cedro={cedro} fruit={fruit} />

        {/* ── Tree / plot image ── */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 15,
          willChange: "transform", pointerEvents: "none",
        }}>
          <img
            src={plotImg}
            alt="Growth phase"
            draggable={false}
            style={{
              position: "absolute",
              left: "50%", bottom: "19.2%",
              width: "78%",
              transform: "translateX(-50%) scaleY(1.2)",
              transformOrigin: "bottom center",
              pointerEvents: "none", userSelect: "none",
            }}
          />
        </div>

        {/* ── Shovel button (idle only) ── */}
        {gameState === "idle" && (
          <button
            aria-label="Посадить саженец"
            onClick={handlePlant}
            style={{
              position: "absolute", left: "50%", bottom: "37%",
              transform: "translateX(-50%)",
              width: "14%", aspectRatio: "1",
              padding: 0, border: "none", background: "transparent",
              cursor: "pointer", zIndex: 25, transition: "transform 0.12s",
              willChange: "transform",
            }}
            onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(0.9)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/KnopkaPOSADIT.webp" alt="Посадить" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </button>
        )}

        {/* ── 30-second planting countdown ── */}
        {gameState === "planting" && (
          <PlantingTimer phaseStartedAt={persisted.phaseStartedAt} />
        )}

        {/* ── Left action buttons (decorative, no functionality) ── */}
        {showActionBtns && (
          <div style={{
            position: "absolute", left: "3%", top: "10%",
            width: "17%", height: "14%",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            zIndex: 25,
          }}>
            <ActionBtn inactiveImg="/KnopkaPoliv2.webp"     label="Полив"      />
            <ActionBtn inactiveImg="/KnopkaUdobrenie2.webp" label="Удобрение"  />
          </div>
        )}

        {/* ── Harvest button (phase 7 only) ── */}
        {showHarvestBtn && (
          <button
            aria-label="Собрать плоды"
            onClick={handleHarvest}
            style={{
              position: "absolute", left: "50%", top: "8%",
              transform: "translateX(-50%)",
              width: "26%",
              padding: 0, border: "none", background: "transparent",
              cursor: "pointer", zIndex: 25,
              transition: "transform 0.12s", willChange: "transform",
            }}
            onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(0.93)"; }}
            onPointerUp={(e)   => { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
            onPointerLeave={(e)=> { (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) scale(1)"; }}
          >
            <img src="/SborPlodov.webp" alt="Собрать плоды" draggable={false}
              style={{ width: "100%", display: "block", userSelect: "none" }} />
          </button>
        )}

        {/* ── Harvest pop labels ── */}
        {pops.map((pop) => (
          <HarvestPopLabel key={pop.id} amount={pop.amount} onDone={() => removePop(pop.id)} />
        ))}

        <NavBar />
      </GameShell>
    </>
  );
}

/* ─── Nav screens ───────────────────────────────────────────────── */
function NavScreen({ bg }: { bg: string }) {
  const [, navigate] = useLocation();
  return (
    <GameShell bg={bg}>
      <CloseBtn onClose={() => navigate("/")} />
    </GameShell>
  );
}

/* ─── Router ────────────────────────────────────────────────────── */
function Router() {
  return (
    <Switch>
      <Route path="/"         component={Game} />
      <Route path="/druzya"   component={() => <NavScreen bg="/FonDRUZYA.webp"       />} />
      <Route path="/zadaniya" component={() => <NavScreen bg="/FonDOSTIZHENIYA.webp" />} />
      <Route path="/sklad"    component={() => <NavScreen bg="/FonSKLAD.webp"        />} />
      <Route path="/magazin"  component={() => <NavScreen bg="/FonMAGAZIN.webp"      />} />
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

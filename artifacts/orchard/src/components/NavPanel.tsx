interface NavPanelProps {
  onCommunity?: () => void;
  onShop?: () => void;
  onWarehouse?: () => void;
  onAchievements?: () => void;
}

const HOTSPOTS = [
  { id: "community",    label: "Community",    left: "2.5%",  top: "5%", width: "23.5%", height: "90%" },
  { id: "shop",         label: "Shop",         left: "26.5%", top: "5%", width: "23.5%", height: "90%" },
  { id: "warehouse",    label: "Warehouse",    left: "50.5%", top: "5%", width: "23.5%", height: "90%" },
  { id: "achievements", label: "Achievements", left: "74.5%", top: "5%", width: "23%",   height: "90%" },
];

export function NavPanel({ onCommunity, onShop, onWarehouse, onAchievements }: NavPanelProps) {
  const handlers = [onCommunity, onShop, onWarehouse, onAchievements];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        width: "100%",
        zIndex: 9999,
        lineHeight: 0,
      }}
    >
      {/* Panel image — natural resolution, no forced dimensions */}
      <img
        src="/panel-KNOPKI.png"
        alt="Navigation panel"
        style={{ width: "100%", display: "block", userSelect: "none" }}
        draggable={false}
      />

      {/* Transparent hotspot buttons — percentage-based over the image */}
      {HOTSPOTS.map((spot, i) => (
        <button
          key={spot.id}
          aria-label={spot.label}
          onClick={handlers[i]}
          style={{
            position: "absolute",
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

import React from "react";
import { cn } from "@/lib/utils";

interface GardenVisualizationProps {
  growthPercent: number;
}

export function GardenVisualization({ growthPercent }: GardenVisualizationProps) {
  // Map growth to visual scale
  const scale = 0.5 + (growthPercent / 100) * 0.5;
  const opacity = 0.3 + (growthPercent / 100) * 0.7;

  return (
    <div className="relative w-64 h-64 sm:w-80 sm:h-80 mx-auto flex items-center justify-center animate-float">
      {/* Outer aura */}
      <div 
        className="absolute inset-0 rounded-full bg-primary/10 blur-2xl animate-pulse-ring transition-all duration-1000"
        style={{ transform: `scale(${scale * 1.2})`, opacity: opacity * 0.5 }}
      />
      
      {/* Inner glowing ring */}
      <div 
        className="absolute inset-4 rounded-full bg-primary/20 blur-xl transition-all duration-1000"
        style={{ transform: `scale(${scale})`, opacity }}
      />

      {/* Main core entity */}
      <div 
        className="relative z-10 rounded-full bg-gradient-to-tr from-primary to-accent shadow-xl border-4 border-white/20 transition-all duration-1000 animate-breathe flex items-center justify-center overflow-hidden"
        style={{ 
          width: `${Math.max(40, growthPercent)}%`, 
          height: `${Math.max(40, growthPercent)}%`,
          minWidth: "6rem",
          minHeight: "6rem"
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/40 via-transparent to-transparent opacity-60" />
      </div>

      {/* Decorative particles */}
      <div className="absolute inset-0 pointer-events-none transition-opacity duration-1000" style={{ opacity }}>
        <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-secondary blur-[1px] animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-3 h-3 rounded-full bg-primary/60 blur-[1px] animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 right-1/3 w-1.5 h-1.5 rounded-full bg-secondary/80 blur-[1px] animate-pulse" style={{ animationDelay: "2s" }} />
      </div>
    </div>
  );
}

"use client";

import { type CSSProperties, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Bomb from "./Bomb";

type Explosion = {
    x: number;
    y: number;
    width: number;
    height: number;
    diameter: number;
    bombStatus: number;
};

export function useBombExplosion() {
    const bombRef = useRef<HTMLDivElement>(null);
    const playedRef = useRef(false);
    const [explosion, setExplosion] = useState<Explosion | null>(null);

    // Capture before game:end is followed by a room reset or a layout change.
    const explode = useCallback(() => {
        const bomb = bombRef.current;
        if (!bomb || playedRef.current) return;
        const rect = bomb.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        playedRef.current = true;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const radius = Math.hypot(
            Math.max(Math.abs(x), Math.abs(window.innerWidth - x)),
            Math.max(Math.abs(y), Math.abs(window.innerHeight - y)),
        );
        setExplosion({
            x,
            y,
            width: rect.width,
            height: rect.height,
            diameter: radius * 2.3,
            bombStatus: Number(bomb.dataset.bombStatus ?? 4),
        });
    }, []);

    const resetExplosion = useCallback(() => {
        playedRef.current = false;
        setExplosion(null);
    }, []);

    const explosionLayer = explosion
        ? createPortal(
              <div className="bomb-explosion-layer" aria-hidden="true">
                  <div
                      className="bomb-explosion-origin"
                      style={
                          {
                              left: explosion.x,
                              top: explosion.y,
                              "--blast-size": `${explosion.diameter}px`,
                              "--blast-start":
                                  explosion.width / explosion.diameter,
                          } as CSSProperties
                      }
                  >
                      <div
                          className="bomb-explosion-ring"
                          onAnimationEnd={(event) => {
                              if (event.animationName !== "bombShockwave")
                                  setExplosion(null);
                          }}
                      />
                      <div
                          className="bomb-explosion-body"
                          style={{
                              width: explosion.width,
                              height: explosion.height,
                          }}
                      >
                          <Bomb
                              bombStatus={explosion.bombStatus}
                              shaking={false}
                          />
                      </div>
                  </div>
              </div>,
              document.body,
          )
        : null;

    return { bombRef, explode, resetExplosion, explosionLayer };
}

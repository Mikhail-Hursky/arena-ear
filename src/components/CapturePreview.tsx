import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { GridDetection, GridRegion } from "../types";
import { cellAtPoint } from "../lib/grid-activity";

export function CapturePreview({
  stream,
  region,
  onRegionChange,
  grid,
  selected,
  onChoose,
}: {
  stream: MediaStream;
  region: GridRegion;
  onRegionChange: (region: GridRegion) => void;
  grid?: GridDetection | null;
  selected?: string;
  onChoose?: (id: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<GridRegion | null>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => {
      if (video.current) video.current.srcObject = null;
    };
  }, [stream]);
  function point(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  function rect(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): GridRegion {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }
  const shown = draft || region;
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          className="secondary"
          onClick={() => {
            setEditing((v) => !v);
            setDraft(null);
            start.current = null;
          }}
        >
          {editing ? "Отменить выделение" : "Выделить область торговца"}
        </button>
        <span style={{ fontSize: 10, color: "#9bad88" }}>
          {editing
            ? "Протяните прямоугольник поверх сетки торговца"
            : "Жёлтая рамка — область поиска сетки"}
        </span>
      </div>
      <div style={{ position: "relative", lineHeight: 0 }}>
        <video
          ref={video}
          muted
          autoPlay
          playsInline
          style={{ width: "100%", maxHeight: "none", display: "block" }}
        />
        <div
          aria-label={
            editing ? "Выделение области торговца" : "Выбор груза на превью"
          }
          style={{
            position: "absolute",
            inset: 0,
            cursor: editing ? "crosshair" : "default",
            touchAction: editing ? "none" : "auto",
          }}
          onPointerDown={(e) => {
            if (!editing) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = point(e);
            setDraft({ ...start.current, width: 0, height: 0 });
          }}
          onPointerMove={(e) => {
            if (editing && start.current)
              setDraft(rect(start.current, point(e)));
          }}
          onPointerUp={(e) => {
            if (!editing) {
              if (grid?.source === 'detected') {
                const cell = cellAtPoint(grid, point(e));
                if (cell) onChoose?.(cell.id);
              }
              return;
            }
            if (!start.current) return;
            const next = rect(start.current, point(e));
            start.current = null;
            setDraft(null);
            if (next.width >= 0.05 && next.height >= 0.05) {
              onRegionChange(next);
              setEditing(false);
            }
          }}
          onPointerCancel={() => {
            start.current = null;
            setDraft(null);
          }}
        >
          {!editing && grid?.source === 'detected' && grid.cells.map(cell => <div key={cell.id} style={{
            position:'absolute', pointerEvents:'none', boxSizing:'border-box',
            left:`${(grid.region.x + cell.col / grid.columns * grid.region.width) * 100}%`,
            top:`${(grid.region.y + cell.row / grid.rows * grid.region.height) * 100}%`,
            width:`${cell.width / grid.columns * grid.region.width * 100}%`,
            height:`${cell.height / grid.rows * grid.region.height * 100}%`,
            border:cell.id === selected ? '2px solid #e2ee78' : '1px solid #e2ee7840',
            background:cell.id === selected ? '#e2ee7822' : undefined,
          }}><span style={{color:'#e2ee78',fontSize:9,lineHeight:1.4,background:'#000a'}}>{cell.result?.recognition?.status === 'identified' ? cell.result.name : `${cell.width}×${cell.height}`}</span></div>)}
          <div
            style={{
              position: "absolute",
              left: `${shown.x * 100}%`,
              top: `${shown.y * 100}%`,
              width: `${shown.width * 100}%`,
              height: `${shown.height * 100}%`,
              border: "2px solid #e2ee78",
              background: "#e2ee7812",
              boxShadow: "0 0 0 1px #0008",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </>
  );
}

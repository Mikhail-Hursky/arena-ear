import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { GridRegion } from "../types";

export function CapturePreview({
  stream,
  region,
  onRegionChange,
}: {
  stream: MediaStream;
  region: GridRegion;
  onRegionChange: (region: GridRegion) => void;
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
            editing ? "Выделение области торговца" : "Область поиска торговца"
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
            if (!editing || !start.current) return;
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

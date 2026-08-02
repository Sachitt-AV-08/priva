import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Sparkles, Undo2, Trash2, Circle } from "lucide-react";
import { recognizeStroke, RECOGNIZE_THRESHOLD } from "../engine/recognizer";

interface Pt {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  color: string;
  width: number;
  points: Pt[];
}

type ShapeKind = "circle" | "rect" | "line" | "arrow";

interface ShapeObj {
  id: string;
  kind: ShapeKind;
  color: string;
  width: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrawingDoc {
  strokes: Stroke[];
  shapes: ShapeObj[];
}

const EMPTY_DOC: DrawingDoc = { strokes: [], shapes: [] };
const COLORS = ["#e8ecf4", "#7c9cff", "#ff6b6b", "#ffd166"];
const WIDTHS = [2, 4, 6];
const CANVAS_H = 320;
const MIN_SIZE = 10;

type Draft =
  | { kind: "stroke"; color: string; width: number; points: Pt[] }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; hx: number; hy: number; sx: number; sy: number; sw: number; sh: number };

function parseDoc(content: string): DrawingDoc {
  try {
    const d = JSON.parse(content);
    return { strokes: d.strokes ?? [], shapes: d.shapes ?? [] };
  } catch {
    return EMPTY_DOC;
  }
}

const HANDLES: { hx: number; hy: number }[] = [
  { hx: 0, hy: 0 }, { hx: 0.5, hy: 0 }, { hx: 1, hy: 0 },
  { hx: 0, hy: 0.5 }, { hx: 1, hy: 0.5 },
  { hx: 0, hy: 1 }, { hx: 0.5, hy: 1 }, { hx: 1, hy: 1 },
];

export function DrawingCanvas({ value, onChange }: { value: string; onChange: (content: string) => void }) {
  const [doc, setDoc] = useState<DrawingDoc>(() => parseDoc(value));
  const [history, setHistory] = useState<DrawingDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cssWRef = useRef(640);
  const draftRef = useRef<Draft | null>(null);

  // Mirrors kept for the imperative redraw loop.
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const commit = useCallback((next: DrawingDoc) => {
    setDoc(next);
    setHistory((h) => (h.length > 50 ? [...h.slice(h.length - 50), docRef.current] : [...h, docRef.current]));
    onChange(JSON.stringify(next));
  }, [onChange]);

  const drawShape = (ctx: CanvasRenderingContext2D, s: ShapeObj) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (s.kind === "circle") {
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(1, s.w / 2), Math.max(1, s.h / 2), 0, 0, Math.PI * 2);
    } else if (s.kind === "rect") {
      ctx.rect(s.x, s.y, s.w, s.h);
    } else if (s.kind === "line") {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
    } else if (s.kind === "arrow") {
      const cy = s.y + s.h / 2;
      const head = Math.min(s.w * 0.3, 18);
      ctx.moveTo(s.x, cy);
      ctx.lineTo(s.x + s.w, cy);
      ctx.moveTo(s.x + s.w, cy);
      ctx.lineTo(s.x + s.w - head, cy - head * 0.55);
      ctx.moveTo(s.x + s.w, cy);
      ctx.lineTo(s.x + s.w - head, cy + head * 0.55);
    }
    ctx.stroke();
  };

  const drawSelection = (ctx: CanvasRenderingContext2D, s: ShapeObj) => {
    ctx.strokeStyle = "rgba(124, 156, 255, 0.8)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(s.x - 4, s.y - 4, s.w + 8, s.h + 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#7c9cff";
    for (const { hx, hy } of HANDLES) {
      const px = s.x + s.w * hx;
      const py = s.y + s.h * hy;
      ctx.fillRect(px - 3, py - 3, 6, 6);
    }
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cssWRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, cssW, CANVAS_H);

    const d = docRef.current;
    for (const st of d.strokes) {
      if (st.points.length < 2) continue;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(st.points[0].x, st.points[0].y);
      for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
      ctx.stroke();
    }
    for (const s of d.shapes) drawShape(ctx, s);

    const draft = draftRef.current;
    if (draft?.kind === "stroke" && draft.points.length > 1) {
      ctx.strokeStyle = draft.color;
      ctx.lineWidth = draft.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(draft.points[0].x, draft.points[0].y);
      for (let i = 1; i < draft.points.length; i++) ctx.lineTo(draft.points[i].x, draft.points[i].y);
      ctx.stroke();
    }

    const sel = d.shapes.find((s) => s.id === selectedRef.current);
    if (sel) drawSelection(ctx, sel);
  }, []);

  const resizeCanvas = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const cssW = Math.max(200, wrap.clientWidth);
    cssWRef.current = cssW;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(CANVAS_H * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(CANVAS_H * dpr);
    }
    render();
  }, [render]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    render();
  }, [render, doc, selectedId, color, strokeWidth]);

  // ---- interaction ----

  const hitShape = (px: number, py: number): ShapeObj | null => {
    const d = docRef.current;
    for (let i = d.shapes.length - 1; i >= 0; i--) {
      const s = d.shapes[i];
      if (px >= s.x - 6 && px <= s.x + s.w + 6 && py >= s.y - 6 && py <= s.y + s.h + 6) return s;
    }
    return null;
  };

  const handleAt = (s: ShapeObj, px: number, py: number): { hx: number; hy: number } | null => {
    for (const { hx, hy } of HANDLES) {
      const hx2 = s.x + s.w * hx;
      const hy2 = s.y + s.h * hy;
      if (Math.hypot(px - hx2, py - hy2) <= 8) return { hx, hy };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const sel = docRef.current.shapes.find((s) => s.id === selectedRef.current);
    if (sel) {
      const handle = handleAt(sel, px, py);
      if (handle) {
        draftRef.current = { kind: "resize", id: sel.id, hx: handle.hx, hy: handle.hy, sx: sel.x, sy: sel.y, sw: sel.w, sh: sel.h };
        return;
      }
    }
    const hit = hitShape(px, py);
    if (hit) {
      setSelectedId(hit.id);
      draftRef.current = { kind: "move", id: hit.id, dx: px - hit.x, dy: py - hit.y };
      return;
    }
    setSelectedId(null);
    draftRef.current = { kind: "stroke", color, width: strokeWidth, points: [{ x: px, y: py }] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    const canvas = canvasRef.current;
    if (!draft || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (draft.kind === "stroke") {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(px - last.x, py - last.y) >= 1.5) draft.points.push({ x: px, y: py });
      render();
      return;
    }

    const d = docRef.current;
    const shape = d.shapes.find((s) => s.id === draft.id);
    if (!shape) return;

    if (draft.kind === "move") {
      const x = Math.max(0, Math.min(cssWRef.current - shape.w, px - draft.dx));
      const y = Math.max(0, Math.min(CANVAS_H - shape.h, py - draft.dy));
      const updated = { ...shape, x, y };
      const next = { strokes: d.strokes, shapes: d.shapes.map((s) => (s.id === shape.id ? updated : s)) };
      docRef.current = next;
      setDoc(next);
    } else {
      const { hx, hy, sx, sy, sw, sh } = draft;
      let x = sx, y = sy, w = sw, h = sh;
      if (hx === 0) { x = Math.min(px, sx + sw - MIN_SIZE); w = sx + sw - x; }
      if (hx === 1) { w = Math.max(MIN_SIZE, px - sx); }
      if (hy === 0) { y = Math.min(py, sy + sh - MIN_SIZE); h = sy + sh - y; }
      if (hy === 1) { h = Math.max(MIN_SIZE, py - sy); }
      if (shape.kind === "circle") {
        const side = Math.max(w, h, MIN_SIZE);
        if (hx === 0) { x = sx + sw - side; }
        if (hy === 0) { y = sy + sh - side; }
        w = side;
        h = side;
      }
      const updated = { ...shape, x, y, w, h };
      const next = { strokes: d.strokes, shapes: d.shapes.map((s) => (s.id === shape.id ? updated : s)) };
      docRef.current = next;
      setDoc(next);
    }
  };

  const onPointerUp = () => {
    const draft = draftRef.current;
    draftRef.current = null;
    if (!draft) return;
    if (draft.kind === "stroke") {
      const points = draft.points;
      if (points.length < 2) return;
      if (snapRef.current) {
        const rec = recognizeStroke(points);
        if (rec && rec.confidence >= RECOGNIZE_THRESHOLD) {
          commit({
            strokes: docRef.current.strokes,
            shapes: [...docRef.current.shapes, {
              id: crypto.randomUUID(), kind: rec.kind, color: draft.color, width: draft.width,
              x: Math.round(rec.x), y: Math.round(rec.y), w: Math.round(rec.w), h: Math.round(rec.h),
            }],
          });
          return;
        }
      }
      commit({
        strokes: [...docRef.current.strokes, { id: crypto.randomUUID(), color: draft.color, width: draft.width, points }],
        shapes: docRef.current.shapes,
      });
    } else {
      commit({ strokes: docRef.current.strokes, shapes: docRef.current.shapes });
    }
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setDoc(prev);
      onChange(JSON.stringify(prev));
      return h.slice(0, -1);
    });
  };

  const clearAll = () => {
    if (!window.confirm("Clear the entire drawing?")) return;
    setSelectedId(null);
    commit(EMPTY_DOC);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const id = selectedRef.current;
    if (!id) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const d = docRef.current;
      commit({ strokes: d.strokes, shapes: d.shapes.filter((s) => s.id !== id) });
      setSelectedId(null);
    } else if (e.key === "Escape") {
      setSelectedId(null);
    }
  };

  const isEmpty = doc.strokes.length === 0 && doc.shapes.length === 0;

  return (
    <div className="rounded-lg border border-border bg-surface-2/50 overflow-hidden" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/60 bg-surface-3/60 flex-wrap">
        <button
          onClick={() => setSnap((v) => !v)}
          title="Smart snap — circles, arrows, lines & boxes become clean shapes"
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border transition-all ${snap ? "bg-accent/15 border-accent/40 text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}
        >
          <Sparkles size={10} /> Snap {snap ? "ON" : "OFF"}
        </button>
        <span className="w-px h-4 bg-border/70" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-4 h-4 rounded-full border transition-all ${color === c ? "border-white scale-110" : "border-border/60"}`}
            style={{ background: c }}
            title="Pen color"
          />
        ))}
        <span className="w-px h-4 bg-border/70" />
        {WIDTHS.map((wd) => (
          <button
            key={wd}
            onClick={() => setStrokeWidth(wd)}
            className={`flex items-center justify-center w-5 h-5 rounded-md border transition-all ${strokeWidth === wd ? "bg-accent/15 border-accent/40" : "border-border text-text-muted hover:text-text-secondary"}`}
            title={`Stroke ${wd}px`}
          >
            <span className="rounded-full bg-current" style={{ width: Math.max(2, wd), height: Math.max(2, wd) }} />
          </button>
        ))}
        <span className="w-px h-4 bg-border/70" />
        <button
          onClick={undo}
          disabled={history.length === 0}
          title="Undo"
          className="p-1 rounded-md text-text-muted hover:text-text-secondary disabled:opacity-30 transition-all"
        >
          <Undo2 size={12} />
        </button>
        <button
          onClick={clearAll}
          title="Clear drawing"
          className="p-1 rounded-md text-text-muted hover:text-red-400 transition-all"
        >
          <Trash2 size={12} />
        </button>
        <span className="ml-auto text-[9px] text-text-muted/60 flex items-center gap-1">
          <Circle size={9} /> Select a shape to move or resize it
        </span>
      </div>
      <div ref={wrapRef} className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="w-full touch-none cursor-crosshair"
          style={{ height: CANVAS_H }}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-text-muted/50">
              Draw a circle, arrow, line or box — Snap turns them into clean shapes
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One Plan – Interactive Digital Wall (React Prototype)
 * Fix: resolve Unexpected token at 797 by restoring truncated JSX, define date helpers,
 * ensure returns are properly wrapped, and keep details panel interactive.
 * Also: nodes show start/finish dates and phases drag nodes horizontally.
 * -------------------------------------------------------------------------------
 */

import React, { useMemo, useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ZoomIn, ZoomOut, RefreshCcw, Link2, AlignVerticalSpaceBetween, PlusCircle, Trash2, Grid3X3 } from "lucide-react";

// ---------------- Colours / Departments ----------------
const PHASE_COLOURS: Record<string, string> = {
  Engineering: "#4f46e5",
  Procurement: "#0ea5e9",
  Contracts: "#f59e0b",
  Construction: "#16a34a",
  Commissioning: "#dc2626",
};

type Dept = keyof typeof PHASE_COLOURS;

// ---------------- Types ----------------
export type ConstraintType = "none" | "MSO" | "MFO" | "SNET" | "FNLT";
export type LogicType = "FS" | "SS" | "FF";

type Phase = { id: string; name: Dept; start: Date; end: Date };

type NodeT = {
  id: string;
  type: "activity" | "milestone";
  title: string;
  department: Dept; // drives colour
  phase: Dept;
  x: number; // px along timeline (start)
  y: number; // lane position
  durationDays: number; // 0 => milestone
  locked?: boolean;
  constraintType?: ConstraintType;
  constraintDate?: Date | null;
  body?: string;
};

type LinkT = { id: string; from: string; to: string; type: LogicType; lagDays: number; label?: string };

type AnchorEnd = 'S' | 'F';
type AnchorVert = 'top' | 'bottom';

type LinkingDrag = { fromId: string; fromEnd: AnchorEnd; fromVert: AnchorVert } | null;
type HoverAnchor = { nodeId: string; end: AnchorEnd; vert: AnchorVert } | null;

// ---------------- Seed Data ----------------
const seedPhases: Phase[] = [
  { id: "p1", name: "Engineering", start: new Date(2025, 0, 1), end: new Date(2025, 5, 30) },
  { id: "p2", name: "Procurement", start: new Date(2025, 3, 1), end: new Date(2025, 8, 30) },
  { id: "p3", name: "Contracts", start: new Date(2025, 5, 1), end: new Date(2025, 10, 30) },
  { id: "p4", name: "Construction", start: new Date(2025, 8, 1), end: new Date(2026, 3, 31) },
  { id: "p5", name: "Commissioning", start: new Date(2026, 4, 1), end: new Date(2026, 8, 30) },
];

const seedNodes: NodeT[] = [
  { id: "a1", type: "activity", title: "Subsystem L01 Ready", department: "Engineering", phase: "Engineering", x: 0, y: 60, durationDays: 20, body: "Drawings issued for construction." },
  { id: "a2", type: "activity", title: "Vendor Award", department: "Procurement", phase: "Procurement", x: 400, y: 160, durationDays: 15, body: "Purchase order placed for cables." },
  { id: "m1", type: "milestone", title: "Scaffold Access", department: "Construction", phase: "Construction", x: 850, y: 100, durationDays: 0, body: "Erection of scaffold for cable trays." },
];

const seedLinks: LinkT[] = [
  { id: "l1", from: "a1", to: "a2", type: "FS", lagDays: 0, label: "depends on" },
];

// ---------------- Utilities ----------------
const startYear = 2025;
const endYear = 2026;
const months: { year: number; month: number }[] = [];
for (let y = startYear; y <= endYear; y++) {
  for (let m = 0; m < 12; m++) months.push({ year: y, month: m });
}

const monthWidth = 120; // px per month
const dayPx = monthWidth / 30; // approx px per day

// Day-accurate mapping anchored to Jan 1 of startYear
const timelineStart = new Date(startYear, 0, 1);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Month helpers (for phase rail)
const dateToX = (date: Date) => ((date.getFullYear() - startYear) * 12 + date.getMonth()) * monthWidth;
const xToDate = (x: number) => {
  const monthsDiff = Math.round(x / monthWidth);
  const y = startYear + Math.floor(monthsDiff / 12);
  const m = ((monthsDiff % 12) + 12) % 12;
  return new Date(y, m, 1);
};

// Node date helpers (exact days)
const xToDateExact = (x: number) => new Date(timelineStart.getTime() + Math.round(x / dayPx) * MS_PER_DAY);
const dateToXExact = (d: Date) => Math.round((Math.floor((d.getTime() - timelineStart.getTime()) / MS_PER_DAY)) * dayPx);
const formatDate = (d: Date) => {
  // yyyy-mm-dd for <input type="date">
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const activityWidthPx = (n: NodeT) => (n.type === "milestone" ? 10 : Math.max(1, Math.round(n.durationDays * dayPx)));
const linkMidAnchor = (n: NodeT, which: "S" | "F") => ({ x: n.x + (which === "S" ? 0 : activityWidthPx(n)), y: n.y + 24 });

// NEW: Pixel-x position of a node's finish edge based on days (no 1px minimum skew)
const endXPx = (n: NodeT, dayPxLocal: number) => (n.type === 'milestone' ? n.x : n.x + n.durationDays * dayPxLocal);

// Mid-edge anchor that ensures the line touches the node's visible edge
const edgeAnchor = (n: NodeT, end: AnchorEnd) => {
  const midY = n.y + 24; // card mid-height (fixed 48px)
  if (n.type === 'milestone') {
    // diamond visual; small offset so arrow meets the edge
    const cx = n.x + activityWidthPx(n) / 2;
    const dx = 6;
    return { x: cx + (end === 'S' ? -dx : dx), y: midY };
  }
  // rectangle activity: left/right edges
  return { x: n.x + (end === 'S' ? 0 : activityWidthPx(n)), y: midY };
};

const getAnchorPoint = (n: NodeT, end: AnchorEnd, vert: AnchorVert) => {
  const w = activityWidthPx(n);
  const x = n.x + (end === 'S' ? 0 : w);
  const y = n.y + (vert === 'top' ? 6 : 46);
  return { x, y };
};

// Choose best top/bottom verts so the line meets the node edge cleanly
function bestAnchorVerts(a: NodeT, aEnd: AnchorEnd, b: NodeT, bEnd: AnchorEnd): [AnchorVert, AnchorVert] {
  const candidates: [AnchorVert, AnchorVert][] = [
    ['top', 'top'], ['top', 'bottom'], ['bottom', 'top'], ['bottom', 'bottom']
  ];
  let best: [AnchorVert, AnchorVert] = ['top', 'top'];
  let bestD = Infinity;
  for (const [va, vb] of candidates) {
    const A = getAnchorPoint(a, aEnd, va);
    const B = getAnchorPoint(b, bEnd, vb);
    const d = Math.hypot(A.x - B.x, A.y - B.y);
    if (d < bestD) { bestD = d; best = [va, vb]; }
  }
  return best;
}

const allAnchorsForNode = (n: NodeT) => (
  [
    { end: 'S' as AnchorEnd, vert: 'top' as AnchorVert },
    { end: 'F' as AnchorEnd, vert: 'top' as AnchorVert },
    { end: 'S' as AnchorEnd, vert: 'bottom' as AnchorVert },
    { end: 'F' as AnchorEnd, vert: 'bottom' as AnchorVert },
  ].map(a => ({ ...a, point: getAnchorPoint(n, a.end, a.vert) }))
);

const findNearestAnchor = (fromId: string, x: number, y: number, nodes: NodeT[]) => {
  let best: { nodeId: string; end: AnchorEnd; vert: AnchorVert; dist: number } | null = null;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    for (const a of allAnchorsForNode(n)) {
      const dx = a.point.x - x; const dy = a.point.y - y; const d = Math.hypot(dx, dy);
      if (!best || d < best.dist) best = { nodeId: n.id, end: a.end, vert: a.vert, dist: d };
    }
  }
  return best;
};

// ---------------- Component ----------------
export default function InteractiveDigitalWallLifecycle() {
  const [nodes, setNodes] = useState<NodeT[]>(seedNodes);
  const [links, setLinks] = useState<LinkT[]>(seedLinks);
  const [phases, setPhases] = useState<Phase[]>(seedPhases);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null); // legacy click-linking; still supported
  const [linkType, setLinkType] = useState<LogicType>("FS");
  const [linkLag, setLinkLag] = useState<number>(0);
  const [draggingPhase, setDraggingPhase] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ id: string; edge: "start" | "end" } | null>(null);
  const [snap, setSnap] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  // New: drag-to-link state + cursor in world coords
  const [linkingDrag, setLinkingDrag] = useState<LinkingDrag>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HoverAnchor>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Viewport & sizing for windowing (performance for up to ~250 nodes)
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const filtered = useMemo(() => nodes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())), [nodes, search]);
  const selected = nodes.find(n => n.id === selectedId) || null;

  // Fast id->node lookup for links (avoid O(n) find per link)
  const nodeById = useMemo(() => {
    const m = new Map<string, NodeT>();
    nodes.forEach(n => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Compute world-visible rect and windowed node list for rendering
  const worldVisible = useMemo(() => {
    const left = (-pan.x) / scale;
    const top = (-pan.y) / scale;
    const right = (viewport.w - pan.x) / scale;
    const bottom = (viewport.h - pan.y) / scale;
    return { left, top, right, bottom };
  }, [pan, scale, viewport]);

  const visibleNodes = useMemo(() => {
    const H = 48; // node height
    const pad = 80; // render padding so edges don't pop
    return filtered.filter(n => {
      const w = activityWidthPx(n);
      const x1 = n.x - pad, y1 = n.y - pad;
      const x2 = n.x + w + pad, y2 = n.y + H + pad;
      return !(x2 < worldVisible.left || x1 > worldVisible.right || y2 < worldVisible.top || y1 > worldVisible.bottom);
    });
  }, [filtered, worldVisible]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  // ---- DEV sanity checks (lightweight "tests") ----
  useEffect(() => {
    console.assert(nodes.every(n => typeof n.id === 'string' && typeof n.title === 'string'), 'NodeT shape invalid');
    if (nodes[0]) {
      const a = linkMidAnchor(nodes[0], 'S');
      console.assert(!Number.isNaN(a.x) && !Number.isNaN(a.y), 'Anchor calc failed');
    }
  }, [nodes]);

  // Extra regression tests
  useEffect(() => {
    const bad = filtered.find(n => activityWidthPx(n) <= 0);
    console.assert(!bad, 'Activity width should be > 0');
    // formatDate sanity
    const d = new Date(2025, 0, 15);
    console.assert(/^\d{4}-\d{2}-\d{2}$/.test(formatDate(d)), 'formatDate must be yyyy-mm-dd');
  }, [filtered]);

  // ---- Phase interactions ----
  const movePhase = (id: string, dx: number) => {
    let phaseName: Dept | null = null;
    const snappedDx = Math.round(dx); // avoid fractional drift
    setPhases(prev => prev.map(p => {
      if (p.id !== id) return p;
      phaseName = p.name;
      return { ...p, start: xToDate(dateToX(p.start) + snappedDx), end: xToDate(dateToX(p.end) + snappedDx) };
    }));
    if (phaseName) {
      setNodes(prev => prev.map(n => n.phase === phaseName ? { ...n, x: n.x + snappedDx } : n));
    }
  };
  const resizePhase = (id: string, dx: number, edge: "start" | "end") => setPhases(prev => prev.map(p => p.id !== id ? p : edge === "start" ? { ...p, start: xToDate(dateToX(p.start) + dx) } : { ...p, end: xToDate(dateToX(p.end) + dx) }));

  // ---- Linking (click-to-link remains; drag-from-dot enhanced) ----
  const handleNodeClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    if (!linkMode) return;
    if (linkingDrag) return;
    if (!pendingFrom) setPendingFrom(id);
    else if (pendingFrom && pendingFrom !== id) {
      setLinks(prev => [...prev, { id: `l_${Date.now()}`, from: pendingFrom, to: id, type: linkType, lagDays: linkLag }]);
      setPendingFrom(null);
    }
  };

  const handleNodeDoubleClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    setShowDetails(true);
  };

  const onAnchorMouseDown = (nodeId: string, end: AnchorEnd, vert: AnchorVert, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!linkMode) return;
    setSelectedId(nodeId);
    setLinkingDrag({ fromId: nodeId, fromEnd: end, fromVert: vert });
  };

  const onAnchorMouseUp = (nodeId: string, end: AnchorEnd, vert: AnchorVert, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!linkMode || !linkingDrag) return;
    if (linkingDrag.fromId === nodeId) { setLinkingDrag(null); setHoverAnchor(null); return; }
    const type: LogicType = linkingDrag.fromEnd === 'F' && end === 'S' ? 'FS' :
      linkingDrag.fromEnd === 'S' && end === 'S' ? 'SS' :
      linkingDrag.fromEnd === 'F' && end === 'F' ? 'FF' : 'FS';
    setLinks(prev => [...prev, { id: `l_${Date.now()}`, from: linkingDrag.fromId, to: nodeId, type, lagDays: linkLag }]);
    setLinkingDrag(null);
    setHoverAnchor(null);
  };

  // ---- Node CRUD ----
  const createMilestone = () => {
    const id = `m_${Date.now()}`;
    const newNode: NodeT = { id, type: "milestone", title: "Milestone", department: "Construction", phase: "Construction", x: 100, y: 60, durationDays: 0, body: "" };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(id);
  };
  const createActivity = () => {
    const id = `a_${Date.now()}`;
    const newNode: NodeT = { id, type: "activity", title: "New Activity", department: "Engineering", phase: "Engineering", x: 120, y: 80, durationDays: 10 };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(id);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes(prev => prev.filter(n => n.id !== selectedId));
    setLinks(prev => prev.filter(l => l.from !== selectedId && l.to !== selectedId));
    setSelectedId(null);
    setShowDetails(false);
  };

  // ---- Move/Resize helpers ----
  const moveNode = (id: string, dx: number, dy: number, e?: React.MouseEvent) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== id) return n;
      if (n.locked && !(e && e.altKey)) return n;
      const nx = snap ? Math.round((n.x + dx) / 10) * 10 : n.x + dx;
      const ny = snap ? Math.round((n.y + dy) / 10) * 10 : n.y + dy;
      return { ...n, x: nx, y: ny };
    }));
  };
  const resizeNodeLeft = (id: string, daysDelta: number, e?: React.MouseEvent) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== id || n.type !== 'activity') return n;
      if (n.locked && !(e && e.altKey)) return n;
      const newDur = Math.max(1, n.durationDays - daysDelta);
      const newX = n.x + daysDelta * dayPx;
      return { ...n, durationDays: newDur, x: newX };
    }));
  };
  const resizeNodeRight = (id: string, daysDelta: number, e?: React.MouseEvent) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== id || n.type !== 'activity') return n;
      if (n.locked && !(e && e.altKey)) return n;
      const newDur = Math.max(1, n.durationDays + daysDelta);
      return { ...n, durationDays: newDur };
    }));
  };

  // ---- Align helper ----
  const alignVertical = () => {
    if (!selectedId) return;
    const ref = nodes.find(n => n.id === selectedId);
    if (!ref) return;
    const targetY = ref.y;
    setNodes(prev => prev.map(n => {
      if (n.id === ref.id) return n;
      const near = Math.abs(n.y - targetY) < 30;
      return near ? { ...n, y: targetY } : n;
    }));
  };

  // ---------------- Render ----------------
  return (
    <div
      className="relative w-full h-[94vh] bg-zinc-50 overflow-hidden"
      onClick={(e) => {
        // Keep details panel persistent unless user clicks its own Close button
        if (showDetails) return;
        if ((e.target as HTMLElement).closest('.details-panel')) return;
        setSelectedId(null);
        setPendingFrom(null);
        setLinkingDrag(null);
        setHoverAnchor(null);
      }}
      onMouseUp={(e) => {
        // Finish drag-to-link even if mouseup is not exactly on a dot
        if (!linkingDrag) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const x = (e.clientX - rect.left - pan.x) / scale;
        const y = (e.clientY - rect.top - pan.y) / scale;
        let target = hoverAnchor;
        if (!target) {
          const nearest = findNearestAnchor(linkingDrag.fromId, x, y, nodes);
          if (nearest && nearest.dist < 16) target = { nodeId: nearest.nodeId, end: nearest.end, vert: nearest.vert };
        }
        if (target) {
          const type: LogicType = linkingDrag.fromEnd === 'F' && target.end === 'S' ? 'FS'
            : linkingDrag.fromEnd === 'S' && target.end === 'S' ? 'SS'
            : linkingDrag.fromEnd === 'F' && target.end === 'F' ? 'FF' : 'FS';
          setLinks(prev => [...prev, { id: `l_${Date.now()}`, from: linkingDrag.fromId, to: target.nodeId, type, lagDays: linkLag }]);
        }
        setLinkingDrag(null);
        setHoverAnchor(null);
      }}
    >
      {/* Timeline bar */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-white border-b overflow-x-auto whitespace-nowrap">
        <div className="relative h-full" style={{ width: `${months.length * monthWidth}px` }}>
          {/* Month markers */}
          <div className="absolute top-0 left-0 right-0 h-6 flex text-[11px] text-zinc-600 border-b border-zinc-200">
            {months.map((m, i) => (
              <div key={i} className="flex-none border-r border-zinc-200 text-center" style={{ width: monthWidth }}>{`${m.year} ${new Date(m.year, m.month).toLocaleString('default', { month: 'short' })}`}</div>
            ))}
          </div>
          {/* Phase bars */}
          <div className="absolute top-6 left-0 right-0 h-[calc(100%-1.5rem)]">
            {phases.map(p => {
              const left = dateToX(p.start);
              const width = dateToX(p.end) - left;
              return (
                <div key={p.id}
                  className="absolute h-8 rounded text-xs text-white flex items-center justify-center cursor-grab select-none"
                  style={{ left, width, backgroundColor: PHASE_COLOURS[p.name] }}
                  onMouseDown={() => setDraggingPhase(p.id)}
                  onMouseUp={() => { setDraggingPhase(null); setResizing(null); }}
                  onMouseMove={e => {
                    if (draggingPhase === p.id && e.buttons === 1) movePhase(p.id, e.movementX / scale);
                    if (resizing?.id === p.id && e.buttons === 1) resizePhase(p.id, e.movementX / scale, resizing.edge);
                  }}
                >
                  <div className="absolute left-0 w-2 h-full cursor-ew-resize" onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: p.id, edge: 'start' }); }} />
                  <div className="absolute right-0 w-2 h-full cursor-ew-resize" onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: p.id, edge: 'end' }); }} />
                  {p.name}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Canvas area with logic lines */}
      <div
        ref={containerRef}
        className="absolute top-24 bottom-16 left-0 right-0 bg-white border overflow-hidden"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const x = (e.clientX - rect.left - pan.x) / scale;
          const y = (e.clientY - rect.top - pan.y) / scale;
          setCursor({ x, y });
        }}
      >
        <svg className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, zIndex: 2, pointerEvents: 'none' }}>
          {/* Link mode banner */}
          {linkMode && (
            <g>
              <rect x={10} y={10} width={240} height={26} rx={6} ry={6} fill="rgba(59,130,246,.12)" stroke="rgba(59,130,246,.5)" />
              <text x={20} y={28} fontSize="12" fill="#1f2937">
                {linkingDrag ? 'Linking: drag to a target…' : 'Link Mode: drag from a dot'}
              </text>
            </g>
          )}

          {links
            .filter(l => visibleIds.has(l.from) || visibleIds.has(l.to))
            .map(l => {
            const a = nodeById.get(l.from);
            const b = nodeById.get(l.to);
            if (!a || !b) return null;
            const aEnd: AnchorEnd = l.type === 'SS' ? 'S' : 'F';
            const bEnd: AnchorEnd = l.type === 'FF' ? 'F' : 'S';
            // use mid-edge anchors so the line physically touches both nodes
            const A = edgeAnchor(a, aEnd);
            const B = edgeAnchor(b, bEnd);
            const mx = (A.x + B.x) / 2;
            const my = Math.min(A.y, B.y) - 40;
            const d = `M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`;
            const highlight = selectedId && (l.from === selectedId || l.to === selectedId);
            return (
              <g key={l.id} opacity={highlight ? 1 : 0.9}>
                <path d={d} stroke={highlight ? '#111827' : 'rgba(0,0,0,.6)'} strokeWidth={highlight ? 3 : 2} fill="none" markerEnd="url(#arrow)" />
                <text x={mx} y={my - 6} fontSize="10" fill="#111" textAnchor="middle">{l.type}{l.lagDays ? ` +${l.lagDays}d` : ''}</text>
              </g>
            );
          })}

          {/* temp path while dragging from a connector dot */}
          {linkingDrag && (() => {
            const fromNode = nodes.find(n => n.id === linkingDrag.fromId);
            if (!fromNode) return null;
            // Start from mid-edge to make intent obvious while dragging
            const A = edgeAnchor(fromNode, linkingDrag.fromEnd);
            const target = cursor; // rubber band to cursor; snap occurs on mouseup
            const mx = (A.x + target.x) / 2;
            const my = Math.min(A.y, target.y) - 40;
            const d = `M ${A.x} ${A.y} Q ${mx} ${my} ${target.x} ${target.y}`;
            return (
              <g>
                <path d={d} stroke="#2563eb" strokeDasharray="6 6" strokeWidth={2.5} fill="none" markerEnd="url(#arrow)" />
                <circle cx={A.x} cy={A.y} r={4} fill="#2563eb" />
              </g>
            );
          })()}

          <defs>
            <marker id="arrow" markerWidth="14" markerHeight="12" refX="13" refY="6" orient="auto" markerUnits="userSpaceOnUse" fill="rgba(0,0,0,.8)">
              <path d="M0,0 L0,12 L14,6 z" />
            </marker>
          </defs>
        </svg>

        {/* Nodes layer */}
        <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0', zIndex: 1 }}>
          {visibleNodes.map(n => {
            const phase = phases.find(p => p.name === n.phase);
            const outOfRange = !phase || n.x < dateToX(phase.start) || n.x > dateToX(phase.end);
            const isHoverTarget = !!(hoverAnchor && hoverAnchor.nodeId === n.id);
            return (
              <DraggableNode
                key={n.id}
                node={n}
                outOfRange={outOfRange}
                selected={selectedId === n.id}
                onSelect={(e) => handleNodeClick(n.id, e)}
                onDouble={(e) => handleNodeDoubleClick(n.id, e)}
                onMove={(dx, dy, ev) => moveNode(n.id, dx, dy, ev)}
                onResizeLeft={(days, ev) => resizeNodeLeft(n.id, days, ev)}
                onResizeRight={(days, ev) => resizeNodeRight(n.id, days, ev)}
                linkMode={linkMode}
                dayPx={dayPx}
                snap={snap}
                departmentColor={PHASE_COLOURS[n.department]}
                showAnchors={linkMode}
                onAnchorMouseDown={onAnchorMouseDown}
                onAnchorMouseUp={onAnchorMouseUp}
                hoverTarget={isHoverTarget}
                setHoverAnchor={setHoverAnchor}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom taskbar */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t flex items-center justify-between px-4 shadow-md select-none">
        <div className="flex items-center gap-2">
          <Input placeholder="Search activities" value={search} onChange={e => setSearch(e.target.value)} className="w-64" />
          <Button variant="secondary" onClick={createActivity}>Add Activity</Button>
          <Button variant="secondary" onClick={createMilestone}><PlusCircle className="w-4 h-4 mr-1" /> Milestone</Button>
          <Button variant={linkMode ? "default" : "secondary"} onClick={() => { setPendingFrom(null); setLinkingDrag(null); setHoverAnchor(null); setLinkMode(v => !v); }}><Link2 className="w-4 h-4 mr-1" /> {linkMode ? 'Link Mode' : 'Link Off'}</Button>
          <select className="border rounded px-2 py-1 text-sm" value={linkType} onChange={e => setLinkType(e.target.value as LogicType)}>
            <option value="FS">FS</option>
            <option value="SS">SS</option>
            <option value="FF">FF</option>
          </select>
          <div className="flex items-center gap-1 text-xs">
            <span>Lag</span>
            <Input type="number" className="w-20" value={linkLag} onChange={e => setLinkLag(parseInt(e.target.value || '0', 10))} />
            <span>d</span>
          </div>
          <Button variant={snap ? "default" : "secondary"} onClick={() => setSnap(s => !s)}><Grid3X3 className="w-4 h-4 mr-1" /> {snap ? 'Snap' : 'Free'}</Button>
          <Button variant="secondary" onClick={alignVertical}><AlignVerticalSpaceBetween className="w-4 h-4 mr-1" /> Align Y</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={deleteSelected}><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setScale(s => Math.max(0.3, s - 0.1))}><ZoomOut className="w-4 h-4" /></Button>
          <div className="text-xs w-12 text-center">{Math.round(scale * 100)}%</div>
          <Button size="sm" variant="ghost" onClick={() => setScale(s => Math.min(3, s + 0.1))}><ZoomIn className="w-4 h-4" /></Button>
          <Button variant="secondary" onClick={() => { setPan({ x: 0, y: 0 }); setScale(1); }}><RefreshCcw className="w-4 h-4 mr-1" /> Reset</Button>
        </div>
      </div>

      {/* Details sheet */}
      {showDetails && selected && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[760px] bg-white border rounded-t-2xl shadow-xl p-4 details-panel z-50" style={{ pointerEvents: 'auto' }} role="dialog" aria-modal="true" aria-labelledby="activity-details-title" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <div id="activity-details-title" className="text-sm font-semibold">Activity Details</div>
            <Button variant="ghost" size="sm" aria-label="Close details" onClick={() => setShowDetails(false)}>Close</Button>
          </div>

          {/* Primary fields */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Input aria-label="Title" value={selected.title} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, title: e.target.value } : n))} />
            <select aria-label="Type" className="border rounded px-2 py-1 text-sm" value={selected.type} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, type: e.target.value as NodeT["type"], durationDays: e.target.value === 'milestone' ? 0 : Math.max(1, n.durationDays) } : n))}>
              <option value="activity">Activity</option>
              <option value="milestone">Milestone</option>
            </select>
            <Input aria-label="Duration (days)" type="number" min={0} step={1} value={selected.durationDays} disabled={selected.type === 'milestone'} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, durationDays: Math.max(0, parseInt(e.target.value || '0', 10)) } : n))} />
          </div>

          <div className="grid grid-cols-3 gap-2 mb-2">
            <select aria-label="Department" className="border rounded px-2 py-1 text-sm" value={selected.department} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, department: e.target.value as Dept } : n))}>
              {Object.keys(PHASE_COLOURS).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select aria-label="Phase" className="border rounded px-2 py-1 text-sm" value={selected.phase} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, phase: e.target.value as Dept } : n))}>
              {Object.keys(PHASE_COLOURS).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs"><input aria-label="Locked" type="checkbox" checked={!!selected.locked} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, locked: e.target.checked } : n))} /> Locked</label>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs">
              <span>Start</span>
              <input type="date" className="border rounded px-2 py-1 text-sm"
                value={formatDate(xToDateExact(selected.x))}
                onChange={e => {
                  const d = e.target.value ? new Date(e.target.value) : null;
                  if (!d) return;
                  const newX = dateToXExact(d);
                  setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, x: newX } : n));
                }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span>Finish</span>
              <input type="date" className="border rounded px-2 py-1 text-sm" value={formatDate(xToDateExact(endXPx(selected, dayPx)))} readOnly />
            </div>
            <div className="text-xs text-zinc-600 flex items-center">Colour by: {selected.department}</div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-2">
            <select aria-label="Constraint type" className="border rounded px-2 py-1 text-sm" value={selected.constraintType || 'none'} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, constraintType: e.target.value as ConstraintType } : n))}>
              <option value="none">No Constraint</option>
              <option value="MSO">Must Start On</option>
              <option value="MFO">Must Finish On</option>
              <option value="SNET">Start No Earlier Than</option>
              <option value="FNLT">Finish No Later Than</option>
            </select>
            <input aria-label="Constraint date" type="date" className="border rounded px-2 py-1 text-sm" value={selected.constraintDate ? new Date(selected.constraintDate).toISOString().substring(0,10) : ''} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, constraintDate: e.target.value ? new Date(e.target.value) : null } : n))} />
            <div className="text-xs text-zinc-600 flex items-center">Colour by: {selected.department}</div>
          </div>

          <Textarea aria-label="Notes" rows={4} value={selected.body || ""} onChange={e => setNodes(prev => prev.map(n => n.id === selected.id ? { ...n, body: e.target.value } : n))} />

          {/* Links inspector */}
          <div className="mt-4">
            <div className="text-sm font-semibold mb-2">Links</div>
            <div className="grid grid-cols-2 gap-4">
              {/* Predecessors */}
              <div>
                <div className="text-xs text-zinc-600 mb-1">Predecessors → This</div>
                <div className="space-y-2">
                  {links.filter(l => l.to === selected.id).map(l => (
                    <LinkEditor
                      key={l.id}
                      link={l}
                      nodes={nodes}
                      direction="pred"
                      onUpdate={(patch) => setLinks(prev => prev.map(x => x.id === l.id ? { ...x, ...patch } : x))}
                      onDelete={() => setLinks(prev => prev.filter(x => x.id !== l.id))}
                    />
                  ))}
                  {links.filter(l => l.to === selected.id).length === 0 && (
                    <div className="text-[11px] text-zinc-500">No predecessors</div>
                  )}
                </div>
              </div>
              {/* Successors */}
              <div>
                <div className="text-xs text-zinc-600 mb-1">This → Successors</div>
                <div className="space-y-2">
                  {links.filter(l => l.from === selected.id).map(l => (
                    <LinkEditor
                      key={l.id}
                      link={l}
                      nodes={nodes}
                      direction="succ"
                      onUpdate={(patch) => setLinks(prev => prev.map(x => x.id === l.id ? { ...x, ...patch } : x))}
                      onDelete={() => setLinks(prev => prev.filter(x => x.id !== l.id))}
                    />
                  ))}
                  {links.filter(l => l.from === selected.id).length === 0 && (
                    <div className="text-[11px] text-zinc-500">No successors</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-zinc-600 mt-3">Tip: Edit link type/lag here. Use the toolbar to create new links quickly.</div>
        </div>
      )}
    </div>
  );
}

// ---------------- Link Editor (inline) ----------------
function LinkEditor({ link, nodes, direction, onUpdate, onDelete }: {
  link: LinkT;
  nodes: NodeT[];
  direction: 'pred' | 'succ';
  onUpdate: (patch: Partial<LinkT>) => void;
  onDelete: () => void;
}) {
  const pred = nodes.find(n => n.id === link.from);
  const succ = nodes.find(n => n.id === link.to);
  const title = direction === 'pred' ? (pred?.title || link.from) : (succ?.title || link.to);
  return (
    <div className="flex items-center gap-2 text-xs border rounded p-2">
      <div className="flex-1 truncate" title={title}>{title}</div>
      <select aria-label="Link type" className="border rounded px-1 py-0.5" value={link.type} onChange={e => onUpdate({ type: (e.target as HTMLSelectElement).value as LogicType })}>
        <option value="FS">FS</option>
        <option value="SS">SS</option>
        <option value="FF">FF</option>
      </select>
      <div className="flex items-center gap-1">
        <span>Lag</span>
        <Input aria-label="Lag days" type="number" className="w-16 h-7" value={link.lagDays} onChange={e => onUpdate({ lagDays: parseInt((e.target as HTMLInputElement).value || '0', 10) })} />
        <span>d</span>
      </div>
      <Button aria-label="Delete link" variant="destructive" size="sm" onClick={onDelete}>Delete</Button>
    </div>
  );
}

// ---------------- Draggable Node ----------------
function DraggableNode({
  node,
  onMove,
  onResizeLeft,
  onResizeRight,
  onSelect,
  onDouble,
  outOfRange,
  selected,
  linkMode,
  dayPx,
  snap,
  departmentColor,
  showAnchors,
  onAnchorMouseDown,
  onAnchorMouseUp,
  hoverTarget,
  setHoverAnchor,
}: {
  node: NodeT;
  onMove: (dx: number, dy: number, e?: React.MouseEvent) => void;
  onResizeLeft: (daysDelta: number, e?: React.MouseEvent) => void;
  onResizeRight: (daysDelta: number, e?: React.MouseEvent) => void;
  onSelect: (e: React.MouseEvent) => void;
  onDouble: (e: React.MouseEvent) => void;
  outOfRange: boolean;
  selected: boolean;
  linkMode: boolean;
  dayPx: number;
  snap: boolean;
  departmentColor: string;
  showAnchors: boolean;
  onAnchorMouseDown: (nodeId: string, end: AnchorEnd, vert: AnchorVert, e: React.MouseEvent) => void;
  onAnchorMouseUp: (nodeId: string, end: AnchorEnd, vert: AnchorVert, e: React.MouseEvent) => void;
  hoverTarget: boolean;
  setHoverAnchor: React.Dispatch<React.SetStateAction<HoverAnchor>>;
}) {
  const dragging = useRef<null | 'move' | 'resize-l' | 'resize-r'>(null);

  const width = activityWidthPx(node);
  const ANCHOR_SIZE = 8;

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edge = 8;
    if (node.type === 'activity' && x < edge) dragging.current = 'resize-l';
    else if (node.type === 'activity' && x > rect.width - edge) dragging.current = 'resize-r';
    else dragging.current = 'move';
  };

  const onMouseUp = () => { dragging.current = null; };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || e.buttons !== 1) return;
    if (node.locked && !e.altKey) return;
    if (dragging.current === 'move') {
      onMove(e.movementX, e.movementY, e);
    } else if (dragging.current === 'resize-l' && node.type === 'activity') {
      const daysDelta = Math.round(e.movementX / dayPx);
      if (daysDelta !== 0) onResizeLeft(daysDelta, e);
    } else if (dragging.current === 'resize-r' && node.type === 'activity') {
      const daysDelta = Math.round(e.movementX / dayPx);
      if (daysDelta !== 0) onResizeRight(daysDelta, e);
    }
  };

  return (
    <motion.div
      className={`absolute h-12 border rounded-xl shadow-sm p-2 bg-white ${outOfRange ? 'opacity-50 border-red-400' : 'border-zinc-200'} ${selected ? 'ring-2 ring-zinc-900' : ''} ${hoverTarget ? 'ring-2 ring-blue-400' : ''}`}
      style={{ left: node.x, top: node.y, width }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseMove={onMouseMove}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onDouble(e); }}
      title={linkMode ? 'Link Mode: drag from a dot' : node.title}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold truncate" style={{ color: departmentColor }}>{node.title}</div>
        {node.locked && <span title="Locked" className="text-[10px] px-1 rounded border" style={{ borderColor: departmentColor, color: departmentColor }}>LOCK</span>}
      </div>
      <div className="text-[11px] text-zinc-600">{node.type === 'milestone' ? 'Milestone' : `${node.durationDays}d`}</div>
      {/* Start/Finish dates (read-only labels on card) */}
      <div className="text-[10px] text-zinc-500 leading-tight">
        <span>Start: {formatDate(xToDateExact(node.x))}</span>{' '}
        <span>• Finish: {formatDate(xToDateExact(endXPx(node, dayPx)))}</span>
      </div>
      <div className="mt-1 text-[10px] inline-block px-1 rounded" style={{ backgroundColor: departmentColor, color: 'white' }}>{node.department}</div>
      {node.type === 'milestone' && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 rotate-45 w-3 h-3" style={{ backgroundColor: departmentColor, borderRadius: 2 }} />
      )}
      {node.type === 'activity' && (
        <>
          <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize" />
          <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" />
        </>
      )}

      {/* Connector dots (only in Link Mode) */}
      {showAnchors && (
        <>
          {/* Top-left (S) */}
          <div
            className="absolute -top-1 -left-1 rounded-full border border-white shadow cursor-crosshair"
            style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE, backgroundColor: departmentColor }}
            onMouseEnter={() => setHoverAnchor({ nodeId: node.id, end: 'S', vert: 'top' })}
            onMouseLeave={() => setHoverAnchor(h => (h && h.nodeId === node.id && h.end === 'S' && h.vert === 'top') ? null : h)}
            onMouseDown={(e) => onAnchorMouseDown(node.id, 'S', 'top', e)}
            onMouseUp={(e) => onAnchorMouseUp(node.id, 'S', 'top', e)}
            title="Start anchor (top)"
          />
          {/* Top-right (F) */}
          <div
            className="absolute -top-1 -right-1 rounded-full border border-white shadow cursor-crosshair"
            style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE, backgroundColor: departmentColor }}
            onMouseEnter={() => setHoverAnchor({ nodeId: node.id, end: 'F', vert: 'top' })}
            onMouseLeave={() => setHoverAnchor(h => (h && h.nodeId === node.id && h.end === 'F' && h.vert === 'top') ? null : h)}
            onMouseDown={(e) => onAnchorMouseDown(node.id, 'F', 'top', e)}
            onMouseUp={(e) => onAnchorMouseUp(node.id, 'F', 'top', e)}
            title="Finish anchor (top)"
          />
          {/* Bottom-left (S) */}
          <div
            className="absolute -bottom-1 -left-1 rounded-full border border-white shadow cursor-crosshair"
            style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE, backgroundColor: departmentColor }}
            onMouseEnter={() => setHoverAnchor({ nodeId: node.id, end: 'S', vert: 'bottom' })}
            onMouseLeave={() => setHoverAnchor(h => (h && h.nodeId === node.id && h.end === 'S' && h.vert === 'bottom') ? null : h)}
            onMouseDown={(e) => onAnchorMouseDown(node.id, 'S', 'bottom', e)}
            onMouseUp={(e) => onAnchorMouseUp(node.id, 'S', 'bottom', e)}
            title="Start anchor (bottom)"
          />
          {/* Bottom-right (F) */}
          <div
            className="absolute -bottom-1 -right-1 rounded-full border border-white shadow cursor-crosshair"
            style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE, backgroundColor: departmentColor }}
            onMouseEnter={() => setHoverAnchor({ nodeId: node.id, end: 'F', vert: 'bottom' })}
            onMouseLeave={() => setHoverAnchor(h => (h && h.nodeId === node.id && h.end === 'F' && h.vert === 'bottom') ? null : h)}
            onMouseDown={(e) => onAnchorMouseDown(node.id, 'F', 'bottom', e)}
            onMouseUp={(e) => onAnchorMouseUp(node.id, 'F', 'bottom', e)}
            title="Finish anchor (bottom)"
          />
        </>
      )}
    </motion.div>
  );
}

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Share2, ZoomIn, ZoomOut, RotateCcw, ShoppingCart, Truck, CircleDot,
} from "lucide-react";
import { api, type TransactionResult } from "../../engine/apiClient";

interface GraphNode {
  id: string;
  label: string;
  group: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

const GROUP_COLORS: Record<string, string> = {
  user: "#d4af37",
  store: "#b76e79",
  electronics: "#b76e79",
  clothing: "#d9a5a0",
  accessories: "#a0a0a0",
};

function productGroup(title: string): string {
  const t = title.toLowerCase();
  if (/(headphone|earbud|speaker|keyboard|charger|usb|hub|monitor|phone|screen|cable)/.test(t)) return "electronics";
  if (/(shoe|sneaker|hoodie|shirt|jacket|dress|pants)/.test(t)) return "clothing";
  return "accessories";
}

function buildGraph(txns: TransactionResult[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [{ id: "me", label: "You", group: "user" }];
  const edges: GraphEdge[] = [];
  const storeIds = new Set<string>();
  const productIds = new Set<string>();

  for (const t of txns) {
    const storeId = `store_${t.merchant.toLowerCase().replace(/[^a-z0-9]/g, "") || "unknown"}`;
    if (!storeIds.has(storeId)) {
      storeIds.add(storeId);
      nodes.push({ id: storeId, label: t.merchant || "Store", group: "store" });
    }
    const pid = `prod_${t.id}`;
    if (!productIds.has(pid)) {
      productIds.add(pid);
      nodes.push({ id: pid, label: t.product_title.split(" (")[0].slice(0, 22), group: productGroup(t.product_title) });
    }
    if (!edges.some((e) => e.from === "me" && e.to === storeId)) {
      edges.push({ from: "me", to: storeId, label: "bought_from" });
    }
    edges.push({ from: storeId, to: pid, label: "contains_item" });
    const day = new Date((t.created_at || 0) * 1000).toISOString().slice(0, 10);
    edges.push({ from: "me", to: pid, label: `purchased_on ${day}` });
  }
  return { nodes, edges };
}

// Simple force-directed graph using canvas
function drawGraph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nodes: { id: string; x: number; y: number; vx: number; vy: number; label: string; group: string }[],
  edges: GraphEdge[],
  nodeMap: Map<string, number>,
  hovered: string | null
) {
  ctx.clearRect(0, 0, width, height);

  // Edges
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (const edge of edges) {
    const fromIdx = nodeMap.get(edge.from);
    const toIdx = nodeMap.get(edge.to);
    if (fromIdx === undefined || toIdx === undefined) continue;
    const from = nodes[fromIdx];
    const to = nodes[toIdx];

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Edge label midpoint
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(edge.label, mx, my - 4);
  }

  // Nodes
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isHovered = hovered === node.id;
    const radius = isHovered ? 22 : 18;
    const color = GROUP_COLORS[node.group] || "#6b7280";

    // Glow
    const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 2);
    gradient.addColorStop(0, `${color}30`);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isHovered) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = isHovered ? "#f4f4f4" : "rgba(255,255,255,0.6)";
    ctx.font = isHovered ? "10px Inter, sans-serif" : "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.label, node.x, node.y + radius + 12);
  }
}

export function PurchaseGraphWorld() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [txns, setTxns] = useState<TransactionResult[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [shipping, setShipping] = useState(0);
  const nodesRef = useRef<any[]>([]);
  const nodeMapRef = useRef<Map<string, number>>(new Map());
  const animRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getTransactions();
      const list = res.transactions ?? [];
      setTxns(list);
      setPending(list.filter((t) => t.status === "pending").length);
      setShipping(list.filter((t) => t.status === "completed" && t.shipping_status && t.shipping_status !== "delivered").length);
      setLastUpdated(Date.now());
    } catch { /* backend down */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const graph = useMemo(() => buildGraph(txns.filter((transaction) => transaction.status === "completed")), [txns]);

  useEffect(() => {
    const { nodes: rawNodes, edges } = graph;
    const nodeMap = new Map<string, number>();
    const simNodes = rawNodes.map((n, i) => {
      nodeMap.set(n.id, i);
      return {
        ...n,
        x: Math.random() * 500 + 50,
        y: Math.random() * 400 + 50,
        vx: 0,
        vy: 0,
      };
    });
    nodesRef.current = simNodes;
    nodeMapRef.current = nodeMap;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Center nodes in a ring
    simNodes.forEach((n, i) => {
      const angle = (i / Math.max(1, simNodes.length)) * Math.PI * 2;
      const radius = Math.min(W, H) * 0.34;
      n.x = W / 2 + Math.cos(angle) * radius;
      n.y = H / 2 + Math.sin(angle) * radius;
    });

    const render = () => {
      drawGraph(ctx, W, H, simNodes, edges, nodeMap, hovered);
      animRef.current = requestAnimationFrame(render);
    };
    render();

    return () => cancelAnimationFrame(animRef.current);
  }, [hovered, graph]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    let found: string | null = null;
    for (const node of nodesRef.current) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < 400) {
        found = node.id;
        break;
      }
    }
    setHovered(found);
    canvas.style.cursor = found ? "pointer" : "default";
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Share2 size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">Purchase Graph</h1>
          <span className="text-xs text-text-muted ml-1">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
          <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" /> LIVE
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-text-muted">
              synced {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-colors">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-colors">
            <ZoomOut size={14} />
          </button>
          <button onClick={() => setZoom(1)} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-colors">
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative overflow-hidden">
          <canvas
            ref={canvasRef}
            width={900}
            height={600}
            className="absolute inset-0 w-full h-full"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            onMouseMove={handleMouseMove}
          />
          <div className="absolute bottom-4 left-4 flex gap-3">
            {Object.entries(GROUP_COLORS).map(([group, color]) => (
              <div key={group} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[9px] text-text-muted capitalize">{group}</span>
              </div>
            ))}
          </div>
          {hovered && (
            <div className="absolute top-4 right-4 glass rounded-lg px-3 py-2 text-xs">
              <div className="text-text-primary font-medium">{nodesRef.current[nodeMapRef.current.get(hovered) || 0]?.label}</div>
              <div className="text-text-muted capitalize">{nodesRef.current[nodeMapRef.current.get(hovered) || 0]?.group}</div>
            </div>
          )}
        </div>

        <div className="w-72 border-l border-border flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[9px] tracking-widest text-text-muted uppercase">Live tracking</div>
              <div className="text-[10px] text-text-muted mt-0.5">
                <span className="text-text-primary font-semibold">{txns.length}</span> orders
                <span className="mx-1.5 text-border-active">·</span>
                <span className="text-accent-orange">{pending}</span> pending pay
                <span className="mx-1.5 text-border-active">·</span>
                <span className="text-accent-bright">{shipping}</span> in transit
              </div>
            </div>
            <Truck size={16} className="text-accent" />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
            {txns.length === 0 && (
              <div className="text-center py-10">
                <CircleDot size={20} className="mx-auto mb-2 text-text-muted/30" />
                <p className="text-xs text-text-muted">No purchases yet — buy something and watch the graph grow.</p>
              </div>
            )}
            {[...txns].reverse().map((t) => (
              <div key={t.id} className="px-2.5 py-2 rounded-lg bg-surface-2/60 border border-border/60">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-surface-3 overflow-hidden flex items-center justify-center shrink-0">
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <ShoppingCart size={12} className="text-text-muted/60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-text-primary truncate">{t.product_title}</div>
                    <div className="text-[9px] text-text-muted truncate">{t.merchant} · ${t.amount.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${t.status === "completed" ? "bg-accent-green/15 text-accent-green" : "bg-accent-orange/15 text-accent-orange"}`}>
                    {t.status}
                  </span>
                  {t.shipping_status ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent capitalize">
                      {t.shipping_status.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

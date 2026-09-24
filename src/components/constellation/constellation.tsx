"use client";

import { useEffect, useRef } from "react";
import ForceGraph, { type LinkObject, type NodeObject } from "force-graph";
import { forceCollide, forceRadial } from "d3-force-3d";
import { branchColor, type AgentNode } from "./types";

type GraphNode = NodeObject & AgentNode & { depth: number };
type GraphLink = LinkObject<GraphNode>;

const RADIUS_BY_DEPTH = [14, 8, 5.5, 4.5, 4];

function atDepth<T>(values: T[], depth: number) {
  return values[Math.min(depth, values.length - 1)];
}

// Each depth sits on its own ring around the Brain; nodes can nest without limit.
function ringRadius(depth: number) {
  return depth === 0 ? 0 : 130 + (depth - 1) * 105;
}

function buildGraph(agents: AgentNode[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = (id: string | null) =>
    agents
      .filter((a) =>
        id === null ? !a.parentId || !byId.has(a.parentId) : a.parentId === id
      )
      .sort((a, b) => a.position - b.position);

  // Start each node at an angle inside its parent's sector so branches stay
  // grouped; the forces then only need to settle, not untangle.
  const nodes: GraphNode[] = [];
  const place = (a: AgentNode, depth: number, angle: number, sector: number) => {
    const ring = ringRadius(depth);
    nodes.push(
      depth === 0
        ? { ...a, depth, x: 0, y: 0, fx: 0, fy: 0 } // root pinned in the center
        : { ...a, depth, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }
    );
    const children = childrenOf(a.id);
    const childSector = sector / Math.max(children.length, 1);
    children.forEach((child, i) =>
      place(child, depth + 1, angle - sector / 2 + childSector * (i + 0.5), childSector)
    );
  };
  childrenOf(null).forEach((root) => place(root, 0, -Math.PI / 2, 2 * Math.PI));

  const links: GraphLink[] = agents
    .filter((a) => a.parentId && byId.has(a.parentId))
    .map((a) => ({ source: a.parentId!, target: a.id }));
  return { nodes, links };
}

type Graph = ForceGraph<GraphNode, GraphLink>;
type ViewState = { selectedId: string | null; activeSlug: string | null; hoverId: string | null };

// Redraw a paused frame (selection/hover change) by briefly disabling auto-pause.
function requestRedraw(
  graph: Graph,
  view: ViewState,
  timer: { current: ReturnType<typeof setTimeout> | undefined }
) {
  graph.autoPauseRedraw(false);
  clearTimeout(timer.current);
  timer.current = setTimeout(() => graph.autoPauseRedraw(view.activeSlug === null), 100);
}

/**
 * Drives force-graph imperatively rather than through react-force-graph-2d:
 * that wrapper's StrictMode handling can destroy the instance on the dev
 * double-mount and leave a frozen canvas. Owning create/destroy here avoids it.
 */
export default function Constellation({
  agents,
  selectedId,
  activeSlug,
  onSelect,
}: {
  agents: AgentNode[];
  selectedId: string | null;
  /** Agent currently answering; pulses and gets particles on its link. */
  activeSlug: string | null;
  onSelect: (agent: AgentNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  // Read by the canvas callbacks on every frame, so they never need re-binding.
  const viewRef = useRef<ViewState>({ selectedId, activeSlug, hoverId: null });
  const onSelectRef = useRef(onSelect);
  const redrawTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const el = containerRef.current!;
    const view = viewRef.current;
    const redrawTimer = redrawTimerRef;
    const isActiveLink = (link: GraphLink) =>
      view.activeSlug !== null && (link.target as GraphNode).slug === view.activeSlug;

    const graph = new ForceGraph<GraphNode, GraphLink>(el)
      .backgroundColor("rgba(0,0,0,0)")
      .cooldownTicks(120)
      .onNodeClick((node) => onSelectRef.current(node))
      .onNodeHover((node) => {
        view.hoverId = node ? node.id : null;
        requestRedraw(graph, view, redrawTimer);
      })
      .linkColor((link) =>
        isActiveLink(link) ? "rgba(216, 180, 254, 0.7)" : "rgba(196, 181, 253, 0.18)"
      )
      .linkWidth((link) => (isActiveLink(link) ? 1.5 : 0.8))
      .linkDirectionalParticleWidth(2.5)
      .linkDirectionalParticleSpeed(0.012)
      .linkDirectionalParticleColor(() => "#e9d5ff")
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, atDepth(RADIUS_BY_DEPTH, node.depth) + 4, 0, 2 * Math.PI);
        ctx.fill();
      })
      .nodeCanvasObject((node, ctx, scale) => {
        const x = node.x!;
        const y = node.y!;
        const r = atDepth(RADIUS_BY_DEPTH, node.depth);
        const color = branchColor(node.branch);
        const isSelected = node.id === view.selectedId;
        const isHover = node.id === view.hoverId;
        const isActive = node.slug === view.activeSlug;
        const pulse = isActive ? 0.5 + 0.5 * Math.sin(Date.now() / 250) : 0;

        // Outer glow
        const glowR = r * (node.depth === 0 ? 3.2 : 2.6) + pulse * r;
        const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowR);
        glow.addColorStop(0, color + (isActive || isHover ? "88" : "55"));
        glow.addColorStop(1, color + "00");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, 2 * Math.PI);
        ctx.fill();

        // Core
        const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        core.addColorStop(0, "#ffffff");
        core.addColorStop(0.35, color);
        core.addColorStop(1, color + "aa");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 1.2 / scale;
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
          ctx.stroke();
        }

        // Label — constant on-screen size, dimmer for sub-agents when zoomed out
        const fontSize = (node.depth === 0 ? 13 : 11) / scale;
        const alpha = node.depth < 2 || scale > 1.1 || isHover || isSelected ? 0.9 : 0.45;
        ctx.font = `${node.depth === 0 ? 600 : 500} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = `rgba(237, 233, 254, ${alpha})`;
        ctx.fillText(node.name, x, y + r + 4 / scale);
      });

    graph.d3Force("charge")?.strength(-200);
    graph.d3Force("link")?.distance(100).strength(0.5);
    graph.d3Force(
      "radial",
      forceRadial<GraphNode>((n) => ringRadius(n.depth)).strength(0.9)
    );
    graph.d3Force(
      "collide",
      forceCollide<GraphNode>((n) => atDepth(RADIUS_BY_DEPTH, n.depth) + 18)
    );

    const observer = new ResizeObserver(([entry]) => {
      graph.width(entry.contentRect.width).height(entry.contentRect.height);
    });
    observer.observe(el);
    graphRef.current = graph;

    return () => {
      observer.disconnect();
      clearTimeout(redrawTimer.current);
      graph._destructor();
      el.replaceChildren();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || agents.length === 0) return;
    // Keep existing nodes where they are when a node is added or removed.
    const previous = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
    const data = buildGraph(agents);
    for (const node of data.nodes) {
      const prev = previous.get(node.id);
      if (prev && node.depth > 0) Object.assign(node, { x: prev.x, y: prev.y, vx: 0, vy: 0 });
    }
    graph.graphData(data).onEngineStop(() => {
      graph.zoomToFit(600, 60);
      graph.onEngineStop(() => {}); // only fit once per change, after the layout settles
    });
  }, [agents]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    viewRef.current.selectedId = selectedId;
    viewRef.current.activeSlug = activeSlug;
    // Particle counts are cached per link, so re-set the accessor to refresh them.
    graph.linkDirectionalParticles((link) =>
      activeSlug !== null && (link.target as GraphNode).slug === activeSlug ? 3 : 0
    );
    requestRedraw(graph, viewRef.current, redrawTimerRef);
  }, [selectedId, activeSlug]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

/*!
 * ArcMap – multi-route SVG arc renderer (TypeScript ES module)
 * MIT © 2025
 */
export type ArcMapLabel = { title?: string; subtitle?: string };
export type Point = { lat: number; lon: number; label?: string };

export type Route = {
  id?: string;
  from: Point;
  to: Point;
  label?: ArcMapLabel | null;
  color?: string;
  arcWidth?: number;
  curvature?: number;
  flyDot?: boolean;
  hoverColor?: string;
  hoverWidth?: number;
};

export type TooltipRenderResult =
  | string
  | HTMLElement
  | (ArcMapLabel & { lines?: string[] });

export interface TooltipOptions {
  follow?: "cursor" | "midpoint"; // default: 'cursor'
  offset?: { x: number; y: number }; // default: {x: 12, y: 12}
  stickyOnClick?: boolean; // default: true
  className?: string; // optional custom class
  render?: (route: Route) => TooltipRenderResult;
}

export interface ArcMapOptions {
  width?: number;
  height?: number;
  routes?: Route[];
  from?: Point;
  to?: Point;
  label?: ArcMapLabel | null; // back-compat
  colors?: { point?: string; arc?: string; trail?: string };
  arcWidth?: number;
  curvature?: number;
  animate?: boolean;
  flyDot?: boolean;
  tooltip?: TooltipOptions; // NEW
}

type XY = { x: number; y: number };

export default class ArcMap {
  private el: HTMLElement;
  private svg!: SVGSVGElement;
  private gArcs!: SVGGElement;
  private gPoints!: SVGGElement;
  private gFx!: SVGGElement;
  private gTooltip!: SVGGElement;
  private tooltipRect!: SVGRectElement | null;
  private tooltipTitle!: SVGTextElement | null;
  private tooltipSub!: SVGTextElement | null;

  private ro?: ResizeObserver;
  private uid = Math.random().toString(36).slice(2, 8);
  private glowId = `glow-${this.uid}`;

  private routes: Route[] = [];

  private tooltipDiv!: HTMLDivElement;
  private isPinned = false;

  o: Required<Omit<ArcMapOptions, "routes" | "from" | "to" | "label">> & {
    routes: Route[];
    label?: never; // hidden in the resolved shape
  };

  constructor(container: string | HTMLElement, opts: ArcMapOptions) {
    const target =
      typeof container === "string"
        ? (document.querySelector(container) as HTMLElement | null)
        : container;
    if (!target) throw new Error("ArcMap: container not found");
    this.el = target;

    // Defaults
    const d = {
      width: this.el.clientWidth || 800,
      height: this.el.clientHeight || 400,
      colors: { point: "#E8FF2A", arc: "#E8FF2A", trail: "#FFFFFF" },
      arcWidth: 4,
      curvature: 0.25,
      animate: true,
      flyDot: true,
      routes: [] as Route[],
    };

    // Back-compat: if single from/to provided, convert to one-route array
    const legacyRoute: Route[] =
      opts.routes && opts.routes.length
        ? opts.routes
        : opts.from && opts.to
        ? [{ from: opts.from, to: opts.to, label: opts.label ?? null }]
        : [];

    this.o = Object.assign({}, d, { routes: legacyRoute }, opts, {
      label: undefined,
    });

    // Container must be relative for absolute SVG overlay
    const style = getComputedStyle(this.el);
    if (style.position === "static") this.el.style.position = "relative";

    // Build SVG (pointer-events ON so we can hover arcs)
    this.svg = this.svgEl("svg", {
      width: String(this.o.width),
      height: String(this.o.height),
      viewBox: `0 0 ${this.o.width} ${this.o.height}`,
      style: "position:absolute;inset:0;pointer-events:auto;",
    }) as SVGSVGElement;
    this.el.appendChild(this.svg);

    // HTML tooltip overlay (easier rich content than SVG)
    this.tooltipDiv = document.createElement("div");
    this.tooltipDiv.setAttribute("role", "tooltip");
    this.tooltipDiv.style.position = "absolute";
    this.tooltipDiv.style.left = "0";
    this.tooltipDiv.style.top = "0";
    this.tooltipDiv.style.transform = "translate(-50%, calc(-100% - 10px))";
    this.tooltipDiv.style.background = "#111";
    this.tooltipDiv.style.color = "#eaeaea";
    this.tooltipDiv.style.border = "1px solid #ffffff26";
    this.tooltipDiv.style.borderRadius = "8px";
    this.tooltipDiv.style.padding = "10px 12px";
    this.tooltipDiv.style.boxShadow = "0 8px 24px #00000066";
    this.tooltipDiv.style.pointerEvents = "none";
    this.tooltipDiv.style.fontFamily =
      "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    this.tooltipDiv.style.fontSize = "12px";
    this.tooltipDiv.style.lineHeight = "1.35";
    this.tooltipDiv.style.maxWidth = "280px";
    this.tooltipDiv.style.display = "none";
    if (this.o.tooltip?.className)
      this.tooltipDiv.className = this.o.tooltip.className;
    this.el.appendChild(this.tooltipDiv);

    this.buildDefs();

    this.gArcs = this.svgEl("g") as SVGGElement;
    this.gPoints = this.svgEl("g") as SVGGElement;
    this.gFx = this.svgEl("g") as SVGGElement;
    this.gTooltip = this.svgEl("g", {
      style: "display:none; pointer-events:none;",
    }) as SVGGElement;

    this.svg.append(this.gArcs, this.gPoints, this.gFx, this.gTooltip);
    this.buildTooltip();

    this.setRoutes(this.o.routes);

    // Resize aware
    if ("ResizeObserver" in window) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el);
    }
  }

  destroy() {
    this.ro?.disconnect();
    this.svg?.remove();
  }

  /** Replace the route list and redraw */
  setRoutes(routes: Route[]) {
    this.routes = routes ?? [];
    this.render();
  }

  /** Update general visual options (colors, curvature, etc.) and redraw */
  update(opts: Partial<ArcMapOptions>) {
    // If caller passes new routes, adopt them
    if (opts.routes) this.routes = opts.routes;
    Object.assign(this.o, opts);
    this.render();
  }

  // ------------------------------------------------------------------------

  private render() {
    const { width, height } = this.o;

    // Draw arcs
    this.gArcs.innerHTML = "";
    this.gFx.innerHTML = "";

    // Points: de-duplicate
    this.gPoints.innerHTML = "";
    const pointSet = new Map<string, XY>();

    this.routes.forEach((r, idx) => {
      const A = this.project(r.from.lon, r.from.lat, width, height);
      const B = this.project(r.to.lon, r.to.lat, width, height);

      // Keep unique points
      const keyA = `${r.from.lat},${r.from.lon}`;
      const keyB = `${r.to.lat},${r.to.lon}`;
      if (!pointSet.has(keyA)) pointSet.set(keyA, A);
      if (!pointSet.has(keyB)) pointSet.set(keyB, B);

      // Arc path
      const curvature = r.curvature ?? this.o.curvature;
      const pathD = this.arcPath(A, B, curvature);

      const arcWidth = r.arcWidth ?? this.o.arcWidth;
      const stroke = r.color ?? (this.o.colors.arc || "#E8FF2A");

      const path = this.svgEl("path", {
        d: pathD,
        fill: "none",
        stroke,
        "stroke-width": String(arcWidth),
        "stroke-linecap": "round",
        filter: `url(#${this.glowId})`,
        "aria-label": r.label?.title ?? `route-${idx}`,
      }) as SVGPathElement;
      this.gArcs.appendChild(path);

      // Invisible hit path for easy hover
      const hit = this.svgEl("path", {
        d: pathD,
        fill: "none",
        stroke: "#000",
        "stroke-opacity": "0",
        "stroke-width": String(arcWidth + 12),
        "pointer-events": "stroke",
        cursor: "pointer",
        tabindex: "0", // keyboard focusable
      }) as SVGPathElement;
      this.gArcs.appendChild(hit);

      // Animate draw-on
      if (this.o.animate) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.getBoundingClientRect(); // reflow
        path.style.transition = "stroke-dashoffset 900ms ease-out";
        requestAnimationFrame(() => (path.style.strokeDashoffset = "0"));
      }

      const baseColor = stroke;
      const baseWidth = String(arcWidth);
      const hoverColor = r.hoverColor ?? baseColor;
      const hoverWidth = String(r.hoverWidth ?? arcWidth + 1);

      path.style.transition = "stroke 160ms ease, stroke-width 160ms ease";

      const highlightOn = () => {
        path.setAttribute("stroke", hoverColor);
        path.setAttribute("stroke-width", hoverWidth);
      };
      const highlightOff = () => {
        path.setAttribute("stroke", baseColor);
        path.setAttribute("stroke-width", baseWidth);
      };

      // Tooltip controls
      const onEnter = (e: MouseEvent) => {
        this.isPinned || this.showTooltipHTML(r, path);
        highlightOn();
        this.isPinned || this.moveTooltip(e, path);
      };
      const onMove = (e: MouseEvent) => {
        this.isPinned || this.moveTooltip(e, path);
      };
      const onLeave = () => {
        if (!this.isPinned) {
          this.hideTooltipHTML();
          highlightOff();
        }
      };
      const onFocus = () => {
        this.showTooltipHTML(r, path);
        highlightOn();
      };
      const onBlur = () => {
        if (!this.isPinned) {
          this.hideTooltipHTML();
          highlightOff();
        }
      };
      const onClick = (e: MouseEvent) => {
        if (this.o.tooltip?.stickyOnClick === false) return;
        this.isPinned = !this.isPinned;
        if (this.isPinned) {
          this.showTooltipHTML(r, path);
          this.moveTooltip(e, path);
          // allow clicking outside to unpin
          const off = (ev: MouseEvent) => {
            if (!this.el.contains(ev.target as Node) || ev.target === hit) {
              this.isPinned = false;
              this.hideTooltipHTML();
              highlightOff();
              window.removeEventListener("mousedown", off, true);
            }
          };
          window.addEventListener("mousedown", off, true);
        } else {
          this.hideTooltipHTML();
          highlightOff();
        }
      };

      // Accessibility
      hit.setAttribute("tabindex", "0");
      hit.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          this.isPinned = !this.isPinned;
          if (!this.isPinned) {
            this.hideTooltipHTML();
            highlightOff();
          } else {
            this.showTooltipHTML(r, path);
          }
        }
        if (ev.key === "Escape") {
          this.isPinned = false;
          this.hideTooltipHTML();
          highlightOff();
        }
      });

      // Events
      hit.addEventListener("mouseenter", onEnter);
      hit.addEventListener("mousemove", onMove);
      hit.addEventListener("mouseleave", onLeave);
      hit.addEventListener("focus", onFocus);
      hit.addEventListener("blur", onBlur);
      hit.addEventListener("click", onClick);

      // Optional flying dot per route
      const fly = r.flyDot ?? this.o.flyDot;
      if (fly) {
        const dot = this.svgEl("circle", {
          r: "5",
          fill: stroke || "#E8FF2A",
          filter: `url(#${this.glowId})`,
        }) as SVGCircleElement;
        this.gFx.appendChild(dot);
        this.animateAlong(dot, path, 1200 + (idx % 3) * 150);
      }
    });

    // Draw unique points
    pointSet.forEach((pt) => {
      const g = this.svgEl("g", { transform: `translate(${pt.x},${pt.y})` });
      const outer = this.svgEl("circle", {
        r: "6",
        fill: this.o.colors.point || "#E8FF2A",
        filter: `url(#${this.glowId})`,
      });
      const inner = this.svgEl("circle", { r: "2.5", fill: "#101010" });
      g.append(outer, inner);
      this.gPoints.appendChild(g);
    });

    // Hide tooltip after redraw (until hover)
    this.hideTooltip();
  }

  // ------------------------------------------------------------------------

  private resize() {
    const w = this.el.clientWidth || this.o.width;
    const h = this.el.clientHeight || this.o.height;
    this.o.width = w;
    this.o.height = h;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));
    this.render();
  }

  private buildDefs() {
    const defs = this.svgEl("defs");
    const f = this.svgEl("filter", {
      id: this.glowId,
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%",
    });
    f.appendChild(
      this.svgEl("feGaussianBlur", { stdDeviation: "3", result: "blur" })
    );
    const merge = this.svgEl("feMerge");
    merge.appendChild(this.svgEl("feMergeNode", { in: "blur" }));
    merge.appendChild(this.svgEl("feMergeNode", { in: "SourceGraphic" }));
    f.appendChild(merge);
    defs.appendChild(f);
    this.svg.appendChild(defs);
  }

  // Tooltip elements (single instance, reused)
  private buildTooltip() {
    this.gTooltip.innerHTML = "";
    const pad = 10;
    const rect = this.svgEl("rect", {
      x: "8",
      y: "8",
      rx: "8",
      ry: "8",
      width: "140",
      height: "50",
      fill: "#111",
      stroke: "#ffffff",
    }) as SVGRectElement;

    const font = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

    const title = this.svgEl("text", {
      x: String(pad),
      y: String(pad + 12),
      "font-family": font,
      "font-size": "14",
      fill: "#eaeaea",
    }) as SVGTextElement;

    const sub = this.svgEl("text", {
      x: String(pad),
      y: String(pad + 12 + 18),
      "font-family": font,
      "font-size": "12",
      fill: "#bdbdbd",
    }) as SVGTextElement;

    const tail = this.svgEl("path", {
      d: "M 0 0 q -8 -12 0 -20",
      stroke: "#ffffff22",
      "stroke-width": "2",
      fill: "none",
    });

    this.gTooltip.append(rect, title, sub, tail);
    this.tooltipRect = rect;
    this.tooltipTitle = title;
    this.tooltipSub = sub;
  }

  private showTooltipHTML(route: Route, path: SVGPathElement) {
    const tpl = this.o.tooltip?.render?.(route);
    if (tpl instanceof HTMLElement) {
      this.tooltipDiv.innerHTML = "";
      this.tooltipDiv.appendChild(tpl);
    } else if (typeof tpl === "string") {
      this.tooltipDiv.innerHTML = tpl;
    } else {
      // default template using label / lines
      const t = (tpl as any)?.title ?? route.label?.title ?? "";
      const s = (tpl as any)?.subtitle ?? route.label?.subtitle ?? "";
      const lines: string[] = (tpl as any)?.lines ?? [];
      this.tooltipDiv.innerHTML = `
      <div style="font-weight:600; font-size:13px">${t ?? ""}</div>
      ${s ? `<div style="opacity:.7; margin-top:2px">${s}</div>` : ""}
      ${
        lines.length
          ? `<ul style="margin:8px 0 0; padding-left:16px; opacity:.9">${lines
              .map((l) => `<li>${l}</li>`)
              .join("")}</ul>`
          : ""
      }
    `;
    }
    this.tooltipDiv.style.display = "";
  }

  private moveTooltip(ev: MouseEvent, path: SVGPathElement) {
    const follow = this.o.tooltip?.follow ?? "cursor";
    const { x: ox, y: oy } = this.o.tooltip?.offset ?? { x: 12, y: 12 };
    const rect = this.el.getBoundingClientRect();

    let x: number;
    let y: number;

    if (follow === "midpoint") {
      const len = path.getTotalLength();
      const mid = path.getPointAtLength(len * 0.5);
      x = mid.x;
      y = mid.y - 10;
    } else {
      // cursor (local coordinates inside container)
      x = ev.clientX - rect.left + ox;
      y = ev.clientY - rect.top + oy;
    }

    // Clamp to container bounds (with padding so bubble stays inside)
    const pad = 8;
    // Temporarily display to measure width/height
    const prev = this.tooltipDiv.style.display;
    this.tooltipDiv.style.display = "";
    const w = this.tooltipDiv.offsetWidth;
    const h = this.tooltipDiv.offsetHeight;
    this.tooltipDiv.style.display = prev;

    const maxX = this.el.clientWidth - pad;
    const maxY = this.el.clientHeight - pad;
    const minX = pad;
    const minY = pad + h; // because we position above with translateY(-100%)

    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));

    this.tooltipDiv.style.left = `${x}px`;
    this.tooltipDiv.style.top = `${y}px`;
  }

  private hideTooltipHTML() {
    this.tooltipDiv.style.display = "none";
  }

  // ---- math ---------------------------------------------------------------

  // Mercator projection
  private project(lon: number, lat: number, w: number, h: number): XY {
    const φ = (lat * Math.PI) / 180;
    const x = ((lon + 180) / 360) * w;
    const y = ((1 - Math.log(Math.tan(Math.PI / 4 + φ / 2)) / Math.PI) / 2) * h;
    return { x, y };
  }

  // Cubic Bézier arc
  private arcPath(A: XY, B: XY, curvature = 0.25) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;
    const dir = B.x > A.x ? -1 : 1; // bow north when heading east
    const lift = dist * curvature * dir;
    const c1 = {
      x: A.x + dx * 0.25 + nx * lift,
      y: A.y + dy * 0.25 + ny * lift,
    };
    const c2 = {
      x: A.x + dx * 0.75 + nx * lift,
      y: A.y + dy * 0.75 + ny * lift,
    };
    return `M ${A.x},${A.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
  }

  private animateAlong(
    dot: SVGCircleElement,
    path: SVGPathElement,
    duration = 1200
  ) {
    const start = performance.now();
    const len = path.getTotalLength();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const pt = path.getPointAtLength(len * k);
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private svgEl(tag: string, attrs: Record<string, string> = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
}

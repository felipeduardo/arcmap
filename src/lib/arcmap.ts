/*!
 * ArcMap – multi-route SVG arc renderer (Web Mercator)
 * Dependency-free. TypeScript. MIT © 2025
 *
 * Features
 * - routes: draw many arcs at once (deduped endpoint dots)
 * - hover: change arc color/width on hover/focus
 * - animation: draw-on + per-route flying dot
 * - tooltip: HTML overlay (follow cursor or midpoint, sticky on click, custom render)
 * - a11y: focusable hit-paths, Enter to pin, Esc to hide
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
  hoverColor?: string;   // stroke when hovered
  hoverWidth?: number;   // stroke-width when hovered
};

export type TooltipRenderResult =
  | string
  | HTMLElement
  | (ArcMapLabel & { lines?: string[] });

export interface TooltipOptions {
  follow?: "cursor" | "midpoint";          // default: 'cursor'
  offset?: { x: number; y: number };       // default: { x: 12, y: 12 }
  stickyOnClick?: boolean;                 // default: true
  className?: string;                      // optional custom class for the <div>
  render?: (route: Route) => TooltipRenderResult; // custom content
}

export interface ArcMapOptions {
  width?: number;
  height?: number;

  // Many routes (preferred)
  routes?: Route[];

  // Back-compat: single connection
  from?: Point;
  to?: Point;
  label?: ArcMapLabel | null;

  colors?: { point?: string; arc?: string; trail?: string };
  arcWidth?: number;            // default stroke width
  curvature?: number;           // default arc curvature
  animate?: boolean;            // draw-on animation
  flyDot?: boolean;             // default per-route flyDot

  tooltip?: TooltipOptions;     // tooltip settings
}

type XY = { x: number; y: number };
type ColorsResolved = { point: string; arc: string; trail: string };

type ResolvedOptions = {
  width: number;
  height: number;
  routes: Route[];
  colors: ColorsResolved;
  arcWidth: number;
  curvature: number;
  animate: boolean;
  flyDot: boolean;
  tooltip: Required<Omit<TooltipOptions, "render" | "className">> & {
    render?: TooltipOptions["render"];
    className?: string;
  };
};

export default class ArcMap {
  private el: HTMLElement;
  private svg!: SVGSVGElement;
  private gArcs!: SVGGElement;
  private gPoints!: SVGGElement;
  private gFx!: SVGGElement;
  private gTooltip!: SVGGElement; // (kept for future SVG tooltip use)
  private tooltipDiv!: HTMLDivElement;
  private tooltipVisible = false;
  private isPinned = false;

  private ro?: ResizeObserver;
  private uid = Math.random().toString(36).slice(2, 8);
  private glowId = `glow-${this.uid}`;

  private routes: Route[] = [];
  private o!: ResolvedOptions;

  constructor(container: string | HTMLElement, opts: ArcMapOptions) {
    const target =
      typeof container === "string"
        ? (document.querySelector(container) as HTMLElement | null)
        : container;

    if (!target) throw new Error("ArcMap: container not found");
    this.el = target;

    // Defaults
    const defaults: ResolvedOptions = {
      width: this.el.clientWidth || 800,
      height: this.el.clientHeight || 400,
      routes: [],
      colors: { point: "#E8FF2A", arc: "#E8FF2A", trail: "#FFFFFF" },
      arcWidth: 4,
      curvature: 0.25,
      animate: true,
      flyDot: true,
      tooltip: {
        follow: "cursor",
        offset: { x: 12, y: 12 },
        stickyOnClick: true
      }
    };

    // Back-compat: single from/to => one route
    const legacyRoute: Route[] =
      opts.routes && opts.routes.length
        ? opts.routes
        : opts.from && opts.to
        ? [{ from: opts.from, to: opts.to, label: opts.label ?? null }]
        : [];

    this.o = {
      ...defaults,
      width: opts.width ?? defaults.width,
      height: opts.height ?? defaults.height,
      routes: legacyRoute,
      colors: {
        point: opts.colors?.point ?? defaults.colors.point,
        arc: opts.colors?.arc ?? defaults.colors.arc,
        trail: opts.colors?.trail ?? defaults.colors.trail
      },
      arcWidth: opts.arcWidth ?? defaults.arcWidth,
      curvature: opts.curvature ?? defaults.curvature,
      animate: opts.animate ?? defaults.animate,
      flyDot: opts.flyDot ?? defaults.flyDot,
      tooltip: {
        follow: opts.tooltip?.follow ?? defaults.tooltip.follow,
        offset: opts.tooltip?.offset ?? defaults.tooltip.offset,
        stickyOnClick:
          opts.tooltip?.stickyOnClick ?? defaults.tooltip.stickyOnClick,
        className: opts.tooltip?.className,
        render: opts.tooltip?.render
      }
    };

    // Container needs positioning for absolute overlays
    const style = getComputedStyle(this.el);
    if (style.position === "static") this.el.style.position = "relative";

    // Root SVG (pointer events ON for hover)
    this.svg = this.svgEl("svg", {
      width: String(this.o.width),
      height: String(this.o.height),
      viewBox: `0 0 ${this.o.width} ${this.o.height}`,
      style: "position:absolute;inset:0;pointer-events:auto;"
    }) as SVGSVGElement;
    this.el.appendChild(this.svg);

    this.buildDefs();

    this.gArcs = this.svgEl("g") as SVGGElement;
    this.gPoints = this.svgEl("g") as SVGGElement;
    this.gFx = this.svgEl("g") as SVGGElement;
    this.gTooltip = this.svgEl("g", { style: "display:none;pointer-events:none;" }) as SVGGElement;

    this.svg.append(this.gArcs, this.gPoints, this.gFx, this.gTooltip);

    // HTML tooltip overlay (richer content + easier layout)
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
    this.tooltipDiv.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    this.tooltipDiv.style.fontSize = "12px";
    this.tooltipDiv.style.lineHeight = "1.35";
    this.tooltipDiv.style.maxWidth = "280px";
    this.tooltipDiv.style.display = "none";
    if (this.o.tooltip.className) this.tooltipDiv.className = this.o.tooltip.className;
    this.el.appendChild(this.tooltipDiv);

    // Initial data
    this.setRoutes(this.o.routes);

    // Resize-aware
    if ("ResizeObserver" in window) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el);
    }
  }

  // Public API --------------------------------------------------------------

  destroy() {
    this.ro?.disconnect();
    this.svg?.remove();
    this.tooltipDiv?.remove();
  }

  /** Replace all routes and redraw */
  setRoutes(routes: Route[]) {
    this.routes = routes ?? [];
    this.render();
  }

  /** Update general visuals / tooltip / routes, then redraw */
  update(opts: Partial<ArcMapOptions>) {
    // merge shallow options; deep-merge colors/tooltip
    if (opts.width != null) this.o.width = opts.width;
    if (opts.height != null) this.o.height = opts.height;
    if (opts.arcWidth != null) this.o.arcWidth = opts.arcWidth;
    if (opts.curvature != null) this.o.curvature = opts.curvature;
    if (opts.animate != null) this.o.animate = opts.animate;
    if (opts.flyDot != null) this.o.flyDot = opts.flyDot;

    if (opts.colors) {
      this.o.colors = {
        point: opts.colors.point ?? this.o.colors.point,
        arc: opts.colors.arc ?? this.o.colors.arc,
        trail: opts.colors.trail ?? this.o.colors.trail
      };
    }

    if (opts.tooltip) {
      this.o.tooltip.follow = opts.tooltip.follow ?? this.o.tooltip.follow;
      this.o.tooltip.offset = opts.tooltip.offset ?? this.o.tooltip.offset;
      this.o.tooltip.stickyOnClick =
        opts.tooltip.stickyOnClick ?? this.o.tooltip.stickyOnClick;
      this.o.tooltip.className = opts.tooltip.className ?? this.o.tooltip.className;
      this.o.tooltip.render = opts.tooltip.render ?? this.o.tooltip.render;
      if (this.o.tooltip.className) this.tooltipDiv.className = this.o.tooltip.className!;
    }

    if (opts.routes) this.routes = opts.routes;
    else if (opts.from && opts.to)
      this.routes = [{ from: opts.from, to: opts.to, label: opts.label ?? null }];

    this.render();
  }

  // Rendering ---------------------------------------------------------------

  private render() {
    const { width, height } = this.o;

    // Clear layers
    this.gArcs.innerHTML = "";
    this.gFx.innerHTML = "";
    this.gPoints.innerHTML = "";

    // Deduplicate endpoints (by lat,lon string key)
    const pointSet = new Map<string, XY>();

    this.routes.forEach((route, idx) => {
      const A = this.project(route.from.lon, route.from.lat, width, height);
      const B = this.project(route.to.lon, route.to.lat, width, height);

      pointSet.set(`${route.from.lat},${route.from.lon}`, A);
      pointSet.set(`${route.to.lat},${route.to.lon}`, B);

      // Arc path
      const curvature = route.curvature ?? this.o.curvature;
      const pathD = this.arcPath(A, B, curvature);

      const arcWidth = route.arcWidth ?? this.o.arcWidth;
      const stroke = route.color ?? this.o.colors.arc;

      const path = this.svgEl("path", {
        d: pathD,
        fill: "none",
        stroke,
        "stroke-width": String(arcWidth),
        "stroke-linecap": "round",
        filter: `url(#${this.glowId})`,
        "aria-label": route.label?.title ?? route.id ?? `route-${idx}`
      }) as SVGPathElement;
      this.gArcs.appendChild(path);

      // Invisible, thick "hit" path for hover/focus
      const hit = this.svgEl("path", {
        d: pathD,
        fill: "none",
        stroke: "#000",
        "stroke-opacity": "0",
        "stroke-width": String(arcWidth + 12),
        "pointer-events": "stroke",
        cursor: "pointer",
        tabindex: "0"
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

      // Hover highlight + tooltip
      const baseColor = stroke;
      const baseWidth = String(arcWidth);
      const hoverColor = route.hoverColor ?? baseColor;
      const hoverWidth = String(route.hoverWidth ?? arcWidth + 1);
      path.style.transition = "stroke 160ms ease, stroke-width 160ms ease";

      const highlightOn = () => {
        path.setAttribute("stroke", hoverColor);
        path.setAttribute("stroke-width", hoverWidth);
      };
      const highlightOff = () => {
        path.setAttribute("stroke", baseColor);
        path.setAttribute("stroke-width", baseWidth);
      };

      const onEnter = (e: MouseEvent) => {
        if (!this.isPinned) {
          this.showTooltipHTML(route);
          this.moveTooltip(e, path);
        }
        highlightOn();
      };

      const onMove = (e: MouseEvent) => {
        if (!this.isPinned) this.moveTooltip(e, path);
      };

      const onLeave = () => {
        if (!this.isPinned) {
          this.hideTooltipHTML();
          highlightOff();
        }
      };

      const onFocus = () => {
        this.showTooltipHTML(route);
        this.placeTooltipAtMid(path);
        highlightOn();
      };

      const onBlur = () => {
        if (!this.isPinned) {
          this.hideTooltipHTML();
          highlightOff();
        }
      };

      const onClick = (e: MouseEvent | TouchEvent) => {
        if (this.o.tooltip.stickyOnClick === false) return;
        this.isPinned = !this.isPinned;
        if (this.isPinned) {
          this.showTooltipHTML(route);
          // Position where the click occurred (or midpoint)
          if ("clientX" in e) this.moveTooltip(e as MouseEvent, path);
          else this.placeTooltipAtMid(path);
          // Clicking outside unpins
          const off = (ev: MouseEvent) => {
            if (!this.el.contains(ev.target as Node)) {
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

      hit.addEventListener("mouseenter", onEnter);
      hit.addEventListener("mousemove", onMove);
      hit.addEventListener("mouseleave", onLeave);
      hit.addEventListener("focus", onFocus);
      hit.addEventListener("blur", onBlur);
      hit.addEventListener("click", onClick);
      // Mobile tap (acts like click)
      hit.addEventListener("touchstart", (e) => onClick(e), { passive: true });

      // Optional flying dot
      const fly = route.flyDot ?? this.o.flyDot;
      if (fly) {
        const dot = this.svgEl("circle", {
          r: "5",
          fill: stroke,
          filter: `url(#${this.glowId})`
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
        fill: this.o.colors.point,
        filter: `url(#${this.glowId})`
      });
      const inner = this.svgEl("circle", { r: "2.5", fill: "#101010" });
      g.append(outer, inner);
      this.gPoints.appendChild(g);
    });

    // Reset tooltip unless pinned
    if (!this.isPinned) this.hideTooltipHTML();
  }

  // Resize ---------------------------------------------------------------

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

  // Tooltip (HTML) -------------------------------------------------------

  private showTooltipHTML(route: Route) {
    const tpl = this.o.tooltip.render?.(route);
    if (tpl instanceof HTMLElement) {
      this.tooltipDiv.innerHTML = "";
      this.tooltipDiv.appendChild(tpl);
    } else if (typeof tpl === "string") {
      this.tooltipDiv.innerHTML = tpl;
    } else {
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
    this.tooltipVisible = true;
  }

  private hideTooltipHTML() {
    this.tooltipDiv.style.display = "none";
    this.tooltipVisible = false;
  }

  private moveTooltip(ev: MouseEvent, path: SVGPathElement) {
    const follow = this.o.tooltip.follow;
    const { x: ox, y: oy } = this.o.tooltip.offset;
    const rect = this.el.getBoundingClientRect();

    let x: number;
    let y: number;

    if (follow === "midpoint") {
      const len = path.getTotalLength();
      const mid = path.getPointAtLength(len * 0.5);
      x = mid.x;
      y = mid.y - 10;
    } else {
      // cursor
      x = ev.clientX - rect.left + ox;
      y = ev.clientY - rect.top + oy;
    }

    this.placeTooltipAt(x, y);
  }

  private placeTooltipAtMid(path: SVGPathElement) {
    const len = path.getTotalLength();
    const mid = path.getPointAtLength(len * 0.5);
    this.placeTooltipAt(mid.x, mid.y - 10);
  }

  private placeTooltipAt(x: number, y: number) {
    // Clamp to container bounds (account for bubble size)
    const pad = 8;
    const prev = this.tooltipDiv.style.display;
    this.tooltipDiv.style.display = ""; // measure
    const w = this.tooltipDiv.offsetWidth;
    const h = this.tooltipDiv.offsetHeight;
    this.tooltipDiv.style.display = prev || ""; // keep visible state

    const maxX = this.el.clientWidth - pad;
    const maxY = this.el.clientHeight - pad;
    const minX = pad;
    const minY = pad + h; // because of translateY(-100%)

    const cx = Math.max(minX, Math.min(maxX, x));
    const cy = Math.max(minY, Math.min(maxY, y));

    this.tooltipDiv.style.left = `${cx}px`;
    this.tooltipDiv.style.top = `${cy}px`;
  }

  // SVG defs -------------------------------------------------------------

  private buildDefs() {
    const defs = this.svgEl("defs");
    const f = this.svgEl("filter", {
      id: this.glowId,
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%"
    });
    f.appendChild(this.svgEl("feGaussianBlur", { stdDeviation: "3", result: "blur" }));
    const merge = this.svgEl("feMerge");
    merge.appendChild(this.svgEl("feMergeNode", { in: "blur" }));
    merge.appendChild(this.svgEl("feMergeNode", { in: "SourceGraphic" }));
    f.appendChild(merge);
    defs.appendChild(f);
    this.svg.appendChild(defs);
  }

  // Math -----------------------------------------------------------------

  // Web Mercator projection to container (expects a Web-Mercator background)
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
    const c1 = { x: A.x + dx * 0.25 + nx * lift, y: A.y + dy * 0.25 + ny * lift };
    const c2 = { x: A.x + dx * 0.75 + nx * lift, y: A.y + dy * 0.75 + ny * lift };
    return `M ${A.x},${A.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
  }

  private animateAlong(dot: SVGCircleElement, path: SVGPathElement, duration = 1200) {
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

  // Utils ----------------------------------------------------------------

  private svgEl(tag: string, attrs: Record<string, string> = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
}

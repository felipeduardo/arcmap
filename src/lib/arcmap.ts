/*!
 * ArcMap – minimal, dependency-free SVG arc renderer (TypeScript ES module)
 * MIT © 2025
 */
export type ArcMapLabel = { title?: string; subtitle?: string };

export type Point = { lat: number; lon: number; label?: string };

export interface ArcMapOptions {
  width?: number;
  height?: number;
  from: Point;
  to: Point;
  colors?: { point?: string; arc?: string; trail?: string };
  arcWidth?: number;
  curvature?: number;  // 0 = straight; 0.1–0.5 looks good
  animate?: boolean;
  flyDot?: boolean;
  label?: ArcMapLabel | null;
}

type XY = { x: number; y: number };

export default class ArcMap {
  private el: HTMLElement;
  private svg!: SVGSVGElement;
  private gArc!: SVGGElement;
  private gPoints!: SVGGElement;
  private gFx!: SVGGElement;
  private gLabel!: SVGGElement;
  private ro?: ResizeObserver;
  private uid = Math.random().toString(36).slice(2, 8);
  private glowId = `glow-${this.uid}`;

  o: Required<Omit<ArcMapOptions, "label">> & { label: ArcMapLabel | null };

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
      from: { lat: 0, lon: 0, label: "A" },
      to: { lat: 0, lon: 0, label: "B" },
      colors: { point: "#E8FF2A", arc: "#E8FF2A", trail: "#FFFFFF" },
      arcWidth: 4,
      curvature: 0.25,
      animate: true,
      flyDot: true,
      label: null as ArcMapLabel | null
    };

    this.o = Object.assign({}, d, opts);

    // Container must be relative for absolute SVG overlay
    const style = getComputedStyle(this.el);
    if (style.position === "static") this.el.style.position = "relative";

    // Build SVG
    this.svg = this.svgEl("svg", {
      width: String(this.o.width),
      height: String(this.o.height),
      viewBox: `0 0 ${this.o.width} ${this.o.height}`,
      style: "position:absolute;inset:0;pointer-events:none;"
    }) as SVGSVGElement;
    this.el.appendChild(this.svg);

    this.buildDefs();

    this.gArc = this.svgEl("g") as SVGGElement;
    this.gPoints = this.svgEl("g") as SVGGElement;
    this.gFx = this.svgEl("g") as SVGGElement;
    this.gLabel = this.svgEl("g") as SVGGElement;

    this.svg.append(this.gArc, this.gPoints, this.gFx, this.gLabel);

    this.render();

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

  update(opts: Partial<ArcMapOptions>) {
    Object.assign(this.o, opts);
    this.render();
  }

  render() {
    const { width, height, from, to } = this.o;
    const A = this.project(from.lon, from.lat, width, height);
    const B = this.project(to.lon, to.lat, width, height);

    // Path
    const pathD = this.arcPath(A, B, this.o.curvature);
    this.gArc.innerHTML = "";
    const path = this.svgEl("path", {
      d: pathD,
      fill: "none",
      stroke: this.o.colors.arc,
      "stroke-width": String(this.o.arcWidth),
      "stroke-linecap": "round",
      filter: `url(#${this.glowId})`
    }) as SVGPathElement;
    this.gArc.appendChild(path);

    if (this.o.animate) {
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      // reflow
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1200ms ease-out";
      requestAnimationFrame(() => (path.style.strokeDashoffset = "0"));
    }

    // Points
    this.gPoints.innerHTML = "";
    [A, B].forEach((pt) => {
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

    // Flying dot
    this.gFx.innerHTML = "";
    if (this.o.flyDot) {
      const dot = this.svgEl("circle", {
        r: "5",
        fill: this.o.colors.arc,
        filter: `url(#${this.glowId})`
      }) as SVGCircleElement;
      this.gFx.appendChild(dot);
      this.animateAlong(dot, path, 1400);
    }

    // Label
    this.gLabel.innerHTML = "";
    if (this.o.label) this.labelAtMid(this.gLabel, path, this.o.label);
  }

  // ---- internals ----------------------------------------------------------

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
    const dir = B.x > A.x ? -1 : 1; // arc bows north when heading east
    const lift = dist * curvature * dir;
    const c1 = { x: A.x + dx * 0.25 + nx * lift, y: A.y + dy * 0.25 + ny * lift };
    const c2 = { x: A.x + dx * 0.75 + nx * lift, y: A.y + dy * 0.75 + ny * lift };
    return `M ${A.x},${A.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
  }

  private labelAtMid(g: SVGGElement, path: SVGPathElement, data: ArcMapLabel) {
    const total = path.getTotalLength();
    const mid = path.getPointAtLength(total * 0.5);
    const pad = 10;

    const group = this.svgEl("g", { transform: `translate(${mid.x},${mid.y})` }) as SVGGElement;
    const rect = this.svgEl("rect", {
      x: "0",
      y: "0",
      rx: "8",
      ry: "8",
      width: "10",
      height: "10",
      fill: "#111",
      stroke: "#ffffff",
      "stroke-opacity": "0.15"
    });

    const font = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

    const t1 = this.svgEl("text", {
      x: String(pad),
      y: String(pad + 12),
      "font-family": font,
      "font-size": "14",
      fill: "#eaeaea"
    });
    t1.textContent = data.title ?? "";

    group.append(rect, t1);

    if (data.subtitle) {
      const t2 = this.svgEl("text", {
        x: String(pad),
        y: String(pad + 12 + 18),
        "font-family": font,
        "font-size": "12",
        fill: "#bdbdbd"
      });
      t2.textContent = data.subtitle;
      group.appendChild(t2);
    }

    g.appendChild(group);

    const bb = group.getBBox();
    const w = bb.width + pad * 1.5;
    const h = bb.height + pad;

    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("x", String(-w / 2));
    rect.setAttribute("y", String(-h - 18));

    // small tail
    const tail = this.svgEl("path", {
      d: "M 0 0 q -8 -12 0 -20",
      stroke: "#ffffff22",
      "stroke-width": "2",
      fill: "none"
    });
    group.appendChild(tail);
  }

  private animateAlong(dot: SVGCircleElement, path: SVGPathElement, duration = 1400) {
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

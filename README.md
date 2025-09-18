# ArcMap — Multi-Route SVG Arc Renderer (Web Mercator)

Beautiful, dependency-free arcs between geo points with hover highlights, animated fly-dots, and rich HTML tooltips. Works with any **Web-Mercator** world background.

---

## Background: Web-Mercator

ArcMap projects lat/lon using **Web Mercator** (EPSG:3857).
Your background **must** be Web-Mercator and **stretched to the container** (no cropping) so coordinates line up.

**Example container (with `public/world_webmercator_graticule.svg`):**

```css
/* app.css */
.map {
  position: relative;
  width: min(1280px, 95vw);
  aspect-ratio: 16/9;
  border-radius: 12px;
  overflow: hidden;

  /* Critical: stretch to fit (no 'cover'/'contain' cropping) */
  background: url('/world_webmercator_graticule.svg') center / 100% 100% no-repeat #0b0b0b;
}
```

> You can use any Web-Mercator world SVG/PNG (graticule, coastlines, etc.) as long as it fills the container 1:1.

---

## API

### Options

| Option                  | Type                                                                     |          Default | Description                            |
| ----------------------- | ------------------------------------------------------------------------ | ---------------: | -------------------------------------- |
| `width`                 | `number`                                                                 |  container width | Canvas width (auto updates on resize)  |
| `height`                | `number`                                                                 | container height | Canvas height (auto updates on resize) |
| `routes`                | `Route[]`                                                                |             `[]` | Connections to draw                    |
| `colors.point`          | `string`                                                                 |        `#E8FF2A` | Dot color                              |
| `colors.arc`            | `string`                                                                 |        `#E8FF2A` | Fallback arc color                     |
| `colors.trail`          | `string`                                                                 |        `#FFFFFF` | (Reserved)                             |
| `arcWidth`              | `number`                                                                 |              `4` | Default arc stroke width               |
| `curvature`             | `number`                                                                 |           `0.25` | 0 = straight, 0.1–0.5 nice arcs        |
| `animate`               | `boolean`                                                                |           `true` | Draw-on animation                      |
| `flyDot`                | `boolean`                                                                |           `true` | Moving dot along each arc              |
| `tooltip.follow`        | `"cursor" \| "midpoint"`                                                 |       `"cursor"` | Tooltip positioning                    |
| `tooltip.offset`        | `{x:number,y:number}`                                                    |    `{x:12,y:12}` | Tooltip offset (px)                    |
| `tooltip.stickyOnClick` | `boolean`                                                                |           `true` | Click to pin/unpin tooltip             |
| `tooltip.className`     | `string`                                                                 |                — | CSS class applied to tooltip `<div>`   |
| `tooltip.render`        | `(route) => string \| HTMLElement \| {title?,subtitle?,lines?:string[]}` |                — | Custom content renderer                |

---

## Tooltip Styling & Customization

By default ArcMap injects a minimal, inline-styled tooltip.
For full control, pass a `className` and override with CSS.

```ts
tooltip: {
  className: "arcmap-tooltip",
  render: (r) => ({
    title: r.label?.title ?? "Route",
    subtitle: r.label?.subtitle,
    lines: [
      `Curvature: ${(r.curvature ?? 0.25).toFixed(2)}`,
      `Color: ${r.color ?? "#E8FF2A"}`
    ]
  })
}
```

```css
/* styles.css */
.arcmap-tooltip {
  background: #0d0f10;
  color: #e6edf3;
  border: 1px solid #1f2a34;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 12px 28px rgba(0,0,0,.45);
  font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  max-width: 300px;
  position: absolute; /* ArcMap positions it */
  pointer-events: none;
}

/* arrow */
.arcmap-tooltip::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: #0d0f10;
  filter: drop-shadow(0 -1px 0 #1f2a34);
}

/* title + subtitle + list */
.arcmap-tooltip .title { font-weight: 600; font-size: 13px; }
.arcmap-tooltip .subtitle { opacity: .7; margin-top: 2px; }
.arcmap-tooltip ul { margin: 8px 0 0; padding-left: 16px; opacity: .9; }
```

**Fully custom HTML renderer**

```ts
tooltip: {
  className: "arcmap-tooltip",
  render: (r) => {
    const el = document.createElement("div");
    el.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center">
        <span style="width:10px;height:10px;border-radius:50%;background:${r.color ?? '#E8FF2A'}"></span>
        <strong class="title">${r.label?.title ?? "Connection"}</strong>
      </div>
      ${r.label?.subtitle ? `<div class="subtitle">${r.label.subtitle}</div>` : ""}
      <ul>
        <li>From: ${r.from.label ?? `${r.from.lat.toFixed(2)}, ${r.from.lon.toFixed(2)}`}</li>
        <li>To: ${r.to.label ?? `${r.to.lat.toFixed(2)}, ${r.to.lon.toFixed(2)}`}</li>
      </ul>
    `;
    return el;
  }
}
```

**Positioning modes**

```ts
tooltip: {
  follow: "cursor",     // or "midpoint"
  stickyOnClick: true,  // click to pin/unpin
  offset: { x: 12, y: 12 }
}
```

---

## Hover Highlight

```ts
routes: [
  {
    from: { lat: 40.71, lon: -74.00 },
    to:   { lat: 50.11, lon:   8.68 },
    color: "#E8FF2A",
    arcWidth: 4,
    hoverColor: "#00E5FF",
    hoverWidth: 6,
  }
]
```

---

## Live Updates

```ts
// Replace routes
map.setRoutes(newRoutes);

// Update visuals / tooltip behavior
map.update({
  curvature: 0.3,
  tooltip: { follow: "midpoint", stickyOnClick: false }
});
```

---

## Example Recipes

### Many routes, shared endpoints deduped

```ts
const hubs = {
  nyc: { lat: 40.7128, lon: -74.006, label: "NYC" },
  lon: { lat: 51.5074, lon: -0.1278, label: "London" },
  fra: { lat: 50.1109, lon:  8.6821, label: "Frankfurt" },
};

map.setRoutes([
  { from: hubs.nyc, to: hubs.lon, color: "#fff", label: { title: "NYC ↔ LON" } },
  { from: hubs.nyc, to: hubs.fra, color: "#E8FF2A", label: { title: "NYC ↔ FRA" } },
]);
```

### Color by metric

```ts
function colorForLatency(ms: number) {
  if (ms < 90)  return "#70FFAF";
  if (ms < 150) return "#FFD166";
  return "#FF6B6B";
}

const metricRoutes = raw.map(r => ({
  ...r,
  color: colorForLatency(r.latencyMs),
  label: { title: r.name, subtitle: `${r.latencyMs} ms` }
}));

map.setRoutes(metricRoutes);
```

### “Pinned” info panels (sticky)

```ts
map.update({
  tooltip: { follow: "midpoint", stickyOnClick: true }
});
```

### No animation / no flying dots

```ts
map.update({ animate: false, flyDot: false });
```

---

## Accessibility

* Each route has a wide invisible **hit path** (`pointer-events: stroke`) for easier hover.
* Hit paths are **focusable** (`tabindex="0"`).
* <kbd>Enter</kbd> toggles pin; <kbd>Esc</kbd> hides when pinned.
* Use concise `label.title` values; ArcMap assigns them as the arc’s **`aria-label`**.

---

## Performance Tips

* Prefer **fewer SVG reflows**: batch updates via `setRoutes()` or a single `update()`.
* Heavy datasets: pre-cluster, or segment into pages/layers.
* Turn off animation for large route counts: `animate: false, flyDot: false`.
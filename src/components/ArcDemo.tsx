import { useEffect } from "react";
import ArcMap, { type Route } from "../lib/arcmap";

const routes: Route[] = [
  {
    from: { lat: 40.7128, lon: -74.006 }, // NYC
    to:   { lat: 50.1109, lon:   8.6821 }, // FRA
    label: { title: "NYC × FRA", subtitle: "86ms" },
    color: "#E8FF2A",
    curvature: 0.15,
    arcWidth: 4,
    hoverColor: "#c9d36eff",
    hoverWidth: 6
  },
  {
    from: { lat: 34.0522, lon: -118.2437 }, // LA
    to:   { lat: 35.6895, lon: 139.6917 },  // Tokyo
    label: { title: "LAX × HND", subtitle: "144ms" },
    color: "#E8FF2A",
    curvature: 0.2,
    arcWidth: 4,
    hoverColor: "#c9d36eff",
    hoverWidth: 6
  },
  {
    from: { lat: -33.8688, lon: 151.2093 }, // Sydney
    to:   { lat: -23.5505, lon: -46.6333 }, // São Paulo
    label: { title: "SYD × GRU", subtitle: "220ms" },
    color: "#E8FF2A",
    arcWidth: 4,
    hoverColor: "#c9d36eff",
    hoverWidth: 6
  }
];

export default function ArcMapDemo() {
  useEffect(() => {
    const map = new ArcMap("#overlay", {
      routes,
      curvature: 0.25,
      animate: true,
      flyDot: true,
      colors: { point: "#E8FF2A", arc: "#E8FF2A", trail: "#FFFFFF" }
    });

    return () => map.destroy();
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: 'min(1280px, 95vw)',
        aspectRatio: '16/9',
        // IMPORTANT: stretch, don't 'cover' (no cropping)
        background:
          "url('/image.png') center / 100% 100% no-repeat",
        borderRadius: 12,
        
      }}
    >
      <div id="overlay" style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}

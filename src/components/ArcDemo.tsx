import { useEffect, useRef } from "react";
import ArcMap from "../lib/arcmap";

export default function ArcMapDemo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const map = new ArcMap(ref.current, {
      from: { lat: 50, lon: -60, label: "NYC" },
      to:   { lat: 5, lon: 3,  label: "FRA" },
      label: { title: "NYC × FRA", subtitle: "86ms" },
      curvature: 0.25,
      animate: false,
      flyDot: true
    });

    return () => map.destroy();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        width: "min(1280px, 95vw)",
        aspectRatio: "16/9",
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
        // Use your dotted Mercator image here. Drop it in public/ as world-dots-mercator.png
        background:
          "center / cover no-repeat url('/world-dots-mercator.png'), #0b0b0b"
      }}
    />
  );
}

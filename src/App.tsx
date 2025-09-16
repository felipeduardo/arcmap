import "./app.css";
import ArcMapDemo from "./components/ArcDemo";

export default function App() {
  return (
    <main className="app">
      <h1>ArcMap demo</h1>
      <ArcMapDemo />
      <p className="hint">
        Try different coordinates in <code>ArcMapDemo.tsx</code>.
      </p>
    </main>
  );
}

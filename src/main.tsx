import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { WebGpuGate } from "./app/WebGpuGate";
import "./app/styles.css";
import "./app/gesture.css";
import "./app/mobile.css";

const App = lazy(() => import("./app/App").then((module) => ({ default: module.App })));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebGpuGate><Suspense fallback={<main className="loading-state">Loading authoring surface…</main>}><App /></Suspense></WebGpuGate>
  </React.StrictMode>,
);

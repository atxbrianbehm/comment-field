import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { WebGpuGate } from "./app/WebGpuGate";
import "./app/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebGpuGate><App /></WebGpuGate>
  </React.StrictMode>,
);

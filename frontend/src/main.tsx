import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.env.DEV) {
  void import("./lib/queueIdbHarness").then((mod) => {
    const w = window as unknown as {
      __queueIdbRace?: typeof mod.runQueueIdbRace;
      __queueIdbProd?: typeof mod.runProductionQueueIdb;
    };
    w.__queueIdbRace = mod.runQueueIdbRace;
    w.__queueIdbProd = mod.runProductionQueueIdb;
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

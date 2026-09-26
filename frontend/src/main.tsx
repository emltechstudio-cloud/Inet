import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FlinkShell } from "./components/flink/shell";
import { RoomPage } from "./room-page";
import "./styles.css";
import { registerServiceWorker } from "./pwa";

function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    registerServiceWorker();
    const sync = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const match = route.match(/^#room\/([^?]+)(?:\?(.*))?$/);
  if (match) {
    const params = new URLSearchParams(match[2] ?? "");
    return <RoomPage id={decodeURIComponent(match[1]!)} mode={params.get("mode") ?? "video"} title={params.get("title") ?? "Room"} />;
  }
  return <FlinkShell />;
}

createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

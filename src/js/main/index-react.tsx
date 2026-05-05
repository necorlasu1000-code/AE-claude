import ReactDOM from "react-dom/client";
import { initBolt } from "../lib/utils/bolt";
import "../index.scss";
import { App } from "./main";

initBolt();

// StrictMode intentionally NOT used — useTerminal manages a real sidecar
// process + lockfile + WebSocket. StrictMode's double-invoke of useEffect
// in dev mode races the second mount against the first cleanup → port /
// lockfile contention → ws close immediately. See mistakes.md
// "React StrictMode + useTerminal heavy side-effect 충돌". Production
// builds are unaffected.
ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <App />
);

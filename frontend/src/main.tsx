import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./public.css";
import PublicView from "./PublicView";

// "/" is the public, read-only landing page; "/admin" is the sign-in + management app (loaded only when needed).
const App = lazy(() => import("./App"));
const admin = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
createRoot(document.getElementById("root")!).render(admin ? <Suspense fallback={<p role="status" className="muted pad">Loading...</p>}><App /></Suspense> : <PublicView />);

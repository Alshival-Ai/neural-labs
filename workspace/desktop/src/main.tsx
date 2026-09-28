import { ProjectsApp } from "./ProjectsApp";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode>{new URLSearchParams(location.search).get("app") === "projects" ? <ProjectsApp /> : <App />}</StrictMode>);

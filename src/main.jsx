import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SciCodeCanvas from "../scicode_canvas.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SciCodeCanvas />
  </StrictMode>
);

import { createRoot } from "react-dom/client";
import { CompactApp } from "./CompactApp";
import "./styles.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<CompactApp />);

import { createRoot } from "react-dom/client";
import { RecordsView } from "./RecordsView";
import "./styles.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<RecordsView />);

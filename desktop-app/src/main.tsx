import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HapticsProvider } from "./components/HapticsProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<HapticsProvider>
			<App />
		</HapticsProvider>
	</React.StrictMode>,
);

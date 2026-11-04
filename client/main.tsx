import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/lexend";
import "./styles.css";
import "./planning.css";
import "./waves.css";
import "./scenarios.css";
import { SetviaSoundProvider } from "./sound";
import App from "./App";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SetviaSoundProvider>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </SetviaSoundProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
import "./refinement.css";
import "./demo-refinement.css";
import "./pass3.css";
import "./story.css";
import "./cover-motion.css";
import "./frontend.css";

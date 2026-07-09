/* @refresh reload */

import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { AppLayout } from "./App";
import { Fleet } from "./screens/Fleet";
import { Launch } from "./screens/Launch";
import { SessionDetail } from "./screens/SessionDetail";
import { TaskBoard } from "./screens/TaskBoard";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

render(
  () => (
    <Router root={AppLayout}>
      <Route path="/" component={Fleet} />
      <Route path="/launch" component={Launch} />
      {/* SPA session route lives under /s/* (not /sessions/*) so it never collides with the
          backend API namespace behind one origin — a hard refresh serves the app, not the API. */}
      <Route path="/s/:id" component={SessionDetail} />
      <Route path="/board" component={TaskBoard} />
    </Router>
  ),
  root,
);

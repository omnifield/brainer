/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
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
      <Route path="/sessions/:id" component={SessionDetail} />
      <Route path="/board" component={TaskBoard} />
    </Router>
  ),
  root,
);

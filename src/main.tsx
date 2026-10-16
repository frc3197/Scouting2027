import * as React from "react";
import * as ReactDOM from "react-dom/client";
import {
  createHashRouter,
  RouterProvider,
} from "react-router-dom";
import "./index.css";
import Root, { loader as rootLoader } from "./Root";
import Team, { teamPageLoader } from "./team/Team";
import { Table } from "./table/Table";
import Home from "./home/Home";
import Teams from "./all_team/Teams";
import UpdateFetched from "./update_fetched_data/update_fetched_data";
import Pick from "./pick/Pick";
import Compare from "./compare/Compare";

const router = createHashRouter([
  {
    path: "/",
    element: <Root></Root>,
    loader: rootLoader,
    HydrateFallback: () => <div role="status" className="p-6">Loading scouting data...</div>,
    children: [
      {
        path: "/",
        element: <Home />,
      },
      {
        path: "/tables",
        element: <Table />,
      },
      {
        path: "/teams",
        element: <Teams />,
      },
      {
        path: "/compare",
        element: <Compare />,
      },
      {
        path: "/update",
        element: <UpdateFetched />
      },
      {
        path: "/pick",
        element: <Pick />
      },
      {
        path: "team/:teamNumber",
        loader: teamPageLoader,
        element: <Team />,
      },
    ]
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

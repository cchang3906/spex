import { useEffect, useState } from "react";

export type Route = "architecture" | "comparison" | "eval" | "run";

const routes: Route[] = ["architecture", "comparison", "eval", "run"];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "").split(/[#?]/)[0];
  return (routes as string[]).includes(raw) ? (raw as Route) : "architecture";
}

export function useHashRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: Route) => {
    window.location.hash = next;
  };

  return [route, navigate];
}

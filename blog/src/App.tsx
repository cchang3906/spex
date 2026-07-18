import { useHashRoute } from "./lib/useHashRoute";
import { Nav } from "./components/Nav";
import { ArchitectureView } from "./views/ArchitectureView";
import { ComparisonView } from "./views/ComparisonView";
import { EvalView } from "./views/EvalView";
import { RunView } from "./views/RunView";

export function App() {
  const [route, navigate] = useHashRoute();

  return (
    <>
      <Nav route={route} onNavigate={navigate} />
      <main>
        {route === "architecture" && <ArchitectureView />}
        {route === "comparison" && <ComparisonView />}
        {route === "eval" && <EvalView />}
        {route === "run" && <RunView />}
      </main>
    </>
  );
}

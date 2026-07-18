import { EvalSpec6 } from "./eval-specs/Spec6";
import { Sidebar } from "./about/Sidebar";
import { useScrollSpy } from "./about/useScrollSpy";

const evalSections = [
  { id: "setup", label: "setup" },
  { id: "combo-1", label: "e2e latency" },
  { id: "combo-2", label: "verification wait" },
  { id: "combo-3", label: "breakdown and overlap" },
  { id: "combo-4", label: "prediction quality" },
  { id: "combo-5", label: "overhead and safety" },
  { id: "combo-6", label: "token cost" },
];
const evalSectionIds = evalSections.map((section) => section.id);

export function EvalView() {
  const activeId = useScrollSpy(evalSectionIds);
  return (
    <div>
      <Sidebar activeId={activeId} items={evalSections} label="eval" />
      <EvalSpec6 />
    </div>
  );
}

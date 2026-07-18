export type SectionMeta = {
  id: string;
  label: string;
};

export const sections: SectionMeta[] = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "predictor", label: "The predictor" },
  { id: "speculation", label: "Speculation rules" },
  { id: "safety", label: "Safety" },
];

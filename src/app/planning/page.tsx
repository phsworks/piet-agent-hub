import { SchoolPlanning } from "@/components/school/school-planning";

/** The whole HvA semester planning, week by week. */
export default function PlanningPage() {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6">
      <SchoolPlanning />
    </div>
  );
}

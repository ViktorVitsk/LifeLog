import { NavLink, Outlet } from "react-router-dom";
import { useLocale } from "../context/LocaleContext";

export default function InsightsPage() {
  const { t } = useLocale();
  const tabs = [
    { to: "/insights", end: true, label: t.insightDashboard },
    { to: "/insights/psychology", label: t.insightPsychology },
    { to: "/insights/skills", label: t.insightSkills },
    { to: "/insights/habits", label: t.insightHabits },
    { to: "/insights/analytics", label: t.insightAnalytics },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                "shrink-0 min-h-[44px] px-3 inline-flex items-center rounded-full text-sm border",
                isActive
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "border-zinc-700 text-zinc-300",
              ].join(" ")
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

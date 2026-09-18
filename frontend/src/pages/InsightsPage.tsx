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
      <nav
        aria-label={t.tabInsights}
        className="-mx-4 -mt-4 px-4 pt-3 pb-3 border-b border-zinc-800/80 bg-zinc-950/90 sticky top-0 z-10 md:-mx-6 md:-mt-6 md:px-6 md:pt-4"
      >
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "min-h-[40px] px-3 inline-flex items-center justify-center rounded-full text-xs sm:text-sm border",
                  "flex-1 min-w-[31%] sm:flex-none sm:min-w-0",
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
      </nav>
      <Outlet />
    </div>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { LocaleProvider } from "./context/LocaleContext";
import { isNetworkError } from "./lib/api";
import AnalyticsPage from "./pages/AnalyticsPage";
import CheckinPage from "./pages/CheckinPage";
import DashboardPage from "./pages/DashboardPage";
import HabitsPage from "./pages/HabitsPage";
import InsightsPage from "./pages/InsightsPage";
import JournalPage from "./pages/JournalPage";
import LoginPage from "./pages/LoginPage";
import PsychologyPage from "./pages/PsychologyPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";
import TodayPage from "./pages/TodayPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !isNetworkError(error) && failureCount < 1,
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<TodayPage />} />
              <Route path="/today" element={<TodayPage />} />
              <Route path="/timeline" element={<JournalPage />} />
              <Route path="/insights" element={<InsightsPage />}>
                <Route index element={<DashboardPage />} />
                <Route path="psychology" element={<PsychologyPage />} />
                <Route path="skills" element={<SkillsPage />} />
                <Route path="habits" element={<HabitsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
              </Route>
              <Route path="/checkin" element={<CheckinPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/dashboard" element={<Navigate to="/insights" replace />} />
              <Route path="/psychology" element={<Navigate to="/insights/psychology" replace />} />
              <Route path="/skills" element={<Navigate to="/insights/skills" replace />} />
              <Route path="/habits" element={<Navigate to="/insights/habits" replace />} />
              <Route path="/analytics" element={<Navigate to="/insights/analytics" replace />} />
              <Route path="/journal" element={<Navigate to="/timeline" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}

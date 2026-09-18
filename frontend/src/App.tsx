import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { isNetworkError } from "./lib/api";
import CheckinPage from "./pages/CheckinPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import HabitsPage from "./pages/HabitsPage";
import JournalPage from "./pages/JournalPage";
import PsychologyPage from "./pages/PsychologyPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the network when offline; don't retry on the kind of
      // errors that won't get better within the next few ms.
      retry: (failureCount, error) => !isNetworkError(error) && failureCount < 1,
      // `offlineFirst` = fire once, then serve cache while offline instead
      // of pausing / throwing loudly. Dexie still provides pending rows,
      // so the dashboard stays useful even with no server reachable.
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
              <Route index element={<Navigate to="/checkin" replace />} />
              <Route path="/checkin" element={<CheckinPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/psychology" element={<PsychologyPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/habits" element={<HabitsPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/checkin" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

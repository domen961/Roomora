import { Routes, Route, Navigate } from "react-router-dom";
import AdminPage from "@/components/admin/AdminPage";
import LoginPage from "@/pages/LoginPage";
import TryPage from "@/pages/TryPage";
import LandingPage from "@/pages/LandingPage";
import CapturePage from "@/pages/CapturePage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/"                       element={<LandingPage />} />
        <Route path="/privacy"                element={<PrivacyPage />} />
        <Route path="/terms"                  element={<TermsPage />} />
        <Route path="/login"                  element={<LoginPage />} />
        <Route path="/admin/*"                element={<AdminPage />} />
        <Route path="/try/:shopId/:productId" element={<TryPage />} />
        <Route path="/capture/:token"                              element={<CapturePage />} />
        <Route path="/capture/:token/:merchantId/:productId"    element={<CapturePage />} />
        <Route path="*"                       element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

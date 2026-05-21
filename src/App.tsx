import { Routes, Route } from "react-router-dom";
import AdminPage from "@/components/admin/AdminPage";
import LoginPage from "@/pages/LoginPage";
import TryPage from "@/pages/TryPage";
import LandingPage from "@/pages/LandingPage";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/"                       element={<LandingPage />} />
        <Route path="/login"                  element={<LoginPage />} />
        <Route path="/admin/*"                element={<AdminPage />} />
        <Route path="/try/:shopId/:productId" element={<TryPage />} />
      </Routes>
    </div>
  );
}

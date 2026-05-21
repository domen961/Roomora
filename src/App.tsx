import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import ProductStep from "@/components/steps/ProductStep";
import RoomStep from "@/components/steps/RoomStep";
import ResultStep from "@/components/steps/ResultStep";
import AdminPage from "@/components/admin/AdminPage";
import LoginPage from "@/pages/LoginPage";
import TryPage from "@/pages/TryPage";

type Step = "product" | "room" | "result";

interface SelectedProduct {
  images: string[];
  description: string;
  name: string;
}

function MainFlow() {
  const [step,    setStep]    = useState<Step>("product");
  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [result,  setResult]  = useState<string | null>(null);

  const handleProductSelected = (images: string[], description: string, name: string) => {
    setProduct({ images, description, name });
    setStep("room");
  };

  const handleResult = (resultUrl: string) => {
    setResult(resultUrl);
    setStep("result");
  };

  const handleReset = () => {
    setProduct(null);
    setResult(null);
    setStep("product");
  };

  return (
    <>
      {step === "product" && <ProductStep onNext={handleProductSelected} />}
      {step === "room"    && product && <RoomStep product={product} onResult={handleResult} onBack={() => setStep("product")} />}
      {step === "result"  && result && product && <ResultStep result={result} productName={product.name} onReset={handleReset} />}
    </>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/login"               element={<LoginPage />} />
        <Route path="/admin/*"             element={<AdminPage />} />
        <Route path="/try/:shopId/:productId" element={<TryPage />} />
        <Route path="/*"                   element={<MainFlow />} />
      </Routes>
    </div>
  );
}

import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { ThemeToggle } from "./theme-toggle";
import CreditBalance from "./CreditBalance";
import { useAuth } from "@/contexts/AuthContext";

const DashboardLayout = () => {
  const { hasActiveSubscription } = useAuth();
  
  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <Sidebar />
      <div className="flex flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
          <div className="flex-1">
            {hasActiveSubscription && (
              <CreditBalance compact />
            )}
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
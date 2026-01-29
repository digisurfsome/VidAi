import { Outlet } from "react-router-dom";
import { useAppSettings } from "@/contexts/AppSettingsContext";

const AuthLayout = () => {
  const { settings } = useAppSettings();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        {settings?.app_logo_url && (
          <div className="flex justify-center mb-8">
            <img 
              src={settings.app_logo_url} 
              alt={settings.app_name || "Logo"} 
              className="h-12 w-auto"
            />
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
};

export default AuthLayout;
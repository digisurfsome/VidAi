import { Link } from "react-router-dom";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { useAuth } from "@/contexts/AuthContext";

const Header = () => {
  const { settings } = useAppSettings();
  const { user } = useAuth();

  return (
    <header className="py-4 px-6 border-b">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold flex items-center gap-2">
          {settings.app_logo_url ? (
            <img 
              src={settings.app_logo_url} 
              alt={settings.app_name}
              className="h-8 w-auto"
              onError={(e) => {
                // Fallback to text if image fails to load
                const target = e.target as HTMLElement;
                target.style.display = 'none';
                const textSpan = target.nextElementSibling as HTMLElement;
                if (textSpan) textSpan.style.display = 'inline';
              }}
            />
          ) : null}
          <span className={settings.app_logo_url ? "hidden" : ""}>{settings.app_name}</span>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <nav>
            {user ? (
              <Button asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            ) : (
              <div className="flex items-center gap-4">
                <Button variant="ghost" asChild>
                  <Link to="/sign-in">Sign In</Link>
                </Button>
                <Button asChild>
                  <Link to="/sign-up">Sign Up</Link>
                </Button>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
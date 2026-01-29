import { NavLink, useNavigate } from "react-router-dom";
import { Home, Bot, Settings, HelpCircle, User, LogOut, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminPermissions } from "@/hooks/useAdminPermissions";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const Sidebar = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { isAdmin } = useAdminPermissions();
  const { settings } = useAppSettings();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
      isActive && "bg-muted text-primary"
    );

  const handleSignOut = async () => {
    console.log('Sign out clicked!');
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      // Always navigate to home after sign out attempt
      navigate('/');
    }
  };

  const handleHelp = () => {
    window.open("https://www.google.com", "_blank");
  };

  const handleProfile = () => {
    navigate("/dashboard/profile");
  };

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <NavLink to="/dashboard" className="flex items-center gap-2 font-semibold">
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
          </NavLink>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <NavLink to="/dashboard" end className={navLinkClass}>
              <Home className="h-4 w-4" />
              Dashboard
            </NavLink>
            <NavLink to="/dashboard/generate" className={navLinkClass}>
              <Bot className="h-4 w-4" />
              Generate
            </NavLink>
          </nav>
        </div>
        <div className="mt-auto">
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              <Button
                variant="ghost"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary justify-start"
                onClick={handleHelp}
              >
                <HelpCircle className="h-4 w-4" />
                Help
              </Button>
              
              <div className="mx-3 my-2 border-t border-border"></div>
              
              {isAdmin && (
                <NavLink to="/dashboard/admin" className={navLinkClass}>
                  <Shield className="h-4 w-4" />
                  Admin
                </NavLink>
              )}
              <NavLink to="/dashboard/settings" className={navLinkClass}>
                <Settings className="h-4 w-4" />
                Settings
              </NavLink>
            </nav>
          </div>
          
          <div className="mx-6 my-2 border-t border-border"></div>
          <div className="p-4">
            <div className="px-2 lg:px-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2 rounded-lg">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.user_metadata?.avatar_url} alt={user?.email || ""} />
                      <AvatarFallback>
                        {user?.email?.charAt(0)?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start text-left">
                      <p className="text-sm font-medium">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</p>
                      <p className="text-xs text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={handleProfile}>
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <button
                      className="flex w-full cursor-pointer items-center px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={handleSignOut}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
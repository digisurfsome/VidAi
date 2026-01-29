import Header from "./Header";
import { Outlet } from "react-router-dom";

const PublicLayout = () => {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default PublicLayout;
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow flex items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-5xl font-bold tracking-tighter sm:text-6xl md:text-7xl">
            VideoCloud
          </h1>
          <p className="max-w-[600px] mx-auto text-muted-foreground md:text-xl">
            Modern AI-powered video creation.
          </p>
          <div className="flex justify-center gap-4">
            <Button asChild size="lg">
              <Link to="/pricing">Sign Up</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
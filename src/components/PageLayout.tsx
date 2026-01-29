import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface PageLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

const PageLayout = ({ title, description, children }: PageLayoutProps) => {
  const location = useLocation();
  
  // Generate breadcrumbs from the current path
  const generateBreadcrumbs = () => {
    const pathSegments = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [];

    // Add Dashboard as first breadcrumb for all dashboard pages
    if (pathSegments[0] === 'dashboard') {
      breadcrumbs.push({
        label: 'Dashboard',
        href: '/dashboard',
        isLast: pathSegments.length === 1
      });

      // Add subsequent segments
      for (let i = 1; i < pathSegments.length; i++) {
        const segment = pathSegments[i];
        const href = '/' + pathSegments.slice(0, i + 1).join('/');
        const isLast = i === pathSegments.length - 1;
        
        // Convert segment to readable label
        const label = segment.charAt(0).toUpperCase() + segment.slice(1);
        
        breadcrumbs.push({
          label,
          href,
          isLast
        });
      }
    }

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((breadcrumb, index) => (
              <div key={breadcrumb.href} className="flex items-center">
                <BreadcrumbItem>
                  {breadcrumb.isLast ? (
                    <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={breadcrumb.href}>{breadcrumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!breadcrumb.isLast && <BreadcrumbSeparator />}
              </div>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>

      {/* Page Content */}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
};

export default PageLayout;
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, Loader2, Settings } from "lucide-react";
import { getAppSettings, updateAppSettings } from "@/lib/app-settings";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { toast } from "sonner";

const appSettingsSchema = z.object({
  app_name: z.string().min(1, "App name is required"),
  app_logo_url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  app_favicon_url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  app_description: z.string().min(1, "App description is required"),
});

type AppSettingsForm = z.infer<typeof appSettingsSchema>;

const AdminSettings = () => {
  const { user } = useAuth();
  const { refreshSettings } = useAppSettings();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const form = useForm<AppSettingsForm>({
    resolver: zodResolver(appSettingsSchema),
    defaultValues: {
      app_name: "",
      app_logo_url: "",
      app_favicon_url: "",
      app_description: "",
    },
  });

  // Load existing data on component mount
  useEffect(() => {
    const loadData = async () => {
      if (!user?.id) return;
      
      try {
        const appSettings = await getAppSettings(user.id);
        form.reset({
          app_name: appSettings.app_name?.value || '',
          app_logo_url: appSettings.app_logo_url?.value || '',
          app_favicon_url: appSettings.app_favicon_url?.value || '',
          app_description: appSettings.app_description?.value || '',
        });
      } catch (error) {
        console.error('Error loading app settings:', error);
        toast.error('Failed to load app settings');
      } finally {
        setIsLoadingData(false);
      }
    };

    loadData();
  }, [user?.id, form]);

  const onSubmit = async (data: AppSettingsForm) => {
    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      await updateAppSettings(user.id, {
        app_name: data.app_name,
        app_logo_url: data.app_logo_url || '',
        app_favicon_url: data.app_favicon_url || '', 
        app_description: data.app_description,
      });
      
      // Refresh the app settings context to update the UI
      await refreshSettings();
      
      toast.success('App settings saved successfully!');
    } catch (error: any) {
      console.error('Error saving app settings:', error);
      toast.error('Failed to save app settings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Application Settings
            </CardTitle>
            <CardDescription>
              Configure your application's branding, name, and general settings. These changes will be applied globally across the application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">Loading settings...</span>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="app_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Application Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="My Awesome App"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          The name displayed in the header and browser title
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="app_description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Application Description</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="A modern web application built with React"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Brief description used for meta tags and SEO
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="app_logo_url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Logo URL (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://example.com/logo.png"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          URL to your application logo. If provided, it will replace the text in the header and sidebar.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="app_favicon_url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Favicon URL (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://example.com/favicon.ico"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          URL to your favicon (.ico, .png, or .svg file). This will be used as the browser tab icon.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    {isLoading ? "Saving..." : "Save Application Settings"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
    </div>
  );
};

export default AdminSettings;
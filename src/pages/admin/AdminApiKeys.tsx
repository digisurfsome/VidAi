import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
import { Eye, EyeOff, Key, Save, Loader2, AlertCircle, Shield } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const adminApiKeySchema = z.object({
  admin_openai_api_key: z.string().optional().refine(
    (val) => !val || val.startsWith('sk-'),
    "Must start with 'sk-' or be empty"
  ),
  admin_fal_api_key: z.string().optional().refine(
    (val) => !val || val.includes(":") || val.startsWith("key_"),
    "Must be in format 'key_id:key_secret' or start with 'key_' or be empty"
  ),
});

type AdminApiKeyForm = z.infer<typeof adminApiKeySchema>;

const AdminApiKeys = () => {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [hasExistingKeys, setHasExistingKeys] = useState<Record<string, boolean>>({});

  const form = useForm<AdminApiKeyForm>({
    resolver: zodResolver(adminApiKeySchema),
    defaultValues: {
      admin_openai_api_key: "",
      admin_fal_api_key: "",
    },
  });

  useEffect(() => {
    loadAdminApiKeys();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAdminApiKeys = async () => {
    setIsLoadingData(true);
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['admin_openai_api_key', 'admin_fal_api_key']);

      if (error) throw error;

      const existingKeys: Record<string, boolean> = {};
      const formValues: Partial<AdminApiKeyForm> = {};

      data?.forEach(row => {
        if (row.setting_key === 'admin_openai_api_key') {
          existingKeys.admin_openai_api_key = !!row.setting_value;
          formValues.admin_openai_api_key = row.setting_value || "";
        } else if (row.setting_key === 'admin_fal_api_key') {
          existingKeys.admin_fal_api_key = !!row.setting_value;
          formValues.admin_fal_api_key = row.setting_value || "";
        }
      });

      setHasExistingKeys(existingKeys);
      form.reset(formValues);
    } catch (error) {
      console.error('Error loading admin API keys:', error);
      toast.error('Failed to load admin API keys');
    } finally {
      setIsLoadingData(false);
    }
  };

  const onSubmit = async (data: AdminApiKeyForm) => {
    setIsLoading(true);
    try {
      // Prepare settings to update
      const updates = [];

      // OpenAI key
      updates.push({
        setting_key: 'admin_openai_api_key',
        setting_value: data.admin_openai_api_key || null,
        setting_type: 'string',
        description: 'Default OpenAI API key for users without their own key configured',
        is_public: false,
        updated_at: new Date().toISOString()
      });

      // fal.ai key
      updates.push({
        setting_key: 'admin_fal_api_key',
        setting_value: data.admin_fal_api_key || null,
        setting_type: 'string',
        description: 'Default fal.ai API key for users without their own key configured',
        is_public: false,
        updated_at: new Date().toISOString()
      });

      // Use upsert to insert or update
      const { error } = await supabase
        .from('app_settings')
        .upsert(updates, {
          onConflict: 'setting_key'
        });

      if (error) throw error;

      // Update existing keys state
      setHasExistingKeys({
        admin_openai_api_key: !!data.admin_openai_api_key,
        admin_fal_api_key: !!data.admin_fal_api_key
      });

      toast.success('Admin API keys saved successfully');
    } catch (error) {
      console.error('Error saving admin API keys:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save admin API keys';
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleKeyVisibility = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Admin API Keys</h3>
        <p className="text-sm text-muted-foreground">
          Configure default API keys for all users. These keys will be used when users haven't configured their own.
        </p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>Security Notice:</strong> Admin API keys are used as fallback when users don't have their own keys configured.
          Users' personal API keys always take priority over admin keys.
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Key Configuration
              </CardTitle>
              <CardDescription>
                Set organization-wide default API keys for your users
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* OpenAI API Key */}
              <FormField
                control={form.control}
                name="admin_openai_api_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      OpenAI API Key
                      {hasExistingKeys.admin_openai_api_key && (
                        <Badge variant="secondary" className="text-xs">Configured</Badge>
                      )}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showKeys.admin_openai_api_key ? "text" : "password"}
                          placeholder="sk-..."
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => toggleKeyVisibility('admin_openai_api_key')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                        >
                          {showKeys.admin_openai_api_key ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Default OpenAI API key for text generation features. Leave empty to disable.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* fal.ai API Key */}
              <FormField
                control={form.control}
                name="admin_fal_api_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      fal.ai API Key
                      {hasExistingKeys.admin_fal_api_key && (
                        <Badge variant="secondary" className="text-xs">Configured</Badge>
                      )}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showKeys.admin_fal_api_key ? "text" : "password"}
                          placeholder="key_id:key_secret"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => toggleKeyVisibility('admin_fal_api_key')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                        >
                          {showKeys.admin_fal_api_key ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Default fal.ai API key for video generation. Leave empty to disable.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Admin Keys
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>

      {/* Info about key priority */}
      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            How API Key Priority Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>1. <strong>User's own keys</strong> - Always used first if configured</p>
          <p>2. <strong>Admin default keys</strong> - Used as fallback when user hasn't configured their own</p>
          <p>3. <strong>No keys available</strong> - Features requiring API keys will be disabled</p>
          <p className="text-muted-foreground mt-3">
            This allows new users to immediately use API features without configuration, 
            while still giving users full control over their own API keys.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminApiKeys;
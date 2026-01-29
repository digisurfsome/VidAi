import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import PageLayout from "@/components/PageLayout";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, Key, Save, Loader2, Mail, AlertCircle, Settings, Send, CheckCircle, CreditCard, Shield, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { testEmailSettings, checkEmailSettingsStatus } from "@/lib/email";
import { validateFalApiKey } from "@/lib/fal-api";
import { toast } from "sonner";
import SubscriptionSettings from "@/components/SubscriptionSettings";

const apiKeySchema = z.object({
  openai: z.string().min(1, "OpenAI API key is required").regex(/^sk-/, "Must start with 'sk-'"),
  fal_ai: z.string().min(1, "fal.ai API key is required").refine(
    (val) => val.includes(":") || val.startsWith("key_"),
    "Must be in format 'key_id:key_secret' or start with 'key_'"
  ),
});

const emailSettingsSchema = z.object({
  sender_name: z.string().min(1, "Sender name is required"),
  sender_email: z.string().email("Must be a valid email address"),
  resend_api_key: z.string().min(1, "Resend API key is required").regex(/^re_/, "Must start with 're_'"),
  sender_domain: z.string().optional(),
});


type ApiKeyForm = z.infer<typeof apiKeySchema>;
type EmailSettingsForm = z.infer<typeof emailSettingsSchema>;

const SettingsPage = () => {
  const { user } = useAuth();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [adminKeys, setAdminKeys] = useState<{
    openai: string | null;
    fal: string | null;
  }>({ openai: null, fal: null });
  const [keySource, setKeySource] = useState<{
    openai: 'user' | 'admin' | 'none';
    fal: 'user' | 'admin' | 'none';
  }>({ openai: 'none', fal: 'none' });
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; domainVerified: boolean; error?: string } | null>(null);
  const [isTestingFalKey, setIsTestingFalKey] = useState(false);
  const [falKeyValid, setFalKeyValid] = useState<boolean | null>(null);
  
  const apiForm = useForm<ApiKeyForm>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      openai: "",
      fal_ai: "",
    },
  });

  const emailForm = useForm<EmailSettingsForm>({
    resolver: zodResolver(emailSettingsSchema),
    defaultValues: {
      sender_name: "",
      sender_email: "",
      resend_api_key: "",
      sender_domain: "",
    },
  });


  // Check email settings status
  const checkEmailStatus = async () => {
    if (!user?.id) return;
    
    try {
      const status = await checkEmailSettingsStatus(user.id);
      setEmailStatus(status);
    } catch (error) {
      console.error('Error checking email status:', error);
    }
  };

  // Helper function to mask API keys
  const maskApiKey = (key: string | null): string => {
    if (!key || key.length < 10) {
      return '••••••••';
    }
    const lastChars = key.slice(-6);
    return `••••••••••••${lastChars}`;
  };

  // Load existing data on component mount
  useEffect(() => {
    const loadData = async () => {
      if (!user?.id) return;
      
      try {
        // Fetch user's keys
        const { data: userData, error: userError } = await supabase
          .from('user_api_keys')
          .select('key_name, key_value')
          .eq('user_id', user.id);

        // Fetch admin keys
        const { data: adminData, error: adminError } = await supabase
          .from('app_settings')
          .select('setting_key, setting_value')
          .in('setting_key', ['admin_openai_api_key', 'admin_fal_api_key']);

        if (userError) {
          console.error('Error loading user data:', userError);
          toast.error('Failed to load existing data');
          return;
        }

        // Process admin keys
        const adminKeysData = { openai: null as string | null, fal: null as string | null };
        adminData?.forEach(row => {
          if (row.setting_key === 'admin_openai_api_key' && row.setting_value) {
            adminKeysData.openai = row.setting_value;
          } else if (row.setting_key === 'admin_fal_api_key' && row.setting_value) {
            adminKeysData.fal = row.setting_value;
          }
        });
        setAdminKeys(adminKeysData);

        if (userData) {
          const existingApiKeys: Partial<ApiKeyForm> = {};
          const existingEmailSettings: Partial<EmailSettingsForm> = {};
          const keySourceData = { openai: 'none' as 'user' | 'admin' | 'none', fal: 'none' as 'user' | 'admin' | 'none' };
          
          userData.forEach(row => {
            // API Keys
            if (row.key_name === 'openai') {
              existingApiKeys.openai = row.key_value;
              keySourceData.openai = 'user';
            } else if (row.key_name === 'fal_ai') {
              existingApiKeys.fal_ai = row.key_value;
              keySourceData.fal = 'user';
            }
            // Email Settings
            else if (row.key_name === 'sender_name') {
              existingEmailSettings.sender_name = row.key_value;
            } else if (row.key_name === 'sender_email') {
              existingEmailSettings.sender_email = row.key_value;
            } else if (row.key_name === 'resend_api_key') {
              existingEmailSettings.resend_api_key = row.key_value;
            } else if (row.key_name === 'sender_domain') {
              existingEmailSettings.sender_domain = row.key_value;
            }
          });
          
          // Determine final key source (fallback to admin if no user key)
          if (keySourceData.openai !== 'user' && adminKeysData.openai) {
            keySourceData.openai = 'admin';
          }
          if (keySourceData.fal !== 'user' && adminKeysData.fal) {
            keySourceData.fal = 'admin';
          }
          setKeySource(keySourceData);

          // Update forms with existing values
          apiForm.reset({
            openai: existingApiKeys.openai || '',
            fal_ai: existingApiKeys.fal_ai || '',
          });

          emailForm.reset({
            sender_name: existingEmailSettings.sender_name || '',
            sender_email: existingEmailSettings.sender_email || '',
            resend_api_key: existingEmailSettings.resend_api_key || '',
            sender_domain: existingEmailSettings.sender_domain || '',
          });
        }

      } catch (error) {
        console.error('Error loading data:', error);
        toast.error('Failed to load existing data');
      } finally {
        setIsLoadingData(false);
      }
    };

    loadData();
    checkEmailStatus();
  }, [user?.id]);

  const toggleKeyVisibility = (keyName: string) => {
    setShowKeys(prev => ({
      ...prev,
      [keyName]: !prev[keyName]
    }));
  };

  const onSubmitApiKeys = async (data: ApiKeyForm) => {
    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      // Save each API key to the database
      const promises = Object.entries(data).map(async ([keyName, keyValue]) => {
        const { error } = await supabase
          .from('user_api_keys')
          .upsert(
            {
              user_id: user.id,
              key_name: keyName,
              key_value: keyValue,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: 'user_id,key_name',
              ignoreDuplicates: false,
            }
          );

        if (error) {
          throw error;
        }
      });

      await Promise.all(promises);
      
      // Update key source after saving
      const newKeySource = { ...keySource };
      if (data.openai) {
        newKeySource.openai = 'user';
      } else if (adminKeys.openai) {
        newKeySource.openai = 'admin';
      } else {
        newKeySource.openai = 'none';
      }
      if (data.fal_ai) {
        newKeySource.fal = 'user';
      } else if (adminKeys.fal) {
        newKeySource.fal = 'admin';
      } else {
        newKeySource.fal = 'none';
      }
      setKeySource(newKeySource);
      
      toast.success('API keys saved successfully!');
      console.log('API keys saved to database:', data);
    } catch (error: any) {
      console.error('Error saving API keys:', error);
      toast.error('Failed to save API keys. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitEmailSettings = async (data: EmailSettingsForm) => {
    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    setIsLoadingEmail(true);
    try {
      // Save each email setting to the database
      const promises = Object.entries(data).map(async ([keyName, keyValue]) => {
        if (!keyValue || !keyValue.trim()) return; // Skip empty values
        
        const { error } = await supabase
          .from('user_api_keys')
          .upsert(
            {
              user_id: user.id,
              key_name: keyName,
              key_value: keyValue,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: 'user_id,key_name',
              ignoreDuplicates: false,
            }
          );

        if (error) {
          throw error;
        }
      });

      await Promise.all(promises);
      
      toast.success('Email settings saved successfully!');
      console.log('Email settings saved to database:', data);
      
      // Check status after saving
      checkEmailStatus();
    } catch (error: any) {
      console.error('Error saving email settings:', error);
      toast.error('Failed to save email settings. Please try again.');
    } finally {
      setIsLoadingEmail(false);
    }
  };

  const handleTestFalKey = async () => {
    const falKey = apiForm.getValues('fal_ai');
    if (!falKey) {
      toast.error('Please enter a fal.ai API key first');
      return;
    }

    setIsTestingFalKey(true);
    setFalKeyValid(null);
    
    try {
      const result = await validateFalApiKey(falKey, true);
      
      if (result.valid) {
        setFalKeyValid(true);
        toast.success(result.message || 'fal.ai API key is valid!');
        
        // If there's a warning (e.g., rate limit), show it
        if (result.warning) {
          toast.info(`Note: ${result.warning}`);
        }
      } else {
        setFalKeyValid(false);
        toast.error(result.message || 'Invalid fal.ai API key');
      }
    } catch (error: any) {
      setFalKeyValid(false);
      console.error('Error testing fal.ai key:', error);
      toast.error(error.message || 'Failed to validate API key');
    } finally {
      setIsTestingFalKey(false);
    }
  };

  const handleTestEmail = async () => {
    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    if (!testEmail || !testEmail.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsTestingEmail(true);
    try {
      const result = await testEmailSettings(user.id, testEmail);
      
      if (result.success) {
        toast.success(`Test email sent successfully to ${testEmail}! Check your inbox.`);
        setTestEmail(''); // Clear the field after successful test
        checkEmailStatus(); // Refresh status
      } else {
        toast.error(result.error || 'Failed to send test email');
      }
    } catch (error: any) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email. Please try again.');
    } finally {
      setIsTestingEmail(false);
    }
  };


  return (
    <PageLayout 
      title="Settings" 
      description="Manage your API keys and email settings."
    >
      <div className="max-w-6xl">
        <Tabs defaultValue="api-keys" orientation="vertical" className="flex gap-8">
          {/* Secondary Navigation Column */}
          <div className="w-64 shrink-0">
            <TabsList className="flex-col h-auto w-full justify-start bg-transparent p-0 space-y-1">
              <TabsTrigger 
                value="api-keys" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Key className="h-4 w-4 mr-2" />
                API Keys
              </TabsTrigger>
              <TabsTrigger 
                value="email" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <Mail className="h-4 w-4 mr-2" />
                Email Settings
              </TabsTrigger>
              <TabsTrigger 
                value="subscription" 
                className="w-full justify-start data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md px-4 py-3"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Subscription
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 space-y-6">

          {/* API Keys Tab */}
          <TabsContent value="api-keys">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Keys
                </CardTitle>
                <CardDescription>
                  Store your API keys securely to use with various AI services. These keys are encrypted and stored securely.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingData ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="ml-2">Loading your settings...</span>
                  </div>
                ) : (
                <Form {...apiForm}>
                  <form onSubmit={apiForm.handleSubmit(onSubmitApiKeys)} className="space-y-6">
                    {/* Admin Keys Info Alert */}
                    {(keySource.openai === 'admin' || keySource.fal === 'admin') && (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Admin-provided keys in use:</strong> Your organization has configured default API keys.
                          {keySource.openai === 'admin' && (
                            <div className="mt-2 text-sm">
                              • OpenAI: {maskApiKey(adminKeys.openai)}
                            </div>
                          )}
                          {keySource.fal === 'admin' && (
                            <div className="mt-1 text-sm">
                              • fal.ai: {maskApiKey(adminKeys.fal)}
                            </div>
                          )}
                          <div className="mt-2 text-sm text-muted-foreground">
                            Configure your own keys below to use them instead.
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                    <FormField
                      control={apiForm.control}
                      name="openai"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            OpenAI API Key
                            {keySource.openai === 'user' && (
                              <Badge variant="default" className="text-xs">Your Key</Badge>
                            )}
                            {keySource.openai === 'admin' && (
                              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Admin Provided
                              </Badge>
                            )}
                            {keySource.openai === 'none' && adminKeys.openai && (
                              <Badge variant="outline" className="text-xs">Admin Available</Badge>
                            )}
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showKeys.openai ? "text" : "password"}
                                placeholder="sk-..."
                                {...field}
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => toggleKeyVisibility("openai")}
                              >
                                {showKeys.openai ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Your OpenAI API key for GPT models. Get it from{" "}
                            <a 
                              href="https://platform.openai.com/api-keys" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              OpenAI Platform
                            </a>
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={apiForm.control}
                      name="fal_ai"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            fal.ai API Key
                            {keySource.fal === 'user' && (
                              <Badge variant="default" className="text-xs">Your Key</Badge>
                            )}
                            {keySource.fal === 'admin' && (
                              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Admin Provided
                              </Badge>
                            )}
                            {keySource.fal === 'none' && adminKeys.fal && (
                              <Badge variant="outline" className="text-xs">Admin Available</Badge>
                            )}
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showKeys.fal_ai ? "text" : "password"}
                                placeholder="key_id:key_secret or key_..."
                                {...field}
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => toggleKeyVisibility("fal_ai")}
                              >
                                {showKeys.fal_ai ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Your fal.ai API key for AI video generation and models. Get it from{" "}
                            <a 
                              href="https://fal.ai/dashboard/keys" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              fal.ai Dashboard
                            </a>
                          </FormDescription>
                          {field.value && (
                            <div className="mt-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleTestFalKey}
                                disabled={isTestingFalKey}
                              >
                                {isTestingFalKey ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Testing...
                                  </>
                                ) : (
                                  <>
                                    {falKeyValid === true && <CheckCircle className="h-4 w-4 mr-2 text-green-500" />}
                                    {falKeyValid === false && <AlertCircle className="h-4 w-4 mr-2 text-red-500" />}
                                    Test Connection
                                  </>
                                )}
                              </Button>
                              {falKeyValid === true && (
                                <p className="text-sm text-green-600 mt-1">✓ API key validated successfully</p>
                              )}
                              {falKeyValid === false && (
                                <p className="text-sm text-red-600 mt-1">✗ Invalid API key or connection failed</p>
                              )}
                            </div>
                          )}
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
                      {isLoading ? "Saving..." : "Save API Keys"}
                    </Button>
                  </form>
                </Form>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email Settings Tab */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Email Settings
                </CardTitle>
                <CardDescription>
                  Configure your email settings for sending invitations and notifications through Resend.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingData ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="ml-2">Loading your settings...</span>
                  </div>
                ) : (
                  <Form {...emailForm}>
                    <form onSubmit={emailForm.handleSubmit(onSubmitEmailSettings)} className="space-y-6">
                      <FormField
                        control={emailForm.control}
                        name="sender_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sender Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Your Company Name"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              The name that will appear in the "From" field of sent emails
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={emailForm.control}
                        name="sender_email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sender Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="noreply@yourdomain.com"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              The email address used to send emails. Must be verified with your domain.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={emailForm.control}
                        name="resend_api_key"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Resend API Key</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type={showKeys.resend_api_key ? "text" : "password"}
                                  placeholder="re_..."
                                  {...field}
                                  className="pr-10"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                  onClick={() => toggleKeyVisibility("resend_api_key")}
                                >
                                  {showKeys.resend_api_key ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </FormControl>
                            <FormDescription>
                              Your Resend API key for sending emails. Get it from{" "}
                              <a 
                                href="https://resend.com/api-keys" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                Resend Dashboard
                              </a>
                              {" "}(3,000 free emails/month)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={emailForm.control}
                        name="sender_domain"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Domain (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="yourdomain.com"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Your verified domain for email sending. If not specified, Resend's domain will be used.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Dynamic status information */}
                      {emailStatus && (
                        <div className={`p-4 rounded-lg border ${
                          emailStatus.configured && emailStatus.domainVerified
                            ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                            : emailStatus.configured
                            ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
                            : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                        }`}>
                          <div className="flex items-start gap-2">
                            {emailStatus.configured && emailStatus.domainVerified ? (
                              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                            ) : (
                              <AlertCircle className={`h-5 w-5 mt-0.5 ${
                                emailStatus.configured 
                                  ? 'text-yellow-600 dark:text-yellow-400'
                                  : 'text-blue-600 dark:text-blue-400'
                              }`} />
                            )}
                            <div className="space-y-2">
                              <h4 className={`font-medium ${
                                emailStatus.configured && emailStatus.domainVerified
                                  ? 'text-green-900 dark:text-green-100'
                                  : emailStatus.configured
                                  ? 'text-yellow-900 dark:text-yellow-100'
                                  : 'text-blue-900 dark:text-blue-100'
                              }`}>
                                {emailStatus.configured && emailStatus.domainVerified
                                  ? 'Email Configuration Ready'
                                  : emailStatus.configured && !emailStatus.domainVerified
                                  ? 'Domain Verification Recommended'
                                  : 'Email Configuration Required'
                                }
                              </h4>
                              <p className={`text-sm ${
                                emailStatus.configured && emailStatus.domainVerified
                                  ? 'text-green-800 dark:text-green-200'
                                  : emailStatus.configured
                                  ? 'text-yellow-800 dark:text-yellow-200'
                                  : 'text-blue-800 dark:text-blue-200'
                              }`}>
                                {emailStatus.configured && emailStatus.domainVerified
                                  ? 'Your email settings are configured and ready to send emails. You can use the test function below to verify everything works.'
                                  : emailStatus.configured && !emailStatus.domainVerified
                                  ? 'Your settings are configured but using a custom domain. For production use, verify your domain in your Resend dashboard.'
                                  : 'Complete the email settings above and save them to enable email functionality.'
                                }
                                {emailStatus.configured && !emailStatus.domainVerified && (
                                  <>
                                    {" "}Visit{" "}
                                    <a 
                                      href="https://resend.com/domains" 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="underline hover:no-underline"
                                    >
                                      Resend Domains
                                    </a>
                                    {" "}to verify your domain.
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Test Email Instructions */}
                      {emailStatus?.configured && (
                        <div className="space-y-4 p-4 border rounded-lg bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                          <h4 className="font-medium flex items-center gap-2 text-green-900 dark:text-green-100">
                            <CheckCircle className="h-4 w-4" />
                            Email Configuration Complete
                          </h4>
                          <p className="text-sm text-green-800 dark:text-green-200">
                            Your email settings are configured and ready to send real emails! Use the test function below to verify everything works.
                          </p>
                        </div>
                      )}

                      {/* Test Email Section */}
                      {emailStatus?.configured && (
                        <div className="space-y-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900/50">
                          <h4 className="font-medium flex items-center gap-2">
                            <Send className="h-4 w-4" />
                            Test Email Configuration
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            Send a test email to verify your configuration is working correctly.
                          </p>
                          <div className="flex gap-2">
                            <Input
                              type="email"
                              placeholder="Enter test email address..."
                              value={testEmail}
                              onChange={(e) => setTestEmail(e.target.value)}
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleTestEmail}
                              disabled={isTestingEmail || !testEmail}
                            >
                              {isTestingEmail ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4 mr-2" />
                              )}
                              {isTestingEmail ? 'Sending...' : 'Send Test'}
                            </Button>
                          </div>
                        </div>
                      )}

                      <Button type="submit" disabled={isLoadingEmail} className="w-full">
                        {isLoadingEmail ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        {isLoadingEmail ? "Saving..." : "Save Email Settings"}
                      </Button>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscription Tab */}
          <TabsContent value="subscription">
            <SubscriptionSettings />
          </TabsContent>

          </div>
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default SettingsPage;
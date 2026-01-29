import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageLayout from '@/components/PageLayout';
import VideoPlayer from '@/components/VideoPlayer';
import GenerationHistory, { VideoGeneration } from '@/components/GenerationHistory';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Loader2,
  Sparkles,
  AlertCircle,
  Settings2,
  History,
  Wand2,
  Video,
  Clock,
  RatioIcon,
  Coins,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { 
  getAvailableModels,
} from '@/lib/fal-client';

// Form validation schema
const generationSchema = z.object({
  prompt: z.string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(500, 'Prompt must be less than 500 characters'),
  model: z.string().min(1, 'Please select a model'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  negativePrompt: z.string().max(200).optional(),
});

type GenerationForm = z.infer<typeof generationSchema>;

const GeneratePage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { 
    balance, 
    loading: creditsLoading, 
    canAfford,
    checkSufficientCredits,
    refundForFailure,
    refreshBalance
  } = useCredits();
  const [selectedGeneration, setSelectedGeneration] = useState<VideoGeneration | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const models = getAvailableModels();

  const form = useForm<GenerationForm>({
    resolver: zodResolver(generationSchema),
    defaultValues: {
      prompt: '',
      model: models[0]?.id || '',
      aspectRatio: '16:9',
      negativePrompt: '',
    },
  });

  // Fetch generation history
  const { data: generations = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ['video-generations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('video_generations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as VideoGeneration[];
    },
    enabled: !!user?.id,
  });

  // Generate video mutation using backend API
  const generateMutation = useMutation({
    mutationFn: async (values: GenerationForm) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      // Check if user has sufficient credits before starting
      setGenerationProgress('Checking credits...');
      const hasCredits = await checkSufficientCredits('default');
      if (!hasCredits) {
        throw new Error('Insufficient credits to generate video');
      }
      
      setIsGenerating(true);
      setGenerationProgress('Initializing video generation...');
      
      try {
        // Get the auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('No authentication token available');
        }

        // Call the backend API endpoint which handles fallback logic
        setGenerationProgress('Submitting generation request...');
        const response = await fetch('/api/generate-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            prompt: values.prompt,
            model: values.model,
            aspectRatio: values.aspectRatio,
            negativePrompt: values.negativePrompt,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to generate video');
        }

        const result = await response.json();
        setGenerationProgress('Video generation started. Processing...');
        
        // Poll for generation status
        const generationId = result.generationId;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          
          const { data: generation, error } = await supabase
            .from('video_generations')
            .select('*')
            .eq('id', generationId)
            .single();
          
          if (error) throw error;
          
          if (generation.status === 'completed') {
            // Credits are deducted on the backend when generation completes
            // Refresh balance to reflect the deduction
            await refreshBalance();
            // Dispatch event to update credit display in header
            window.dispatchEvent(new CustomEvent('refresh-credits'));
            return generation;
          } else if (generation.status === 'failed') {
            throw new Error(generation.error_message || 'Video generation failed');
          }
          
          attempts++;
          setGenerationProgress(`Processing... (${attempts * 5}s)`);
        }
        
        throw new Error('Generation timeout - please check history for status');
      } catch (error: any) {
        console.error('Generation error:', error);
        // If generation fails, no need to refund since we only deduct on success
        throw error;
      } finally {
        setIsGenerating(false);
        setGenerationProgress('');
        // Refresh balance after generation attempt
        refreshBalance();
        // Update credit display in header
        window.dispatchEvent(new CustomEvent('refresh-credits'));
      }
    },
    onSuccess: (data) => {
      toast.success('Video generated successfully!');
      setSelectedGeneration(data);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['video-generations'] });
    },
    onError: (error: any) => {
      // Handle specific error messages from the API
      const errorMessage = error.message || 'Failed to generate video';
      
      if (errorMessage.includes('Insufficient credits')) {
        toast.error('You need at least 1 credit to generate a video. Please purchase more credits.');
      } else if (errorMessage.includes('API key not configured')) {
        toast.error('No API keys available. Please configure your fal.ai API key in Settings or contact your administrator.');
      } else if (errorMessage.includes('Rate limit')) {
        toast.error('Rate limit exceeded. Please try again later.');
      } else if (errorMessage.includes('Invalid token')) {
        toast.error('Authentication error. Please sign in again.');
      } else {
        toast.error(errorMessage);
      }
    },
  });

  const onSubmit = (values: GenerationForm) => {
    generateMutation.mutate(values);
  };

  const handleRegenerate = (generation: VideoGeneration) => {
    form.setValue('prompt', generation.prompt);
    form.setValue('model', generation.model);
    if (generation.metadata?.aspect_ratio) {
      form.setValue('aspectRatio', generation.metadata.aspect_ratio);
    }
    toast.info('Prompt loaded. Click Generate to create a new video.');
  };

  const handleDeleteGeneration = async (id: string) => {
    const { error } = await supabase
      .from('video_generations')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete generation');
    } else {
      toast.success('Generation deleted');
      queryClient.invalidateQueries({ queryKey: ['video-generations'] });
      if (selectedGeneration?.id === id) {
        setSelectedGeneration(null);
      }
    }
  };

  return (
    <PageLayout
      title="AI Video Generation"
      description="Create stunning videos from text prompts using advanced AI models"
    >

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column: Generation Form */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Generate Video
              </CardTitle>
              <CardDescription>
                Describe your video and customize generation parameters
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* Prompt Input */}
                  <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prompt</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="A cinematic shot of a futuristic city at night, with flying cars and neon signs..."
                            className="min-h-[100px] resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Describe the video you want to create (10-500 characters)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Model Selection */}
                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Video className="h-4 w-4" />
                          Model
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {models.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{model.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {model.description}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Aspect Ratio */}
                  <FormField
                    control={form.control}
                    name="aspectRatio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <RatioIcon className="h-4 w-4" />
                          Aspect Ratio
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="16:9">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-5 border rounded-sm" />
                                <span>16:9 (Landscape)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="9:16">
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-8 border rounded-sm" />
                                <span>9:16 (Portrait)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="1:1">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 border rounded-sm" />
                                <span>1:1 (Square)</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Negative Prompt */}
                  <FormField
                    control={form.control}
                    name="negativePrompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Negative Prompt (Optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Things to avoid in the video..."
                            className="min-h-[60px] resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Describe what you don't want in the video
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Insufficient Credits Alert */}
                  {!creditsLoading && balance === 0 && (
                    <Alert className="border-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <span className="font-medium">Insufficient credits</span>
                        <br />
                        You need at least 1 credit to generate a video.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Generate Button */}
                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={isGenerating || creditsLoading || !canAfford('default')}
                  >
                    {creditsLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading credits...
                      </>
                    ) : isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {generationProgress || 'Generating...'}
                      </>
                    ) : !canAfford('default') ? (
                      <>
                        <Coins className="mr-2 h-4 w-4" />
                        Insufficient Credits
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate Video (1 Credit)
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Video Preview and History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Video Player */}
          <VideoPlayer
            videoUrl={selectedGeneration?.video_url}
            thumbnailUrl={selectedGeneration?.thumbnail_url}
            isLoading={isGenerating}
            error={selectedGeneration?.status === 'failed' ? selectedGeneration.error_message : undefined}
            duration={selectedGeneration?.duration_seconds}
            width={selectedGeneration?.width}
            height={selectedGeneration?.height}
          />

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Generation History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <GenerationHistory
                generations={generations}
                isLoading={isLoadingHistory}
                onSelect={setSelectedGeneration}
                onRegenerate={handleRegenerate}
                onDelete={handleDeleteGeneration}
                maxHeight="400px"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
};

export default GeneratePage;
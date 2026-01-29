import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Clock,
  Download,
  RefreshCw,
  Trash2,
  Play,
  AlertCircle,
  FileVideo,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export interface VideoGeneration {
  id: string;
  prompt: string;
  model: string;
  video_url?: string;
  thumbnail_url?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  error_message?: string;
  metadata?: any;
}

interface GenerationHistoryProps {
  generations: VideoGeneration[];
  isLoading?: boolean;
  onRegenerate?: (generation: VideoGeneration) => void;
  onDelete?: (id: string) => void;
  onSelect?: (generation: VideoGeneration) => void;
  className?: string;
  maxHeight?: string;
}

export function GenerationHistory({
  generations,
  isLoading = false,
  onRegenerate,
  onDelete,
  onSelect,
  className,
  maxHeight = '400px',
}: GenerationHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (generation: VideoGeneration) => {
    setSelectedId(generation.id);
    onSelect?.(generation);
  };

  const handleDownload = (generation: VideoGeneration) => {
    if (generation.video_url) {
      const link = document.createElement('a');
      link.href = generation.video_url;
      link.download = `video-${generation.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const getStatusColor = (status: VideoGeneration['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-500';
      case 'processing':
        return 'bg-blue-500/10 text-blue-500';
      case 'failed':
        return 'bg-red-500/10 text-red-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  const getModelName = (modelId: string) => {
    const models: Record<string, string> = {
      'fal-ai/minimax-video': 'MiniMax',
      'fal-ai/minimax-video/image-to-video': 'MiniMax I2V',
      'fal-ai/wan-t2v': 'WAN T2V',
    };
    return models[modelId] || modelId.split('/').pop();
  };

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <h3 className="text-sm font-medium mb-3">Recent Generations</h3>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <FileVideo className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No videos generated yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Your generation history will appear here
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Recent Generations</h3>
        <Badge variant="secondary" className="text-xs">
          {generations.length} videos
        </Badge>
      </div>

      <ScrollArea className="w-full" style={{ maxHeight }}>
        <div className="space-y-2 p-1 pr-4">
          {generations.map((generation) => (
            <Card
              key={generation.id}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                selectedId === generation.id && 'ring-2 ring-primary'
              )}
              onClick={() => handleSelect(generation)}
            >
              <CardContent className="p-3">
                <div className="flex gap-3">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0 w-24 h-16 bg-muted rounded overflow-hidden relative">
                    {generation.thumbnail_url ? (
                      <img
                        src={generation.thumbnail_url}
                        alt="Video thumbnail"
                        className="w-full h-full object-cover"
                      />
                    ) : generation.status === 'processing' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : generation.status === 'failed' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    
                    {/* Duration badge */}
                    {generation.duration_seconds && (
                      <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
                        {generation.duration_seconds}s
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {generation.prompt}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            variant="secondary"
                            className={cn('text-xs', getStatusColor(generation.status))}
                          >
                            {generation.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {getModelName(generation.model)}
                          </span>
                          {generation.width && generation.height && (
                            <span className="text-xs text-muted-foreground">
                              {generation.width}×{generation.height}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(generation.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {generation.status === 'completed' && generation.video_url && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 focus-visible:ring-0 focus-visible:ring-offset-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(generation);
                                }}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                          </Tooltip>
                        )}

                        {onRegenerate && generation.status !== 'processing' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 focus-visible:ring-0 focus-visible:ring-offset-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRegenerate(generation);
                                }}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Regenerate</TooltipContent>
                          </Tooltip>
                        )}

                        {onDelete && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive focus-visible:ring-0 focus-visible:ring-offset-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(generation.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    {/* Error message */}
                    {generation.status === 'failed' && generation.error_message && (
                      <p className="text-xs text-destructive mt-1 truncate">
                        {generation.error_message}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default GenerationHistory;
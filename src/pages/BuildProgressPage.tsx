/**
 * BuildProgressPage — Real-time build status visualization
 *
 * Shows customers exactly what's happening during their build:
 * - Phase progress with pass/fail indicators
 * - Live event stream
 * - Auto-updating screenshots as they're captured
 * - Delivery receipt on completion
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useBuildProgress } from '@/hooks/useBuildProgress';
import { BUILD_PHASES } from '@/lib/build-jobs';
import type { BuildEvent } from '@/lib/build-events';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2, XCircle, Loader2, Clock, ArrowLeft,
  ExternalLink, Image, AlertTriangle, Rocket,
} from 'lucide-react';

export default function BuildProgressPage() {
  const { buildId } = useParams<{ buildId: string }>();
  const navigate = useNavigate();
  const { build, events, isLoading, error, latestScreenshot } = useBuildProgress(buildId || null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !build) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error || 'Build not found'}</p>
        <Button variant="outline" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const isComplete = build.status === 'complete';
  const isFailed = build.status === 'failed';
  const isActive = !isComplete && !isFailed && build.status !== 'cancelled';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{build.app_name || 'Build'}</h1>
          <p className="text-muted-foreground">
            {isComplete ? 'Build delivered successfully' :
             isFailed ? 'Build failed' :
             'Building your app...'}
          </p>
        </div>
        <StatusBadge status={build.status} />
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{build.current_phase_name || 'Preparing'}</span>
          <span className="font-medium">{build.progress_percentage}%</span>
        </div>
        <Progress value={build.progress_percentage} className="h-3" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Phases + Event log */}
        <div className="lg:col-span-2 space-y-6">
          {/* Phase cards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Build Phases</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {BUILD_PHASES.map((phase) => (
                <PhaseRow
                  key={phase.phase}
                  phase={phase}
                  currentPhase={build.current_phase}
                  phasesCompleted={build.phases_completed || []}
                  events={events.filter(e => e.phase === phase.phase)}
                />
              ))}
            </CardContent>
          </Card>

          {/* Event stream */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Live Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {isActive ? 'Waiting for build to start...' : 'No events recorded'}
                    </p>
                  ) : (
                    events.map(event => (
                      <EventRow key={event.id} event={event} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Screenshot + Build info */}
        <div className="space-y-6">
          {/* Live screenshot */}
          {latestScreenshot && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Latest Screenshot
                </CardTitle>
              </CardHeader>
              <CardContent>
                <img
                  src={latestScreenshot}
                  alt="Build screenshot"
                  className="w-full rounded-lg border"
                />
              </CardContent>
            </Card>
          )}

          {/* Build info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Build Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Build ID" value={build.id.slice(0, 8) + '...'} />
              <InfoRow label="Priority" value={build.priority} />
              {build.complexity_tier && (
                <InfoRow label="Complexity" value={build.complexity_tier} />
              )}
              <InfoRow
                label="Started"
                value={build.started_at
                  ? new Date(build.started_at).toLocaleTimeString()
                  : 'Queued'}
              />
              {build.completed_at && (
                <InfoRow
                  label="Completed"
                  value={new Date(build.completed_at).toLocaleTimeString()}
                />
              )}
              {build.started_at && build.completed_at && (
                <InfoRow
                  label="Duration"
                  value={formatDuration(
                    new Date(build.completed_at).getTime() - new Date(build.started_at).getTime()
                  )}
                />
              )}
              {build.retry_count > 0 && (
                <InfoRow label="Retries" value={`${build.retry_count}/${build.max_retries}`} />
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {isComplete && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <Button className="w-full" onClick={() => navigate(`/dashboard/build/${buildId}/receipt`)}>
                  View Delivery Receipt
                </Button>
                <Button variant="outline" className="w-full">
                  <Rocket className="h-4 w-4 mr-2" />
                  Deploy to Vercel
                </Button>
              </CardContent>
            </Card>
          )}

          {isFailed && build.error_context && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-lg text-destructive">Error Details</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {(build.error_context as any)?.last_error || 'Unknown error'}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================
// Sub-components
// ==================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    queued: { label: 'Queued', variant: 'secondary' },
    building: { label: 'Building', variant: 'default' },
    testing: { label: 'Testing', variant: 'default' },
    deploying: { label: 'Deploying', variant: 'default' },
    complete: { label: 'Delivered', variant: 'outline' },
    failed: { label: 'Failed', variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
  };

  const c = config[status] || { label: status, variant: 'secondary' as const };

  return (
    <Badge variant={c.variant} className="text-sm px-3 py-1">
      {(status === 'building' || status === 'testing' || status === 'deploying') && (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      )}
      {status === 'complete' && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
      {c.label}
    </Badge>
  );
}

function PhaseRow({
  phase,
  currentPhase,
  phasesCompleted,
  events,
}: {
  phase: typeof BUILD_PHASES[number];
  currentPhase: number;
  phasesCompleted: any[];
  events: BuildEvent[];
}) {
  const completed = phasesCompleted.find((p: any) => p.phase === phase.phase);
  const isActive = currentPhase === phase.phase;
  const isPending = currentPhase < phase.phase;
  const isFailed = completed?.status === 'failed';

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
      isActive ? 'bg-primary/5 border border-primary/20' :
      completed && !isFailed ? 'bg-muted/50' :
      isFailed ? 'bg-destructive/5 border border-destructive/20' :
      ''
    }`}>
      {/* Status icon */}
      <div className="flex-shrink-0">
        {completed && !isFailed && <CheckCircle2 className="h-5 w-5 text-green-500" />}
        {isFailed && <XCircle className="h-5 w-5 text-destructive" />}
        {isActive && <Loader2 className="h-5 w-5 text-primary animate-spin" />}
        {isPending && <Clock className="h-5 w-5 text-muted-foreground/40" />}
      </div>

      {/* Phase info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isPending ? 'text-muted-foreground/60' : ''}`}>
            Phase {phase.phase}: {phase.name}
          </span>
          {completed?.duration_ms && (
            <span className="text-xs text-muted-foreground">
              ({formatDuration(completed.duration_ms)})
            </span>
          )}
        </div>
        <p className={`text-xs ${isPending ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
          {phase.description}
        </p>
        {/* Test results count */}
        {events.length > 0 && (
          <div className="flex gap-2 mt-1">
            {events.filter(e => e.event_type === 'test_pass').length > 0 && (
              <span className="text-xs text-green-600">
                {events.filter(e => e.event_type === 'test_pass').length} passed
              </span>
            )}
            {events.filter(e => e.event_type === 'test_fail').length > 0 && (
              <span className="text-xs text-red-600">
                {events.filter(e => e.event_type === 'test_fail').length} failed
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: BuildEvent }) {
  const time = new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const iconMap: Record<string, React.ReactNode> = {
    phase_start: <Loader2 className="h-3 w-3 text-blue-500" />,
    phase_complete: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    phase_failed: <XCircle className="h-3 w-3 text-destructive" />,
    test_pass: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    test_fail: <XCircle className="h-3 w-3 text-destructive" />,
    screenshot_captured: <Image className="h-3 w-3 text-purple-500" />,
    build_complete: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    build_failed: <XCircle className="h-3 w-3 text-destructive" />,
    deploy_start: <Rocket className="h-3 w-3 text-blue-500" />,
    deploy_complete: <Rocket className="h-3 w-3 text-green-500" />,
    deploy_failed: <XCircle className="h-3 w-3 text-destructive" />,
    warning: <AlertTriangle className="h-3 w-3 text-yellow-500" />,
    error: <XCircle className="h-3 w-3 text-destructive" />,
    info: <Clock className="h-3 w-3 text-muted-foreground" />,
  };

  return (
    <div className="flex items-start gap-2 text-sm py-1">
      <span className="text-xs text-muted-foreground font-mono whitespace-nowrap mt-0.5">
        {time}
      </span>
      <span className="mt-0.5">{iconMap[event.event_type] || <Clock className="h-3 w-3" />}</span>
      <span className="text-muted-foreground">{event.message || event.event_type}</span>
      {event.duration_ms && (
        <span className="text-xs text-muted-foreground ml-auto">
          {formatDuration(event.duration_ms)}
        </span>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * useBuildProgress — React hook for real-time build tracking
 *
 * Subscribes to Supabase Realtime for live build events and status updates.
 * Powers the Build Progress UI page.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { BuildJob } from '@/lib/build-jobs';
import type { BuildEvent } from '@/lib/build-events';

interface UseBuildProgressReturn {
  build: BuildJob | null;
  events: BuildEvent[];
  isLoading: boolean;
  error: string | null;
  latestScreenshot: string | null;
}

export function useBuildProgress(buildId: string | null): UseBuildProgressReturn {
  const [build, setBuild] = useState<BuildJob | null>(null);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    if (!buildId) {
      setIsLoading(false);
      return;
    }

    async function loadInitial() {
      try {
        // Fetch build job
        const { data: buildData, error: buildError } = await supabase
          .from('build_jobs')
          .select('*')
          .eq('id', buildId)
          .maybeSingle();

        if (buildError) throw buildError;
        setBuild(buildData as BuildJob | null);

        // Fetch existing events
        const { data: eventsData, error: eventsError } = await supabase
          .from('build_events')
          .select('*')
          .eq('build_job_id', buildId)
          .order('created_at', { ascending: true });

        if (eventsError) throw eventsError;
        const typedEvents = (eventsData || []) as BuildEvent[];
        setEvents(typedEvents);

        // Find latest screenshot
        const screenshots = typedEvents.filter(e => e.screenshot_url);
        if (screenshots.length > 0) {
          setLatestScreenshot(screenshots[screenshots.length - 1].screenshot_url);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitial();
  }, [buildId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!buildId) return;

    // Subscribe to build status changes
    const statusChannel = supabase
      .channel(`build-status-${buildId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'build_jobs',
          filter: `id=eq.${buildId}`,
        },
        (payload) => {
          setBuild(payload.new as BuildJob);
        }
      )
      .subscribe();

    // Subscribe to new events
    const eventsChannel = supabase
      .channel(`build-events-${buildId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'build_events',
          filter: `build_job_id=eq.${buildId}`,
        },
        (payload) => {
          const newEvent = payload.new as BuildEvent;
          setEvents(prev => [...prev, newEvent]);

          if (newEvent.screenshot_url) {
            setLatestScreenshot(newEvent.screenshot_url);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(statusChannel);
      supabase.removeChannel(eventsChannel);
    };
  }, [buildId]);

  return { build, events, isLoading, error, latestScreenshot };
}

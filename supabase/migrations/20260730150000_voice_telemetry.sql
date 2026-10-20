/*
  # Voice telemetry

  `NCORE_ULTRA_LOW_LATENCY_MOONSHOT.md` sets a target of warm join-to-first-audio
  under 500 ms and lists the measurements needed to chase it. None of them were
  being recorded, which means every claim about voice latency so far has been a
  guess. This is the measurement layer.

  Step 2 and 3 of the doc's roadmap: "Record join-to-first-audio telemetry in
  direct calls and server voice" and "Surface the selected voice region and RTT
  in the call diagnostics UI".

  ## One row per join attempt
  Including the failures. A join that never produced audio is the most
  interesting row in the table, and a schema that only records successes would
  hide exactly the cases worth investigating.

  ## Timings are stored as offsets, not timestamps
  Milliseconds from join start. Clock skew between a client and the database
  makes absolute timestamps useless for measuring a 400 ms window, and the
  client is the only party that can measure the interval accurately.
*/

CREATE TABLE IF NOT EXISTS public.voice_session_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- 'server_voice' for a community voice channel, 'direct_call' for a DM call.
  session_kind text NOT NULL CHECK (session_kind IN ('server_voice', 'direct_call')),
  channel_id uuid,
  conversation_id uuid,
  community_id uuid,

  provider text NOT NULL DEFAULT 'agora',
  selected_region text,
  /* Probe RTTs per candidate region, e.g. {"us-east": 24, "eu-west": 96}. */
  region_probes jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Offsets in milliseconds from the moment the user asked to join.
  token_fetch_ms integer,
  rtc_connected_ms integer,
  first_local_publish_ms integer,
  first_remote_audio_ms integer,

  -- Steady-state quality, sampled across the session.
  rtt_samples integer[] NOT NULL DEFAULT '{}',
  avg_rtt_ms integer,
  p95_rtt_ms integer,
  packet_loss_pct numeric(5,2),
  jitter_ms integer,

  reconnect_count integer NOT NULL DEFAULT 0,
  failover_count integer NOT NULL DEFAULT 0,

  -- 'connected' means audio actually flowed at least once.
  outcome text NOT NULL DEFAULT 'connected'
    CHECK (outcome IN ('connected', 'failed', 'abandoned')),
  failure_reason text,

  session_duration_ms integer,
  client_platform text,
  network_type text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_metrics_recent
  ON public.voice_session_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_metrics_user
  ON public.voice_session_metrics (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_metrics_region
  ON public.voice_session_metrics (selected_region, created_at DESC);

ALTER TABLE public.voice_session_metrics ENABLE ROW LEVEL SECURITY;

/*
  Users write and read only their own rows. Platform staff read everything,
  because the point of the table is comparing regions and providers across a
  population, not showing one person their own ping.
*/
DROP POLICY IF EXISTS "Users insert own voice metrics" ON public.voice_session_metrics;
CREATE POLICY "Users insert own voice metrics"
  ON public.voice_session_metrics FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own voice metrics" ON public.voice_session_metrics;
CREATE POLICY "Users read own voice metrics"
  ON public.voice_session_metrics FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')
    )
  );

-- No UPDATE or DELETE policy. A measurement that can be edited after the fact
-- is not a measurement.

-- ---------------------------------------------------------------------------
-- Aggregate view for the diagnostics UI
-- ---------------------------------------------------------------------------

/*
  Rolled-up voice health over a recent window.

  Percentiles rather than averages: a mean join time hides the tail, and the
  tail is what people actually notice and complain about. p95 join-to-first-audio
  is the number the moonshot target should be measured against, not the mean.
*/
CREATE OR REPLACE FUNCTION public.voice_health_summary(
  p_days integer DEFAULT 7,
  p_scope text DEFAULT 'me'
)
RETURNS TABLE (
  region text,
  sessions bigint,
  median_join_ms numeric,
  p95_join_ms numeric,
  median_rtt_ms numeric,
  avg_packet_loss_pct numeric,
  failure_rate_pct numeric,
  reconnect_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
  v_is_staff boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = v_uid AND p.platform_role IN ('owner', 'admin')
  ) INTO v_is_staff;

  -- Asking for the whole population without being staff silently narrows to
  -- your own rows rather than erroring; the UI offers the toggle either way.
  IF p_scope <> 'all' OR NOT v_is_staff THEN
    RETURN QUERY
    SELECT m.selected_region,
           count(*),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m.first_remote_audio_ms)::numeric,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY m.first_remote_audio_ms)::numeric,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m.avg_rtt_ms)::numeric,
           avg(m.packet_loss_pct)::numeric,
           (100.0 * count(*) FILTER (WHERE m.outcome = 'failed') / NULLIF(count(*), 0))::numeric,
           avg(m.reconnect_count)::numeric
      FROM public.voice_session_metrics m
     WHERE m.user_id = v_uid
       AND m.created_at >= now() - make_interval(days => v_days)
     GROUP BY m.selected_region
     ORDER BY count(*) DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.selected_region,
         count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY m.first_remote_audio_ms)::numeric,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY m.first_remote_audio_ms)::numeric,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY m.avg_rtt_ms)::numeric,
         avg(m.packet_loss_pct)::numeric,
         (100.0 * count(*) FILTER (WHERE m.outcome = 'failed') / NULLIF(count(*), 0))::numeric,
         avg(m.reconnect_count)::numeric
    FROM public.voice_session_metrics m
   WHERE m.created_at >= now() - make_interval(days => v_days)
   GROUP BY m.selected_region
   ORDER BY count(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.voice_health_summary(integer, text) TO authenticated;

/*
  The user's most recent sessions, for the call diagnostics panel.
*/
CREATE OR REPLACE FUNCTION public.my_recent_voice_sessions(p_limit integer DEFAULT 20)
RETURNS SETOF public.voice_session_metrics
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
    FROM public.voice_session_metrics
   WHERE user_id = auth.uid()
   ORDER BY created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.my_recent_voice_sessions(integer) TO authenticated;

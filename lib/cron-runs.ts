import type { SupabaseClient } from '@supabase/supabase-js'

export type CronRunStatus = 'running' | 'success' | 'error'

export async function startCronRun(
  supabase: SupabaseClient,
  jobName: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({
        job_name: jobName,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.error(`[cron-runs] start ${jobName} failed:`, error.message)
      return null
    }

    return (data as { id?: string } | null)?.id ?? null
  } catch (error) {
    console.error(`[cron-runs] start ${jobName} failed:`, error)
    return null
  }
}

export async function finishCronRun(
  supabase: SupabaseClient,
  runId: string | null,
  params: {
    status: Exclude<CronRunStatus, 'running'>
    metrics?: Record<string, unknown>
    errorMessage?: string | null
  },
): Promise<void> {
  if (!runId) return

  try {
    const { error } = await supabase
      .from('cron_runs')
      .update({
        status: params.status,
        finished_at: new Date().toISOString(),
        metrics: params.metrics ?? {},
        error_message: params.errorMessage ?? null,
      })
      .eq('id', runId)

    if (error) {
      console.error('[cron-runs] finish failed:', error.message)
    }
  } catch (error) {
    console.error('[cron-runs] finish failed:', error)
  }
}

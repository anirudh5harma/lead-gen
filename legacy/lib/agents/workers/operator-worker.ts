/**
 * Operator Agent Worker — runs the workspace's agent pipelines. A "pipeline"
 * is just an ordered list of (role, tool) steps; only the steps whose agent the
 * workspace has *enabled* run, and acting steps (send / publish / …) respect the
 * agent's autonomy mode. See PLAN.md §3.3.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult, AgentRole } from '../protocol/types'
import { WORKFLOW_DEFINITIONS, type WorkflowName } from '../core/workflow-types'
import {
  resolveWorkspaceId, loadWorkspaceAgents, isAgentEnabled, getAutonomy,
} from '../core/workspace-agents'

interface StepOutcome {
  step: number
  role: AgentRole
  tool: string
  status: 'completed' | 'failed' | 'skipped' | 'awaiting_approval'
  reason?: string
  result?: Record<string, unknown>
  error?: string
}

type RunStatus = 'completed' | 'partial' | 'awaiting_approval' | 'blocked'

export async function run(
  supabase: SupabaseClient,
  dispatch: WorkerTaskDispatch,
  userId: string,
  clientId: string | null,
): Promise<WorkerTaskResult> {
  const start = Date.now()
  const { tool, args } = dispatch

  try {
    let result: Record<string, unknown> = {}

    switch (tool) {
      // ── Orchestrate a pipeline ───────────────────────────────────────────────
      case 'bombsell.operator.orchestrate': {
        const { workflow, context } = args as {
          workflow: WorkflowName
          context?: { leadId?: string; postId?: string; companyName?: string; companyDomain?: string }
        }
        const def = WORKFLOW_DEFINITIONS[workflow]
        if (!def) throw new Error(`Unknown pipeline: ${workflow}`)
        const steps = def.steps

        const workspaceId = resolveWorkspaceId(userId, clientId)
        const wsAgents = await loadWorkspaceAgents(supabase, workspaceId)

        await recordAgentEvent(supabase, {
          userId, clientId, agentName: 'operator',
          eventType: 'operator.orchestrate.started', status: 'running',
          title: `Pipeline "${def.displayName}" started`,
          metadata: { workflow, engine: def.engine, totalSteps: steps.length },
        })

        const { dispatchTask } = await import('../core/supervisor')

        const outcomes: StepOutcome[] = []
        let completed = 0
        let runStatus: RunStatus = 'completed'

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]!
          const role = step.role as AgentRole
          const stepNo = i + 1

          // 1) agent disabled?
          if (!isAgentEnabled(wsAgents, role)) {
            if (step.required) {
              await recordAgentEvent(supabase, {
                userId, clientId, agentName: 'operator',
                eventType: 'operator.orchestrate.blocked', status: 'blocked',
                title: `Pipeline "${def.displayName}" blocked — required agent "${role}" is disabled`,
                metadata: { workflow, step: stepNo, role },
              })
              outcomes.push({ step: stepNo, role, tool: step.tool, status: 'skipped', reason: 'required_agent_disabled' })
              runStatus = 'blocked'
              break
            }
            outcomes.push({ step: stepNo, role, tool: step.tool, status: 'skipped', reason: 'agent_disabled' })
            await recordAgentEvent(supabase, {
              userId, clientId, agentName: 'operator',
              eventType: `operator.step.${stepNo}.skipped`, status: 'skipped',
              title: `Step ${stepNo}/${steps.length}: ${step.description} — skipped (agent off)`,
              metadata: { workflow, step: stepNo, role, tool: step.tool, reason: 'agent_disabled' },
            })
            continue
          }

          // 2) autonomy gate for acting steps (steps that touch the outside world)
          if (step.acting) {
            const autonomy = getAutonomy(wsAgents, role)
            if (autonomy === 'research_only') {
              outcomes.push({ step: stepNo, role, tool: step.tool, status: 'skipped', reason: 'research_only' })
              await recordAgentEvent(supabase, {
                userId, clientId, agentName: 'operator',
                eventType: `operator.step.${stepNo}.skipped`, status: 'skipped',
                title: `Step ${stepNo}/${steps.length}: ${step.description} — skipped (research-only)`,
                metadata: { workflow, step: stepNo, role, tool: step.tool, reason: 'research_only' },
              })
              continue
            }
            if (autonomy === 'approve_first') {
              outcomes.push({ step: stepNo, role, tool: step.tool, status: 'awaiting_approval', reason: 'approve_first' })
              await recordAgentEvent(supabase, {
                userId, clientId, agentName: 'operator',
                eventType: 'operator.orchestrate.awaiting_approval', status: 'needs_approval',
                title: `Pipeline "${def.displayName}" paused for approval at step ${stepNo} (${step.description})`,
                metadata: { workflow, step: stepNo, role, tool: step.tool, leadId: context?.leadId, postId: context?.postId },
              })
              runStatus = 'awaiting_approval'
              break
            }
            // autopilot → fall through and run it
          }

          // 3) run the step
          const stepStart = Date.now()
          await recordAgentEvent(supabase, {
            userId, clientId, agentName: 'operator',
            eventType: `operator.step.${stepNo}.started`, status: 'running',
            title: `Step ${stepNo}/${steps.length}: ${step.description}`,
            metadata: { workflow, step: stepNo, role, tool: step.tool },
          })

          try {
            const taskOutput = await dispatchTask(supabase, {
              userId, clientId, role,
              task: {
                tool: step.tool,
                arguments: {
                  ...(context?.leadId ? { leadId: context.leadId } : {}),
                  ...(context?.postId ? { postId: context.postId } : {}),
                  ...(context?.companyName ? { targetCompany: context.companyName } : {}),
                  ...(context?.companyDomain ? { companyDomain: context.companyDomain } : {}),
                },
              },
              sessionId: dispatch.sessionId,
              workflowRunId: dispatch.tracingContext.workflowRunId,
            })
            const latencyMs = Date.now() - stepStart
            const ok = taskOutput.status === 'completed'
            if (ok) completed++
            outcomes.push({
              step: stepNo, role, tool: step.tool,
              status: ok ? 'completed' : 'failed',
              result: taskOutput.result, error: taskOutput.error,
            })
            await recordAgentEvent(supabase, {
              userId, clientId, agentName: 'operator',
              eventType: `operator.step.${stepNo}.${ok ? 'completed' : 'failed'}`,
              status: ok ? 'completed' : 'failed',
              title: `Step ${stepNo}/${steps.length}: ${step.description} — ${ok ? 'done' : 'failed'}`,
              metadata: { workflow, step: stepNo, role, tool: step.tool, latencyMs, taskStatus: taskOutput.status },
            })
            if (!ok) {
              if (step.required) { runStatus = 'partial'; break }
              // optional step failed → keep going
            }
          } catch (stepErr) {
            const latencyMs = Date.now() - stepStart
            const msg = stepErr instanceof Error ? stepErr.message : String(stepErr)
            outcomes.push({ step: stepNo, role, tool: step.tool, status: 'failed', error: msg })
            await recordAgentEvent(supabase, {
              userId, clientId, agentName: 'operator',
              eventType: `operator.step.${stepNo}.failed`, status: 'failed',
              title: `Step ${stepNo}/${steps.length}: ${step.description} — error`,
              metadata: { workflow, step: stepNo, role, tool: step.tool, latencyMs, error: msg },
            })
            if (step.required) { runStatus = 'partial'; break }
          }
        }

        await recordAgentEvent(supabase, {
          userId, clientId, agentName: 'operator',
          eventType: `operator.orchestrate.${runStatus === 'completed' ? 'completed' : runStatus}`,
          status: runStatus === 'awaiting_approval' ? 'needs_approval' : runStatus === 'blocked' ? 'blocked' : 'completed',
          title: `Pipeline "${def.displayName}" ${runStatus} — ${completed}/${steps.length} steps ran`,
          metadata: { workflow, engine: def.engine, status: runStatus, stepsRun: completed, totalSteps: steps.length },
        })

        result = {
          workflow, engine: def.engine, status: runStatus,
          stepsRun: completed, totalSteps: steps.length, steps: outcomes,
        }
        break
      }

      // ── Status ────────────────────────────────────────────────────────────────
      case 'bombsell.operator.status': {
        const { listAgents } = await import('../core/registry')
        const agents = listAgents()
        result = {
          agents: agents.map((a) => ({ role: a.role, status: a.health.status, health: a.health })),
          queueSize: 0,
        }
        await recordAgentEvent(supabase, {
          userId, clientId, agentName: 'operator',
          eventType: 'operator.status.completed', status: 'completed',
          title: `Agent status: ${agents.length} agents`, metadata: { agentCount: agents.length },
        })
        break
      }

      default:
        throw new Error(`Unknown operator tool: ${tool}`)
    }

    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'completed',
      result,
      creditsConsumed: 0.1,
      latencyMs: Date.now() - start,
    }
  } catch (err) {
    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      creditsConsumed: 0,
      latencyMs: Date.now() - start,
    }
  }
}

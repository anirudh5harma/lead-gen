import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runCampaignStrategyGraphInWorkflowStep,
  runSkillOptimizerGraphInWorkflowStep,
  type BombsellLangGraphState,
  type CampaignStrategyDecision,
  type CampaignStrategyGraphInput,
  type SkillOptimizerDecision,
  type SkillOptimizerGraphInput,
} from "../core/agents/langgraph/index.ts";
import {
  _resetToolRegistry,
  registerTool,
} from "../core/agents/tools/registry.ts";
import {
  buildCampaignStrategyRecommendation,
  type CampaignOptimizerOutcomeKind,
} from "../core/product/campaign-optimizer.ts";
import {
  buildSkillOptimizationPlan,
} from "../core/product/skill-optimizer.ts";
import {
  planCampaignDispatchAllocations,
  type CampaignDispatchCandidate,
  type CampaignDispatchStrategy,
} from "../core/product/campaign-allocation.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await predicate();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

test("campaign optimizer: positive replies can justify cautious double-down", () => {
  const play_id = randomUUID();
  const recommendation = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3),
    outcomes: [
      outcome("run-1", play_id, "positive_reply"),
      outcome("run-2", play_id, "positive_reply"),
    ],
  });

  const variant = recommendation.variants[0];
  assert.equal(variant?.recommendation, "double_down");
  assert.equal(variant?.reply_outcomes, 2);
  assert.equal(variant?.reply_rate, 0.67);
  assert.equal(variant?.positive_outcome_rate, 0.67);
  assert.equal(variant?.positive_outcomes, 2);
  assert.match(variant?.explanation ?? "", /positive outcome/);
});

test("campaign optimizer: meeting and pipeline outcomes score above replies", () => {
  const play_id = randomUUID();
  const replyStrategy = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3),
    outcomes: [outcome("run-1", play_id, "positive_reply")],
  });
  const meetingStrategy = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3),
    outcomes: [outcome("run-1", play_id, "meeting_booked")],
  });

  assert.ok(
    meetingStrategy.variants[0]!.utility_score > replyStrategy.variants[0]!.utility_score,
  );
});

test("campaign optimizer: bounces and unsubscribes reduce allocation", () => {
  const play_id = randomUUID();
  const recommendation = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3),
    outcomes: [
      outcome("run-1", play_id, "bounce"),
      outcome("run-2", play_id, "unsubscribe"),
      outcome("run-3", play_id, "do_not_contact"),
    ],
  });

  const variant = recommendation.variants[0];
  assert.equal(variant?.recommendation, "reduce");
  assert.equal(variant?.negative_outcome_rate, 1);
  assert.equal(variant?.allocation_weight, 0.05);
  assert.match(variant?.explanation ?? "", /negative outcome/);
});

test("campaign optimizer: insufficient samples keep exploration small", () => {
  const play_id = randomUUID();
  const recommendation = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 1),
    outcomes: [outcome("run-1", play_id, "deal_won")],
  });

  const variant = recommendation.variants[0];
  assert.equal(variant?.recommendation, "not_enough_proof");
  assert.equal(variant?.allocation_weight, 0.15);
  assert.match(variant?.explanation ?? "", /1\/3 samples/);
});

test("campaign optimizer: summary explains double-down, reduce, and exploration counts", () => {
  const winningPlay = randomUUID();
  const riskyPlay = randomUUID();
  const exploringPlay = randomUUID();
  const recommendation = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: [
      ...runs(winningPlay, 3, "Winner"),
      ...runs(riskyPlay, 3, "Risky"),
      ...runs(exploringPlay, 1, "Explorer"),
    ],
    outcomes: [
      outcome("run-1", winningPlay, "meeting_booked"),
      outcome("run-2", winningPlay, "positive_reply"),
      outcome("run-4", riskyPlay, "bounce"),
      outcome("run-5", riskyPlay, "unsubscribe"),
      outcome("run-6", riskyPlay, "do_not_contact"),
    ],
  });

  assert.match(recommendation.summary, /1 variants ready to double down/);
  assert.match(recommendation.summary, /1 should reduce/);
  assert.match(recommendation.summary, /1 still need exploration/);
});

test("skill optimizer: combines campaign outcomes and procedural memory", () => {
  const play_id = randomUUID();
  const rep_id = randomUUID();
  const strategy = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3).map((run) => ({
      ...run,
      rep_id,
      rep_name: "Outbound agent",
      pattern_key: "founder-signal-cold-open",
    })),
    outcomes: [
      outcome("run-1", play_id, "meeting_booked"),
      outcome("run-2", play_id, "positive_reply"),
    ],
  });

  const plan = buildSkillOptimizationPlan({
    workspace_id: strategy.workspace_id,
    min_samples: 3,
    variants: strategy.variants,
    memory_updates: [{
      event_id: randomUUID(),
      rep_id,
      pattern_key: "founder-signal-cold-open",
      delta_score: 0.25,
      win: true,
    }],
  });

  const recommendation = plan.recommendations[0];
  assert.equal(recommendation?.recommendation, "double_down");
  assert.equal(recommendation?.next_action, "apply_play_gate");
  assert.equal(recommendation?.reply_rate, 0.33);
  assert.equal(recommendation?.positive_outcome_rate, 0.67);
  assert.equal(recommendation?.meeting_rate, 0.33);
  assert.equal(recommendation?.memory_win_count, 1);
  assert.match(plan.summary, /1 skills ready for gated double-down/);
});

test("skill optimizer: risky skills require reduce review", () => {
  const play_id = randomUUID();
  const strategy = buildCampaignStrategyRecommendation({
    workspace_id: randomUUID(),
    min_samples: 3,
    play_runs: runs(play_id, 3).map((run) => ({
      ...run,
      pattern_key: "risky-opener",
    })),
    outcomes: [
      outcome("run-1", play_id, "bounce"),
      outcome("run-2", play_id, "unsubscribe"),
      outcome("run-3", play_id, "do_not_contact"),
    ],
  });

  const plan = buildSkillOptimizationPlan({
    workspace_id: strategy.workspace_id,
    min_samples: 3,
    variants: strategy.variants,
    memory_updates: [{
      event_id: randomUUID(),
      pattern_key: "risky-opener",
      delta_score: -0.3,
      win: false,
    }],
  });

  const recommendation = plan.recommendations[0];
  assert.equal(recommendation?.recommendation, "reduce");
  assert.equal(recommendation?.next_action, "review_reduce");
  assert.equal(recommendation?.memory_loss_count, 1);
  assert.match(recommendation?.explanation ?? "", /Review before reducing/);
});

test("campaign dispatch allocation: prioritizes double-down and skips reduced variants", () => {
  const winningPlay = randomUUID();
  const riskyPlay = randomUUID();
  const explorerPlay = randomUUID();
  const candidates: CampaignDispatchCandidate[] = [
    candidate(riskyPlay, "email", "risk-skill", "enterprise"),
    candidate(explorerPlay, "email", "explore-skill", "enterprise"),
    candidate(winningPlay, "email", "win-skill", "enterprise"),
  ];
  const strategy: CampaignDispatchStrategy = {
    recommendation_id: randomUUID(),
    generated_at: new Date().toISOString(),
    variants: [
      strategyVariant(winningPlay, "email", "win-skill", "enterprise", "double_down", 0.62),
      strategyVariant(riskyPlay, "email", "risk-skill", "enterprise", "reduce", 0.05),
      strategyVariant(explorerPlay, "email", "explore-skill", "enterprise", "not_enough_proof", 0.15),
    ],
  };

  const plans = planCampaignDispatchAllocations(candidates, strategy);

  assert.equal(plans[0]!.candidate.play_id, winningPlay);
  assert.equal(plans[0]!.allocation.recommendation, "double_down");
  assert.equal(plans[0]!.allocation.should_dispatch, true);
  assert.equal(plans[1]!.candidate.play_id, explorerPlay);
  assert.equal(plans[1]!.allocation.recommendation, "not_enough_proof");
  assert.equal(plans[2]!.candidate.play_id, riskyPlay);
  assert.equal(plans[2]!.allocation.should_dispatch, false);
  assert.equal(plans[2]!.allocation.recommendation_id, strategy.recommendation_id);
});

test("campaign dispatch allocation: explicit Play dispatch can override reduce", () => {
  const play_id = randomUUID();
  const strategy: CampaignDispatchStrategy = {
    recommendation_id: randomUUID(),
    generated_at: new Date().toISOString(),
    variants: [
      strategyVariant(play_id, "email", "risk-skill", "enterprise", "reduce", 0.05),
    ],
  };

  const plans = planCampaignDispatchAllocations([
    { ...candidate(play_id, "email", "risk-skill", "enterprise"), explicit_target: true },
  ], strategy);

  assert.equal(plans[0]!.allocation.recommendation, "reduce");
  assert.equal(plans[0]!.allocation.should_dispatch, true);
});

test("campaign dispatch allocation: learned winning skill becomes the dispatched Play skill", () => {
  const play_id = randomUUID();
  const recommendation_id = randomUUID();
  const defaultCandidate = candidate(play_id, "email", "signal_problem_probe", "enterprise");
  const strategy: CampaignDispatchStrategy = {
    recommendation_id,
    generated_at: new Date().toISOString(),
    variants: [
      strategyVariant(play_id, "email", "peer_proof_micro_case", "enterprise", "double_down", 0.63),
    ],
  };

  const plans = planCampaignDispatchAllocations([defaultCandidate], strategy);

  assert.equal(plans[0]!.allocation.recommendation, "double_down");
  assert.equal(plans[0]!.allocation.skill_key, "peer_proof_micro_case");
  assert.equal(plans[0]!.allocation.skill_version, null);
  assert.equal(
    plans[0]!.allocation.variant_key,
    `play:${play_id}|skill:peer_proof_micro_case|channel:email|segment:enterprise`,
  );
  assert.equal(plans[0]!.allocation.matched_variant_key, plans[0]!.allocation.variant_key);
  assert.equal(plans[0]!.allocation.recommendation_id, recommendation_id);
});

test("campaign dispatch allocation: learned skills do not cross channels", () => {
  const play_id = randomUUID();
  const defaultCandidate = candidate(play_id, "email", "signal_problem_probe", "enterprise");
  const strategy: CampaignDispatchStrategy = {
    recommendation_id: randomUUID(),
    generated_at: new Date().toISOString(),
    variants: [
      strategyVariant(play_id, "linkedin_dm", "linkedin_signal_dm_probe", "enterprise", "double_down", 0.63),
    ],
  };

  const plans = planCampaignDispatchAllocations([defaultCandidate], strategy);

  assert.equal(plans[0]!.allocation.recommendation, "unscored");
  assert.equal(plans[0]!.allocation.skill_key, "signal_problem_probe");
  assert.equal(plans[0]!.allocation.matched_variant_key, null);
});

test("campaign dispatch skip event: validates reduced allocation payload", async () => {
  const bus = createInMemoryEventBus();
  const play_id = randomUUID();
  const signal_id = randomUUID();
  const recommendation_id = randomUUID();
  const generated_at = new Date().toISOString();

  await bus.publish({
    workspace_id: randomUUID(),
    event_type: "campaign.dispatch.skipped",
    source: "system",
    producer_ref: "test:campaign-dispatch",
    idempotency_key: `skip:${signal_id}:${play_id}:${recommendation_id}`,
    payload: {
      signal_id,
      play_id,
      play_name: "Enterprise signal email",
      channel: "email",
      skill_key: "risk-skill",
      skill_version: "v1",
      segment_key: "enterprise",
      variant_key: `play:${play_id}|skill:risk-skill|channel:email|segment:enterprise`,
      matched_variant_key: `play:${play_id}|skill:risk-skill|channel:email|segment:enterprise`,
      recommendation_id,
      strategy_generated_at: generated_at,
      recommendation: "reduce",
      allocation_weight: 0.05,
      reason: "Negative outcomes were too high.",
      skipped_at: generated_at,
    },
  });

  assert.equal(bus.published.at(-1)?.event_type, "campaign.dispatch.skipped");
});

test("campaign strategy graph: optimizes campaign allocation without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const play_id = randomUUID();
  const recommendation_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.campaign.strategy.optimize",
    description: "Optimize campaign strategy.",
    kind: "write",
    input: z.object({
      lookback_days: z.number().int().positive().max(180).optional(),
      min_samples: z.number().int().positive().max(50).optional(),
    }),
    output: campaignStrategyOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.campaign.strategy.optimize");
      assert.equal(input.lookback_days, 30);
      assert.equal(input.min_samples, 3);
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      const result = {
        workspace_id,
        recommendation_id,
        generated_at: new Date().toISOString(),
        min_samples: 3,
        summary: "1 variants ready to double down, 0 should reduce, 0 still need exploration.",
        variants: [{
          variant_key: `play:${play_id}|skill:test|channel:email|segment:enterprise`,
          play_id,
          play_name: "Enterprise signal email",
          rep_id: null,
          rep_name: "Outbound agent",
          channel: "email",
          skill_key: "test",
          pattern_key: `play:${play_id}|stage:campaign_outcome`,
          segment_key: "enterprise",
          sample_count: 3,
          outcome_count: 2,
          reply_outcomes: 1,
          positive_outcomes: 2,
          negative_outcomes: 0,
          meeting_outcomes: 1,
          reply_rate: 0.33,
          positive_outcome_rate: 0.67,
          meeting_rate: 0.33,
          negative_outcome_rate: 0,
          utility_score: 0.72,
          confidence: 1,
          allocation_weight: 0.62,
          recommendation: "double_down" as const,
          explanation: "2 positive outcomes with 1 meeting/pipeline win. Double down cautiously.",
        }],
      };
      await bus.publish({
        workspace_id,
        event_type: "campaign.strategy.recommended",
        source: "system",
        producer_ref: "test:campaign-optimizer",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        payload: {
          recommendation_id,
          generated_at: result.generated_at,
          min_samples: result.min_samples,
          summary: result.summary,
          variants: result.variants,
        },
      });
      return result;
    },
  });

  runtime.register(
    defineWorkflow<CampaignStrategyGraphInput, BombsellLangGraphState>({
      name: "campaign_strategy_graph_test",
      version: "1",
      async run(input, ctx) {
        return runCampaignStrategyGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "campaign_strategy_graph_test",
    input: {
      workspace_id,
      user_id,
      lookback_days: 30,
      min_samples: 3,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<CampaignStrategyGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");

  const decision = output.attributes?.campaign_strategy as CampaignStrategyDecision;
  assert.equal(decision.recommendation_id, recommendation_id);
  assert.equal(decision.next_action, "double_down");
  assert.equal(decision.top_variant?.play_id, play_id);

  assert.deepEqual(toolCalls, ["product.campaign.strategy.optimize"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "campaign.strategy.recommended"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "campaign strategy optimization must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
});

test("skill optimizer graph: recommends gated skill changes without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const recommendation_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.play.skills.optimize",
    description: "Optimize Play skills.",
    kind: "write",
    input: z.object({
      lookback_days: z.number().int().positive().max(180).optional(),
      min_samples: z.number().int().positive().max(50).optional(),
    }),
    output: skillOptimizerOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.play.skills.optimize");
      assert.equal(input.lookback_days, 30);
      assert.equal(input.min_samples, 3);
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      const result = {
        workspace_id,
        recommendation_id,
        generated_at: new Date().toISOString(),
        min_samples: 3,
        summary: "1 skills ready for gated double-down, 0 need reduce review, 0 still need exploration.",
        recommendations: [{
          skill_key: "founder-signal-cold-open",
          pattern_key: "founder-signal-cold-open",
          channel: "email",
          segment_key: "enterprise",
          rep_id: null,
          rep_name: "Outbound agent",
          sample_count: 3,
          outcome_count: 2,
          reply_outcomes: 1,
          positive_outcomes: 2,
          negative_outcomes: 0,
          meeting_outcomes: 1,
          reply_rate: 0.33,
          positive_outcome_rate: 0.67,
          meeting_rate: 0.33,
          negative_outcome_rate: 0,
          memory_win_count: 1,
          memory_loss_count: 0,
          memory_delta_score: 0.25,
          utility_score: 0.74,
          confidence: 1,
          allocation_weight: 0.62,
          recommendation: "double_down" as const,
          next_action: "apply_play_gate" as const,
          explanation:
            "2 positive outcomes, 1 meeting/pipeline win, and 1 procedural win support a gated double-down.",
          source_variant_keys: ["play:test|skill:founder-signal-cold-open|channel:email|segment:enterprise"],
        }],
      };
      await bus.publish({
        workspace_id,
        event_type: "play.skill.optimization.recommended",
        source: "system",
        producer_ref: "test:skill-optimizer",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        payload: {
          recommendation_id,
          generated_at: result.generated_at,
          min_samples: result.min_samples,
          summary: result.summary,
          recommendations: result.recommendations,
        },
      });
      return result;
    },
  });

  runtime.register(
    defineWorkflow<SkillOptimizerGraphInput, BombsellLangGraphState>({
      name: "skill_optimizer_graph_test",
      version: "1",
      async run(input, ctx) {
        return runSkillOptimizerGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "skill_optimizer_graph_test",
    input: {
      workspace_id,
      user_id,
      lookback_days: 30,
      min_samples: 3,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<SkillOptimizerGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");

  const decision = output.attributes?.skill_optimizer as SkillOptimizerDecision;
  assert.equal(decision.recommendation_id, recommendation_id);
  assert.equal(decision.next_action, "apply_play_gate");
  assert.equal(decision.double_down_count, 1);

  assert.deepEqual(toolCalls, ["product.play.skills.optimize"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "play.skill.optimization.recommended"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "skill optimization must not enqueue or send outreach",
  );
});

function candidate(
  play_id: string,
  channel: string,
  skill_key: string,
  segment_key: string,
): CampaignDispatchCandidate {
  return {
    play_id,
    play_name: "Campaign Play",
    channel,
    skill_key,
    skill_version: "v1",
    segment_key,
  };
}

function strategyVariant(
  play_id: string,
  channel: string,
  skill_key: string,
  segment_key: string,
  recommendation: CampaignDispatchStrategy["variants"][number]["recommendation"],
  allocation_weight: number,
): CampaignDispatchStrategy["variants"][number] {
  return {
    variant_key: `play:${play_id}|skill:${skill_key}|channel:${channel}|segment:${segment_key}`,
    play_id,
    channel,
    skill_key,
    segment_key,
    allocation_weight,
    recommendation,
    explanation: `${recommendation} ${skill_key}`,
  };
}

function runs(play_id: string, count: number, play_name = "Campaign Play") {
  return Array.from({ length: count }, (_, index) => ({
    play_run_id: `${play_id}:run-${index + 1}`,
    play_id,
    play_name,
    channel: "email",
    skill_key: "test-skill",
    segment_key: "enterprise",
  }));
}

function outcome(
  play_run_id: string,
  play_id: string,
  kind: CampaignOptimizerOutcomeKind,
) {
  return {
    outcome_id: randomUUID(),
    play_run_id,
    play_id,
    kind,
  };
}

const campaignStrategyRecommendationSchema = z.enum([
  "double_down",
  "hold",
  "reduce",
  "not_enough_proof",
]);

const campaignStrategyVariantSchema = z.object({
  variant_key: z.string(),
  play_id: z.string().uuid(),
  play_name: z.string(),
  rep_id: z.string().uuid().nullable(),
  rep_name: z.string().nullable(),
  channel: z.string().nullable(),
  skill_key: z.string(),
  pattern_key: z.string(),
  segment_key: z.string(),
  sample_count: z.number().int().nonnegative(),
  outcome_count: z.number().int().nonnegative(),
  reply_outcomes: z.number().int().nonnegative(),
  positive_outcomes: z.number().int().nonnegative(),
  negative_outcomes: z.number().int().nonnegative(),
  meeting_outcomes: z.number().int().nonnegative(),
  reply_rate: z.number().min(0).max(1),
  positive_outcome_rate: z.number().min(0).max(1),
  meeting_rate: z.number().min(0).max(1),
  negative_outcome_rate: z.number().min(0).max(1),
  utility_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  allocation_weight: z.number().min(0).max(1),
  recommendation: campaignStrategyRecommendationSchema,
  explanation: z.string(),
});

const campaignStrategyOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  min_samples: z.number().int().positive(),
  summary: z.string(),
  variants: z.array(campaignStrategyVariantSchema),
});

const skillOptimizerNextActionSchema = z.enum([
  "apply_play_gate",
  "review_reduce",
  "keep_learning",
  "no_change",
]);

const skillOptimizationRecommendationSchema = z.object({
  skill_key: z.string(),
  pattern_key: z.string(),
  channel: z.string().nullable(),
  segment_key: z.string(),
  rep_id: z.string().uuid().nullable(),
  rep_name: z.string().nullable(),
  sample_count: z.number().int().nonnegative(),
  outcome_count: z.number().int().nonnegative(),
  reply_outcomes: z.number().int().nonnegative(),
  positive_outcomes: z.number().int().nonnegative(),
  negative_outcomes: z.number().int().nonnegative(),
  meeting_outcomes: z.number().int().nonnegative(),
  reply_rate: z.number().min(0).max(1),
  positive_outcome_rate: z.number().min(0).max(1),
  meeting_rate: z.number().min(0).max(1),
  negative_outcome_rate: z.number().min(0).max(1),
  memory_win_count: z.number().int().nonnegative(),
  memory_loss_count: z.number().int().nonnegative(),
  memory_delta_score: z.number(),
  utility_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  allocation_weight: z.number().min(0).max(1),
  recommendation: campaignStrategyRecommendationSchema,
  next_action: skillOptimizerNextActionSchema,
  explanation: z.string(),
  source_variant_keys: z.array(z.string()),
});

const skillOptimizerOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  min_samples: z.number().int().positive(),
  summary: z.string(),
  recommendations: z.array(skillOptimizationRecommendationSchema),
});

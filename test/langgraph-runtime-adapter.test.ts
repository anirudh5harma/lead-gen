import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  BombsellGraphStateAnnotation,
  createLangGraphMemoryCheckpoint,
  invokeLangGraphTool,
  listLangGraphToolNames,
  requestLangGraphApproval,
  runLangGraphInWorkflowStep,
  traceLangGraphNode,
  type BombsellLangGraphState,
} from "../core/agents/langgraph/index.ts";
import {
  _resetToolRegistry,
  registerTool,
} from "../core/agents/tools/registry.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/adapters/in-process.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";

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

test("LangGraph runtime adapter: runs a stateful graph inside a durable workflow step", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const rep_id = randomUUID();
  const signal_id = randomUUID();
  const runtime = createInProcessWorkflowRuntime({ bus });

  registerTool({
    name: "test.echo",
    description: "Echo a phrase with the workspace context.",
    kind: "read",
    input: z.object({ phrase: z.string() }),
    output: z.object({
      phrase: z.string(),
      workspace_id: z.string().uuid(),
      rep_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      return {
        phrase: input.phrase,
        workspace_id: ctx.workspace_id,
        rep_id: ctx.rep_id!,
      };
    },
  });

  const graphName = "test.echo_graph.v1";
  const graph = new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "echo",
      traceLangGraphNode({
        graph_name: graphName,
        node_name: "echo",
        bus,
        handler: async (state: BombsellLangGraphState) => {
          const output = await invokeLangGraphTool(
            "test.echo",
            { phrase: String(state.attributes?.phrase ?? "") },
            state,
            { bus },
          );
          return { tool_results: { echo: output } };
        },
      }),
    )
    .addEdge(START, "echo")
    .addEdge("echo", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });

  runtime.register(
    defineWorkflow<{ phrase: string }, BombsellLangGraphState>({
      name: "langgraph_echo",
      version: "1",
      async run(input, ctx) {
        return runLangGraphInWorkflowStep({
          graph_name: graphName,
          graph,
          ctx,
          bus,
          state: {
            workspace_id: ctx.workspace_id!,
            rep_id,
            signal_id,
            thread_id: `thread:${ctx.run_id}`,
            run_id: ctx.run_id,
            correlation_id: ctx.correlation_id,
            causation_event_id: null,
            attributes: { phrase: input.phrase },
          },
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "langgraph_echo",
    input: { phrase: "hello" },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<unknown, BombsellLangGraphState>(run.id);

  assert.equal(final?.output?.tool_results?.echo.phrase, "hello");
  assert.equal(final?.output?.tool_results?.echo.workspace_id, workspace_id);
  assert.deepEqual(listLangGraphToolNames(), ["test.echo"]);

  const spans = bus.published.filter((event) => event.event_type === "agent.trace.span.recorded");
  assert.equal(spans.some((event) => event.payload.kind === "langgraph.node"), true);
  assert.equal(spans.some((event) => event.payload.kind === "tool.call"), true);
  assert.equal(spans.some((event) => event.payload.kind === "agent.run"), true);
  assert.equal(
    spans.some((event) => event.payload.primitive_refs.signal_id === signal_id),
    true,
  );
});

test("LangGraph runtime adapter: approval interrupts map to workflow approvals", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const runtime = createInProcessWorkflowRuntime({ bus });
  let approval_id: string | null = null;

  await bus.subscribe("approval.requested", (event) => {
    approval_id = event.payload.approval_id;
  });

  const graphName = "test.approval_graph.v1";
  runtime.register(
    defineWorkflow<unknown, BombsellLangGraphState>({
      name: "langgraph_approval",
      version: "1",
      async run(_input, ctx) {
        const graph = new StateGraph(BombsellGraphStateAnnotation)
          .addNode(
            "approval",
            traceLangGraphNode({
              graph_name: graphName,
              node_name: "approval",
              bus,
              handler: async (state: BombsellLangGraphState) => {
                const decision = await requestLangGraphApproval(
                  ctx,
                  state,
                  {
                    kind: "outbound.email.send",
                    payload: { message_id: state.message_id },
                  },
                  { bus, node_name: "approval" },
                );
                return { approvals: { send: decision.decision } };
              },
            }),
          )
          .addEdge(START, "approval")
          .addEdge("approval", END)
          .compile({ checkpointer: createLangGraphMemoryCheckpoint() });

        return runLangGraphInWorkflowStep({
          graph_name: graphName,
          graph,
          ctx,
          bus,
          state: {
            workspace_id: ctx.workspace_id!,
            message_id: randomUUID(),
            thread_id: `thread:${ctx.run_id}`,
            run_id: ctx.run_id,
            correlation_id: ctx.correlation_id,
            causation_event_id: null,
            attributes: {},
          },
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "langgraph_approval",
    input: null,
  });

  await until(async () => (await runtime.get(run.id))?.status === "awaiting_approval");
  await until(() => approval_id);
  await runtime.resolveApproval(approval_id!, {
    decision: "approved",
    decided_by: randomUUID(),
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");

  const final = await runtime.get<unknown, BombsellLangGraphState>(run.id);
  assert.equal(final?.output?.approvals?.send, "approved");
  assert.equal(
    bus.published.some(
      (event) =>
        event.event_type === "agent.trace.span.recorded" &&
        event.payload.kind === "approval.interrupt",
    ),
    true,
  );
});

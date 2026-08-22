import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect } from "effect"
import { LLMAISDK } from "@/session/llm/ai-sdk"

type AISDKAdapterEvent = Parameters<typeof LLMAISDK.toLLMEvents>[1]

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- tests defensive adapter branches outside AI SDK's current typed surface
const uncheckedAdapterEvent = (input: unknown) => input as AISDKAdapterEvent

describe("session.llm.ai-sdk truncated tool-name recovery", () => {
  const adaptWithAdvertised = async (toolNames: string[], events: ReadonlyArray<AISDKAdapterEvent>) => {
    const state = LLMAISDK.adapterState()
    state.advertisedToolNames = toolNames
    return Effect.runPromise(
      Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event)).pipe(Effect.map((items) => items.flat())),
    )
  }

  test("canonicalizes a provider-truncated name across the whole tool-call event sequence", async () => {
    const events = await adaptWithAdvertised(["read"], [
      uncheckedAdapterEvent({ type: "tool-input-start", id: "call-1", toolName: "rea" }),
      uncheckedAdapterEvent({ type: "tool-input-delta", id: "call-1", delta: '{"file_path":' }),
      uncheckedAdapterEvent({ type: "tool-input-end", id: "call-1" }),
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "rea",
        input: { file_path: "README.md" },
      } as AISDKAdapterEvent,
    ])

    expect(events.map((event) => event.type)).toEqual([
      "tool-input-start",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
    ])
    const names = [
      ...events.filter(LLMEvent.is.toolInputStart),
      ...events.filter(LLMEvent.is.toolInputDelta),
      ...events.filter(LLMEvent.is.toolInputEnd),
      ...events.filter(LLMEvent.is.toolCall),
    ].map((event) => event.name)
    expect(names).toEqual(["read", "read", "read", "read"])
  })

  test("leaves exact and unknown names untouched", async () => {
    const events = await adaptWithAdvertised(["read", "bash"], [
      uncheckedAdapterEvent({ type: "tool-input-start", id: "call-1", toolName: "bash" }),
      { type: "tool-call", toolCallId: "call-2", toolName: "wri", input: {} } as AISDKAdapterEvent,
    ])

    expect(events.filter(LLMEvent.is.toolInputStart).map((event) => event.name)).toEqual(["bash"])
    expect(events.filter(LLMEvent.is.toolCall).map((event) => event.name)).toEqual(["wri"])
  })
})

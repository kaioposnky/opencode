import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { canonicalizeToolCallName, LLMEvent, resolveToolNameByUniquePrefix } from "../src"
import { ToolRuntime } from "../src/tool-runtime"
import { Tool } from "../src/tool"
import { it } from "./lib/effect"

describe("resolveToolNameByUniquePrefix", () => {
  const names = ["read", "readmefull", "bash", "glob"]

  test("returns an exact match unchanged", () => {
    expect(resolveToolNameByUniquePrefix(names, "read")).toBe("read")
    expect(resolveToolNameByUniquePrefix(names, "bash")).toBe("bash")
  })

  test("recovers a missing final character when the completion is unique", () => {
    expect(resolveToolNameByUniquePrefix(names, "bas")).toBe("bash")
    expect(resolveToolNameByUniquePrefix(names, "glo")).toBe("glob")
  })

  test("recovers a truncated name even when longer prefixes also match", () => {
    expect(resolveToolNameByUniquePrefix(names, "rea")).toBe("read")
  })

  test("prefers a unique one-character completion over a unique longer prefix", () => {
    expect(resolveToolNameByUniquePrefix(["alpha", "alphabet"], "alph")).toBe("alpha")
  })

  test("resolves a truncated name by its unique longer prefix", () => {
    expect(resolveToolNameByUniquePrefix(["readmefull", "bash"], "readmefu")).toBe("readmefull")
  })

  test("refuses ambiguous prefixes with no unique one-character completion", () => {
    expect(resolveToolNameByUniquePrefix(["alpha", "alphabet"], "alp")).toBeUndefined()
  })

  test("ignores names shorter than three characters", () => {
    expect(resolveToolNameByUniquePrefix(["ab"], "a")).toBeUndefined()
  })

  test("returns undefined for unknown names", () => {
    expect(resolveToolNameByUniquePrefix(names, "zzz")).toBeUndefined()
  })
})

describe("canonicalizeToolCallName", () => {
  test("passes exact and unknown names through untouched", () => {
    expect(canonicalizeToolCallName(["read", "bash"], "read")).toBe("read")
    expect(canonicalizeToolCallName(["read", "bash"], "wri")).toBe("wri")
  })
})

describe("ToolRuntime.dispatch truncation recovery", () => {
  const echo = Tool.make({
    description: "Echo the input.",
    parameters: Schema.Struct({ value: Schema.String }),
    success: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed({ value }),
  })

  it.effect("executes a truncated call against the advertised tool", () =>
    Effect.gen(function* () {
      const input = { value: "hi" }
      const exact = yield* ToolRuntime.dispatch({ echo }, LLMEvent.toolCall({ id: "call_1", name: "echo", input }))
      const truncated = yield* ToolRuntime.dispatch({ echo }, LLMEvent.toolCall({ id: "call_1", name: "ech", input }))

      expect(truncated.result).toEqual(exact.result)
      expect(truncated.result.type).not.toBe("error")
      const names = truncated.events.map((event) => (event.type === "tool-result" ? event.name : undefined))
      expect(names).toEqual(["echo"])
    }),
  )

  it.effect("keeps reporting unknown tools as errors", () =>
    Effect.gen(function* () {
      const dispatched = yield* ToolRuntime.dispatch(
        { echo },
        LLMEvent.toolCall({ id: "call_1", name: "nope", input: {} }),
      )

      expect(dispatched.result).toEqual({ type: "error", value: "Unknown tool: nope" })
    }),
  )
})

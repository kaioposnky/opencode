import { Effect } from "effect"
import {
  LLMEvent,
  type ToolCallPart,
  ToolFailure,
  ToolOutput,
  ToolResultValue,
  type ToolOutput as ToolOutputType,
  type ToolResultValue as ToolResultValueType,
} from "./schema"
import { canonicalizeToolCallName } from "./tool-name"
import { type AnyTool, type Tools } from "./tool"

export interface ToolSettlement {
  readonly result: ToolResultValueType
  readonly output?: ToolOutputType
}

export interface DispatchResult extends ToolSettlement {
  readonly events: ReadonlyArray<LLMEvent>
}

/** Execute one canonical tool call without owning provider IO or continuation. */
export const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<DispatchResult> => {
  // Some providers drop the final character of streamed tool names; recover
  // the intended tool so results and history reference its canonical name.
  const name = canonicalizeToolCallName(Object.keys(tools), call.name)
  const target = name === call.name ? call : { ...call, name }
  const tool = tools[target.name]
  if (!tool) return Effect.succeed(result(target, { type: "error", value: `Unknown tool: ${target.name}` }))
  if (!tool.execute)
    return Effect.succeed(result(target, { type: "error", value: `Tool has no execute handler: ${target.name}` }))

  return decodeAndExecute(tool, target).pipe(
    Effect.map((value) => result(target, value)),
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed(result(target, { type: "error", value: failure.message }, failure.error)),
    ),
  )
}

const decodeAndExecute = (tool: AnyTool, call: ToolCallPart): Effect.Effect<ToolSettlement, ToolFailure> =>
  tool._decode(call.input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) =>
      tool.execute!(decoded, { id: call.id, name: call.name }).pipe(
        Effect.flatMap((value) =>
          tool._encode(value).pipe(
            Effect.mapError(
              (error) =>
                new ToolFailure({
                  message: `Tool returned an invalid value for its success schema: ${error.message}`,
                }),
            ),
          ),
        ),
        Effect.map((encoded) => {
          if (tool._legacyResult && ToolResultValue.is(encoded))
            return { result: encoded, output: ToolOutput.fromResultValue(encoded) }
          const output = tool._project(decoded, call.id, encoded)
          const result = ToolOutput.toResultValue(output)
          return result.type === "error" ? { result } : { result, output }
        }),
      ),
    ),
  )

const result = (call: ToolCallPart, value: ToolResultValueType | ToolSettlement, error?: unknown): DispatchResult => {
  const settlement = ToolResultValue.is(value) ? { result: value } : value
  return {
    result: settlement.result,
    output: settlement.output,
    events:
      settlement.result.type === "error"
        ? [
            LLMEvent.toolError({ id: call.id, name: call.name, message: String(settlement.result.value), error }),
            LLMEvent.toolResult({ id: call.id, name: call.name, result: settlement.result }),
          ]
        : [LLMEvent.toolResult({ id: call.id, name: call.name, result: settlement.result, output: settlement.output })],
  }
}

export const ToolRuntime = { dispatch } as const

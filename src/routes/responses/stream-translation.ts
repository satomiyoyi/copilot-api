import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type ResponseOutputFunctionCall,
  type ResponseOutputMessage,
  type ResponsesStreamEvent,
  type ResponsesStreamState,
} from "./response-types"

function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function makeEmptyResponse(state: ResponsesStreamState) {
  return {
    id: state.responseId,
    object: "response" as const,
    created_at: Math.floor(Date.now() / 1000),
    status: "completed" as const,
    model: state.model,
    output: [],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  }
}

// eslint-disable-next-line max-lines-per-function, complexity
export function translateChunkToResponsesEvents(
  chunk: ChatCompletionChunk,
  state: ResponsesStreamState,
): Array<ResponsesStreamEvent> {
  const events: Array<ResponsesStreamEvent> = []

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  // Update model from chunk
  if (chunk.model) {
    state.model = chunk.model
  }

  // First chunk: emit response.created and response.in_progress
  if (!state.responseId) {
    state.responseId = `resp_${chunk.id}`
    const emptyResponse = makeEmptyResponse(state)

    events.push({
      type: "response.created",
      response: emptyResponse,
    })
    events.push({
      type: "response.in_progress",
      response: emptyResponse,
    })
  }

  // Text delta
  if (delta.content) {
    if (!state.messageStarted) {
      state.currentMessageId = `msg_${generateId()}`
      state.contentIndex = 0
      state.textAccumulator = ""
      state.messageStarted = true

      const messageItem: ResponseOutputMessage = {
        type: "message",
        id: state.currentMessageId,
        status: "completed",
        role: "assistant",
        content: [],
      }

      events.push({
        type: "response.output_item.added",
        output_index: state.outputIndex,
        item: messageItem,
      })
      events.push({
        type: "response.content_part.added",
        item_id: state.currentMessageId,
        output_index: state.outputIndex,
        content_index: state.contentIndex,
        part: { type: "output_text", text: "" },
      })
    }

    state.textAccumulator += delta.content

    events.push({
      type: "response.output_text.delta",
      item_id: state.currentMessageId,
      output_index: state.outputIndex,
      content_index: state.contentIndex,
      delta: delta.content,
    })
  }

  // Tool call handling
  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        // Finalize any open text message before starting tool calls
        if (state.messageStarted) {
          events.push({
            type: "response.output_text.done",
            item_id: state.currentMessageId,
            output_index: state.outputIndex,
            content_index: state.contentIndex,
            text: state.textAccumulator,
          })
          events.push({
            type: "response.content_part.done",
            item_id: state.currentMessageId,
            output_index: state.outputIndex,
            content_index: state.contentIndex,
            part: { type: "output_text", text: state.textAccumulator },
          })
          events.push({
            type: "response.output_item.done",
            output_index: state.outputIndex,
            item: {
              type: "message",
              id: state.currentMessageId,
              status: "completed",
              role: "assistant",
              content: [
                { type: "output_text", text: state.textAccumulator },
              ],
            },
          })
          state.outputIndex++
          state.messageStarted = false
        }

        // Start new function call
        const fcId = `fc_${generateId()}`
        state.functionCallAccumulator[toolCall.index] = {
          id: fcId,
          callId: toolCall.id,
          name: toolCall.function.name,
          arguments: "",
        }

        const fnCallItem: ResponseOutputFunctionCall = {
          type: "function_call",
          id: fcId,
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: "",
          status: "completed",
        }

        events.push({
          type: "response.output_item.added",
          output_index: state.outputIndex + toolCall.index,
          item: fnCallItem,
        })
      }

      // Tool call argument delta
      if (toolCall.function?.arguments) {
        const fc = state.functionCallAccumulator[toolCall.index]
        if (fc) {
          fc.arguments += toolCall.function.arguments

          events.push({
            type: "response.function_call_arguments.delta",
            item_id: fc.id,
            output_index: state.outputIndex + toolCall.index,
            delta: toolCall.function.arguments,
          })
        }
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    // Close open text message
    if (state.messageStarted) {
      events.push({
        type: "response.output_text.done",
        item_id: state.currentMessageId,
        output_index: state.outputIndex,
        content_index: state.contentIndex,
        text: state.textAccumulator,
      })
      events.push({
        type: "response.content_part.done",
        item_id: state.currentMessageId,
        output_index: state.outputIndex,
        content_index: state.contentIndex,
        part: { type: "output_text", text: state.textAccumulator },
      })
      events.push({
        type: "response.output_item.done",
        output_index: state.outputIndex,
        item: {
          type: "message",
          id: state.currentMessageId,
          status:
            choice.finish_reason === "length" ? "incomplete" : "completed",
          role: "assistant",
          content: [{ type: "output_text", text: state.textAccumulator }],
        },
      })
      state.outputIndex++
      state.messageStarted = false
    }

    // Close open function calls
    for (const [indexStr, fc] of Object.entries(
      state.functionCallAccumulator,
    )) {
      const index = Number(indexStr)
      events.push({
        type: "response.function_call_arguments.done",
        item_id: fc.id,
        output_index: state.outputIndex + index,
        arguments: fc.arguments,
      })
      events.push({
        type: "response.output_item.done",
        output_index: state.outputIndex + index,
        item: {
          type: "function_call",
          id: fc.id,
          call_id: fc.callId,
          name: fc.name,
          arguments: fc.arguments,
          status: "completed",
        },
      })
    }

    // Build final response
    const finalStatus =
      choice.finish_reason === "length" ? "incomplete"
      : choice.finish_reason === "content_filter" ? "failed"
      : "completed"

    events.push({
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: finalStatus,
        model: state.model,
        output: [],
        usage: {
          input_tokens: chunk.usage?.prompt_tokens ?? 0,
          output_tokens: chunk.usage?.completion_tokens ?? 0,
          total_tokens: chunk.usage?.total_tokens ?? 0,
        },
      },
    })
  }

  return events
}

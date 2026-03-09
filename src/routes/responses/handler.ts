import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"

import {
  translateToOpenAI,
  translateToResponsesAPI,
} from "./non-stream-translation"
import type {
  ResponsesAPIResponse,
  ResponsesPayload,
  ResponsesStreamState,
} from "./response-types"
import { translateChunkToResponsesEvents } from "./stream-translation"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  consola.debug("Responses API request payload:", JSON.stringify(payload))

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Try direct passthrough to Copilot /responses endpoint first.
  // Some models (e.g. gpt-5.4) only support the /responses endpoint.
  try {
    return await handleDirectResponses(c, payload)
  } catch (error) {
    // If the direct call fails, fall back to chat/completions translation
    consola.debug(
      "Direct /responses call failed, falling back to chat/completions translation:",
      error,
    )
    return await handleTranslatedResponses(c, payload)
  }
}

async function handleDirectResponses(c: Context, payload: ResponsesPayload) {
  consola.debug("Trying direct /responses passthrough")
  const response = await createResponses(payload)

  if (isNonStreamingResponsesAPI(response)) {
    consola.debug(
      "Non-streaming direct response:",
      JSON.stringify(response).slice(-400),
    )
    return c.json(response)
  }

  consola.debug("Streaming direct response")
  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      if (rawEvent.data === "[DONE]") {
        break
      }
      if (!rawEvent.data) {
        continue
      }

      // Parse the event to get the type for the SSE event field
      const parsed = JSON.parse(rawEvent.data)
      const eventType = parsed.type ?? rawEvent.event ?? "message"

      await stream.writeSSE({
        event: eventType,
        data: rawEvent.data,
      })
    }
  })
}

async function handleTranslatedResponses(
  c: Context,
  payload: ResponsesPayload,
) {
  const openAIPayload = translateToOpenAI(payload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  // Set max_tokens from cached models if not provided
  if (isNullish(openAIPayload.max_tokens)) {
    const selectedModel = state.models?.data.find(
      (model) => model.id === openAIPayload.model,
    )
    if (selectedModel) {
      openAIPayload.max_tokens =
        selectedModel.capabilities.limits.max_output_tokens
      consola.debug("Set max_tokens to:", openAIPayload.max_tokens)
    }
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreamingChatCompletion(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const responsesAPIResponse = translateToResponsesAPI(
      response,
      payload.metadata,
    )
    consola.debug(
      "Translated Responses API response:",
      JSON.stringify(responsesAPIResponse),
    )
    return c.json(responsesAPIResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: ResponsesStreamState = {
      responseId: "",
      outputIndex: 0,
      currentMessageId: "",
      contentIndex: 0,
      textAccumulator: "",
      functionCallAccumulator: {},
      messageStarted: false,
      model: openAIPayload.model,
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToResponsesEvents(chunk, streamState)

      for (const event of events) {
        consola.debug(
          "Translated Responses API event:",
          JSON.stringify(event),
        )
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreamingResponsesAPI = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesAPIResponse =>
  Object.hasOwn(response, "object")

const isNonStreamingChatCompletion = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

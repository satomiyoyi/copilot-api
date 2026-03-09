import {
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type Tool,
} from "~/services/copilot/create-chat-completions"

import {
  type ResponseInputContentPart,
  type ResponseInputFunctionCall,
  type ResponseInputItem,
  type ResponseInputMessage,
  type ResponseOutputFunctionCall,
  type ResponseOutputItem,
  type ResponseOutputMessage,
  type ResponsesAPIResponse,
  type ResponsesPayload,
  type ResponseTool,
} from "./response-types"

// --- Request Translation ---

export function translateToOpenAI(
  payload: ResponsesPayload,
): ChatCompletionsPayload {
  const messages = buildMessages(payload.input, payload.instructions)

  return {
    model: payload.model,
    messages,
    max_tokens: payload.max_output_tokens,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    ...(payload.reasoning && {
      reasoning_effort: payload.reasoning.effort,
    }),
  }
}

function buildMessages(
  input: string | Array<ResponseInputItem>,
  instructions?: string,
): Array<Message> {
  const messages: Array<Message> = []

  if (instructions) {
    messages.push({ role: "system", content: instructions })
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input })
    return messages
  }

  for (const item of input) {
    switch (item.type) {
      case "message": {
        messages.push(translateInputMessage(item))
        break
      }
      case "function_call": {
        appendFunctionCall(messages, item)
        break
      }
      case "function_call_output": {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: item.output,
        })
        break
      }
      case "item_reference": {
        // Silently skip (stateless proxy)
        break
      }
      // No default
    }
  }

  return messages
}

function translateInputMessage(item: ResponseInputMessage): Message {
  if (typeof item.content === "string") {
    return { role: item.role, content: item.content }
  }

  const contentParts = translateContentParts(item.content)
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role: item.role, content: contentParts[0].text }
  }

  return { role: item.role, content: contentParts }
}

function translateContentParts(
  parts: Array<ResponseInputContentPart>,
): Array<ContentPart> {
  const result: Array<ContentPart> = []

  for (const part of parts) {
    switch (part.type) {
      case "input_text": {
        result.push({ type: "text", text: part.text })
        break
      }
      case "output_text": {
        result.push({ type: "text", text: part.text })
        break
      }
      case "input_image": {
        result.push({
          type: "image_url",
          image_url: { url: part.image_url, detail: part.detail },
        })
        break
      }
      // No default
    }
  }

  return result
}

function appendFunctionCall(
  messages: Array<Message>,
  item: ResponseInputFunctionCall,
): void {
  // Try to merge into the last assistant message
  const lastMessage = messages[messages.length - 1]
  if (lastMessage && lastMessage.role === "assistant") {
    if (!lastMessage.tool_calls) {
      lastMessage.tool_calls = []
    }
    lastMessage.tool_calls.push({
      id: item.call_id,
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    })
  } else {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        },
      ],
    })
  }
}

function translateTools(
  tools?: Array<ResponseTool>,
): Array<Tool> | undefined {
  if (!tools) return undefined
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function translateToolChoice(
  toolChoice?: ResponsesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!toolChoice) return undefined
  if (typeof toolChoice === "string") return toolChoice
  return {
    type: "function",
    function: { name: toolChoice.name },
  }
}

// --- Response Translation ---

export function translateToResponsesAPI(
  response: ChatCompletionResponse,
  metadata?: Record<string, string>,
): ResponsesAPIResponse {
  const output: Array<ResponseOutputItem> = []
  const choice = response.choices[0]

  if (!choice) {
    return buildResponse(response, output, "failed", metadata)
  }

  // Add text message if content exists
  if (choice.message.content) {
    const messageItem: ResponseOutputMessage = {
      type: "message",
      id: `msg_${response.id}`,
      status: mapFinishReasonToMessageStatus(choice.finish_reason),
      role: "assistant",
      content: [{ type: "output_text", text: choice.message.content }],
    }
    output.push(messageItem)
  }

  // Add function calls
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      const fnCall: ResponseOutputFunctionCall = {
        type: "function_call",
        id: `fc_${toolCall.id}`,
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
        status: "completed",
      }
      output.push(fnCall)
    }
  }

  const status = mapFinishReasonToStatus(choice.finish_reason)
  return buildResponse(response, output, status, metadata)
}

function buildResponse(
  response: ChatCompletionResponse,
  output: Array<ResponseOutputItem>,
  status: ResponsesAPIResponse["status"],
  metadata?: Record<string, string>,
): ResponsesAPIResponse {
  return {
    id: `resp_${response.id}`,
    object: "response",
    created_at: response.created,
    status,
    model: response.model,
    output,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
    ...(metadata && { metadata }),
  }
}

function mapFinishReasonToStatus(
  reason: string,
): ResponsesAPIResponse["status"] {
  switch (reason) {
    case "stop":
    case "tool_calls": {
      return "completed"
    }
    case "length": {
      return "incomplete"
    }
    case "content_filter": {
      return "failed"
    }
    default: {
      return "completed"
    }
  }
}

function mapFinishReasonToMessageStatus(
  reason: string,
): "completed" | "incomplete" {
  return reason === "length" ? "incomplete" : "completed"
}

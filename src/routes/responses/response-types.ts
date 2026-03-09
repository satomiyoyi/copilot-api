// OpenAI Responses API Types

// --- Request Types ---

export interface ResponsesPayload {
  model: string
  input: string | Array<ResponseInputItem>
  instructions?: string
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  tools?: Array<ResponseTool>
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; name: string }
  stream?: boolean
  metadata?: Record<string, string>
  reasoning?: {
    effort?: "low" | "medium" | "high"
    summary?: "auto" | "concise" | "detailed"
  }
  // Ignored fields (stateless proxy)
  // previous_response_id, store, truncation
}

export type ResponseInputItem =
  | ResponseInputMessage
  | ResponseInputFunctionCall
  | ResponseInputFunctionCallOutput
  | ResponseInputItemReference

export interface ResponseInputMessage {
  type: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponseInputContentPart>
}

export interface ResponseInputFunctionCall {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

export interface ResponseInputFunctionCallOutput {
  type: "function_call_output"
  call_id: string
  output: string
}

export interface ResponseInputItemReference {
  type: "item_reference"
  id: string
}

export type ResponseInputContentPart =
  | ResponseInputTextPart
  | ResponseInputImagePart
  | ResponseOutputTextPart

export interface ResponseInputTextPart {
  type: "input_text"
  text: string
}

export interface ResponseInputImagePart {
  type: "input_image"
  image_url: string
  detail?: "low" | "high" | "auto"
}

export interface ResponseOutputTextPart {
  type: "output_text"
  text: string
}

export interface ResponseTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

// --- Response Types ---

export interface ResponsesAPIResponse {
  id: string
  object: "response"
  created_at: number
  status: "completed" | "incomplete" | "failed"
  model: string
  output: Array<ResponseOutputItem>
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  error?: {
    code: string
    message: string
  } | null
  metadata?: Record<string, string>
}

export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseOutputFunctionCall
  | ResponseOutputReasoningItem

export interface ResponseOutputMessage {
  type: "message"
  id: string
  status: "completed" | "incomplete"
  role: "assistant"
  content: Array<{ type: "output_text"; text: string }>
}

export interface ResponseOutputFunctionCall {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
  status: "completed"
}

export interface ResponseOutputReasoningItem {
  type: "reasoning"
  id: string
  summary: Array<{ type: "summary_text"; text: string }>
}

// --- Streaming Types ---

export interface ResponsesStreamState {
  responseId: string
  outputIndex: number
  currentMessageId: string
  contentIndex: number
  textAccumulator: string
  functionCallAccumulator: Record<
    number,
    { id: string; callId: string; name: string; arguments: string }
  >
  messageStarted: boolean
  model: string
}

export type ResponsesStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseCompletedEvent

export interface ResponseCreatedEvent {
  type: "response.created"
  response: ResponsesAPIResponse
}

export interface ResponseInProgressEvent {
  type: "response.in_progress"
  response: ResponsesAPIResponse
}

export interface ResponseOutputItemAddedEvent {
  type: "response.output_item.added"
  output_index: number
  item: ResponseOutputItem
}

export interface ResponseOutputItemDoneEvent {
  type: "response.output_item.done"
  output_index: number
  item: ResponseOutputItem
}

export interface ResponseContentPartAddedEvent {
  type: "response.content_part.added"
  item_id: string
  output_index: number
  content_index: number
  part: { type: "output_text"; text: string }
}

export interface ResponseContentPartDoneEvent {
  type: "response.content_part.done"
  item_id: string
  output_index: number
  content_index: number
  part: { type: "output_text"; text: string }
}

export interface ResponseOutputTextDeltaEvent {
  type: "response.output_text.delta"
  item_id: string
  output_index: number
  content_index: number
  delta: string
}

export interface ResponseOutputTextDoneEvent {
  type: "response.output_text.done"
  item_id: string
  output_index: number
  content_index: number
  text: string
}

export interface ResponseFunctionCallArgumentsDeltaEvent {
  type: "response.function_call_arguments.delta"
  item_id: string
  output_index: number
  delta: string
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: "response.function_call_arguments.done"
  item_id: string
  output_index: number
  arguments: string
}

export interface ResponseCompletedEvent {
  type: "response.completed"
  response: ResponsesAPIResponse
}

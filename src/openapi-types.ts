export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

export type OperationParameter = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description?: string;
  schema: JsonSchema;
};

export type OperationRequestBody = {
  required: boolean;
  contentType: string;
  schema: JsonSchema;
};

export type WeeekOperation = {
  name: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: readonly string[];
  parameters: readonly OperationParameter[];
  requestBody?: OperationRequestBody;
};

const FIELD_NAMES = [
  "name",
  "email",
  "password",
  "currentPassword",
  "newPassword",
  "phone",
  "preferredCurrency",
  "termsAccepted",
  "privacyPolicyAccepted",
] as const;

export type FormFieldName = (typeof FIELD_NAMES)[number];
export type FieldErrors = Partial<Record<FormFieldName, string[]>>;

export class ApiError extends Error {
  readonly fieldErrors: FieldErrors;

  constructor(
    message: string,
    readonly status: number,
    fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.fieldErrors = fieldErrors;
  }
}

export function parseApiPayload(text: string, status: number): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `The API returned an unexpected response (HTTP ${status}). Check that the backend URL is correct and the API is available.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fieldForMessage(message: string): FormFieldName | undefined {
  const normalized = message.toLowerCase();
  return FIELD_NAMES.find(
    (field) =>
      normalized.startsWith(`${field.toLowerCase()} `) ||
      normalized.includes(` ${field.toLowerCase()} `),
  );
}

export function apiErrorFromResponse(
  status: number,
  payload: unknown,
): ApiError {
  const payloadRecord = isRecord(payload) ? payload : undefined;
  const rawMessage = payloadRecord?.message;
  const messages =
    typeof rawMessage === "string"
      ? [rawMessage]
      : Array.isArray(rawMessage)
        ? rawMessage.filter((message): message is string => typeof message === "string")
        : [];
  const fieldErrors: FieldErrors = {};

  for (const message of messages) {
    const field = fieldForMessage(message);
    if (field) {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), message];
    }
  }

  const fallback =
    status >= 500
      ? "Something went wrong. Please try again."
      : "Please check your information and try again.";

  return new ApiError(messages[0] ?? fallback, status, fieldErrors);
}

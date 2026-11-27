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

function fieldForMessage(
  message: string,
  requestPath?: string,
): FormFieldName | undefined {
  const normalized = ` ${message
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")} `;
  const path = requestPath?.toLowerCase() ?? "";
  const aliases: Partial<Record<FormFieldName, string[]>> = {
    currentPassword: ["current password"],
    newPassword: ["new password"],
    preferredCurrency: ["preferred currency"],
    termsAccepted: ["terms accepted", "terms and conditions", "consent"],
    privacyPolicyAccepted: ["privacy policy accepted", "privacy policy"],
  };

  for (const field of ["currentPassword", "newPassword"] as const) {
    const fieldWords = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const terms = [fieldWords, ...(aliases[field] ?? [])];
    if (terms.some((term) => normalized.includes(` ${term} `))) return field;
  }

  if (/\bpassword\b/i.test(message)) {
    if (path.includes("/auth/change-password")) return "newPassword";
    if (path.includes("/auth/register")) return "password";
  }

  if (
    path.includes("/users/me") &&
    normalized.includes(" currency ")
  ) {
    return "preferredCurrency";
  }

  for (const field of FIELD_NAMES.filter(
    (candidate) => candidate !== "currentPassword" && candidate !== "newPassword",
  )) {
    const fieldWords = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const terms = [fieldWords, ...(aliases[field] ?? [])];
    if (terms.some((term) => normalized.includes(` ${term} `))) return field;
  }

  return undefined;
}

export function apiErrorFromResponse(
  status: number,
  payload: unknown,
  requestPath?: string,
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
    const field = fieldForMessage(message, requestPath);
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

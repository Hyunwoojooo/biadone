export type ShareUrlValidationResult = {
  valid: boolean;
  normalizedUrl?: string;
  shareId?: string;
  errorCode?:
    | "INVALID_URL"
    | "UNSUPPORTED_DOMAIN"
    | "UNSUPPORTED_PATH"
    | "MISSING_SHARE_ID";
};

export function validateShareUrl(input: string): ShareUrlValidationResult {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return { valid: false, errorCode: "INVALID_URL" };
  }

  if (url.protocol !== "https:") {
    return { valid: false, errorCode: "INVALID_URL" };
  }

  if (url.hostname !== "chatgpt.com") {
    return { valid: false, errorCode: "UNSUPPORTED_DOMAIN" };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "share") {
    return { valid: false, errorCode: "UNSUPPORTED_PATH" };
  }

  const shareId = parts[1];
  if (!shareId) {
    return { valid: false, errorCode: "MISSING_SHARE_ID" };
  }

  const normalizedUrl = `https://chatgpt.com/share/${encodeURIComponent(shareId)}`;
  return {
    valid: true,
    normalizedUrl,
    shareId
  };
}

const ACCESS_USERNAME = "blabase";

export function hasValidBasicAuthorization(
  authorization: string | null,
  expectedPassword: string
): boolean {
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;

    return (
      decoded.slice(0, separator) === ACCESS_USERNAME &&
      decoded.slice(separator + 1) === expectedPassword
    );
  } catch {
    return false;
  }
}

export const suggestionAccessUsername = ACCESS_USERNAME;

/** Continuity checks for Spring JwtService's USER/STAFF access token contract.
 * Spring still verifies signatures and validates the live device session. */
export class SessionIdentityError extends Error {
  constructor(public readonly reason: "MISSING_IDENTITY_CLAIM" | "IDENTITY_MISMATCH") {
    super(reason);
  }
}
export function sessionIdentity(raw: string): string {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(atob(raw.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { throw new SessionIdentityError("MISSING_IDENTITY_CLAIM"); }
  const fields = ["sid", "type", "accountId", "shopId", "sub", "shopCode"];
  if (fields.some(key => !["string", "number"].includes(typeof claims[key]) || !String(claims[key]).trim()) ||
      !["USER", "STAFF"].includes(String(claims.type)))
    throw new SessionIdentityError("MISSING_IDENTITY_CLAIM");
  return JSON.stringify(fields.map(key => String(claims[key])));
}
export function requireMatchingIdentity(previous: string, next: string) {
  if (sessionIdentity(previous) !== sessionIdentity(next))
    throw new SessionIdentityError("IDENTITY_MISMATCH");
}

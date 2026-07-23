/** Owner identity from env — never hardcode chat/user ids. */

export function getOwnerId(): number | null {
  const raw =
    typeof process !== "undefined" && process.env
      ? process.env.BOT_OWNER_ID ?? process.env.OWNER_ID
      : undefined;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isOwner(userId: number | undefined): boolean {
  if (userId === undefined) return false;
  const owner = getOwnerId();
  if (owner === null) {
    // No owner configured — treat nobody as owner (dashboard stays locked).
    // In harness/tests without env, allow user id 1 when NODE_ENV=test or
    // AGNTDEV_TEST is set so owner specs can run.
    if (
      typeof process !== "undefined" &&
      (process.env?.AGNTDEV_TEST === "1" || process.env?.NODE_ENV === "test")
    ) {
      return userId === 1;
    }
    return false;
  }
  return userId === owner;
}

export const scopes = {
  a: { sku: "demo-a", warehouse: "east" },
  b: { sku: "demo-b", warehouse: "east" },
  west: { sku: "demo-a", warehouse: "west" },
};
export const scenarios = [
  "late-success",
  "product-switch",
  "variable-switch",
  "aba",
  "cache-read",
];
export const modes = ["status-only", "guarded-write"];
export const querySource =
  "query Stock($sku: ID!, $warehouse: String!) { product(sku: $sku, warehouse: $warehouse) { sku warehouse quantity __typename } }";
export const key = (s) => JSON.stringify([s.sku, s.warehouse]);
export function createState(scope = scopes.a) {
  return {
    scope: { ...scope },
    epoch: 1,
    nextId: 0,
    attempt: { id: null, status: "idle" },
  };
}
export function enter(state, scope) {
  return {
    ...state,
    scope: { ...scope },
    epoch: state.epoch + 1,
    attempt: { id: null, status: "idle" },
  };
}
export function begin(state) {
  const token = {
    scope: { ...state.scope },
    epoch: state.epoch,
    id: state.nextId + 1,
  };
  return {
    state: {
      ...state,
      nextId: token.id,
      attempt: { id: token.id, status: "pending" },
    },
    token,
  };
}
export function accepts(state, token) {
  return (
    state.attempt.status === "pending" &&
    state.epoch === token.epoch &&
    state.attempt.id === token.id &&
    key(state.scope) === key(token.scope)
  );
}
export function settle(state, token, outcome, write) {
  if (!accepts(state, token))
    return {
      state,
      accepted: false,
      cacheWrite: false,
      outcome: outcome.status,
    };
  let status = outcome.status,
    message = outcome.message ?? null,
    cacheWrite = false;
  if (status === "succeeded" && write)
    try {
      write(outcome.data);
      cacheWrite = true;
    } catch (error) {
      status = "failed";
      message = "Cache write failed: " + error.message;
    }
  return {
    state: { ...state, attempt: { id: token.id, status, message } },
    accepted: true,
    cacheWrite,
    outcome: status,
  };
}
export function slotSpec(scenario, slot) {
  if (!scenarios.includes(scenario)) throw new Error("Unknown scenario");
  if (slot === "seed") return { scope: scopes.a, quantity: 3 };
  if (slot === "old" && scenario !== "cache-read")
    return { scope: scopes.a, quantity: 7 };
  if (slot === "new")
    return scenario === "late-success" || scenario === "cache-read"
      ? { scope: scopes.a, fail: true }
      : scenario === "product-switch"
        ? { scope: scopes.b, quantity: 12 }
        : scenario === "variable-switch"
          ? { scope: scopes.west, quantity: 12 }
          : { scope: scopes.a, quantity: 9 };
  throw new Error("Unknown slot");
}

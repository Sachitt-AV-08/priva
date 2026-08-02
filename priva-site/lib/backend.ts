"use client";

import { useSyncExternalStore } from "react";
import { apiFetch as rawApiFetch } from "./constants";

type BackendSnapshot = {
  reconnecting: boolean;
  failures: number;
};

let snapshot: BackendSnapshot = { reconnecting: false, failures: 0 };
const serverSnapshot: BackendSnapshot = { reconnecting: false, failures: 0 };
const listeners = new Set<() => void>();

function publish(next: BackendSnapshot) {
  if (
    next.reconnecting === snapshot.reconnecting &&
    next.failures === snapshot.failures
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function markFailure() {
  publish({ reconnecting: true, failures: snapshot.failures + 1 });
}

function markSuccess() {
  if (snapshot.reconnecting || snapshot.failures) {
    publish({ reconnecting: false, failures: 0 });
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await rawApiFetch(path, init);
    if (response.status >= 500) markFailure();
    else markSuccess();
    return response;
  } catch (error) {
    markFailure();
    throw error;
  }
}

export function useBackendStatus(): BackendSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => serverSnapshot
  );
}

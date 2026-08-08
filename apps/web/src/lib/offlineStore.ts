export const OFFLINE_DB_NAME = "party-check-in-offline";
let storageEpoch = 0;

export function getOfflineStorageEpoch(): number {
  return storageEpoch;
}

export type OfflineTicket = {
  ticketId: number;
  token: string;
  guestName: string;
  ticketType: string;
  voidedAt: string | null;
  checkedInAt: string | null;
  provisionalOperationId?: string;
};

export type PendingOperation = {
  clientOperationId: string;
  token: string;
  checkedInAt: string;
};

export type OfflineConflict = PendingOperation & {
  outcome: "CONFLICT" | "INVALID" | "VOIDED";
  guestName?: string;
  serverCheckedInAt?: string;
  recordedAt: string;
};

export type OfflineSummary = {
  cachedTicketCount: number;
  pendingCount: number;
  conflictCount: number;
  lastSyncAt: string | null;
};

const OFFLINE_GRANT_META_KEY = "offlineGrant";
const OFFLINE_MODE_META_KEY = "offlineModeEnabled";

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
});

export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("tickets", { keyPath: "token" });
      db.createObjectStore("pending", { keyPath: "clientOperationId" });
      db.createObjectStore("conflicts", { keyPath: "clientOperationId" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function replaceOfflineSnapshot(
  tickets: OfflineTicket[],
  generatedAt: string,
  expectedEpoch = storageEpoch,
): Promise<void> {
  if (expectedEpoch !== storageEpoch) return;
  const db = await openOfflineDatabase();
  const read = db.transaction(["pending"], "readonly");
  const pending = await requestResult(read.objectStore("pending").getAll()) as PendingOperation[];
  await transactionDone(read);
  const pendingByToken = new Map(pending.map((operation) => [operation.token, operation]));
  if (expectedEpoch !== storageEpoch) {
    db.close();
    return;
  }
  const write = db.transaction(["tickets", "meta"], "readwrite");
  const ticketStore = write.objectStore("tickets");
  ticketStore.clear();
  for (const ticket of tickets) {
    const provisional = pendingByToken.get(ticket.token);
    ticketStore.put(provisional ? {
      ...ticket,
      checkedInAt: ticket.checkedInAt ?? provisional.checkedInAt,
      provisionalOperationId: provisional.clientOperationId,
    } : ticket);
  }
  write.objectStore("meta").put({ key: "lastSyncAt", value: generatedAt });
  await transactionDone(write);
  db.close();
}

function createOperationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `offline_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type OfflineCheckinResult =
  | { state: "VALID"; ticket: OfflineTicket; operation: PendingOperation }
  | { state: "ALREADY_USED"; ticket: OfflineTicket }
  | { state: "INVALID" }
  | { state: "VOIDED"; ticket: OfflineTicket };

export async function checkInOffline(token: string, now = new Date().toISOString()): Promise<OfflineCheckinResult> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction(["tickets", "pending"], "readwrite");
  const ticketStore = transaction.objectStore("tickets");
  const ticket = await requestResult(ticketStore.get(token)) as OfflineTicket | undefined;
  if (!ticket) {
    transaction.abort();
    db.close();
    return { state: "INVALID" };
  }
  if (ticket.voidedAt) {
    transaction.abort();
    db.close();
    return { state: "VOIDED", ticket };
  }
  if (ticket.checkedInAt) {
    transaction.abort();
    db.close();
    return { state: "ALREADY_USED", ticket };
  }
  const operation: PendingOperation = {
    clientOperationId: createOperationId(),
    token,
    checkedInAt: now,
  };
  const updated = { ...ticket, checkedInAt: now, provisionalOperationId: operation.clientOperationId };
  ticketStore.put(updated);
  transaction.objectStore("pending").put(operation);
  await transactionDone(transaction);
  db.close();
  return { state: "VALID", ticket: updated, operation };
}

export async function getPendingOperations(): Promise<PendingOperation[]> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("pending", "readonly");
  const operations = await requestResult(transaction.objectStore("pending").getAll()) as PendingOperation[];
  await transactionDone(transaction);
  db.close();
  return operations;
}

export async function acknowledgeOperations(
  results: Array<{
    clientOperationId: string;
    acknowledged: boolean;
    outcome: "APPLIED" | "IDEMPOTENT_REPLAY" | "CONFLICT" | "INVALID" | "VOIDED";
    guestName?: string;
    checkedInAt?: string;
  }>,
  expectedEpoch = storageEpoch,
): Promise<void> {
  if (expectedEpoch !== storageEpoch) return;
  const db = await openOfflineDatabase();
  const transaction = db.transaction(["pending", "conflicts"], "readwrite");
  const pendingStore = transaction.objectStore("pending");
  const conflictStore = transaction.objectStore("conflicts");
  for (const result of results) {
    if (!result.acknowledged) continue;
    const operation = await requestResult(pendingStore.get(result.clientOperationId)) as PendingOperation | undefined;
    if (!operation) continue;
    if (result.outcome === "CONFLICT" || result.outcome === "INVALID" || result.outcome === "VOIDED") {
      conflictStore.put({
        ...operation,
        outcome: result.outcome,
        guestName: result.guestName,
        serverCheckedInAt: result.checkedInAt,
        recordedAt: new Date().toISOString(),
      } satisfies OfflineConflict);
    }
    pendingStore.delete(result.clientOperationId);
  }
  await transactionDone(transaction);
  db.close();
}

export async function getOfflineSummary(): Promise<OfflineSummary> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction(["tickets", "pending", "conflicts", "meta"], "readonly");
  const [cachedTicketCount, pendingCount, conflictCount, meta] = await Promise.all([
    requestResult(transaction.objectStore("tickets").count()),
    requestResult(transaction.objectStore("pending").count()),
    requestResult(transaction.objectStore("conflicts").count()),
    requestResult(transaction.objectStore("meta").get("lastSyncAt")) as Promise<{ value: string } | undefined>,
  ]);
  await transactionDone(transaction);
  db.close();
  return { cachedTicketCount, pendingCount, conflictCount, lastSyncAt: meta?.value ?? null };
}

export async function storeOfflineGrant(grant: string): Promise<void> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readwrite");
  transaction.objectStore("meta").put({ key: OFFLINE_GRANT_META_KEY, value: grant });
  await transactionDone(transaction);
  db.close();
}

export async function getStoredOfflineGrant(): Promise<string | null> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readonly");
  const record = await requestResult(transaction.objectStore("meta").get(OFFLINE_GRANT_META_KEY)) as { value?: unknown } | undefined;
  await transactionDone(transaction);
  db.close();
  return typeof record?.value === "string" ? record.value : null;
}

export async function removeStoredOfflineGrant(): Promise<void> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readwrite");
  transaction.objectStore("meta").delete(OFFLINE_GRANT_META_KEY);
  await transactionDone(transaction);
  db.close();
}

export async function setOfflineModeEnabled(enabled: boolean): Promise<void> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readwrite");
  const store = transaction.objectStore("meta");
  if (enabled) store.put({ key: OFFLINE_MODE_META_KEY, value: true });
  else store.delete(OFFLINE_MODE_META_KEY);
  await transactionDone(transaction);
  db.close();
}

export async function isOfflineModeEnabled(): Promise<boolean> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readonly");
  const record = await requestResult(transaction.objectStore("meta").get(OFFLINE_MODE_META_KEY)) as { value?: unknown } | undefined;
  await transactionDone(transaction);
  db.close();
  return record?.value === true;
}

export async function removeOfflineAuthorization(): Promise<void> {
  const db = await openOfflineDatabase();
  const transaction = db.transaction("meta", "readwrite");
  const store = transaction.objectStore("meta");
  store.delete(OFFLINE_GRANT_META_KEY);
  store.delete(OFFLINE_MODE_META_KEY);
  await transactionDone(transaction);
  db.close();
}

export async function clearOfflineDatabase(): Promise<void> {
  storageEpoch += 1;
  const db = await openOfflineDatabase();
  const transaction = db.transaction(["tickets", "pending", "conflicts", "meta"], "readwrite");
  transaction.objectStore("tickets").clear();
  transaction.objectStore("pending").clear();
  transaction.objectStore("conflicts").clear();
  transaction.objectStore("meta").clear();
  await transactionDone(transaction);
  db.close();
}

export async function deleteOfflineDatabaseForTests(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline database deletion blocked"));
  });
}

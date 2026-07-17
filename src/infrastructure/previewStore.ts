import { openDB } from "idb";

const DB_NAME = "comment-field-preview-cache";
const STORE_NAME = "active-preview";
const RECORD_KEY = "active";

export interface StoredPreviewCache {
  key: string;
  frames: Array<Blob | null>;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  memoryBytes: number;
  readyFrames: number;
  draftReady: boolean;
  updatedAt: number;
}

function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) { if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME); },
  });
}

export async function loadStoredPreviewCache(key: string) {
  const db = await database();
  const record = await db.get(STORE_NAME, RECORD_KEY) as StoredPreviewCache | undefined;
  db.close();
  return record?.key === key ? record : null;
}

export async function saveStoredPreviewCache(record: Omit<StoredPreviewCache, "updatedAt">) {
  const db = await database();
  await db.put(STORE_NAME, { ...record, updatedAt: Date.now() }, RECORD_KEY);
  db.close();
}

export async function pruneStoredPreviewCache(activeKey?: string) {
  const db = await database();
  const record = await db.get(STORE_NAME, RECORD_KEY) as StoredPreviewCache | undefined;
  if (!activeKey || (record && record.key !== activeKey)) await db.delete(STORE_NAME, RECORD_KEY);
  db.close();
}

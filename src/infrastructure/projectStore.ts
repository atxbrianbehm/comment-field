import { openDB } from "idb";
import { migrateProject, type Project } from "@comment-field/engine";

const DB_NAME = "comment-field";
const STORE_NAME = "projects";
const ACTIVE_KEY = "active-project";

async function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    },
  });
}

export async function saveAutosave(project: Project) {
  const db = await database();
  await db.put(STORE_NAME, project, ACTIVE_KEY);
}

export async function loadAutosave(): Promise<Project | undefined> {
  const db = await database();
  const saved = await db.get(STORE_NAME, ACTIVE_KEY) as Project | undefined;
  return saved ? migrateProject(saved) : undefined;
}

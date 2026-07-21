import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { Project } from "@comment-field/engine";

const MAX_HISTORY = 60;

function cloneProject(value: Project): Project {
  try {
    return structuredClone(value);
  } catch {
    // Fall back when structuredClone fails (rare host quirks / oversized payloads).
    return JSON.parse(JSON.stringify(value)) as Project;
  }
}

export function useProjectHistory(initial: Project) {
  const [project, setProjectState] = useState(initial);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  const pastRef = useRef<Project[]>([]);
  const futureRef = useRef<Project[]>([]);
  /** When true, successive edits share one undo step (card drag, slider scrub). */
  const coalescingRef = useRef(false);
  /** Snapshot from just before the first edit in a coalesce window. */
  const coalesceBaseRef = useRef<Project | null>(null);

  const bump = useCallback(() => setHistoryEpoch((value) => value + 1), []);

  const clearHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    coalescingRef.current = false;
    coalesceBaseRef.current = null;
    bump();
  }, [bump]);

  const beginCoalescing = useCallback(() => {
    coalescingRef.current = true;
    coalesceBaseRef.current = null;
  }, []);

  const endCoalescing = useCallback(() => {
    if (coalescingRef.current && coalesceBaseRef.current) {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), coalesceBaseRef.current];
      futureRef.current = [];
      bump();
    }
    coalescingRef.current = false;
    coalesceBaseRef.current = null;
  }, [bump]);

  const setProject = useCallback((action: SetStateAction<Project>, options?: { recordHistory?: boolean }) => {
    const recordHistory = options?.recordHistory !== false;
    let recorded = false;
    setProjectState((current) => {
      let next: Project;
      try {
        next = typeof action === "function" ? (action as (value: Project) => Project)(current) : action;
      } catch (error) {
        console.error("Project update failed", error);
        return current;
      }
      if (next === current) return current;
      if (recordHistory) {
        if (coalescingRef.current) {
          if (!coalesceBaseRef.current) {
            try {
              coalesceBaseRef.current = cloneProject(current);
            } catch (error) {
              console.error("History snapshot failed", error);
            }
          }
        } else {
          try {
            pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cloneProject(current)];
            futureRef.current = [];
            recorded = true;
          } catch (error) {
            console.error("History snapshot failed", error);
          }
        }
      }
      return next;
    });
    if (recorded) queuePromise.then(bump);
  }, [bump]);

  const mutateProject = useCallback((updater: (draft: Project) => void, options?: { recordHistory?: boolean }) => {
    setProject((current) => {
      const next = cloneProject(current);
      updater(next);
      next.updatedAt = new Date().toISOString();
      return next;
    }, options);
  }, [setProject]);

  const undo = useCallback(() => {
    endCoalescing();
    if (!pastRef.current.length) return false;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    try {
      futureRef.current = [cloneProject(projectRef.current), ...futureRef.current].slice(0, MAX_HISTORY);
    } catch {
      futureRef.current = [projectRef.current, ...futureRef.current].slice(0, MAX_HISTORY);
    }
    setProjectState(previous);
    projectRef.current = previous;
    bump();
    return true;
  }, [bump, endCoalescing]);

  const redo = useCallback(() => {
    endCoalescing();
    if (!futureRef.current.length) return false;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    try {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cloneProject(projectRef.current)];
    } catch {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), projectRef.current];
    }
    setProjectState(next);
    projectRef.current = next;
    bump();
    return true;
  }, [bump, endCoalescing]);

  const replaceProject = useCallback((next: Project) => {
    setProjectState(next);
    projectRef.current = next;
    clearHistory();
  }, [clearHistory]);

  return {
    project,
    setProject,
    mutateProject,
    replaceProject,
    undo,
    redo,
    beginCoalescing,
    endCoalescing,
    clearHistory,
    canUndo: pastRef.current.length > 0 || Boolean(coalesceBaseRef.current),
    canRedo: futureRef.current.length > 0,
    historyEpoch,
  };
}

const voidPromise = Promise.resolve();

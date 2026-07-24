import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  clearHeroPerformance, deserializeProject, fitFieldBoundsToComments, generateReflowTargets, heroEndTime,
  heroStartTime, parseCommentJson, parsePlainText, regenerateComposition, resolveBuildTriggers,
  resolveGestureTriggers, serializeProject, settleCameraOnHero, type Composition, type GestureSample,
  type HeroPerformance, type Project, type Take,
} from "@comment-field/engine";
import type { CommentSceneHandle, InteractionMode, TransformPatch } from "../renderer/CommentScene";

type Workspace = "field" | "design" | "animate";
type AnimateTab = "entrance" | "exit" | "camera" | "hero";
type FieldView = "camera" | "overview";
type RightTab = "layout" | "build" | "hero";

interface AuthoringActionsInput {
  project: Project;
  composition: Composition;
  take: Take;
  takes: Take[];
  duration: number;
  time: number;
  commentSource: string;
  selectedPlacement: Composition["cards"][number] | null;
  selectedComment: Project["comments"][number] | null;
  exportScale: number;
  exportProgress: { frame: number; total: number } | null;
  sceneRef: RefObject<CommentSceneHandle | null>;
  mutateProject: (updater: (draft: Project) => void) => void;
  mutateComposition: (updater: (draft: Composition) => void) => void;
  mutateTake: (updater: (draft: Take) => void) => void;
  pausePlayback: () => void;
  setPlayhead: (value: number) => void;
  setProject: (value: SetStateAction<Project>, options?: { recordHistory?: boolean }) => void;
  /** Full replace without undo (load project). Falls back to setProject without history when omitted. */
  replaceProject?: (project: Project) => void;
  setActiveCompositionId: Dispatch<SetStateAction<string>>;
  setActiveTakeId: Dispatch<SetStateAction<string>>;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedCardIds?: Dispatch<SetStateAction<string[]>>;
  setCommentSource: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setExportProgress: Dispatch<SetStateAction<{ frame: number; total: number } | null>>;
  setFieldView: Dispatch<SetStateAction<FieldView>>;
  setMode: Dispatch<SetStateAction<InteractionMode>>;
  setRightTab: Dispatch<SetStateAction<RightTab>>;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  setAnimateTab: Dispatch<SetStateAction<AnimateTab>>;
}

const clone = <T,>(value: T): T => structuredClone(value);
const makeId = (prefix: string) => prefix + "-" + crypto.randomUUID();

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useAuthoringActions(input: AuthoringActionsInput) {
  const {
    project, composition, take, takes, duration, time, commentSource, selectedPlacement, selectedComment,
    exportScale, exportProgress, sceneRef, mutateProject, mutateComposition, mutateTake, pausePlayback,
    setPlayhead, setProject, replaceProject, setActiveCompositionId, setActiveTakeId, setSelectedCardId, setSelectedCardIds, setCommentSource, setNotice,
    setExportProgress, setFieldView, setMode, setRightTab, setWorkspace, setAnimateTab,
  } = input;
  function importComments() {
    try {
      const trimmed = commentSource.trim();
      if (!trimmed) { setNotice("Paste comments first"); return; }
      // Prefer plain text unless the payload is clearly a JSON array.
      const result = trimmed.startsWith("[") && trimmed.endsWith("]")
        ? parseCommentJson(commentSource)
        : parsePlainText(commentSource);
      if (!result.records.length) {
        setNotice(result.errors[0] ? `Import failed: ${result.errors[0].reason}` : "No valid comments found");
        return;
      }
      const ids = result.records.map((record) => record.id);
      mutateProject((draft) => {
        draft.comments = result.records;
        draft.compositions = draft.compositions.map((item) => regenerateComposition(item, ids));
        for (const draftTake of draft.takes) {
          const parent = draft.compositions.find((item) => item.id === draftTake.compositionId);
          if (!parent) continue;
          draftTake.gestureSamples = [];
          draftTake.cardTriggers = resolveBuildTriggers(parent.cards, draftTake.build);
          if (draftTake.hero && !result.records.some((record) => record.id === draftTake.hero?.cardId)) draftTake.hero = null;
          draftTake.reflowTargets = {};
        }
      });
      setSelectedCardId(null);
      setSelectedCardIds?.([]);
      setPlayhead(duration);
      setNotice(`Loaded ${result.records.length} comments${result.errors.length ? ` · ${result.errors.length} lines skipped` : ""}`);
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? `Apply failed: ${error.message}` : "Apply failed");
    }
  }

  async function loadCommentFile(file: File) {
    setCommentSource(await file.text());
    setNotice(`Previewing ${file.name}`);
  }

  function scatter() {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === composition.id)!;
      Object.assign(target, regenerateComposition(target, draft.comments.map((comment) => comment.id)));
      for (const draftTake of draft.takes.filter((item) => item.compositionId === target.id)) draftTake.reflowTargets = {};
    });
    setPlayhead(duration);
    setNotice(`Scattered with “${composition.seed}”`);
  }

  function updateBuild<K extends keyof Take["build"]>(key: K, value: Take["build"][K]) {
    mutateTake((draft) => {
      draft.build[key] = value;
      draft.cardTriggers = resolveBuildTriggers(composition.cards, draft.build);
      draft.gestureSamples = [];
    });
  }

  function randomizeBuild() {
    mutateTake((draft) => {
      draft.build.seed = makeId("build");
      draft.cardTriggers = resolveBuildTriggers(composition.cards, draft.build);
      draft.gestureSamples = [];
    });
    setPlayhead(duration);
    setNotice("Randomized and baked trigger times");
  }

  function completeGesture(samples: GestureSample[]) {
    const triggers = resolveGestureTriggers(samples, composition.cards, 0.16, composition, take);
    mutateTake((draft) => { draft.gestureSamples = samples; draft.cardTriggers = triggers; });
    setMode("select");
    setPlayhead(duration);
    setNotice(`Baked ${triggers.length} gesture triggers`);
  }

  function transformCard(cardId: string, patch: TransformPatch, editReflow: boolean) {
    transformCards([{ cardId, patch }], editReflow);
  }

  function transformCards(moves: Array<{ cardId: string; patch: TransformPatch }>, editReflow: boolean) {
    if (!moves.length) return;
    if (editReflow && take.hero) {
      setProject((current) => {
        const target = current.takes.find((item) => item.id === take.id);
        if (!target) return current;
        let reflowTargets = { ...target.reflowTargets };
        let changed = false;
        for (const move of moves) {
          if (move.cardId === take.hero?.cardId) continue;
          const existing = reflowTargets[move.cardId];
          if (!existing) continue;
          reflowTargets = { ...reflowTargets, [move.cardId]: { ...existing, ...move.patch } };
          changed = true;
        }
        if (!changed) return current;
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          takes: current.takes.map((item) => item.id === target.id ? { ...item, reflowTargets } : item),
        };
      });
      return;
    }
    setProject((current) => {
      const target = current.compositions.find((item) => item.id === composition.id);
      if (!target) return current;
      const patchById = new Map(moves.map((move) => [move.cardId, move.patch]));
      let changed = false;
      const cards = target.cards.map((card) => {
        const patch = patchById.get(card.cardId);
        if (!patch || card.locked) return card;
        changed = true;
        return { ...card, ...patch };
      });
      if (!changed) return current;
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        compositions: current.compositions.map((item) => item.id === target.id ? { ...item, cards } : item),
      };
    });
  }

  function switchComposition(id: string) {
    pausePlayback();
    const firstTake = project.takes.find((item) => item.compositionId === id);
    setActiveCompositionId(id);
    if (firstTake) setActiveTakeId(firstTake.id);
    setSelectedCardId(null);
    setPlayhead(firstTake?.duration ?? 8);
    // Multi-select is owned by App; clearing primary is enough for single-card consumers.
  }

  function addProtectedRegion() {
    mutateComposition((draft) => draft.protectedRegions.push({ id: makeId("region"), name: `Protected ${draft.protectedRegions.length + 1}`, x: 0.38, y: 0.36, width: 0.24, height: 0.28 }));
    setNotice("Added central protected region");
  }

  function setHero() {
    if (!selectedPlacement || !selectedComment?.heroEligible) return;
    const startTime = Math.min(4, duration * 0.55);
    const path = { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.08 } };
    const easing = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
    const hero: HeroPerformance = {
      cardId: selectedPlacement.cardId,
      keyframes: [
        { id: makeId("hero-source"), time: startTime, value: { kind: "source" }, interpolation: "bezier", easing, holdDuration: 0, path },
        { id: makeId("hero-pose"), time: startTime + 1.2, value: { kind: "pose", transform: { x: 0.5, y: 0.5, z: 1.4, scale: 1.7, rotation: 0 }, targetSpace: "screen", surroundingDim: 0.4, surroundingBlur: 2.5 }, interpolation: "bezier", easing, holdDuration: 0, path },
      ],
      reflowRadius: 0.34,
      attraction: 0.48,
      falloff: 1.4,
      maxDisplacement: 0.12,
      overlapPasses: 4,
      reflowDuration: 1.1,
      easing: "ease-out",
      reflowEasing: "ease-out",
    };
    mutateTake((draft) => {
      draft.hero = hero;
      draft.population.postHeroBurstStartTime = startTime + 1.2;
      draft.reflowTargets = {};
    });
    setRightTab("hero");
    setWorkspace("animate");
    setAnimateTab("hero");
    setNotice(`${selectedComment.username} is the hero`);
  }

  function removeHero() {
    mutateProject((draft) => {
      const index = draft.takes.findIndex((item) => item.id === take.id);
      if (index >= 0) draft.takes[index] = clearHeroPerformance(draft.takes[index]);
    });
    setMode("select");
    setAnimateTab("entrance");
    setNotice("Hero removed; ordinary entrance restored");
  }

  function bakeReflow() {
    if (!take.hero) return;
    const targets = generateReflowTargets(composition, take.hero);
    mutateTake((draft) => { draft.reflowTargets = targets; });
    setWorkspace("field");
    setMode("reflow");
    setPlayhead(Math.min(duration, heroStartTime(take.hero) + Math.max(heroEndTime(take.hero) - heroStartTime(take.hero), take.hero.reflowDuration)));
    setNotice(`Baked ${Object.keys(targets).length} editable reflow targets`);
  }

  function createTake(duplicate: boolean) {
    const siblingCount = takes.length + 1;
    const source = duplicate && take ? clone(take) : clone(takes[0]);
    source.id = makeId("take");
    source.name = `Take ${String(siblingCount).padStart(2, "0")}`;
    source.favorite = false;
    if (!duplicate) {
      source.duration = 8;
      source.build.seed = `${composition.seed}-build-${siblingCount}`;
      source.population.seed = `${composition.seed}-population-${siblingCount}`;
      source.gestureSamples = [];
      source.cardTriggers = resolveBuildTriggers(composition.cards, source.build);
      source.entranceOverride = undefined;
      source.hero = null;
      source.reflowTargets = {};
      source.cameraKeyframes = [];
      source.notes = "";
    }
    mutateProject((draft) => draft.takes.push(source));
    setActiveTakeId(source.id);
    setPlayhead(source.duration);
    setNotice(duplicate ? "Duplicated take" : "Created take");
  }

  function fitFieldToComments() {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === composition.id)!;
      target.fieldBounds = fitFieldBoundsToComments(draft.comments.length, target.width / target.height);
      Object.assign(target, regenerateComposition(target, draft.comments.map((comment) => comment.id)));
      for (const draftTake of draft.takes.filter((item) => item.compositionId === target.id)) draftTake.reflowTargets = {};
    });
    setFieldView("overview");
    requestAnimationFrame(() => sceneRef.current?.fitField());
    setNotice("Fit the field to the current comment count");
  }

  function alignCameraToHero() {
    if (!take.hero) return;
    const endTime = Math.min(duration, heroEndTime(take.hero));
    const cameraKeyframes = settleCameraOnHero(composition, take);
    mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; });
    setWorkspace("animate");
    setAnimateTab("camera");
    setPlayhead(endTime);
    setNotice("Camera settle aligned to the hero transition");
  }

  function deleteTake() {
    if (takes.length <= 1) { setNotice("Each composition needs one take"); return; }
    const next = takes.find((item) => item.id !== take.id)!;
    mutateProject((draft) => { draft.takes = draft.takes.filter((item) => item.id !== take.id); });
    setActiveTakeId(next.id);
  }

  function saveJson() {
    downloadBlob(new Blob([serializeProject(project)], { type: "application/json" }), `${project.id}.comment-field.json`);
    setNotice("Downloaded project JSON");
  }

  async function loadJson(file: File) {
    try {
      const loaded = deserializeProject(await file.text());
      if (replaceProject) replaceProject(loaded);
      else setProject(loaded, { recordHistory: false });
      setActiveCompositionId(loaded.compositions[0].id);
      setActiveTakeId(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.id ?? loaded.takes[0].id);
      setSelectedCardId(null);
      setPlayhead(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.duration ?? 8);
      setWorkspace("field");
      setNotice("Project loaded");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load project"); }
  }

  function loadBackground(file: File) {
    const mediaType = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4") ? "video" : "image";
    if (mediaType === "image" && !file.type.startsWith("image/")) {
      setNotice("Choose an image or MP4 background plate");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      mutateComposition((draft) => {
        const previous = draft.backgroundPlate;
        draft.backgroundPlate = {
          source: String(reader.result),
          name: file.name,
          mediaType,
          visible: true,
          opacity: previous?.opacity ?? 1,
          fit: previous?.fit ?? "cover",
          includeInExport: previous?.includeInExport ?? false,
        };
      });
      setNotice(`Loaded ${mediaType === "video" ? "MP4" : "image"} plate · ${file.name}`);
    };
    reader.onerror = () => setNotice("Could not load background plate");
    reader.readAsDataURL(file);
  }

  function slugPart(value: string) {
    return value.replace(/\W+/g, "-").toLowerCase().replace(/^-|-$/g, "") || "clip";
  }

  async function exportFrames() {
    if (!sceneRef.current || exportProgress) { setNotice("Return to Field or Hero view before exporting"); return; }
    const width = Math.round(composition.width * exportScale);
    const height = Math.round(composition.height * exportScale);
    const transparent = Boolean(project.renderSettings.transparentExport);
    const prefix = `${slugPart(composition.name)}-${slugPart(take.name)}${transparent ? "-alpha" : ""}`;
    try {
      pausePlayback();
      setExportProgress({ frame: 0, total: Math.round(duration * composition.frameRate) });
      sceneRef.current.beginExport(width, height);
      const { exportPngSequence } = await import("../export/pngSequence");
      const blob = await exportPngSequence(
        (time, frameWidth, frameHeight) => sceneRef.current!.renderFrame(time, frameWidth, frameHeight, { transparent }),
        {
          width,
          height,
          frameRate: composition.frameRate,
          duration,
          prefix,
        },
        (progress) => {
          if (progress.frame === progress.total || progress.frame % 5 === 0) setExportProgress(progress);
        },
      );
      downloadBlob(blob, `${project.id}-${composition.id}-${take.id}${transparent ? "-alpha" : ""}-png.zip`);
      setNotice(transparent ? "Transparent PNG sequence exported" : "PNG sequence exported");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Export failed"); }
    finally { sceneRef.current?.endExport(); setExportProgress(null); }
  }

  /** Flat PNG of the assigned hero card (or selected hero-eligible post). */
  async function exportHeroStill() {
    const comment = take.hero
      ? project.comments.find((item) => item.id === take.hero?.cardId) ?? null
      : selectedComment?.heroEligible ? selectedComment : null;
    if (!comment) { setNotice("Assign a hero (or select a hero-eligible post) first"); return; }
    try {
      const { renderCardCanvas } = await import("@comment-field/webgpu-runtime");
      const canvas = renderCardCanvas(comment, project.cardStyle, 2);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Card PNG failed"))), "image/png");
      });
      downloadBlob(blob, `hero-${slugPart(comment.handle || comment.username || comment.id)}.png`);
      setNotice(`Exported hero still · ${comment.handle || comment.username}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Hero still export failed");
    }
  }

  async function verifyDeterministicFrame() {
    if (!sceneRef.current) { setNotice("Return to Field or Hero view to verify"); return; }
    try {
      setNotice("Checking frame determinism…");
      const width = Math.max(64, Math.round(composition.width * exportScale));
      const height = Math.max(64, Math.round(composition.height * exportScale));
      sceneRef.current.beginExport(width, height);
      const first = await sceneRef.current.renderFrame(time, width, height);
      const second = await sceneRef.current.renderFrame(time, width, height);
      const [firstHash, secondHash] = await Promise.all([
        crypto.subtle.digest("SHA-256", await first.arrayBuffer()),
        crypto.subtle.digest("SHA-256", await second.arrayBuffer()),
      ]);
      const encode = (value: ArrayBuffer) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const hashA = encode(firstHash);
      const hashB = encode(secondHash);
      setNotice(hashA === hashB ? `Deterministic frame ${hashA.slice(0, 8)}` : "Frame mismatch detected");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Determinism check failed"); }
    finally { sceneRef.current?.endExport(); }
  }
  return {
    importComments, loadCommentFile, scatter, updateBuild, randomizeBuild, completeGesture, transformCard, transformCards,
    switchComposition, addProtectedRegion, setHero, removeHero, bakeReflow, createTake, fitFieldToComments,
    alignCameraToHero, deleteTake, saveJson, loadJson, loadBackground, exportFrames, exportHeroStill,
    verifyDeterministicFrame,
  };
}

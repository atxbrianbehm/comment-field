import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  clearHeroPerformance, deserializeProject, fitFieldBoundsToComments, generateReflowTargets, heroEndTime,
  heroStartTime, parseCommentJson, parsePlainText, regenerateComposition, resolveBuildTriggers,
  resolveGestureTriggers, serializeProject, settleCameraOnHero, type Composition, type GestureSample,
  type HeroPerformance, type Project, type Take,
} from "@comment-field/engine";
import { exportPngSequence } from "../export/pngSequence";
import type { CommentSceneHandle, InteractionMode, TransformPatch } from "../renderer/CommentScene";

type Workspace = "field" | "design" | "animate";
type AnimateTab = "entrance" | "camera" | "hero";
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
  setProject: Dispatch<SetStateAction<Project>>;
  setActiveCompositionId: Dispatch<SetStateAction<string>>;
  setActiveTakeId: Dispatch<SetStateAction<string>>;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
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
    setPlayhead, setProject, setActiveCompositionId, setActiveTakeId, setSelectedCardId, setCommentSource, setNotice,
    setExportProgress, setFieldView, setMode, setRightTab, setWorkspace, setAnimateTab,
  } = input;
  function importComments() {
    const result = commentSource.trim().startsWith("[") ? parseCommentJson(commentSource) : parsePlainText(commentSource);
    if (!result.records.length) { setNotice("No valid comments found"); return; }
    mutateProject((draft) => {
      draft.comments = result.records;
      draft.compositions = draft.compositions.map((item) => regenerateComposition(item, result.records.map((record) => record.id)));
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
    setPlayhead(duration);
    setNotice(`Loaded ${result.records.length} comments`);
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
    if (editReflow && take.hero) {
      if (cardId === take.hero.cardId) return;
      setProject((current) => {
        const target = current.takes.find((item) => item.id === take.id);
        const existing = target?.reflowTargets[cardId];
        if (!target || !existing) return current;
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          takes: current.takes.map((item) => item.id === target.id ? {
            ...item,
            reflowTargets: { ...item.reflowTargets, [cardId]: { ...existing, ...patch } },
          } : item),
        };
      });
      return;
    }
    setProject((current) => {
      const target = current.compositions.find((item) => item.id === composition.id);
      const card = target?.cards.find((item) => item.cardId === cardId);
      if (!target || !card || card.locked) return current;
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        compositions: current.compositions.map((item) => item.id === target.id ? {
          ...item,
          cards: item.cards.map((itemCard) => itemCard.cardId === cardId ? { ...itemCard, ...patch } : itemCard),
        } : item),
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
    mutateTake((draft) => { draft.hero = hero; draft.reflowTargets = {}; });
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
      setProject(loaded);
      setActiveCompositionId(loaded.compositions[0].id);
      setActiveTakeId(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.id ?? loaded.takes[0].id);
      setSelectedCardId(null);
      setPlayhead(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.duration ?? 8);
      setWorkspace("field");
      setNotice("Project loaded");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load project"); }
  }

  function loadBackground(file: File) {
    const reader = new FileReader();
    reader.onload = () => mutateComposition((draft) => { draft.backgroundImage = String(reader.result); });
    reader.readAsDataURL(file);
  }

  async function exportFrames() {
    if (!sceneRef.current || exportProgress) { setNotice("Return to Field or Hero view before exporting"); return; }
    const width = Math.round(composition.width * exportScale);
    const height = Math.round(composition.height * exportScale);
    try {
      pausePlayback();
      setExportProgress({ frame: 0, total: Math.round(duration * composition.frameRate) });
      sceneRef.current.beginExport(width, height);
      const blob = await exportPngSequence(sceneRef.current.renderFrame, {
        width,
        height,
        frameRate: composition.frameRate,
        duration,
        prefix: `${composition.name.replace(/\W+/g, "-").toLowerCase()}-${take.name.replace(/\W+/g, "-").toLowerCase()}`,
      }, (progress) => {
        if (progress.frame === progress.total || progress.frame % 5 === 0) setExportProgress(progress);
      });
      downloadBlob(blob, `${project.id}-${composition.id}-${take.id}-png.zip`);
      setNotice("PNG sequence exported");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Export failed"); }
    finally { sceneRef.current?.endExport(); setExportProgress(null); }
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
    importComments, loadCommentFile, scatter, updateBuild, randomizeBuild, completeGesture, transformCard,
    switchComposition, addProtectedRegion, setHero, removeHero, bakeReflow, createTake, fitFieldToComments,
    alignCameraToHero, deleteTake, saveJson, loadJson, loadBackground, exportFrames, verifyDeterministicFrame,
  };
}

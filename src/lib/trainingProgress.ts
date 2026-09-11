// Applies the trainer's turn output to the persisted training plan.
//
// The agent grades out loud (task_verdict on a spoken turn); this module owns
// what happens next: store the check-my-work frame, advance the plan through
// the pure helpers in electron/training-plan.ts, save it, and — when a pass
// rolls into a brand-new module — kick off the background call that writes
// that module's objectives and done-criteria.

import { api } from "./api";
import { useSession } from "../store/session";
import {
  applyModuleDetail,
  applyTaskVerdict,
  currentTask,
  recordMistakePattern,
} from "../../electron/training-plan";
import type { InstructionResponse, TrainingPlan } from "./api";

/** Renderer-side id mint, same shape as the store's newId(). */
export function newLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The frame from this task's previous check, for attempt-over-attempt
 * comparison on a check-my-work turn. Null when there is no earlier check.
 */
export async function loadReferenceFrame(
  plan: TrainingPlan,
): Promise<string | null> {
  const task = currentTask(plan);
  const previous = task?.feedback.filter((f) => f.frameFile).slice(-1)[0];
  if (!previous?.frameFile) return null;
  try {
    const res = await api().plans.loadFrame({
      planId: plan.id,
      frameFile: previous.frameFile,
    });
    return res.dataUrl;
  } catch {
    return null;
  }
}

/**
 * Fold a turn's verdict / mistake-pattern into the active plan and persist.
 * No-op on turns that carry neither, and when no plan is active.
 */
export async function applyTrainingTurn(
  result: Pick<InstructionResponse, "taskVerdict" | "mistakePattern" | "instruction">,
  log: (msg: string) => void,
): Promise<void> {
  const s = useSession.getState();
  const planId = s.activePlan?.id;
  if (!planId) return;
  if (!result.taskVerdict && !result.mistakePattern) return;

  // Store the frame the verdict was given on — one image per explicit
  // check, attached to the feedback entry. Best-effort, like all persistence.
  // This is the only await, and it runs BEFORE the plan is read and edited:
  // the background module-detailing call can replace activePlan while the
  // frame is being written, and applying the verdict to a copy taken earlier
  // would persist a plan with that detail silently undone.
  let frameFile: string | null = null;
  if (result.taskVerdict) {
    const lastFrame = s.frames[s.frames.length - 1];
    if (lastFrame) {
      try {
        const saved = await api().plans.saveFrame({
          planId,
          frameId: newLocalId("chk"),
          dataUrl: lastFrame.dataUrl,
        });
        frameFile = saved.file;
      } catch {
        // no frame — the text feedback still lands
      }
    }
  }

  // Guard against a session switch while the frame write was in flight.
  let plan = useSession.getState().activePlan;
  if (!plan || plan.id !== planId) return;
  const now = Date.now();

  if (result.mistakePattern) {
    plan = recordMistakePattern(plan, result.mistakePattern, now);
  }

  if (result.taskVerdict) {
    const summary = (result.instruction ?? "").trim().slice(0, 240);
    const verdict = applyTaskVerdict(plan, result.taskVerdict, summary, frameFile, now);
    plan = verdict.plan;
    log(
      `[training] verdict=${result.taskVerdict} → module ${plan.cursor.module + 1}, task ${plan.cursor.task + 1}` +
        (verdict.planCompleted ? " (plan complete!)" : ""),
    );
    if (verdict.enteredNewModule) {
      void detailModuleInBackground(plan, plan.cursor.module, log);
    }
  }

  useSession.getState().setActivePlan(plan);
  void api().plans.save(plan);
}

/**
 * Write objectives + done-criteria for a module that just became current.
 * Failure is fine — the next session start retries before the module is
 * worked on.
 */
export async function detailModuleInBackground(
  plan: TrainingPlan,
  moduleIndex: number,
  log: (msg: string) => void,
): Promise<void> {
  const module = plan.modules[moduleIndex];
  if (!module || module.detailed) return;
  log(`[training] detailing module ${moduleIndex + 1} "${module.title}"…`);
  try {
    const tasks = await api().claude.detailModule({ plan, moduleIndex });
    if (!Array.isArray(tasks) || tasks.length === 0) {
      log(`[training] module detail failed — will retry at next session start`);
      return;
    }
    // The plan may have moved on while the call ran — apply to the latest copy.
    const live = useSession.getState().activePlan;
    const base = live?.id === plan.id ? live : plan;
    const detailed = applyModuleDetail(base, moduleIndex, tasks, {
      now: Date.now(),
      idFor: newLocalId,
    });
    if (useSession.getState().activePlan?.id === plan.id) {
      useSession.getState().setActivePlan(detailed);
    }
    void api().plans.save(detailed);
    log(`[training] module ${moduleIndex + 1} detailed (${tasks.length} tasks)`);
  } catch (err) {
    log(`[training] module detail error: ${String(err)}`);
  }
}

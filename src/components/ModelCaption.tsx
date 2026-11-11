import { useTheme } from "../design/ThemeProvider";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import {
  FALLBACK_COACH_MODEL,
  coachModelFor,
  modelLabel,
} from "../../electron/agents/harness/models";

/**
 * Which model the coach is running on, in one quiet line.
 *
 * Once the coach has looked at the screen this is the model that look
 * actually ran on, as reported back with the answer — so if the account could
 * not use the chosen model and the coach fell back, this says so. Before the
 * first look it is the choice in Settings.
 */
export function ModelCaption({ style }: { style?: React.CSSProperties }) {
  const T = useTheme();
  const lookModel = useSession((s) => s.model);
  const chosen = useSettings((s) => s.settings?.coachModel);
  const model = lookModel ?? coachModelFor(chosen);
  const fellBack = model === FALLBACK_COACH_MODEL;
  return (
    <span
      title={
        fellBack
          ? "Your account could not use the model chosen in Settings, so the coach is using this one instead"
          : "The model the coach is running on. Change it in Settings."
      }
      style={{ fontSize: 10.5, color: T.ink3, whiteSpace: "nowrap", ...style }}
    >
      Model: {modelLabel(model)}
      {fellBack ? " (fallback)" : ""}
    </span>
  );
}

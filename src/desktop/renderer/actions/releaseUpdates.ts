import { invokeDesktop } from "@/desktop/renderer/ipc";
import type {
  ReleaseUpdate,
  ReleaseUpdateCheckResult,
} from "@/desktop/main/services/releaseUpdateService";

export type {
  ReleaseUpdate,
  ReleaseUpdateCheckResult,
};

export function checkForReleaseUpdate(): Promise<ReleaseUpdateCheckResult> {
  return invokeDesktop("releaseUpdates", "checkForReleaseUpdate");
}

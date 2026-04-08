import { useCallback, useState } from "react";
import { validateWaypoint } from "../api/rest";

export type ValidationStatus = "idle" | "checking" | "valid" | "invalid";

/**
 * Validates a map coordinate (local x/y) against the lanelet network.
 * Returns the last validation result and a `validate` function.
 *
 * Usage:
 *   const { status, validate } = useWaypointValidation();
 *   await validate(x, y); // returns true if inside lanelet
 */
export function useWaypointValidation() {
  const [status, setStatus] = useState<ValidationStatus>("idle");

  /**
   * Validate point and return `true` if inside a lanelet.
   * Always resolves (never throws) — errors are treated as invalid.
   */
  const validate = useCallback(async (x: number, y: number): Promise<boolean> => {
    setStatus("checking");
    try {
      const result = await validateWaypoint({ x, y });
      setStatus(result.valid ? "valid" : "invalid");
      return result.valid;
    } catch (err) {
      console.error("[validate] API error:", err);
      setStatus("invalid");
      return false;
    }
  }, []);

  const reset = useCallback(() => setStatus("idle"), []);

  return { status, validate, reset };
}

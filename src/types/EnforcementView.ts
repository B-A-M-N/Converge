/**
 * EnforcementView - Represents the effective governance view for a job.
 * Provides provenance tracking and constraint resolution results.
 */

export interface EnforcementView<T extends object = any> {
  /** The effective values that should be enforced */
  effective: T;
  /** Authority source that generated this view */
  authority: string;
  /** When this view was generated */
  generatedAt: string;
  /** Who/what generated this view */
  generatedBy: string;
  /** Optional sources breakdown for each field */
  sources?: Record<string, any>;
}

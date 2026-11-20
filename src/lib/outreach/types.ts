/**
 * Row shapes for Draper's tables (0062). Only the ones a page reads so far;
 * later stages add theirs as they need them.
 */
import type { Fault } from "./rules.ts";

export interface Lane {
  id: number;
  name: string;
  services: string[];
  areas: string[];
  skip: string[];
  template_version: number;
  approval_required: boolean;
  active: boolean;
  notes: string | null;
}

export interface DraperSettings {
  version: number;
  master_on: boolean;
  test_mode: boolean;
  test_inboxes: string[];
  daily_first_emails: number;
  window_start: string;
  window_end: string;
  gap_min_minutes: number;
  gap_max_minutes: number;
  stop_window_minutes: number;
  pause_from: string | null;
  pause_to: string | null;
  opt_out_line: "A" | "B";
  /** 0066: Saturdays and Sundays are sending days too. Missing before 0066 is pasted. */
  send_weekends?: boolean;
  client_radius_km: number;
  never_list: string[];
  exclusion_categories: string[];
  note: string | null;
  created_at: string;
}

export interface Template {
  version: number;
  first_subject: string;
  first_body: string;
  followup_subject: string;
  followup_body: string;
  opt_out_a: string;
  opt_out_b: string;
  slot_rules: string;
  example: string | null;
  created_at: string;
}

export interface RunInstructions {
  version: number;
  body: string;
  created_at: string;
}

export interface DraperState {
  paused: boolean;
  paused_reason: string | null;
  paused_by: "kyle" | "auto" | null;
  paused_at: string | null;
  faults_off: Fault[];
}

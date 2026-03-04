// Output formatting — tables, status reports, doctor results

import kleur from "kleur";
import type { Task, TaskStatus } from "../core/types.js";
import type { StatusReport, DoctorCheck } from "./types.js";

const STATUS_COLOR: Record<TaskStatus, (s: string) => string> = {
  pending: kleur.yellow,
  active: kleur.blue,
  done: kleur.green,
  failed: kleur.red,
};

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

export function formatTaskTable(tasks: Task[]): string {
  if (tasks.length === 0) return kleur.dim("No tasks found.");

  const header = `${pad("ID", 12)}${pad("Status", 10)}${pad("Type", 10)}${pad("Pri", 5)}Description`;
  const separator = "─".repeat(60);
  const rows = tasks.map((t) => {
    const color = STATUS_COLOR[t.status];
    const desc = t.description.split("\n")[0].slice(0, 40);
    return `${pad(t.id, 12)}${color(pad(t.status, 10))}${pad(t.type, 10)}${pad(String(t.priority), 5)}${desc}`;
  });

  return [kleur.bold(header), separator, ...rows].join("\n");
}

export function formatStatus(report: StatusReport): string {
  const lines: string[] = [];

  lines.push(kleur.bold("Ralph Status"));
  lines.push("─".repeat(30));
  lines.push("");
  lines.push(`Tasks: ${kleur.bold(String(report.total))} total`);

  const statusOrder: TaskStatus[] = ["active", "pending", "done", "failed"];
  for (const status of statusOrder) {
    const count = report.counts[status];
    if (count > 0) {
      const color = STATUS_COLOR[status];
      lines.push(`  ${color("●")} ${count} ${status}`);
    }
  }

  lines.push("");

  if (report.active_task) {
    lines.push(`Active: ${kleur.bold(report.active_task.id)} (${report.active_task.type})`);
  } else {
    lines.push(kleur.dim("No active task"));
  }

  lines.push("");

  if (report.last_commit) {
    lines.push(`Last commit: ${kleur.dim(report.last_commit.sha.slice(0, 7))} — ${report.last_commit.message}`);
  }

  return lines.join("\n");
}

export function formatDoctorResults(checks: DoctorCheck[]): string {
  const lines: string[] = [];

  lines.push(kleur.bold("Ralph Doctor"));
  lines.push("─".repeat(30));
  lines.push("");

  for (const check of checks) {
    const icon = check.passed ? kleur.green("✓") : kleur.red("✗");
    const msg = check.passed ? check.name : `${check.name} — ${kleur.red(check.message)}`;
    lines.push(`  ${icon} ${msg}`);
  }

  const passed = checks.filter((c) => c.passed).length;
  lines.push("");
  lines.push(`${passed}/${checks.length} checks passed`);

  return lines.join("\n");
}

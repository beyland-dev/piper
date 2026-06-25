import { runCommand } from "../utils/process.js";
import { shellEscape } from "../utils/shell.js";

export interface GitSnapshot {
  available: boolean;
  modifiedFiles: Set<string>;
}

async function isGitRepository(workspacePath: string): Promise<boolean> {
  const result = await runCommand("git rev-parse --is-inside-work-tree", {
    cwd: workspacePath
  });

  return result.exitCode === 0;
}

export async function listModifiedFiles(workspacePath: string): Promise<string[]> {
  if (!(await isGitRepository(workspacePath))) {
    return [];
  }

  const unstaged = await runCommand("git diff --name-only", {
    cwd: workspacePath
  });
  const staged = await runCommand("git diff --cached --name-only", {
    cwd: workspacePath
  });

  return [...new Set([...unstaged.stdout.split("\n"), ...staged.stdout.split("\n")].map((value) => value.trim()).filter(Boolean))];
}

export async function captureGitSnapshot(workspacePath: string): Promise<GitSnapshot> {
  const available = await isGitRepository(workspacePath);
  if (!available) {
    return {
      available: false,
      modifiedFiles: new Set()
    };
  }

  return {
    available,
    modifiedFiles: new Set(await listModifiedFiles(workspacePath))
  };
}

export async function enforceProtectedFiles(params: {
  workspacePath: string;
  snapshot: GitSnapshot;
  protectedFiles: string[];
}): Promise<string[]> {
  const { workspacePath, snapshot, protectedFiles } = params;

  if (protectedFiles.length === 0) {
    return [];
  }

  if (!snapshot.available) {
    return [
      "Protected file constraints require a git repository so changes can be detected and reverted."
    ];
  }

  const currentModifiedFiles = new Set(await listModifiedFiles(workspacePath));
  const violations = protectedFiles.filter(
    (filePath) => currentModifiedFiles.has(filePath) && !snapshot.modifiedFiles.has(filePath)
  );

  if (violations.length > 0) {
    const escapedFiles = violations.map((filePath) => shellEscape(filePath)).join(" ");
    await runCommand(`git checkout -- ${escapedFiles}`, {
      cwd: workspacePath
    });
  }

  return violations.map((filePath) => `Constraint violated: do not modify ${filePath}`);
}

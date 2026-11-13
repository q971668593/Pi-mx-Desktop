import { gitExec } from "./git-workspace";
import { selectedHunkPatch } from "./git-board-parse";

type GitResult = { ok: true; stdout: string } | { ok: false; error: string };

async function git(cwd: string, args: string[], input?: string): Promise<GitResult> {
  const result = await gitExec(cwd, args, { timeout: 120_000, maxBuffer: 20 * 1024 * 1024, input });
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.stdout || "git failed").trim().slice(0, 2000) };
  return { ok: true, stdout: result.stdout };
}

export async function stageSelectedHunks(cwd: string, path: string, headers: string[]): Promise<GitResult> {
  const diff = await git(cwd, ["diff", "--binary", "--", path]);
  if (!diff.ok) return diff;
  const patch = selectedHunkPatch(path, diff.stdout, headers);
  if (!patch) return { ok: false, error: "invalid_hunk" };
  const staged = await git(cwd, ["apply", "--cached", "--recount", "-"], patch);
  if (!staged.ok) return staged;
  const unstaged = await git(cwd, ["diff", "--binary", "--", path]);
  if (!unstaged.ok) return unstaged;
  const checkout = await git(cwd, ["checkout", "-f", "--", path]);
  if (!checkout.ok) return checkout;
  return unstaged.stdout.trim() ? git(cwd, ["apply", "--recount", "-"], unstaged.stdout) : staged;
}

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { workspaceFsWriteText } from "./workspace-fs"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("workspace text editing", () => {
  it("saves text inside the workspace and refuses paths outside it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-file-edit-"))
    dirs.push(root)
    await writeFile(join(root, "note.txt"), "old", "utf8")

    await expect(workspaceFsWriteText({ workspaceRoot: root, path: "note.txt", content: "new text" })).resolves.toEqual({ ok: true })
    await expect(readFile(join(root, "note.txt"), "utf8")).resolves.toBe("new text")
    await expect(workspaceFsWriteText({ workspaceRoot: root, path: "../outside.txt", content: "nope" })).resolves.toMatchObject({ ok: false })
  })
})
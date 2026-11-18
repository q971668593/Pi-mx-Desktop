import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { workspaceFsReadText, workspaceFsWriteText } from "./workspace-fs"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("workspace text editing", () => {
  it("rejects stale revisions and serializes concurrent saves", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-file-edit-"))
    dirs.push(root)
    const file = join(root, "note.txt")
    const req = { workspaceRoot: root, path: "note.txt" }
    await writeFile(file, "initial")
    const opened = await workspaceFsReadText(req)
    if (!opened.ok || !opened.revision) throw new Error("Missing revision")

    await writeFile(file, "external change")
    await expect(workspaceFsWriteText({ ...req, content: "draft", expectedRevision: opened.revision }))
      .resolves.toEqual({ ok: false, error: "conflict" })
    await expect(readFile(file, "utf8")).resolves.toBe("external change")

    const current = await workspaceFsReadText(req)
    if (!current.ok || !current.revision) throw new Error("Missing revision")
    const results = await Promise.all(["first", "second"].map((content) =>
      workspaceFsWriteText({ ...req, content, expectedRevision: current.revision }),
    ))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conflict" }])
  })

  it("saves text inside the workspace and refuses paths outside it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-file-edit-"))
    dirs.push(root)
    await writeFile(join(root, "note.txt"), "old", "utf8")

    await expect(workspaceFsWriteText({ workspaceRoot: root, path: "note.txt", content: "new text" })).resolves.toEqual({ ok: true })
    await expect(readFile(join(root, "note.txt"), "utf8")).resolves.toBe("new text")
    await expect(workspaceFsWriteText({ workspaceRoot: root, path: "../outside.txt", content: "nope" })).resolves.toMatchObject({ ok: false })
  })
})
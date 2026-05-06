// resolveShellPath — 3 시나리오 단위 테스트 (whichFn DI mock).
//
// 통합 시점 검증 (실제 which 호출 + claude.exe 등)은 4.4 dogfood 영역.
// 본 단위는 path resolution 분기 로직만 검증.

import { describe, it, expect, vi } from "vitest";
import { resolveShellPath } from "./shellResolve.js";

describe("resolveShellPath", () => {
  it("absolute path → returned unchanged (PATH lookup skipped)", () => {
    const which = vi.fn();
    const result = resolveShellPath("C:\\Users\\user\\.local\\bin\\claude.exe", which);
    expect(result).toBe("C:\\Users\\user\\.local\\bin\\claude.exe");
    expect(which).not.toHaveBeenCalled();
  });

  it("relative name + which resolves → returns absolute path", () => {
    const which = vi.fn(() => "C:\\Users\\user\\.local\\bin\\claude.exe");
    const result = resolveShellPath("claude", which);
    expect(result).toBe("C:\\Users\\user\\.local\\bin\\claude.exe");
    expect(which).toHaveBeenCalledWith("claude");
  });

  it("relative name + which throws → returns input unchanged (fail-safe → PtyHost ENOENT)", () => {
    const which = vi.fn(() => { throw new Error("not found: nonexistent-bin-xyz"); });
    const result = resolveShellPath("nonexistent-bin-xyz", which);
    expect(result).toBe("nonexistent-bin-xyz");
    expect(which).toHaveBeenCalledTimes(1);
  });
});

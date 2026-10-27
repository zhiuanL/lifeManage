import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V1 Windows desktop entry", () => {
  it("uses the GUI subsystem for both debug previews and release builds", () => {
    const source = readFileSync("src-tauri/src/main.rs", "utf8");
    expect(source).toContain('#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]');
    expect(source).not.toContain("not(debug_assertions)");
    expect(source).toContain("lifeos_lib::run()");
  });
});

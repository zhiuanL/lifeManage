import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../vite.config";

describe("V1 responsive build compatibility", () => {
  it("keeps CSS compatible with the browser used for desktop acceptance", () => {
    const resolved = typeof config === "function" ? config({ command: "build", mode: "production" }) : config;
    expect(resolved).toMatchObject({ build: { cssTarget: ["chrome89", "safari13"] } });
  });
  it("puts narrow goal content above its operation controls", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".goal-row-main { grid-column: 1 / -1; }");
    expect(css).toContain(".goal-row { grid-template-columns: minmax(0, 1fr) 36px 36px; gap: 8px; }");
  });
  it("does not watch locked native applications or verification profiles", () => {
    const resolved = typeof config === "function" ? config({ command: "serve", mode: "development" }) : config;
    expect(resolved).toMatchObject({
      server: {
        port: 1420,
        strictPort: true,
        watch: { ignored: ["**/src-tauri/**", "**/.verification/**", "**/portable/**"] },
      },
    });
  });
});

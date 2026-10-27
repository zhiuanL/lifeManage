import { afterEach, describe, expect, it, vi } from "vitest";
import { browserIdGenerator } from "../../src/shared/id";

afterEach(() => vi.unstubAllGlobals());

describe("browser ID generator", () => {
  it("uses the native UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "native-uuid");
    vi.stubGlobal("crypto", { randomUUID });

    expect(browserIdGenerator.next()).toBe("native-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("generates a version 4 UUID using secure random bytes in older browsers", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = index; });
        return bytes;
      },
    });

    expect(browserIdGenerator.next()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});

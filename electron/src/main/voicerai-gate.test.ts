import { describe, expect, it } from "vitest";
import { codeFromDeepLink } from "./voicerai-gate";

describe("codeFromDeepLink", () => {
  it("reads the code the ThinkFlyFlow page hands back", () => {
    expect(codeFromDeepLink("voicerai://auth?code=abc123")).toBe("abc123");
    expect(codeFromDeepLink("voicerai://auth/?code=abc123")).toBe("abc123");
    expect(codeFromDeepLink("voicerai:///?code=abc123")).toBe("abc123");
  });

  it("keeps URL-safe characters intact", () => {
    expect(codeFromDeepLink("voicerai://auth?code=4s2ocb5cbIVO2_m0kG6-x")).toBe(
      "4s2ocb5cbIVO2_m0kG6-x",
    );
  });

  it("ignores links that are not a sign-in hand-off", () => {
    expect(codeFromDeepLink("voicerai://settings?code=abc")).toBeNull();
    expect(codeFromDeepLink("voicerai://auth")).toBeNull();
    expect(codeFromDeepLink("voicerai://auth?code=%20")).toBeNull();
    // Another app's scheme must never unlock VoicerAI.
    expect(codeFromDeepLink("voicestudio://auth?code=abc")).toBeNull();
    expect(
      codeFromDeepLink(
        "https://thinkflyflow.laureljar.com/desktop-auth?code=abc",
      ),
    ).toBeNull();
    expect(codeFromDeepLink("not a url")).toBeNull();
  });
});

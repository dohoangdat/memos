import { describe, expect, it } from "vitest";
import { fixWebmDuration } from "@/lib/webm-duration";

// EBML header, then a Segment of unknown size holding Info { TimecodeScale = 1,000,000 } and a Cluster.
const recording = () =>
  new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x84,
    0x42,
    0x82,
    0x81,
    0x77, // EBML { DocType "w" }
    0x18,
    0x53,
    0x80,
    0x67,
    0x01,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff, // Segment, unknown size
    0x15,
    0x49,
    0xa9,
    0x66,
    0x87,
    0x2a,
    0xd7,
    0xb1,
    0x83,
    0x0f,
    0x42,
    0x40, // Info { TimecodeScale 1e6 }
    0x1f,
    0x43,
    0xb6,
    0x75,
    0x80, // Cluster
  ]);

describe("WebM duration", () => {
  it("writes the length, in milliseconds, into the Segment's Info", async () => {
    const fixed = new Uint8Array(await (await fixWebmDuration(new Blob([recording()], { type: "audio/webm" }), 3210)).arrayBuffer());
    const at = fixed.findIndex((byte, index) => byte === 0x44 && fixed[index + 1] === 0x89);
    expect(at).toBeGreaterThan(0);
    expect(new DataView(fixed.buffer).getFloat64(at + 3)).toBe(3210);
    // Info grew by the 11-byte Duration element; the Cluster follows untouched.
    expect(Array.from(fixed.slice(-5))).toEqual([0x1f, 0x43, 0xb6, 0x75, 0x80]);
    expect(fixed.length).toBe(recording().length + 11 + 7);
  });

  it("leaves other files and files with a duration alone", async () => {
    const mp4 = new Blob([recording()], { type: "audio/mp4" });
    expect(await fixWebmDuration(mp4, 1000)).toBe(mp4);
    const once = await fixWebmDuration(new Blob([recording()], { type: "audio/webm" }), 1000);
    const twice = await fixWebmDuration(once, 1000);
    expect(twice.size).toBe(once.size);
  });
});

import { describe, expect, it } from "vitest";
import { parseScannerPayload } from "@/lib/scannerPayload";

describe("scanner QR payload policy", () => {
  it("sends signed QR tokens as the preferred scanner request", () => {
    expect(parseScannerPayload(JSON.stringify({ qrToken: "signed-token" }))).toEqual({
      body: { qrToken: "signed-token" },
      label: "QR firmado",
    });
  });

  it("keeps versioned ticket identity claims for old contract QR payloads", () => {
    expect(
      parseScannerPayload(
        JSON.stringify({
          contractAddress: "C_SCAN_TEST_123456",
          ticketRootId: 123456,
          version: 2,
        }),
      ),
    ).toEqual({
      body: {
        contractAddress: "C_SCAN_TEST_123456",
        ticketRootId: 123456,
        version: 2,
      },
      label: "C_SCAN.../#123456v2",
    });
  });

  it("supports explicit legacy ticket ids only as a backend-controlled request", () => {
    expect(
      parseScannerPayload(
        JSON.stringify({
          ticketId: "12345678-aaaa-bbbb-cccc-123456789000",
          code: "DEMO-CODE",
        }),
      ),
    ).toEqual({
      body: { ticketId: "12345678-aaaa-bbbb-cccc-123456789000" },
      label: "DEMO-CODE",
    });
  });

  it("rejects unrecognized JSON payloads before calling the scanner API", () => {
    expect(() => parseScannerPayload(JSON.stringify({ random: true }))).toThrow("QR No Reconocido");
  });
});

import crypto from "node:crypto";

// HCP signs each webhook (headers Api-Timestamp + Api-Signature) with the
// signing secret it showed you when you saved the webhook URL. Its exact
// construction isn't documented anywhere we could confirm, so instead of
// guessing one, we accept ANY of the standard HMAC-SHA256 constructions and
// report which one matched. This is safe: every candidate is still an HMAC
// keyed with the secret, so nothing can be forged without it. Once the log
// shows the matching scheme, we can pin it to just that one.

export interface SignatureResult {
  ok: boolean;
  /** Which construction matched, e.g. "timestamp.body/hex". Only set when ok. */
  scheme?: string;
  /** Non-secret diagnostics for the log when verification fails. */
  detail?: string;
}

interface HeaderReader {
  get(name: string): string | null;
}

function firstHeader(headers: HeaderReader, names: string[]): string {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return "";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** "v1,abc= v1,def=" / "sha256=abc" / "abc" -> ["abc=", "def=", ...] */
function signatureTokens(header: string): string[] {
  return header
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^(v\d+=|sha256=)/i, ""))
    .filter((t) => t && !/^(v\d+|sha256)$/i.test(t));
}

export function verifyHcpSignature(rawBody: string, headers: HeaderReader, secret: string): SignatureResult {
  const signatureHeader = firstHeader(headers, ["api-signature", "webhook-signature", "x-hcp-signature"]);
  const timestamp = firstHeader(headers, ["api-timestamp", "webhook-timestamp"]);
  if (!signatureHeader) return { ok: false, detail: "no signature header present" };

  const tokens = signatureTokens(signatureHeader);
  const keys: { label: string; key: string | Buffer }[] = [{ label: "secret", key: secret }];
  if (secret.startsWith("whsec_")) {
    keys.push({ label: "whsec-base64", key: Buffer.from(secret.slice(6), "base64") });
  }

  const messages: { label: string; value: string }[] = [
    { label: "timestamp.body", value: `${timestamp}.${rawBody}` },
    { label: "timestampbody", value: `${timestamp}${rawBody}` },
    { label: "body", value: rawBody },
    { label: "body.timestamp", value: `${rawBody}.${timestamp}` },
    { label: "timestamp:body", value: `${timestamp}:${rawBody}` },
  ];

  for (const { label: keyLabel, key } of keys) {
    for (const { label: msgLabel, value } of messages) {
      const mac = crypto.createHmac("sha256", key).update(value);
      const digest = mac.digest();
      const encodings: [string, string][] = [
        ["hex", digest.toString("hex")],
        ["base64", digest.toString("base64")],
        ["base64url", digest.toString("base64url")],
      ];
      for (const [encLabel, expected] of encodings) {
        for (const token of tokens) {
          const candidate = encLabel === "hex" ? token.toLowerCase() : token;
          if (safeEqual(candidate, expected)) {
            const keyNote = keyLabel === "secret" ? "" : `, key=${keyLabel}`;
            return { ok: true, scheme: `${msgLabel}/${encLabel}${keyNote}` };
          }
        }
      }
    }
  }

  return {
    ok: false,
    detail:
      `no scheme matched (signature header ${signatureHeader.length} chars, ` +
      `timestamp ${timestamp ? "present" : "missing"}, body ${rawBody.length} bytes)`,
  };
}

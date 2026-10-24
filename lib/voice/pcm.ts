/**
 * Browser-safe audio helpers for the Cartesia agent WebSocket.
 * Wire format (https://docs.cartesia.ai/line/integrations/websocket-api.md): headerless mono
 * signed 16-bit little-endian PCM, base64-encoded inside JSON text frames. Agent audio comes
 * back in the same format as the input.
 */

export const AGENT_SAMPLE_RATE = 16_000;
export const AGENT_INPUT_FORMAT = "pcm_16000";
/** Docs recommend 20–100 ms input chunks; 40 ms at 16 kHz. */
export const INPUT_CHUNK_SAMPLES = 640;

/**
 * Streaming linear-interpolation resampler (e.g. 48 kHz microphone → 16 kHz). It keeps a short
 * tail between blocks so chunk boundaries don't click. No anti-alias filter: adequate for
 * speech recognition in a prototype.
 */
export class Resampler {
  private readonly step: number;
  private pos = 0;
  private tail = new Float32Array(0);

  constructor(fromRate: number, toRate: number) {
    if (!(fromRate > 0 && toRate > 0)) throw new Error("sample rates must be positive");
    this.step = fromRate / toRate;
  }

  push(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.tail.length + input.length);
    buf.set(this.tail);
    buf.set(input, this.tail.length);
    const out: number[] = [];
    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const f = pos - i;
      out.push(buf[i]! * (1 - f) + buf[i + 1]! * f);
      pos += this.step;
    }
    const keep = Math.min(Math.floor(pos), buf.length);
    this.tail = buf.slice(keep);
    this.pos = pos - keep;
    return Float32Array.from(out);
  }
}

export function encodePcm16Base64(samples: Float32Array): string {
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return bytesToBase64(new Uint8Array(view.buffer));
}

export function decodePcm16Base64(b64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

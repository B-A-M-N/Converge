export function encodeFrame(frame: { id: number; method: string; params?: any }): Buffer {
  const json = JSON.stringify(frame);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length);
  return Buffer.concat([header, Buffer.from(json)]);
}

export function decodeFrame(buffer: Buffer): { frame: any; remaining: Buffer } | null {
  if (buffer.length < 4) return null;
  const bodyLength = buffer.readUInt32BE(0);
  if (buffer.length < 4 + bodyLength) return null;
  const body = buffer.subarray(4, 4 + bodyLength);
  const frame = JSON.parse(body.toString());
  return { frame, remaining: buffer.subarray(4 + bodyLength) };
}

const PNG_SIGNATURE_LENGTH = 8;
const PIXELS_PER_METER_PER_DPI = 39.3700787402;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.slice(4, 8 + data.length)));
  return chunk;
}

/** Add a pHYs chunk so print applications keep the intended PNG density. */
export async function withPngDensity(blob: Blob, dpi: number): Promise<Blob> {
  const source = new Uint8Array(await blob.arrayBuffer());
  if (
    source.length < PNG_SIGNATURE_LENGTH ||
    source[0] !== 137 ||
    source[1] !== 80 ||
    source[2] !== 78 ||
    source[3] !== 71
  ) {
    throw new Error("Expected a PNG image.");
  }

  const density = Math.round(dpi * PIXELS_PER_METER_PER_DPI);
  const data = new Uint8Array(9);
  const densityView = new DataView(data.buffer);
  densityView.setUint32(0, density);
  densityView.setUint32(4, density);
  data[8] = 1;
  const densityChunk = makeChunk("pHYs", data);

  const chunks: Uint8Array[] = [source.slice(0, PNG_SIGNATURE_LENGTH)];
  let offset = PNG_SIGNATURE_LENGTH;
  let insertedDensity = false;
  while (offset + 12 <= source.length) {
    const view = new DataView(source.buffer, source.byteOffset + offset);
    const dataLength = view.getUint32(0);
    const end = offset + 12 + dataLength;
    if (end > source.length) throw new Error("Invalid PNG data.");
    const type = new TextDecoder().decode(source.slice(offset + 4, offset + 8));
    if (type !== "pHYs") chunks.push(source.slice(offset, end));
    if (type === "IHDR") {
      chunks.push(densityChunk);
      insertedDensity = true;
    }
    offset = end;
  }
  if (!insertedDensity || offset !== source.length) {
    throw new Error("Invalid PNG data.");
  }

  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return new Blob([result], { type: "image/png" });
}

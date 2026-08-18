export async function zipFiles(files: Record<string, string | Uint8Array>, level: 0 | 1) {
  const { strToU8, zipSync } = await import("fflate");
  const encoded = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === "string" ? strToU8(value) : value]));
  const zipped = zipSync(encoded, { level });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

export class RequestBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new RequestBodyError("too_large");
  if (!request.body) throw new RequestBodyError("invalid");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestBodyError("too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError("invalid");
  }
}

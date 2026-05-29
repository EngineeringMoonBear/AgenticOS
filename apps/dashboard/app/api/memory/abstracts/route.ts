import { NextResponse } from "next/server";
import { vikingFsLs, vikingAbstract, type FsEntry } from "@/lib/api/viking";

export const runtime = "nodejs";

const CONCURRENCY = 8;

interface FileEntry {
  uri: string;
  name: string;
}

interface AbstractItem extends FileEntry {
  abstract: string;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "uri required" }, { status: 400 });
  }
  try {
    const ls = await vikingFsLs(uri);
    const entries = (ls.entries ?? []) as FsEntry[];
    const files: FileEntry[] = entries
      .filter((e) => e.is_dir === false)
      .map((e) => ({
        uri: String(e.uri ?? ""),
        name: String(e.name ?? ""),
      }))
      .filter((e) => e.uri.length > 0);

    const items: AbstractItem[] = await mapWithConcurrency(files, CONCURRENCY, async (f) => {
      try {
        const a = await vikingAbstract(f.uri);
        return { uri: f.uri, name: f.name, abstract: a.abstract ?? "" };
      } catch {
        return { uri: f.uri, name: f.name, abstract: "" };
      }
    });

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

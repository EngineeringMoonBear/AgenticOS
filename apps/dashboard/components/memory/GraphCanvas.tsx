"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import { colorForTag } from "@/lib/vault/tag-colors";
import type { WikiPage } from "@agenticos/vault-core";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((mod) => mod.default),
  { ssr: false }
);

interface GraphNode {
  id: string;
  label: string;
  primaryTag: string;
  color: string;
  size: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface GraphCanvasProps {
  onSelectNode: (path: string) => void;
}

async function fetchVaultPage(path: string): Promise<WikiPage | null> {
  const res = await fetch(`/api/vault/page?path=${encodeURIComponent(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch vault page: ${res.status}`);
  return res.json() as Promise<WikiPage>;
}

export function GraphCanvas({ onSelectNode }: GraphCanvasProps) {
  const { data: treeData } = useVaultTree();
  const paths = treeData?.flatPaths ?? [];

  const pageQueries = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["vault", "page", path],
      queryFn: () => fetchVaultPage(path),
      staleTime: 30_000,
    })),
  });

  const graphData = useMemo<GraphData>(() => {
    const pages = pageQueries
      .map((q) => q.data)
      .filter((p): p is WikiPage => p != null);

    if (pages.length === 0) return { nodes: [], links: [] };

    // Build backlink counts
    const backlinkCounts = new Map<string, number>();
    for (const page of pages) {
      for (const target of page.outgoing) {
        backlinkCounts.set(target, (backlinkCounts.get(target) ?? 0) + 1);
      }
    }

    const nodes: GraphNode[] = pages.map((page) => {
      const backlinkCount = backlinkCounts.get(page.path) ?? 0;
      const primaryTag = page.tags[0];
      return {
        id: page.path,
        label: page.title,
        primaryTag: primaryTag ?? "",
        color: colorForTag(primaryTag),
        size: 4 + Math.log(1 + backlinkCount) * 3,
      };
    });

    const pagePathSet = new Set(pages.map((p) => p.path));
    const links: GraphLink[] = [];
    for (const page of pages) {
      for (const target of page.outgoing) {
        if (pagePathSet.has(target)) {
          links.push({ source: page.path, target });
        }
      }
    }

    return { nodes, links };
  }, [pageQueries]);

  if (graphData.nodes.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: "var(--text-muted)", fontSize: "14px" }}
      >
        Loading graph…
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <ForceGraph2D
        graphData={graphData}
        nodeRelSize={1}
        nodeVal={(n) => (n as GraphNode).size}
        nodeColor={(n) => (n as GraphNode).color}
        nodeLabel={(n) => (n as GraphNode).label}
        linkColor={() => "rgba(176, 168, 158, 0.35)"}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(n) => onSelectNode((n as GraphNode).id)}
        backgroundColor="transparent"
      />
    </div>
  );
}

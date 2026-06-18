"use client";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { PillVariant } from "@/components/ui/Pill";
import { useOrg } from "@/lib/hooks/use-org";
import { useApprovals } from "@/lib/hooks/use-approvals";
import type { OrgNode } from "@/lib/paperclip/client";
import type { ApprovalRow } from "@/lib/hooks/use-approvals";

// ── Icon ─────────────────────────────────────────────────────────────────────

const OrgIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="2" width="6" height="4" rx="1" />
    <rect x="2" y="17" width="6" height="4" rx="1" />
    <rect x="16" y="17" width="6" height="4" rx="1" />
    <path d="M12 6v3M12 9H5.5v6M12 9h6.5v6" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusToPillVariant(status: string): PillVariant {
  switch (status) {
    case "active":
      return "ok";
    case "paused":
    case "inactive":
      return "warn";
    case "error":
    case "disabled":
      return "err";
    default:
      return "warn";
  }
}

function approvalStatusToPillVariant(status: string): PillVariant {
  switch (status) {
    case "pending":
      return "warn";
    case "approved":
      return "ok";
    case "rejected":
    case "cancelled":
      return "err";
    default:
      return "warn";
  }
}

// ── Org tree node (recursive) ─────────────────────────────────────────────────

function OrgNodeItem({ node, depth }: { node: OrgNode; depth: number }) {
  const pillVariant = statusToPillVariant(node.status);
  const indent = depth * 16;

  return (
    <>
      <div
        style={{
          paddingLeft: indent,
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {depth > 0 && (
          <span
            style={{
              color: "var(--parchment-muted)",
              fontSize: 10,
              userSelect: "none",
            }}
            aria-hidden="true"
          >
            └
          </span>
        )}
        <Pill variant={pillVariant}>{node.status}</Pill>
        <span className="label-strong" style={{ fontSize: 12.5 }}>
          {node.name}
        </span>
        <span
          className="meta"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--parchment-muted)",
          }}
        >
          {node.role}
        </span>
      </div>
      {node.reports.map((child) => (
        <OrgNodeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ── Approval row ──────────────────────────────────────────────────────────────

function ApprovalItem({ approval }: { approval: ApprovalRow }) {
  const pillVariant = approvalStatusToPillVariant(approval.status);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingTop: 4,
        paddingBottom: 4,
      }}
    >
      <Pill variant={pillVariant}>{approval.status}</Pill>
      <span className="label-strong" style={{ fontSize: 12.5 }}>
        {approval.type}
      </span>
      <span
        className="meta"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--parchment-muted)",
        }}
      >
        {approval.requestedBy ?? "—"}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OrgPanel() {
  const orgQuery = useOrg();
  const approvalsQuery = useApprovals();

  const isLoading = orgQuery.isLoading || approvalsQuery.isLoading;
  const isError = orgQuery.isError || approvalsQuery.isError;

  const orgTree = orgQuery.data?.org ?? null;
  const approvals = approvalsQuery.data?.approvals ?? [];

  const treeEmpty = !orgTree || orgTree.length === 0;

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={OrgIcon}>Org</CardTitle>
        <CardAction>
          {isLoading ? "loading…" : treeEmpty ? "no org" : `${approvals.length} pending`}
        </CardAction>
      </CardHead>

      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="text-sm" style={{ color: "var(--russet)" }}>
          Failed to load org data.
        </div>
      ) : (
        <>
          {/* Org tree section */}
          <div>
            {treeEmpty ? (
              <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
                No org data.
              </div>
            ) : (
              <div>
                {orgTree.map((node) => (
                  <OrgNodeItem key={node.id} node={node} depth={0} />
                ))}
              </div>
            )}
          </div>

          {/* Approvals subsection */}
          <div style={{ marginTop: 16 }}>
            <div
              className="label-strong"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--parchment-muted)",
                marginBottom: 6,
              }}
            >
              Approvals
            </div>
            {approvals.length === 0 ? (
              <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
                No pending approvals.
              </div>
            ) : (
              <div>
                {approvals.map((approval) => (
                  <ApprovalItem key={approval.id} approval={approval} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

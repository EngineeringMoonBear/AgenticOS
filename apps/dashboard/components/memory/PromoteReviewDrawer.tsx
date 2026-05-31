"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCommitInbox } from "@/lib/vault/hooks/use-commit-inbox";
import { useDiscardInbox } from "@/lib/vault/hooks/use-discard-inbox";
import type { PromoteResult } from "@/lib/vault/hooks/use-promote-inbox";

interface PromoteReviewDrawerProps {
  inboxPath: string;
  proposal: PromoteResult;
  onClose: () => void;
}

export function PromoteReviewDrawer({
  inboxPath,
  proposal,
  onClose,
}: PromoteReviewDrawerProps) {
  const commit = useCommitInbox();
  const discard = useDiscardInbox();

  const [destination, setDestination] = useState(proposal.proposed.destination);
  const [title, setTitle] = useState(proposal.proposed.title);
  const [tagsRaw, setTagsRaw] = useState(proposal.proposed.tags.join(", "));
  const [body, setBody] = useState(proposal.proposed.body);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  function handleCommit() {
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const now = new Date().toISOString();

    commit.mutate(
      {
        inboxPath,
        page: {
          path: destination,
          title,
          tags,
          body,
          created: now,
          updated: now,
          sources: [],
        },
      },
      {
        onSuccess: () => {
          toast.success(`Promoted to wiki/${destination}.md`);
          onClose();
        },
        onError: (err) => {
          toast.error(`Failed to commit: ${err.message}`);
        },
      }
    );
  }

  function handleDiscard() {
    discard.mutate(inboxPath, {
      onSuccess: () => {
        toast.success("Inbox note discarded");
        onClose();
      },
      onError: (err) => {
        toast.error(`Failed to discard: ${err.message}`);
      },
    });
  }

  const isBusy = commit.isPending || discard.isPending;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Review promotion proposal"
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-y-auto shadow-xl"
        style={{
          width: "480px",
          backgroundColor: "var(--surface)",
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Review Promotion
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Confidence + Reasoning */}
        <div
          className="mx-4 mt-4 rounded-lg border p-3"
          style={{
            backgroundColor: "var(--surface-raised)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Confidence:{" "}
              <span style={{ color: "var(--text-primary)" }}>
                {Math.round(proposal.confidence * 100)}%
              </span>
            </span>
            <button
              onClick={() => setReasoningOpen((o) => !o)}
              className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              Reasoning
              {reasoningOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          </div>
          {reasoningOpen && (
            <p
              className="mt-2 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              {proposal.reasoning}
            </p>
          )}
        </div>

        {/* Editable fields */}
        <div className="flex flex-col gap-4 p-4 flex-1">
          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Destination path
            </span>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-raised)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
              placeholder="Farm/TopicName"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-raised)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
              placeholder="Page title"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Tags (comma-separated)
            </span>
            <input
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--surface-raised)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
              placeholder="tag-one, tag-two"
            />
          </label>

          <label className="flex flex-col gap-1 flex-1">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Body
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="rounded border px-3 py-1.5 text-sm font-mono resize-y flex-1"
              style={{
                backgroundColor: "var(--surface-raised)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
                minHeight: "180px",
              }}
            />
          </label>
        </div>

        {/* Actions */}
        <div
          className="flex items-center justify-between p-4 border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={handleDiscard}
            disabled={isBusy}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50"
            style={{
              color: "var(--text-muted)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {discard.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Discard
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>

            <button
              onClick={handleCommit}
              disabled={isBusy || !destination || !title || !body}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{
                backgroundColor: "var(--accent-plum-400)",
                color: "#fff",
              }}
            >
              {commit.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Commit
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

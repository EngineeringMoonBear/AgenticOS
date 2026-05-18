"use client";

import { useState } from "react";
import { Inbox, Loader2, AlertCircle, Sparkles, Trash2 } from "lucide-react";
import { useInboxList } from "@/lib/vault/hooks/use-inbox-list";
import { usePromoteInbox } from "@/lib/vault/hooks/use-promote-inbox";
import { useDiscardInbox } from "@/lib/vault/hooks/use-discard-inbox";
import type { InboxNote } from "@agenticos/vault-core";
import type { PromoteResult } from "@/lib/vault/hooks/use-promote-inbox";
import { PromoteReviewDrawer } from "./PromoteReviewDrawer";

export function InboxQueue() {
  const { data: items, isLoading, isError } = useInboxList();
  const promote = usePromoteInbox();
  const discard = useDiscardInbox();

  const [drawerState, setDrawerState] = useState<{
    inboxPath: string;
    result: PromoteResult;
  } | null>(null);

  const [promotingPath, setPromotingPath] = useState<string | null>(null);
  const [discardingPath, setDiscardingPath] = useState<string | null>(null);

  function handlePromote(note: InboxNote) {
    setPromotingPath(note.path);
    promote.mutate(note.path, {
      onSuccess: (result) => {
        setDrawerState({ inboxPath: note.path, result });
        setPromotingPath(null);
      },
      onError: () => {
        setPromotingPath(null);
      },
    });
  }

  function handleDiscard(note: InboxNote) {
    setDiscardingPath(note.path);
    discard.mutate(note.path, {
      onSettled: () => setDiscardingPath(null),
    });
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 p-4 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 size={14} className="animate-spin" />
        Loading inbox…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex items-center gap-2 p-4 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <AlertCircle size={14} />
        Failed to load inbox
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 p-6 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <Inbox size={24} />
        <span>Inbox is empty</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-3">
        <div
          className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          <Inbox size={12} />
          Inbox ({items.length})
        </div>

        {items.map((note) => {
          const isPromoting = promotingPath === note.path;
          const isDiscarding = discardingPath === note.path;

          return (
            <div
              key={note.path}
              className="rounded-lg border p-3 flex flex-col gap-2"
              style={{
                backgroundColor: "var(--surface-raised)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--text-primary)" }}
                    title={note.title}
                  >
                    {note.title}
                  </span>
                  <span
                    className="text-xs truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {note.path}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePromote(note)}
                  disabled={isPromoting || isDiscarding}
                  className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--accent-plum-400)",
                    color: "#fff",
                  }}
                >
                  {isPromoting ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  {isPromoting ? "Promoting…" : "Promote"}
                </button>

                <button
                  onClick={() => handleDiscard(note)}
                  disabled={isPromoting || isDiscarding}
                  className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {isDiscarding ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                  Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {drawerState && (
        <PromoteReviewDrawer
          inboxPath={drawerState.inboxPath}
          proposal={drawerState.result}
          onClose={() => setDrawerState(null)}
        />
      )}
    </>
  );
}

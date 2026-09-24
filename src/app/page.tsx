"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { EMPTY_CHAT, type ChatState } from "@/components/constellation/agent-chat";
import { NodePanel, type PanelTab } from "@/components/constellation/node-panel";
import { AddNodeDialog } from "@/components/constellation/add-node-dialog";
import type { AgentNode } from "@/components/constellation/types";

// force-graph touches window on import, so it can only load in the browser.
const Constellation = dynamic(
  () => import("@/components/constellation/constellation"),
  { ssr: false }
);

// Client-only too: the cards read collapsed state from localStorage on first render.
const HomeCards = dynamic(() => import("@/components/home/home-cards"), { ssr: false });
// Keep in sync with the column width in home-cards.tsx.
const HOME_CARDS_INSET = "@min-[720px]:left-[356px]";

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()) as AgentNode[];
}

export default function HomePage() {
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatState>>({});
  const [tab, setTab] = useState<PanelTab>("overview");
  const [addParent, setAddParent] = useState<AgentNode | null>(null);

  useEffect(() => {
    fetchAgents()
      .then((data) => {
        setAgents(data);
        const brain = data.find((a) => a.parentId === null);
        // Open the Brain by default on wide screens; on phones the graph comes first.
        if (brain && window.matchMedia("(min-width: 768px)").matches) {
          setSelectedId(brain.id);
        }
      })
      .catch(() => setError("Couldn't load agents. Is the DB running and seeded?"));
  }, []);

  const reloadAgents = useCallback(async (select?: string | null) => {
    const data = await fetchAgents();
    setAgents(data);
    if (select !== undefined) setSelectedId(select);
  }, []);

  const updateChat = useCallback(
    (agentId: string, update: (prev: ChatState) => ChatState) =>
      setChats((prev) => ({
        ...prev,
        [agentId]: update(prev[agentId] ?? EMPTY_CHAT),
      })),
    []
  );

  // Clicking the open node again closes its panel.
  const toggle = useCallback(
    (a: AgentNode) => setSelectedId((current) => (current === a.id ? null : a.id)),
    []
  );

  const selected = agents.find((a) => a.id === selectedId);
  const subNodes = selected
    ? agents.filter((a) => a.parentId === selected.id).sort((a, b) => a.position - b.position)
    : [];

  return (
    <div className="relative flex-1 flex min-h-0 overflow-hidden bg-[radial-gradient(ellipse_at_center,oklch(0.22_0.07_300)_0%,var(--background)_70%)]">
      {/* Container queries: the cards get their own column only when this area is wide enough. */}
      <div className="@container relative flex-1 min-w-0">
        <div className={`absolute inset-0 ${HOME_CARDS_INSET}`}>
          {error ? (
            <p className="text-muted-foreground text-sm text-center mt-20">{error}</p>
          ) : (
            <Constellation
              agents={agents}
              selectedId={selectedId}
              activeSlug={activeSlug}
              onSelect={toggle}
            />
          )}
        </div>
        <HomeCards agents={agents} onSelectAgent={(a) => setSelectedId(a.id)} />
      </div>

      {selected && (
        <div className="absolute inset-0 z-10 md:static md:w-[460px] lg:w-[620px] md:shrink-0 flex flex-col min-h-0">
          <NodePanel
            key={selected.id}
            agent={selected}
            subNodes={subNodes}
            tab={tab}
            onTabChange={setTab}
            chat={chats[selected.id] ?? EMPTY_CHAT}
            onChatChange={updateChat}
            onActiveSlugChange={setActiveSlug}
            onSelect={(a) => setSelectedId(a.id)}
            onAddChild={setAddParent}
            onDeleted={(a) => reloadAgents(a.parentId)}
            onChanged={() => reloadAgents()}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      <AddNodeDialog
        parent={addParent}
        onClose={() => setAddParent(null)}
        onCreated={(id) => {
          setAddParent(null);
          setTab("overview");
          reloadAgents(id);
        }}
      />
    </div>
  );
}

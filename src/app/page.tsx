"use client";

import dynamic from "next/dynamic";
import { AssistantChat } from "@/components/chat/assistant-chat";

// Client-only: the cards read collapsed state from localStorage on first render.
const HomeCards = dynamic(() => import("@/components/home/home-cards"), { ssr: false });

export default function HomePage() {
  return (
    <div className="flex-1 min-h-0 p-3 md:p-4 grid gap-3 md:gap-4 md:grid-cols-[360px_minmax(0,1fr)] md:overflow-hidden">
      <div className="min-h-0 md:overflow-y-auto">
        <HomeCards />
      </div>
      <AssistantChat />
    </div>
  );
}

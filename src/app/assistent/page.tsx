import { AssistantChat } from "@/components/chat/assistant-chat";

export default function AssistantPage() {
  return (
    <div className="flex-1 min-h-0 w-full max-w-3xl mx-auto p-3 md:p-4 flex flex-col">
      <AssistantChat />
    </div>
  );
}

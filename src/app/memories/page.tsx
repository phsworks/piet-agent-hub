"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

type Memory = {
  id: string;
  content: string;
  category: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
};

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function load() {
    const res = await fetch("/api/memories");
    const data = await res.json();
    setMemories(data.items);
    setLoading(false);
  }

  useEffect(() => {
    let ignore = false;
    (async () => {
      const res = await fetch("/api/memories");
      const data = await res.json();
      if (!ignore) {
        setMemories(data.items);
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleDelete(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete memory");
      load();
    }
  }

  function startEdit(memory: Memory) {
    setEditingId(memory.id);
    setEditValue(memory.content);
  }

  async function saveEdit(id: string) {
    const content = editValue.trim();
    if (!content) return;
    const res = await fetch(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setEditingId(null);
      load();
    } else {
      toast.error("Failed to save memory");
    }
  }

  return (
    <div className="max-w-2xl w-full mx-auto px-4 py-8 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Memories</h1>
      {loading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!loading && memories.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing remembered yet. Chat with the Brain and it will start
          picking up durable facts about you.
        </p>
      )}
      {memories.map((m) => (
        <Card key={m.id} className="gap-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <Badge variant="secondary">{m.category}</Badge>
              <Badge variant="outline">{m.branch}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(m.updatedAt).toLocaleString()}
            </span>
          </CardHeader>
          <CardContent>
            {editingId === m.id ? (
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-sm"
                autoFocus
              />
            ) : (
              <p className="text-sm">{m.content}</p>
            )}
          </CardContent>
          <CardFooter className="flex gap-2 justify-end">
            {editingId === m.id ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => saveEdit(m.id)}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(m.id)}
                >
                  Delete
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(m)}>
                  Edit
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

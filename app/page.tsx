"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "complete";
};

type ModelStatus = {
  available: boolean;
  model: string | null;
  message?: string;
};

const suggestions = [
  "幫我整理今天的工作重點",
  "我有幾件事想記下來，先幫我整理",
  "幫我想想如何安排明天的時間",
];

const STORAGE_KEY = "secretary-agent.messages.v1";

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function refreshModelStatus() {
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        const status = (await response.json()) as ModelStatus;
        if (!cancelled) setModelStatus(status);
      } catch {
        if (!cancelled) {
          setModelStatus({
            available: false,
            model: null,
            message: "無法取得 LM Studio 的模型清單，請確認 server 已啟動。",
          });
        }
      }
    }
    void refreshModelStatus();
    const interval = window.setInterval(refreshModelStatus, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Browser-only persisted state is loaded after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setMessages(JSON.parse(saved) as Message[]);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (messages.length)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activities]);

  async function sendMessage(event?: FormEvent, chosenText = draft) {
    event?.preventDefault();
    const text = chosenText.trim();
    if (!text || sending || !modelStatus?.available) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const conversation = [...messages, userMessage];
    const assistantId = crypto.randomUUID();
    setMessages([
      ...conversation,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setDraft("");
    setSending(true);
    setError("");
    setActivities([]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Pi agent 無法回應。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split("\n\n");
        buffer = records.pop() ?? "";
        for (const record of records) {
          const line = record
            .split("\n")
            .find((part) => part.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            delta?: string;
            text?: string;
            name?: string;
            id?: string;
            error?: string;
          };
          if (event.type === "text") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content + (event.delta ?? ""),
                    }
                  : message,
              ),
            );
          } else if (event.type === "final") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: event.text ?? message.content }
                  : message,
              ),
            );
          } else if (event.type === "tool_start") {
            setActivities((current) => [
              ...current,
              {
                id: event.id ?? crypto.randomUUID(),
                name: event.name ?? "tool",
                status: "running",
              },
            ]);
          } else if (event.type === "tool_end") {
            setActivities((current) =>
              current.map((activity) =>
                activity.id === event.id
                  ? { ...activity, status: "complete" }
                  : activity,
              ),
            );
          } else if (event.type === "error") {
            throw new Error(event.error ?? "Pi agent 執行失敗。");
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "發生未預期的錯誤。");
      setMessages((current) =>
        current.filter(
          (message) => message.id !== assistantId || message.content.length > 0,
        ),
      );
    } finally {
      setSending(false);
      setActivities((current) =>
        current.map((activity) => ({ ...activity, status: "complete" })),
      );
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function clearConversation() {
    setMessages([]);
    setActivities([]);
    setError("");
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <div className="rail-spacer" />
        <button className="rail-button active" aria-label="對話" title="對話">
          <ChatIcon />
        </button>
        <div className="rail-spacer" />
        <div className="local-indicator" title="只在本機執行">
          <span />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">PERSONAL WORKSPACE</span>
            <h1>Secretary Agent</h1>
          </div>
          <div className="topbar-actions">
            <span
              className={`runtime-status ${modelStatus === null ? "checking" : modelStatus.available ? "ready" : "unavailable"}`}
              title={modelStatus?.message}
            >
              <i />
              {modelStatus === null
                ? "檢查模型中"
                : modelStatus.available
                  ? modelStatus.model
                  : "模型不可用"}
            </span>
            <button
              className="icon-button"
              onClick={clearConversation}
              title="清除對話"
              aria-label="清除對話"
            >
              <TrashIcon />
            </button>
          </div>
        </header>

        <section
          className={`conversation ${messages.length ? "has-messages" : ""}`}
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-orb">
                <SparkIcon />
              </div>
              <p className="eyebrow">YOUR DAY, IN BETTER ORDER</p>
              <h2>
                今天有什麼
                <br className="mobile-break" />
                需要一起處理？
              </h2>
              <p className="welcome-copy">
                先把腦中的事情說出來，我會幫你釐清下一步。
              </p>
              <div className="suggestions">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    onClick={() => void sendMessage(undefined, suggestion)}
                    disabled={sending || !modelStatus?.available}
                  >
                    <span>{["01", "02", "03"][index]}</span>
                    {suggestion}
                    <ArrowIcon />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-row ${message.role}`}
                >
                  {message.role === "assistant" && (
                    <div className="assistant-avatar">
                      <SparkIcon />
                    </div>
                  )}
                  <div className={`message-bubble ${message.role}`}>
                    {message.content ||
                      (sending && message.role === "assistant" ? (
                        <span className="thinking">
                          <i />
                          正在整理思路…
                        </span>
                      ) : (
                        ""
                      ))}
                  </div>
                  {message.role === "user" && (
                    <div className="user-avatar">你</div>
                  )}
                </article>
              ))}
              {activities.length > 0 && (
                <div className="activity-list">
                  {activities.map((activity) => (
                    <div className="activity" key={activity.id}>
                      {activity.status === "running" ? (
                        <span className="spinner" />
                      ) : (
                        <CheckIcon />
                      )}
                      <span>{activity.name}</span>
                      <span className="activity-state">
                        {activity.status === "running" ? "執行中" : "完成"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          {!modelStatus?.available && modelStatus?.message && (
            <div className="error-card composer-error" role="status">
              {modelStatus.message}
            </div>
          )}
          {messages.length > 0 && error && (
            <div className="error-card composer-error" role="alert">
              {error}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(event) => void sendMessage(event)}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                modelStatus?.available
                  ? "說說你正在想的事…"
                  : "請先啟動 LM Studio 並載入可用模型"
              }
              rows={1}
              maxLength={8000}
              disabled={sending || !modelStatus?.available}
              aria-label="輸入訊息"
            />
            <div className="composer-bottom">
              <span className="composer-hint">
                <kbd>Enter</kbd> 傳送 <kbd>Shift + Enter</kbd> 換行
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={!draft.trim() || sending || !modelStatus?.available}
                aria-label="傳送訊息"
              >
                {sending ? <span className="spinner light" /> : <ArrowUpIcon />}
              </button>
            </div>
          </form>
          <p className="privacy-note">
            <LockIcon /> 對話保存在此瀏覽器；模型端點由 Pi 設定
          </p>
        </footer>
      </section>
    </main>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.3-4.4a7.3 7.3 0 0 1-.8-3.4A7.5 7.5 0 0 1 12 4.7h.5A7.5 7.5 0 0 1 20 11.5Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Z" />
      <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5m-7 7 7-7 7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

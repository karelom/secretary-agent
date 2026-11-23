import { spawn } from 'node:child_process';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Message = { role: 'user' | 'assistant'; content: string };

function encodeEvent(value: Record<string, string>) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && !['http://127.0.0.1:4173', 'http://localhost:4173'].includes(origin)) {
    return Response.json({ error: '此本機助理只接受本機瀏覽器請求。' }, { status: 403 });
  }

  let messages: Message[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 40) {
      return Response.json({ error: '對話格式不正確。' }, { status: 400 });
    }
    messages = body.messages.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('role' in item) ||
        !('content' in item) ||
        !['user', 'assistant'].includes(String(item.role)) ||
        typeof item.content !== 'string' ||
        item.content.length > 8000
      ) {
        throw new Error('訊息格式不正確。');
      }
      return { role: item.role as Message['role'], content: item.content };
    });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : '請求內容無效。' },
      { status: 400 }
    );
  }

  if (messages[messages.length - 1].role !== 'user') {
    return Response.json({ error: '最後一則訊息必須來自使用者。' }, { status: 400 });
  }

  const transcript = messages
    .slice(0, -1)
    .map((message) => `${message.role === 'user' ? '使用者' : 'Secretary Agent'}：${message.content}`)
    .join('\n\n');
  const prompt = [
    '你是 Secretary Agent，專注於協助使用者整理日常工作、想法和待辦。請使用繁體中文，先理解需求、必要時詢問澄清，回答務實而簡潔。',
    '此版本尚未連接外部待辦資料。不要聲稱已經建立、修改或完成任何 Todo；如果使用者希望追蹤某件事，先整理出適合建立待辦的內容並說明目前尚未儲存。',
    transcript ? `先前對話：\n${transcript}` : '',
    `使用者的新訊息：\n${messages[messages.length - 1].content}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const args = ['--mode', 'rpc', '--no-session'];
  if (process.env.PI_PROVIDER) args.push('--provider', process.env.PI_PROVIDER);
  if (process.env.PI_MODEL) args.push('--model', process.env.PI_MODEL);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let buffer = '';
      let stderr = '';
      const pi = spawn(process.env.PI_BIN || 'pi', args, {
        cwd: process.env.PI_WORKING_DIRECTORY || process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      pi.stdin.on('error', () => undefined);
      const send = (event: Record<string, string>) => {
        if (!closed) controller.enqueue(encoder.encode(encodeEvent(event)));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        controller.close();
      };
      const timeout = setTimeout(() => {
        send({ type: 'error', error: 'Pi 執行超過五分鐘，已停止這次請求。' });
        pi.kill('SIGTERM');
      }, 5 * 60 * 1000);

      pi.stdout.setEncoding('utf8');
      pi.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line) {
            try {
              const event = JSON.parse(line) as {
                type?: string;
                assistantMessageEvent?: { type?: string; delta?: string };
                toolCallId?: string;
                toolName?: string;
                isError?: boolean;
                message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
              };
              if (
                event.type === 'message_update' &&
                event.assistantMessageEvent?.type === 'text_delta' &&
                event.assistantMessageEvent.delta
              ) {
                send({ type: 'text', delta: event.assistantMessageEvent.delta });
              } else if (event.type === 'tool_execution_start') {
                send({
                  type: 'tool_start',
                  id: event.toolCallId ?? crypto.randomUUID(),
                  name: event.toolName ?? 'tool',
                });
              } else if (event.type === 'tool_execution_end') {
                send({
                  type: 'tool_end',
                  id: event.toolCallId ?? '',
                  name: event.toolName ?? 'tool',
                });
                if (event.isError) send({ type: 'tool_error', error: 'Pi 工具執行失敗。' });
              } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
                const text = (event.message.content ?? [])
                  .filter((item) => item.type === 'text')
                  .map((item) => item.text ?? '')
                  .join('');
                if (text) send({ type: 'final', text });
              }
            } catch {
              // Ignore non-event output; Pi diagnostics are collected from stderr.
            }
          }
          newline = buffer.indexOf('\n');
        }
      });
      pi.stderr.setEncoding('utf8');
      pi.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-3000);
      });
      pi.on('error', (cause) => {
        send({
          type: 'error',
          error: `無法啟動 Pi（${cause.message}）。請確認 Pi CLI 已安裝且可從此終端機執行。`,
        });
        finish();
      });
      pi.on('close', (code) => {
        if (code !== 0 && !closed) {
          const details = stderr.trim().split('\n').slice(-2).join(' ');
          send({
            type: 'error',
            error: details || `Pi 結束時發生錯誤（代碼 ${code ?? 'unknown'}）。`,
          });
        } else {
          send({ type: 'done' });
        }
        finish();
      });
      request.signal.addEventListener(
        'abort',
        () => {
          pi.kill('SIGTERM');
          finish();
        },
        { once: true }
      );
      pi.stdin.end(`${JSON.stringify({ type: 'prompt', message: prompt })}\n`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

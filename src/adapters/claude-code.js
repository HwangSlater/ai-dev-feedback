// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// Claude Code adapter: ~/.claude/projects/**/*.jsonl -> common session/event shape.
//
// Session: { id, file, cwd, branch, start, end, ev: Event[] }
// Event (short keys keep the cache small):
//   { t, k:'p', x, n, s? }  human prompt: text (clipped), full length, source ('sug' | 'q')
//   { t, k:'i' }            user interrupted the agent
//   { t, k:'t', n, g, e? }  tool call: name, target (file or command), error flag
//   { t, k:'r', n, x, m? }  agent reply text: length, tail of the text, model (ai-dev-feedback 에서 더함)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const name = 'claude-code';

export function defaultRoot() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

export function listFiles(root = defaultRoot()) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const rel of fs.readdirSync(root, { recursive: true })) {
    const f = String(rel);
    // Subagent transcripts are the agent talking to itself, not the developer.
    if (!f.endsWith('.jsonl') || f.split(/[\\/]/).includes('subagents')) continue;
    out.push(path.join(root, f));
  }
  return out;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

function toolTarget(name, input = {}, cwd) {
  if (SHELL_TOOLS.has(name)) return String(input.command || '').replace(/\s+/g, ' ').slice(0, 200);
  const file = input.file_path || input.notebook_path || input.path;
  if (file) {
    const rel = cwd ? path.relative(cwd, String(file)) : String(file);
    return (rel && !rel.startsWith('..') ? rel : String(file)).replace(/\\/g, '/').slice(0, 160);
  }
  if (input.subagent_type) return String(input.subagent_type);
  return '';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}

// Test/build output that reports failure even when the exit code was swallowed (e.g. piped to tail).
export const FAILURE = /\b[1-9]\d* (failed|failing|errors?)\b|\bFAILED\b|\bFAIL\s|Traceback \(most recent call last\)|\berror TS\d+|npm ERR!|AssertionError|Exit code [1-9]|exited with code [1-9]|BUILD FAILED|Build failed|Compilation failed/;

function resultText(content) {
  const t = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text || '').join('\n') : '';
  return t.length > 6000 ? t.slice(0, 2000) + t.slice(-4000) : t;
}

const INJECTED = /^(<[a-z-]+[\s>]|Caveat:|This session is being continued|Another Claude session|\[Cross-session)/;

// Returns 'prompt' | 'interrupt' | null for a user record.
function classifyUser(r, text) {
  if (r.isSidechain || r.isMeta || !text) return null;
  if (text.startsWith('[Request interrupted')) return 'interrupt';
  const kind = r.origin?.kind;
  if (kind) return kind === 'human' ? 'prompt' : null;
  // Older logs have no origin field.
  return INJECTED.test(text.trimStart()) ? null : 'prompt';
}

function cleanPrompt(text) {
  return text.replace(/\[Image[^\]]*\]/g, '[image]').trim();
}

export async function parseFile(file) {
  const ev = [];
  const pending = new Map(); // tool_use_id -> event
  const s = { id: path.basename(file, '.jsonl'), file, cwd: '', branch: '', start: 0, end: 0, ev };
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type !== 'user' && r.type !== 'assistant') continue;
    const t = Date.parse(r.timestamp);
    if (!t) continue;
    if (!s.cwd && r.cwd) s.cwd = r.cwd;
    if (!s.branch && r.gitBranch) s.branch = r.gitBranch;
    if (r.sessionId) s.id = r.sessionId;
    const content = r.message?.content;

    if (r.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type !== 'tool_result') continue;
          const e = pending.get(b.tool_use_id);
          if (e && (b.is_error || (SHELL_TOOLS.has(e.n) && FAILURE.test(resultText(b.content))))) e.e = 1;
        }
      }
      const text = textOf(content);
      const kind = classifyUser(r, text);
      if (kind === 'interrupt') ev.push({ t, k: 'i' });
      else if (kind === 'prompt') {
        const clean = cleanPrompt(text);
        const e = { t, k: 'p', x: clean.length > 1200 ? `${clean.slice(0, 900)} … ${clean.slice(-280)}` : clean, n: clean.length };
        const src = r.promptSource;
        if (src === 'suggestion_accepted') e.s = 'sug';
        else if (src === 'queued') e.s = 'q';
        ev.push(e);
      }
    } else if (!r.isSidechain && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'tool_use') {
          const e = { t, k: 't', n: b.name, g: toolTarget(b.name, b.input, s.cwd) };
          pending.set(b.id, e);
          ev.push(e);
        } else if (b?.type === 'text' && b.text?.trim()) {
          ev.push({ t, k: 'r', n: b.text.length, x: b.text.replace(/\s+/g, ' ').trim().slice(-240), ...(r.message?.model ? { m: r.message.model } : {}) });
        }
      }
    }
  }
  ev.sort((a, b) => a.t - b.t);
  s.start = ev[0]?.t || 0;
  s.end = ev.at(-1)?.t || 0;
  return s;
}

export function isEdit(name) {
  return EDIT_TOOLS.has(name);
}

export function isShell(name) {
  return SHELL_TOOLS.has(name);
}

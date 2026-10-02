// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// Codex CLI adapter: ~/.codex/sessions/**/rollout-*.jsonl -> the same session/event shape as claude-code.js.
// Handles both the "code mode" format (shell commands inside an `exec` script as tools.shell_command(...))
// and the older one (function_call "shell" / local_shell_call / exec_command_end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { FAILURE } from './claude-code.js';

export const name = 'codex';

export function defaultRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

export function listFiles(root = defaultRoot()) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(root, f));
}

const SHELL_TOOLS = new Set(['shell', 'shell_command', 'exec_command', 'container.exec', 'local_shell', 'run_command']);

function outputText(out) {
  if (typeof out === 'string') {
    try {
      const j = JSON.parse(out);
      return typeof j === 'string' ? j : j.output ?? JSON.stringify(j);
    } catch {
      return out;
    }
  }
  if (Array.isArray(out)) return out.map((c) => c?.text || '').join('\n');
  return out?.content ?? '';
}

const EXEC_FAILED = /Exit code: [1-9]|Script failed|Script error|exit_code"?:\s*[1-9]/;

// ["bash", "-lc", "npm test"] and "powershell -Command npm test" -> "npm test": keep the real command, not its wrapper.
const WRAPPER = /^(?:\S*[\\/])?(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*?-(?:l?c|Command)\s+/i;

function commandString(c) {
  const s = Array.isArray(c) ? (c.length >= 3 && WRAPPER.test(`${c[0]} ${c[1]} `) ? c.at(-1) : c.join(' ')) : String(c || '');
  return s.replace(WRAPPER, '').replace(/^(["'])(.*)\1$/, '$2').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Pulls the shell commands out of a code-mode script: tools.shell_command({"command": "...", ...}).
function commandsInScript(src) {
  const out = [];
  const re = /tools\.(\w+)\(\s*\{[^]*?"?command"?\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/g;
  let m;
  while ((m = re.exec(src))) {
    if (!SHELL_TOOLS.has(m[1])) continue;
    try {
      out.push(commandString(JSON.parse(m[2])));
    } catch {}
  }
  return out;
}

// Web and read-only tools count as reading, like Claude Code's WebFetch/Read.
function toolName(n) {
  return /web|search|fetch|browse/i.test(n) ? 'WebFetch' : /read|view|list/i.test(n) ? 'Read' : n;
}

function otherToolsInScript(src) {
  const names = new Set();
  for (const m of src.matchAll(/tools\.(\w+)\(/g)) if (!SHELL_TOOLS.has(m[1]) && m[1] !== 'apply_patch') names.add(m[1]);
  return [...names];
}

export async function parseFile(file) {
  const ev = [];
  const byCall = new Map(); // call_id -> events started by that call
  const s = { id: path.basename(file, '.jsonl'), file, cwd: '', branch: '', start: 0, end: 0, ev };
  const rel = (p) => {
    const r = s.cwd ? path.relative(s.cwd, p) : p;
    return (r && !r.startsWith('..') ? r : p).replace(/\\/g, '/').slice(0, 160);
  };
  const tool = (t, callId, n, g) => {
    const e = { t, k: 't', n, g };
    ev.push(e);
    if (callId) (byCall.get(callId) || byCall.set(callId, []).get(callId)).push(e);
  };
  const fail = (callId) => {
    const list = byCall.get(callId);
    if (list?.length) list.at(-1).e = 1;
  };

  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const t = Date.parse(r.timestamp);
    const p = r.payload || {};
    if (r.type === 'session_meta') {
      s.id = p.id || p.session_id || s.id;
      s.cwd = p.cwd || s.cwd;
      s.branch = p.git?.branch || s.branch;
      continue;
    }
    if (r.type === 'turn_context' && !s.cwd && p.cwd) s.cwd = p.cwd;
    if (!t) continue;

    if (r.type === 'event_msg') {
      if (p.type === 'user_message' && p.message?.trim()) {
        const x = p.message.replace(/\[Image[^\]]*\]/g, '[image]').trim();
        ev.push({ t, k: 'p', x: x.length > 1200 ? `${x.slice(0, 900)} … ${x.slice(-280)}` : x, n: x.length });
      } else if (p.type === 'turn_aborted' && p.reason === 'interrupted') {
        ev.push({ t, k: 'i' });
      } else if (p.type === 'agent_message' && p.message?.trim()) {
        ev.push({ t, k: 'r', n: p.message.length, x: p.message.replace(/\s+/g, ' ').trim().slice(-240) });
      } else if (p.type === 'patch_apply_end') {
        const files = Array.isArray(p.changes) ? p.changes : Object.keys(p.changes || {});
        for (const f of files) tool(t, null, 'Edit', rel(f));
      } else if (p.type === 'web_search_end') {
        tool(t, null, 'WebSearch', '');
      } else if (p.type === 'exec_command_end') {
        // Older format: the command itself arrives as a function_call with the same call_id.
        if (p.exit_code) fail(p.call_id);
      }
      continue;
    }

    if (r.type !== 'response_item') continue;
    if (p.type === 'custom_tool_call' && p.name === 'exec') {
      const src = String(p.input || '');
      for (const c of commandsInScript(src)) tool(t, p.call_id, 'Bash', c);
      for (const n of otherToolsInScript(src)) tool(t, p.call_id, toolName(n), '');
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (p.name === 'apply_patch' || p.name === 'wait') continue; // edits come from patch_apply_end
      if (SHELL_TOOLS.has(p.name)) {
        let args = {};
        try {
          args = JSON.parse(p.arguments || p.input || '{}');
        } catch {}
        tool(t, p.call_id, 'Bash', commandString(args.command ?? args.cmd));
      } else tool(t, p.call_id, toolName(p.name), '');
    } else if (p.type === 'local_shell_call') {
      tool(t, p.call_id, 'Bash', commandString(p.action?.command));
    } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      const out = outputText(p.output);
      if (EXEC_FAILED.test(out) || FAILURE.test(out.slice(0, 2000) + out.slice(-4000))) fail(p.call_id);
    }
  }
  ev.sort((a, b) => a.t - b.t);
  s.start = ev[0]?.t || 0;
  s.end = ev.at(-1)?.t || 0;
  return s;
}

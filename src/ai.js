// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// AI backend, first available of: the Anthropic API (ANTHROPIC_API_KEY), the logged-in `claude` CLI, the logged-in
// `codex` CLI. AI_DEV_FEEDBACK_AI=api|claude|codex (or --ai) picks one explicitly.
// Both CLIs run headless with tools, settings, thinking/reasoning and session persistence cut down: about 350 tokens
// of fixed overhead per call for claude, about 6,400 for codex (its agent prompt can only be partly replaced).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ensureDir, sha1 } from './util.js';

const API_MODELS = { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5' };
// Fixed input tokens each call carries, measured (docs/COSTS.md).
export const CALL_OVERHEAD = { api: 20, cli: 350, codex: 6400 };

export const usage = { calls: { haiku: 0, sonnet: 0 }, input: 0, output: 0, costUsd: 0 };

let backend;

function findBin(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const found = execFileSync(cmd, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // On Windows the extensionless file is a shell script; use the .exe, or the one an npm .cmd shim points at.
    let bin = found.find((f) => /\.exe$/i.test(f)) || found.find((f) => /\.cmd$/i.test(f)) || found[0];
    if (bin && /\.cmd$/i.test(bin)) bin = exeBehindShim(bin) || bin;
    return bin || null;
  } catch {
    return null;
  }
}

export function detectBackend(force) {
  if (!force && backend !== undefined) return backend;
  const want = force || process.env.AI_DEV_FEEDBACK_AI;
  const api = () => (process.env.ANTHROPIC_API_KEY ? { kind: 'api' } : null);
  const claude = () => ((bin) => bin && { kind: 'cli', bin })(findBin('claude'));
  const codex = () => ((bin) => bin && { kind: 'codex', bin })(findBin('codex'));
  const order = { api: [api], claude: [claude], codex: [codex] }[want] || [api, claude, codex];
  for (const f of order) {
    const b = f();
    if (b) return force ? b : (backend = b);
  }
  return force ? null : (backend = null);
}

function exeBehindShim(cmdFile) {
  try {
    const m = fs.readFileSync(cmdFile, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/i);
    const exe = m && path.join(path.dirname(cmdFile), m[1]);
    return exe && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

// `via` runs one call on a specific backend (used by the accuracy experiment to compare backends).
export async function complete({ model, system, prompt, maxTokens = 4000, via }) {
  const b = via ? detectBackend(via) : detectBackend();
  if (!b) throw new Error('No AI backend: install Claude Code (`claude`) or Codex (`codex`), or set ANTHROPIC_API_KEY.');
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res =
        b.kind === 'api'
          ? await viaApi(model, system, prompt, maxTokens)
          : b.kind === 'codex'
            ? await viaCodex(b.bin, model, system, prompt)
            : await viaCli(b.bin, model, system, prompt);
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  usage.calls[model]++;
  usage.input += res.input;
  usage.output += res.output;
  usage.costUsd += res.cost || 0;
  return res.text;
}

async function viaApi(model, system, prompt, maxTokens) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: API_MODELS[model],
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
      continue;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(`API ${r.status}: ${j.error?.message || 'error'}`);
    return {
      text: j.content.filter((c) => c.type === 'text').map((c) => c.text).join(''),
      input: j.usage.input_tokens,
      output: j.usage.output_tokens,
    };
  }
}

function quoteWin(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

function viaCli(bin, model, system, prompt) {
  const dir = ensureDir(path.join(HOME, 'run'));
  const sysFile = path.join(dir, `sys-${sha1(system).slice(0, 12)}.txt`);
  if (!fs.existsSync(sysFile)) fs.writeFileSync(sysFile, system);
  const settingsFile = path.join(dir, 'settings.json');
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{"alwaysThinkingEnabled":false}');
  const args = [
    '-p',
    '--model', model,
    '--system-prompt-file', sysFile,
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--setting-sources', '',
    '--settings', settingsFile,
    '--output-format', 'json',
  ];
  const win = process.platform === 'win32' && /\.cmd$/i.test(bin);
  return new Promise((resolve, reject) => {
    const child = win
      ? spawn([quoteWin(bin), ...args.map(quoteWin)].join(' '), { cwd: dir, shell: true, env: cliEnv() })
      : spawn(bin, args, { cwd: dir, env: cliEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(`claude: ${j.result || j.subtype}`));
        resolve({
          text: j.result || '',
          input: (j.usage?.input_tokens || 0) + (j.usage?.cache_read_input_tokens || 0) + (j.usage?.cache_creation_input_tokens || 0),
          output: j.usage?.output_tokens || 0,
          cost: j.total_cost_usd || 0,
        });
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

let codexFeatures;

// Every optional Codex feature adds tool definitions to each call; turn them all off (list comes from the same binary).
function codexDisableFlags(bin) {
  if (codexFeatures) return codexFeatures;
  try {
    const out = execFileSync(bin, ['features', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    codexFeatures = out
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 3 && p.at(-1) === 'true')
      .flatMap((p) => ['--disable', p[0]]);
  } catch {
    codexFeatures = [];
  }
  return codexFeatures;
}

// "haiku" work (labeling) runs with low reasoning effort, "sonnet" work (the narrative) with medium, on the user's default model.
function viaCodex(bin, model, system, prompt) {
  const dir = ensureDir(path.join(HOME, 'run'));
  const sysFile = path.join(dir, `sys-${sha1(system).slice(0, 12)}.txt`);
  if (!fs.existsSync(sysFile)) fs.writeFileSync(sysFile, system);
  const effort = model === 'sonnet' ? 'medium' : 'low';
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '-s', 'read-only',
    '-C', dir,
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', `model_instructions_file="${sysFile.replace(/\\/g, '/')}"`,
    ...codexDisableFlags(bin),
    '--json',
    '-',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      let text = '';
      let input = 0;
      let output = 0;
      for (const line of out.split(/\r?\n/)) {
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text || text;
        if (e.type === 'turn.completed' && e.usage) {
          input += e.usage.input_tokens || 0;
          output += (e.usage.output_tokens || 0) + (e.usage.reasoning_output_tokens || 0);
        }
        if (e.type === 'turn.failed' || e.type === 'error') return reject(new Error(`codex: ${JSON.stringify(e).slice(0, 300)}`));
      }
      if (!text) return reject(new Error(`codex exited ${code}: ${(err || out).slice(0, 300)}`));
      resolve({ text, input, output, cost: 0 });
    });
    child.stdin.end(prompt);
  });
}

function cliEnv() {
  return { ...process.env, MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
}

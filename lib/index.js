/**
 * dafiyu-fold —— 折之前，把要被折掉的原文存一份
 *
 * 为什么有这个：
 *   DSH 的官方压缩（`@deepseek-ai/dsh-compaction-basic`）把一大段历史压成摘要时，
 *   **只留摘要，原文就没了**。被折掉的那些话，说得再准也找不回来了。
 *   这个插件不替换它、不改它的提示词，只在它动手之前把原文抄一份到磁盘。
 *
 * 怎么做到的：
 *   等 `compaction` 服务就绪 → 拿到那台活着的引擎 → 包一层它的 `summarize()`：
 *     ① 先把这次要折的输入整段写进 `折叠-插件-<时间>.md`
 *     ② 再原样调用它自己的 summarize
 *   所以摘要的写法、形状、阈值全归官方，这个插件只负责“留底”。
 *
 * ⚠️ 唯一容易配错的地方：折叠服务在 DSH 里被放在一个 isolate 分组里
 *   （`cordis.patch.yml` 里 `- id: compaction / isolate: compaction: true`），
 *   这个插件的那一行**必须写进那个分组的 config 列表**，写在最外层永远等不到服务。
 *   详见 README.md。
 */
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** 原文落在哪 —— 默认 `~/.dsh/fold-archive/`，可用环境变量覆盖 */
const ARCHIVE_DIR =
  process.env.DAFIYU_FOLD_DIR || join(homedir(), '.dsh', 'fold-archive');

/** 插件自己的日志，同一层目录下 */
const LOG_FILE = process.env.DAFIYU_FOLD_LOG || join(dirname(ARCHIVE_DIR), 'dafiyu-fold.log');

const PATCH_FLAG = '__dafiyuFoldPatched';

export const name = 'dafiyu-fold';

function log(message) {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* 日志写不进去就算了，绝不影响折叠本身 */
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** 把一组消息尽量原样写成 Markdown */
function renderBody(input) {
  let messages = [];
  if (Array.isArray(input)) messages = input;
  else if (Array.isArray(input?.messages)) messages = input.messages;
  else if (Array.isArray(input?.range?.messages)) messages = input.range.messages;

  if (messages.length) {
    return messages
      .map((message, index) => {
        const role = message?.role ?? message?.data?.role ?? message?.source?.kind ?? '?';
        const text = typeof message === 'string' ? message : JSON.stringify(message, null, 1);
        return `\n## [${index}] ${role}\n\n\`\`\`\n${text}\n\`\`\`\n`;
      })
      .join('');
  }
  return '```json\n' + JSON.stringify(input, null, 1) + '\n```\n';
}

function archive(input) {
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const file = join(ARCHIVE_DIR, `折叠-插件-${stamp()}.md`);
    const header =
      `# 折叠原文（dafiyu-fold 自动落盘）\n\n` +
      `> 时间：${new Date().toISOString()}\n` +
      `> 这一段原本会被官方压缩成摘要、原文丢掉。这里留一份。\n\n`;
    writeFileSync(file, header + renderBody(input), 'utf8');
    log(`原文落盘 ✓ ${file}`);
    return file;
  } catch (error) {
    log(`落盘失败 ✗ ${error?.message}`);
    return null;
  }
}

function patchEngine(engine, where) {
  try {
    if (!engine) {
      log(`${where}：引擎是空的 ✗`);
      return false;
    }
    const proto = Object.getPrototypeOf(engine);
    if (!proto) {
      log(`${where}：拿不到原型 ✗`);
      return false;
    }
    if (proto[PATCH_FLAG]) {
      log(`${where}：已经包过了 ✓`);
      return true;
    }
    const original = proto.summarize;
    if (typeof original !== 'function') {
      log(`${where}：没有 summarize ✗`);
      return false;
    }
    proto.summarize = async function summarizeWithArchive(input, agent, signal) {
      const file = archive(input);
      log(`summarize 调用了 ✓ 原文：${file ?? '(没存成)'}`);
      return original.call(this, input, agent, signal);
    };
    proto[PATCH_FLAG] = true;
    log(`${where}：包好了 ✓ 以后每次折叠都会先把原文落盘`);
    return true;
  } catch (error) {
    log(`${where}：包失败 ✗ ${error?.message}`);
    return false;
  }
}

export function apply(ctx) {
  log('apply 进来了 ✓');

  try {
    if (ctx.compaction && patchEngine(ctx.compaction, '直接拿')) return;
  } catch (error) {
    log(`直接拿 compaction 失败 ✗（正常，走 inject）`);
  }

  try {
    ctx.inject(['compaction'], (child) => {
      log("inject('compaction') 的回调进来了 ✓");
      patchEngine(child?.compaction, 'inject 回调');
    });
    log('inject 挂上了 ✓ 等 compaction 就绪');
  } catch (error) {
    log(`ctx.inject 失败 ✗ ${error?.message}`);
  }
}

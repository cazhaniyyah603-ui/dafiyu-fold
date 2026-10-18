# dafiyu-fold

> 折之前，把要被折掉的原文存一份。
>
> DSH 的官方上下文压缩（compaction）把一大段历史压成摘要时，**只留摘要，原文就没了**。
> 被折掉的那些话——你说的、它说的、当时为什么那么想——说得再准也找不回来。
>
> 这个插件不替换官方引擎、不改它的提示词、不动任何阈值。
> 它只做一件事：**在官方动手之前，把这一段原文整段抄到磁盘。**

---

## 它做什么

每一轮折叠发生前，你会得到一份 Markdown：

```
~/.dsh/fold-archive/折叠-插件-2026-10-18T06-19-18.md
```

里面是按角色分好的一条条消息，原样保留。摘要照旧由官方生成，你照旧在会话里看到摘要——只是这一次，原文也在。

## 它不做什么

- 不替换官方压缩引擎（是**包一层**，不是换掉）
- 不改提示词、阈值、保留量
- 不联网、不上传、不发任何东西出去
- 不动会话文件本身（折叠仍然由官方完成，它只是在旁边抄一份）

## 安装

把它放进你自己的插件目录，然后在 profile 的 `package.json` 里加上 link 依赖：

```json
{
  "dependencies": {
    "dafiyu-fold": "link:/绝对路径/到/dafiyu-fold"
  }
}
```

## ⚠️ 关键一步：必须放进 compaction 分组

**这是唯一容易配错的地方，也是这个插件最值得说的一条经验。**

DSH 把一个折叠服务关在 **isolate 分组** 里：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true      # ← 服务只在这间屋子里对外开放
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
      config:
        thresholdRatio: 0.22
        retainTokens: 40000
```

`isolate` 的语义是：**这个服务只对同一个分组里的插件可见**。

所以插件那一行必须写成 `compaction-basic` 的兄弟：

```yaml
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
      config:
        thresholdRatio: 0.22
        retainTokens: 40000
    - id: dafiyu-fold        # ← 放在这里
      name: dafiyu-fold
```

写在 profile 最外层是**不行的**——`inject(['compaction'])` 会永远等不到，`apply` 里也读不到 `ctx.compaction`（会报 `cannot get property "compaction" without inject`）。

## 验证它真的在跑

看日志：

```bash
tail -f ~/.dsh/dafiyu-fold.log
```

正常应该是这样：

```
[...] apply 进来了 ✓
[...] inject('compaction') 的回调进来了 ✓
[...] inject 回调：包好了 ✓ 以后每次折叠都会先把原文落盘
```

看到最后一行，就说明成了。之后每次折叠都会多一个 `折叠-插件-*.md`。

## 配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DAFIYU_FOLD_DIR` | `~/.dsh/fold-archive` | 原文存哪儿 |
| `DAFIYU_FOLD_LOG` | `~/.dsh/dafiyu-fold.log` | 日志写哪儿 |

## 它是怎么包的

```
ctx.inject(['compaction'], child => {
  const proto = Object.getPrototypeOf(child.compaction);
  const original = proto.summarize;
  proto.summarize = async (input, agent, signal) => {
    存档(input);
    return original.call(this, input, agent, signal);
  };
});
```

拿到**活着的那台引擎**，只覆盖 `summarize()` 这一个方法。官方引擎的其余部分一动不动。

## 已知限制

- 这是**对内部接口**的包裹（`summarize` 是官方引擎的子类钩子），DSH 大版本升级时可能失效。失效的表现是日志里出现 `没有 summarize ✗`，删掉插件那一行即可，不会影响启动。
- 只留**这一次调用收到的输入**。如果官方引擎在一次折叠里分多轮调用，会得到多份文件——这正是想要的行为。
- 存档目录会一直变大。介意的话自己定期清理，插件不做自动删除（**不替人删东西**）。

## License

MIT

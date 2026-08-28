# 安全策略

## 上报漏洞

**请不要通过公开 issue 上报安全问题。**

请使用 GitHub 的私密漏洞报告：进入本仓库的
[Security → Report a vulnerability](https://github.com/prgrmrwy/dsh-cockpit/security/advisories/new)
提交。该渠道只有维护者可见。

上报时请尽量包含：

- 受影响的版本或 commit
- 复现步骤，以及你观察到的实际影响
- 你认为的严重程度与可能的利用场景

这是一个业余维护的项目，没有 SLA。我会在看到后尽快确认，修复完成前请不要
公开细节。

## 安全边界

了解本项目的设计边界有助于判断某个行为是不是漏洞：

- 驾驶舱服务**只监听 `127.0.0.1:3090`**，并用 HttpOnly cookie 中的本机 token
  做门禁。它防的是本机其他进程与恶意网页，**不是**一个面向网络的鉴权体系。
- 凭据只复用系统 OpenSSH 的免密能力，**不保存**密码、私钥内容或 passphrase。
- 驾驶舱**不读取、不同步、不转发** provider token，也不代理远端的
  Settings / Subscriptions / Credentials。
- 数据目录 `~/.dsh-cockpit/`（`devices.json`、`token`）权限收紧到 `0600`，
  与 `~/.dsh` 严格隔离。
- 设备工作台是跨源 iframe，驾驶舱不读其 DOM，也不注入脚本。
- SSH 隧道只做 `127.0.0.1` 回环转发，强制 `BatchMode`，不关闭 host-key 校验。

### 已知且刻意的限制

以下属于设计取舍，不作为漏洞处理：

- 把 3090 暴露到回环之外（例如自行加反向代理）不在威胁模型内。
- 不可捕获的终止（SIGKILL、断电）不保证同步清理 SSH 子进程；重启后本项目
  不会仅凭端口或命令行相似性去猜测归属并 kill 进程。
- 驾驶舱离线期间的 approval/question 事件无法回读，这是上游协议限制。

如果你不确定某个行为算不算漏洞，按漏洞上报即可，我来判断。

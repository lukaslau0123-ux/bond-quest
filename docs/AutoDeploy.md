# 自動更新（CI/CD）方案 — 鍵界 Bond Quest

> 目標：改完 `_src/` 存檔 → 自動建置 → 自動驗證 → 自動上傳 → 線上網站 1–2 分鐘內更新。
> 現況（2026-11-27）：**已全自動打通** — repo 已推上 GitHub（`lukaslau0123-ux/bond-quest`），Pages 已啟用，`git push` 即自動建置並發佈。
> - GitHub Pages（永遠最新）：`https://lukaslau0123-ux.github.io/bond-quest/`
> - WorkBuddy 固定連結（保留給已收到連結的人）：`https://bond-quest.app.workbuddy.host/?sharecode=UXRUYBRT6X`
>
> ⚠️ 兩條鏈接**內容一致但更新機制不同**：Pages 靠 CI 自動；WorkBuddy 連結要每次手動重新發佈 `site/` 才會更新（見 §6）。

---

## 1. 選型：為甚麼是 GitHub Pages

| 方案 | 自動觸發 | 需要伺服器 | 成本 | 適用 |
|---|---|---|---|---|
| **GitHub Pages + Actions（本方案）** | `git push` 即觸發 | 否 | 免費 | 靜態單檔遊戲，最省事 |
| Cloudflare Pages（Plan B） | `wrangler pages deploy`（本機直接上傳） | 否 | 免費 | 想更快、要預覽網址 |
| WorkBuddy 站點（現有連結） | 要經 Agent 重新發佈 | 否 | 免費 | 現有分享連結，保留作備用 |

**關鍵取捨**：現時 `https://bond-quest.app.workbuddy.host/...` 這條連結是 Agent 手動發佈產生，外部 CI **無法**直接呼叫它，所以「全自動」必須落在一個有 CLI／API 的託管平台。GitHub Pages 免費、與 git 天然整合，最適合。

> 兩者可以並存：GitHub Pages 做「永遠最新」的自動站，WorkBuddy 連結繼續給已收到連結的人用（內容要手動再發佈才更新）。

---

## 2. 檔案結構

```
2026-11-20-09-12-06/
├─ _src/                     ← 唯一要手動改的原始碼
│   ├─ template.html             HTML 骨架（/*__CSS__*/ 等佔位符）
│   ├─ styles.css
│   ├─ data.js                   ZONES / NODES / 題庫資料
│   ├─ world.js                  地形、天空、角色、傳送點
│   └─ game.js                   玩法、任務、教練卡
├─ _vendor/three.min.js      ← 內嵌用第三方庫（必須入版控）
├─ build.py                  ← 組裝：_src → index.html + site/index.html
├─ index.html                ← 【產物，不進 git】本機預覽用
├─ site/index.html           ← 【產物，不進 git】部署目錄（CI 上傳這個）
│
├─ scripts/                  ← 自動化（新增）
│   ├─ lib.mjs                   建置／驗證／git／日誌／回滾 共用邏輯
│   ├─ verify.mjs                守門檢查（8 項，失敗即 exit 1）
│   ├─ watch.mjs                 存檔監看器（本機自動化核心）
│   ├─ ship.mjs                  一鍵發佈（建置→驗證→commit→push）
│   └─ notify.mjs                桌面通知（Windows 氣泡 / 終端提示音）
│
├─ .github/workflows/deploy.yml  ← CI：push 後建置→驗證→部署 Pages
├─ .gitignore                    ← 排除產物、日誌、.workbuddy/
├─ .gitattributes                ← 統一 LF，避免 Windows 無謂 diff
├─ package.json                  ← npm run build / watch / ship
├─ logs/deploy.log               ← 【不進 git】每次建置紀錄
└─ docs/AutoDeploy.md            ← 本文件
```

**為甚麼產物不進 git**：這是安全設計。壞版本只會留在本機 `index.html`，永遠不會被 commit，更不會被 CI 上傳。線上版本只會由「通過驗證的建置」更新。

---

## 3. 自動化流程

```
        ┌──────────────┐
        │ 你改 _src/*  │
        └──────┬───────┘
               │ 存檔（Ctrl+S）
               ▼
     ┌──────────────────┐   500ms 防抖，連續存檔只跑一次
     │ watch.mjs 偵測    │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ build.py 組裝     │  ~1.1s，產出 809 KB 單檔
     └────────┬─────────┘
              ▼
     ┌──────────────────┐   ✗ 失敗 → 阻止部署 + 通知 + 回滾本機產物
     │ verify.mjs 守門   │
     └────────┬─────────┘
              │ ✓ 8/8 通過
              ▼
     ┌──────────────────┐   只在 watch:push / ship 模式
     │ git commit + push │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐   GitHub Actions：重新 build + verify（唔信本機）
     │ CI: build/verify  │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ deploy-pages      │  上傳 artifact → 切換 Pages 版本（原子替換）
     └────────┬─────────┘
              ▼
        線上網站更新（1–2 分鐘）
```

**四層防線**（任何一層掛掉都不會讓壞版本上線）：

1. **防抖** — 500ms 內連續存檔合併成一次建置。
2. **守門檢查** — 檔案體積、佔位符殘留、`<script>` 平衡、關鍵 UI 節點、三支 JS `node --check` 語法。
3. **本機回滾** — 驗證失敗即刻還原 `logs/last-good.html`，預覽不會停在壞版本。
4. **CI 重跑** — GitHub 從乾淨環境重新建置，不信任本機產物（避免「我部機得」）。

---

## 4. 一次性設定（約 10 分鐘）— ✅ 已完成（2026-11-21）

> 以下步驟**已全部做過**，留作日後重建 repo 時的參考。
> 現況：`origin` = `https://github.com/lukaslau0123-ux/bond-quest.git`（public）、分支 `main`、Pages 已啟用且 CI 綠燈。

### 4.1 建立遠端 repo

先在 https://github.com/new 建一個名為 `bond-quest` 的 **Public** 空 repo（不要勾 README / .gitignore），然後一條指令搞定：

```bash
npm run connect -- <你的GitHub用戶名>
```

它會自動：設定 `origin` → 把分支改名 `main` → 首次推送。
第一次推送時 **Git Credential Manager 會彈出瀏覽器**，按一次 **Authorize**，憑證就永久記住，之後 `push` 不再問。

想先看它會做甚麼（不推送）：`npm run connect -- <用戶名> --dry-run`

手動等價做法：

```bash
git remote add origin https://github.com/<你的帳號>/bond-quest.git
git branch -M main
git push -u origin main
```

首次推送會彈出瀏覽器授權，或使用 Personal Access Token（見 §4.4）。

### 4.2 開啟 GitHub Pages

Repo → **Settings → Pages** → **Build and deployment → Source** 選 **GitHub Actions**（**不要**選 "Deploy from a branch"）。

設定完第一次 push，`Deploy` job 會給你網址：`https://<帳號>.github.io/bond-quest/`。

### 4.3 權限（workflow 已寫好，這裡是核對）

```yaml
permissions:
  contents: read      # 讀原始碼
  pages: write        # 寫 Pages
  id-token: write     # OIDC，deploy-pages 必要
```

另需 Repo → **Settings → Actions → General → Workflow permissions** 允許 Actions 執行（預設已開）。
若 repo 有 branch protection，請容許 Actions 讀取（不影響 push 觸發）。

### 4.4 本機憑證（Windows）

```bash
git config --global credential.helper manager   # 一次登入，之後自動記住
```

或用 Fine-grained PAT（權限只需 `Contents: Read and write`），推送時貼上作密碼。

### 4.5 通知用 Secret（可選但建議）

Repo → **Settings → Secrets and variables → Actions → New repository secret**
新增 `DEPLOY_WEBHOOK`，值為 Slack / Discord / 企業微信 的 Incoming Webhook URL。
未設定也不會報錯（workflow 內已做空值保護）。

---

## 5. 日常使用

### 模式 A：邊改邊看（本機，不部署）

```bash
npm run watch
```

另開一個終端 preview：

```bash
python -m http.server 8080 -d site
# 開 http://localhost:8080
```

### 模式 B：存檔即上線（全自動，推薦）

```bash
npm run watch:push
```

之後每次 `Ctrl+S`：建置 → 驗證 → 自動 commit → push → CI 部署。**不用再碰任何指令**。

### 模式 C：改完一次過發佈

```bash
npm run ship -- "更新任務面板文案"
```

### 模式 D：手動檢查

```bash
npm run build     # 建置 + 驗證
npm run verify    # 只跑守門檢查
```

### 模式 E：產生上傳包

```bash
npm run upload    # 建置 → 驗證 → 產出 dist/
```

`dist/` 內容：`index.html`、`version.json`（版本戳）、`404.html`、`_headers`（HTML 不快取）、`.nojekyll`。
這個資料夾可以直接丟到任何靜態主機（Netlify Drop、Cloudflare Pages、GitHub Pages），不需要改任何設定。

> 想調延遲：`DEBOUNCE_MS=1200 npm run watch:push`（慢速硬碟或大檔案時有用）。

---

## 6. 失敗處理

### 6.1 失敗類型與行為

| 失敗點 | 現象 | 系統行為 | 線上版本 |
|---|---|---|---|
| JS 語法錯 | `[FAIL] 三支原始 JS 語法正確` | 阻止提交／推送，回滾本機產物 | 不變 |
| 模板佔位符寫錯 | `[FAIL] 沒有殘留佔位符` | 同上 | 不變 |
| 產物過細 | `[FAIL] 檔案體積 >= 600 KB` | 同上 | 不變 |
| `site/` 未同步 | `[FAIL] site/index.html 與根目錄一致` | 同上 | 不變 |
| Python 未安裝 | `找不到 Python` | 直接報錯，不建置 | 不變 |
| 推送被拒（非 fast-forward） | `git push 失敗` | 提示先 `git pull --rebase` | 不變 |
| CI 建置失敗 | Actions 紅色 ✗ | 停止在 `build` job，**不會**執行 `deploy` | 不變 |
| Pages 部署失敗 | `deploy` job 失敗 | 舊版本繼續服務（Pages 原子替換） | 不變 |

**核心保證**：`deploy` job 有 `needs: build`，build 失敗就不會部署。所以「壞版本上線」這件事在本管線裡不可能發生，最壞情況只是「線上停在上一版」。

### 6.2 通知（三層，由近到遠）

1. **終端機** — 即時彩色日誌 + 提示音（`\a`），無需設定。
2. **Windows 桌面氣泡** — 建置失敗／驗證失敗／推送失敗自動彈出（`scripts/notify.mjs`）。
3. **GitHub Actions** —
   - 失敗預設寄 email 給 repo owner（Settings → Notifications 可調）；
   - 若設了 `DEPLOY_WEBHOOK`，失敗時自動 POST 到 Slack／Discord／企業微信，訊息含 run 連結；
   - Commit 旁會出現紅 ✗，可直接點入看哪一步掛、哪一行錯。

### 6.3 完整日誌

```bash
tail -n 40 logs/deploy.log      # 本機每次建置的時間、耗時、失敗原因
```

CI 的日誌在 GitHub → Actions → 對應 run → 展開 `建置` / `守門檢查`。

---

## 9. 分享連結與更新機制（WorkBuddy 站點）

**現用連結（固定不變）**

```
https://bond-quest.app.workbuddy.host/?sharecode=UXRUYBRT6X
```

**兩條線上鏈接對照（2026-11-27 起內容逐位元組一致）**

| 鏈接 | 更新機制 | 適用 |
|---|---|---|
| `https://bond-quest.app.workbuddy.host/?sharecode=UXRUYBRT6X` | 手動重新發佈 `site/`（appId `wbapp_TgQ6cTAiyoqwbKTyZMQz4R`） | 已分享出去的固定連結 |
| `https://lukaslau0123-ux.github.io/bond-quest/` | `git push` → CI 自動建置發佈 | 永遠最新版本、公開分享 |

> 兩者差異只有 build 戳記的時區字串，內容雜湊（去除戳記後）完全相同。

### 9.1 為甚麼連結不會變

發佈是綁在一個 **appId**（`wbapp_TgQ6cTAiyoqwbKTyZMQz4R`）上的。重新發佈時：

```
本地 site/  →  壓縮上傳  →  覆寫同一個 app 的沙箱  →  同一個 sharecode 指向新內容
```

所以 `sharecode=UXRUYBRT6X` 永遠有效，**你不需要重新取得連結**，已收到連結的人 `F5` 就看到最新版。

### 9.2 已完成的實測

| 步驟 | 線上位元組 | 線上 SHA-256 | 建置戳記 |
|---|---|---|---|
| 第一次發佈 | 828,141 | `c9c5619f…` | — |
| 修改 → `npm run upload` → 重新發佈 | 828,198 | `3db7bd05…` | 22:27:39 |
| 加入手機虛擬搖桿後重新發佈 | 838,391 | `7955209e…` | 23:00:46 |
| 用**同一條連結**重新抓取 | 828,198 | `3db7bd05…` | 22:27:39 |
| 2026-11-27 · 隊伍／元素／Boss 全線更新 | 1,155,877 | `dd4b0fad…` | 09:41:32 |

連結完全相同，內容已被替換，且線上檔案的 SHA-256 與本地 `dist/index.html` **逐位元組一致**。

### 9.3 更新流程

```bash
npm run upload     # 1. 建置 + 驗證 + 出包
                   # 2. 重新發佈同一個應用（說一句「更新上線」即可）
```

> **本專案規則**：每次改動後都要重新發佈一次，讓線上連結保持最新（用戶 2026-11-21 指示）。
> 每次發佈後用 `curl` 比對線上 SHA-256 與 `dist/index.html` 是否一致，才算完成。

或用 §4 的 GitHub Pages，達到 `git push` 全自動。

### 9.4 如何確認線上是不是最新版

在線上頁面 **右鍵 → 檢視網頁原始碼**，第 4 行：

```html
<!-- build: 2026-11-21 22:27:39 | src: c57e7c605faa -->
```

時間戳比你的建置時間新，就是最新版。

### 9.5 限制（重要）

1. **不是「存檔即上線」**：WorkBuddy 沙箱是快照，不會監看你的本地資料夾。`npm run watch` 只更新本機，要上線仍需重新發佈一次。真正全自動請走 §4。
2. **sharecode 就是存取憑證**：任何拿到這條連結的人都能玩，請勿公開發佈在公開論壇。
3. **瀏覽器／學校網絡快取**：極少數情況仍見舊版，`Ctrl+F5` 強制重新整理。
4. **`version.json` 只在一般靜態主機有效**：WorkBuddy 站點只服務入口頁，直接開 `/version.json` 會顯示「連結不完整」，屬正常。
5. **手機未支援**：仍只有鍵盤 + 滑鼠操作（無虛擬搖桿），手機開啟會看到提示但無法遊玩。
6. **單檔 808 KB**：首次載入需下載整個遊戲（含 Three.js），學校網慢時會等幾秒。

---

## 10. 回滾（已上線但發現問題）

**方法 1：反轉提交（推薦，保留歷史）**

```bash
git revert <壞掉的 commit>
git push
```

CI 會自動重新部署回上一個狀態。約 1–2 分鐘。

**方法 2：重新部署舊版**

GitHub → Actions → 找到上一個成功的 run → **Re-run all jobs**。

**方法 3：本機產物回滾**

`logs/last-good.html` 永遠是「上一個通過驗證」的成品，可直接複製回 `site/index.html` 手動應急。

---

## 11. 其他需要知道的限制

1. **更新不是「即時」而是「1–2 分鐘」**：Actions 排隊 + 建置 + Pages CDN 傳播。若要做到 10 秒級，用 Plan B（Cloudflare 直傳）。
2. **Pages CDN 會快取**：更新後如果還看到舊版，`Ctrl+F5` 強制重新整理（或無痕視窗）。
3. **單檔 809 KB**：首次載入需下載整個遊戲（含 Three.js）。學校網慢的話建議之後把 `_vendor/three.min.js` 改成外部 CDN 或 gzip（本方案未改動遊戲邏輯）。
4. **手機未支援**：遊戲仍只有鍵盤／滑鼠操作，自動部署不改變這點。
5. **`_src` 是唯一真實來源**：直接改 `index.html` 會在下次建置被覆蓋，請改 `_src/`。

---

## 12. Plan B：Cloudflare Pages（想更快）

```bash
npm i -D wrangler
npx wrangler pages deploy site --project-name bond-quest
```

- 首次會要求 `CLOUDFLARE_API_TOKEN`（權限：`Cloudflare Pages: Edit`）。
- 直傳約 **10–20 秒**生效，並自動產生每次部署的預覽網址。
- 可把上面指令加進 `ship.mjs` 的推送後步驟，做到「存檔 → 20 秒上線」。
- 對比：GitHub Pages 免 token、與 git 綁定、有完整歷史；Cloudflare 更快但要管 token。

---

## 13. 驗收清單

- [x] `git` repo 已建立，產物與日誌已排除
- [x] `python build.py` 產出 1129 KB、`site/` 同步
- [x] `node scripts/verify.mjs` 9/9 通過
- [x] `npm run watch` 存檔後 1.1 秒完成重建（已實測）
- [x] 故意寫壞 `data.js` → 驗證失敗、阻止部署、自動回滾（已實測）
- [x] `node scripts/ship.mjs` 建置→驗證→提交 全鏈路通過（已實測）
- [x] `npm run upload` 產出 `dist/`（版本戳 + 快取標頭）
- [x] WorkBuddy 站點已發佈，連結 `?sharecode=UXRUYBRT6X`
- [x] 重新發佈後同一連結內容更新（線上 SHA-256 = 本地，已實測）
- [x] 推到 GitHub：`origin` = `lukaslau0123-ux/bond-quest`（public，已推送）
- [x] Settings → Pages → Source 選 GitHub Actions（Pages 已啟用，CI 綠燈）
- [x] 兩條線上鏈接內容一致（去 build 戳記後 SHA-256 相同，2026-11-27 實測）

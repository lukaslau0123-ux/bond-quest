# 雲端帳號系統 — 鍵界 Bond Quest

> 這份文件取代先前的本機帳號方案。現時帳號由 **WorkBuddy 雲服務** 處理：真正的伺服器端認證、跨裝置登入、資料以 owner 隔離。
> 舊的 `_src/auth.js`（PBKDF2 + AES 本機加密帳號）已移除。

## 一、雲端設定（已完成）

| 項目 | 值 |
|---|---|
| 應用 | `wbapp_TgQ6cTAiyoqwbKTyZMQz4R`（鍵界 Bond Quest，公開網站已發佈） |
| 雲服務狀態 | `billingStatus: normal`、`provisionStatus: assigned` |
| resourceId | `wbcs_mb2vnpqp0IA9o8T2E3L9We` |
| endpoint | `https://bond-quest.app.workbuddy.host` |
| publishableKey | `wbpk_TgQ6cTAiyoqwbKTyZMQz4R_…`（可放前端；伺服器另有 Origin 校驗） |
| 認證方式 | Email 一次性驗證碼（OTP） |

`publicConfig` 內三個值寫在 `_src/cloud.js` 的 `CFG`，全部來自 `workbuddy_cloud_service` 回傳，沒有硬編其他網域。

### 資料表 `progress`

```sql
CREATE TABLE progress (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    TEXT NOT NULL DEFAULT auth.uid(),
  owner_name  TEXT,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT progress_owner_key UNIQUE (owner_id)
);
```

一行一個玩家（`UNIQUE (owner_id)` 讓 `upsert` 有 conflict target）。

### RLS（唯一的安全邊界）

| 政策 | 指令 | 角色 | 條件 |
|---|---|---|---|
| `progress_select_own` | SELECT | `authenticated` | `owner_id = auth.uid()` |
| `progress_insert_own` | INSERT | `authenticated` | `WITH CHECK (owner_id = auth.uid())` |
| `progress_update_own` | UPDATE | `authenticated` | `USING` 與 `WITH CHECK` 都是 own |
| `progress_delete_own` | DELETE | `authenticated` | `owner_id = auth.uid()` |

加上兩層防線：

1. **Grant**：只給 `authenticated`；`anon` 已 `REVOKE ALL`。
2. **Policy**：即使有 grant，也只看到 `owner_id = auth.uid()` 的行。

`owner_id` 由 `DEFAULT auth.uid()` 填入，**前端永遠不送這個欄位**，所以偽造他人 owner 會被 `WITH CHECK` 拒絕。

## 二、前端整合點（`_src/cloud.js`）

### 初始化（一次）

```js
const sdk = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: CFG.endpoint,
  oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
  publishableKey: CFG.publishableKey
});
```

SDK 由 CDN 載入（單檔靜態站，無 build step）：

```html
<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"></script>
```

### 認證流程

```
輸入電郵 → 驗證 → cloud.auth.sendOtp({ email })
        → 平台寄出 6 位驗證碼 → 前端暫存 { email, verificationId, isExistingUser }
輸入驗證碼 → cloud.auth.verifyOtp({ email, verificationId, isExistingUser, token })
        → 成功：SDK 建立工作階段（自動持久化）
        → 失敗：顯示「驗證碼唔正確或已過期」
```

首次使用同一電郵會自動註冊（`isExistingUser: false` → 免密碼 signup）。**整個系統沒有密碼**：沒有密碼就沒有外洩、也沒有重設流程要維護。

### 工作階段

| 行為 | 實作 |
|---|---|
| 重開頁面仍登入 | SDK 自行保存 token，`init()` 時 `cloud.auth.getSession()` 還原 |
| 跨裝置 | 同一帳號在另一部機登入，讀同一行 `progress` |
| 工作階段變更 | `cloud.auth.onAuthStateChange()` 同步 UI（例如其他分頁登出） |
| 登出 | `signOut()`，先 flush 最後一次進度，再回首頁（訪客狀態） |

### 進度同步

- 存：每次遊戲事件 → `CLOUD.save()`（900ms 防抖）→ `upsert({ data, owner_name, updated_at }, { onConflict: 'owner_id' })`
- 讀：登入後 `select('data').maybeSingle()`
- 訪客：寫 `localStorage['bq_guest_v1']`；登入時若雲端沒有資料而本機有訪客進度，會詢問是否上傳

## 三、輸入驗證與錯誤提示

| 檢查 | 規則 | 提示 |
|---|---|---|
| 電郵空白 | 必填 | 請輸入電郵 |
| 電郵格式 | `x@y.zz`，上限 120 字 | 電郵格式唔啱，例如 you@example.com |
| 驗證碼 | 必須 6 位數字（輸入時自動過濾非數字） | 請輸入 6 位數字驗證碼 |
| 未取碼就提交 | `pending` 不存在或電郵已改 | 請先為呢個電郵取得驗證碼 |
| 驗證碼錯誤／過期 | 後端回錯 | 驗證碼唔正確或已過期，請重新輸入或重新發送 |
| 發送太頻繁 | 429 / rate limit | 發送太頻繁，請稍等一分鐘再試 |
| 網絡問題 | `network` / `backend-unavailable` | 網絡或伺服器暫時不可用，請稍後再試 |

錯誤一律顯示在**對應欄位下方**或表單訊息區，不用 `alert`。後端原始訊息（例如 `rpc error … %!(EXTRA …)`）會被過濾，不會直接給玩家看到。

帳號是否存在**不會**在文案中洩露（避免帳號探測）。

## 四、安全處理

1. **無密碼**：只用一次性 OTP，不存在密碼儲存／傳輸問題。
2. **前端不持有長期密鑰**：`publishableKey` 只識別應用，權限由伺服器 Origin 校驗 + RLS 決定。
3. **不送 `owner_id`**：由 `DEFAULT auth.uid()` 決定，`WITH CHECK` 擋偽造。
4. **雙層門**：grant（anon 全撤）+ RLS（owner only）。
5. **token 不落地到程式碼**：SDK 保存 access token 與 `wbrt_` refresh handle，不經我們的程式碼、不寫 log、不放 URL。
6. **錯誤訊息不洩露內部細節**：不顯示原始 gRPC／SQL 訊息。
7. **未登入不可寫**：`anon` 連 INSERT 權限都沒有。

## 五、實測紀錄（2026-11-22，線上 `https://bond-quest.app.workbuddy.host`）

| 測試 | 結果 |
|---|---|
| SDK 載入 | `typeof WorkBuddyCloud === 'object'` |
| Origin 校驗 | `onPublishedOrigin: true`、`hasSdk: true` |
| 初始狀態 | `signedIn: false`，`getSession()` 無 session |
| 空電郵提交 | 顯示「請輸入電郵」 |
| 格式錯電郵 | 顯示「電郵格式唔啱…」 |
| `sendOtp` 真實請求 | 成功，回傳 `verificationId`，UI 顯示「已寄出」與 60 秒倒數 |
| 錯誤驗證碼 | 顯示「驗證碼唔正確或已過期」，未建立 session |
| 短驗證碼 | 前端攔截「請輸入 6 位數字驗證碼」，不發請求 |
| 關窗再開 | 保留已寄出的電郵與驗證碼欄位（不必重新發送） |
| **資料隔離** | DB 內植入 2 行（`test-user-a` / `test-user-b`），未登入查詢回傳 **0 行** |
| **撤權後** | 未登入查詢回 `DATABASE_42501`（permission denied） |
| 測試資料清理 | `SELECT count(*) FROM progress` → `0` |

## 六、需要留意

1. **只能在已發佈網域使用**：雲端認證要求 Origin 完全一致。用 `file://` 或 `localhost` 打開會顯示「雲端帳號只可以在已發佈網址使用」，這是平台邊界，不是 bug。
2. **需要網絡**：SDK 由 CDN 載入，離線時帳號視窗會提示「SDK 未載入」，遊戲本體仍可玩（訪客進度存本機）。
3. **Email 供應商由平台管理**：寄件人、模板、額度都在 WorkBuddy 管理頁；應用程式碼不應自行設定 SMTP。
4. **驗證碼有時效與次數限制**：由平台控制；重發有 60 秒倒數。
5. **未完成真實登入驗證**：`verifyOtp` 需要真實收件箱的驗證碼。本次已驗證到「發送成功 + 驗證碼錯誤處理 + 資料隔離」；最後一步（成功登入 → 雲端寫入 → 重開還原）需要一個可收信的電郵做一次登入。

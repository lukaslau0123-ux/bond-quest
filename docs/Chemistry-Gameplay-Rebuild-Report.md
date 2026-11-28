# Bond Quest — 化學玩法重建報告

> 對象：F4E Interdisciplinary Project「Chemical Bonding Web Game」
> 專案路徑：`C:\Users\user\OneDrive\Desktop\bond-quest`
> 建置產物：`index.html` / `site/index.html`（1326 KB，單檔離線，9/9 檢查通過）
> 本報告每一節先寫「問題」，再寫「方案」。方案內的每一項都指向實際檔案／行號／數值。

---

## 目錄

1. 指引要求摘要與落差
2. 現有答題玩法診斷
3. 答題方法重新設計
4. 新手教學重寫（原神式引導）
5. 卡住／穿模／互相遮擋
6. Boss 設計與實作
7. 驗收對照

---

## 一、指引要求摘要與落差

### 問題

專案原本是照著自己寫的 `docs/BondRealm_Game_Requirements.md`（研發規格書）在做，而不是照著評分表在做。兩者方向不同：

- 研發規格談「戰鬥系統、角色、抽卡、地圖、傳送點」——這是遊戲性的擴張；
- 指引（`1st Term F4E Interdisciplinary Project Guidelines.docx`）講的是**「這不是編程比賽」**，目的是「學生透過設計一個能教人的東西，來鞏固與溫習 chemical bonding，並產出一個其他班真的可以用的溫習工具」。

結果就是：一個約 1.4 萬行（`_src/` 共 14,164 行）的動作遊戲，化學題只佔其中一個彈出視窗；而化學題佔整份功課的 **60%**。投入與分數完全錯配。若照現狀交，最大的風險是 R3（迷思糾正）與 R2（點叉圖與電子核算）兩項各 20% 直接失分，因為原版連一張圖都沒有。

### 方案

**1.1 交付物與配分（原文摘錄）**

| 項目 | 比重 | 期限 |
|---|---|---|
| Chemical Bonding Web Game | **60%** | 2026-12-18（五） |
| Poster | 20% | 同上 |
| Presentation in English | 10% | 2026 年 12 月 |
| Peer evaluation | 10% | — |

**1.2 遊戲評分表（Table 2，五項各 20%）對照實作位置**

| 準則 | 指引原文要求 | 本專案對應實作 |
|---|---|---|
| R1 準確性 | 三種鍵定義與應用無誤，含陌生化學式 | `_src/data.js` 27 個化合物；`_src/game.js:1194 explain()` 逐類別規則文字 |
| R2 點叉圖與電子核算 | 只畫外層電子、點叉一致、電子總數正確、離子括號與電荷、共用電子對、bond pair／lone pair 數目 | `_src/game.js:1890 openDotCross()`（8 塊點叉板）；`_src/game.js:1737 checkPairs()`（電子對計數步驟） |
| R3 迷思糾正 | **至少三個**迷思，做成選項，並解釋「為何錯的想法會失敗」 | `_src/data.js` 6 個 `trap`（nacl/o2/co2/cu/nh3/bf3）；`_src/game.js:1251 stepWhy()` 逐「班別 × 所選選項」的解釋文字 |
| R4 覆蓋與進度 | 三類均衡、由淺入深、含陌生化學式、**giant structure vs simple molecule**、術語表 | `_src/game.js:1377 dialogKinds()`（giant 判斷）；`_src/game.js:1577 structureExplanation()`；術語表 14 條 |
| R5 學習設計 | 提示、解釋性回饋、**最後溫習總結**、**6–10 分鐘遊玩時間**、同儕試玩證據 | `_src/game.js:2507 computeSummary()` / `:2524 showSummary()`；提示按鈕；`REWARD_RULES` 節奏 |

**1.3 指引 Step 1 的指定流程（必做）與現況**

指引原文給的範例是 NaCl：
1. MCQ1「化學式中的元素是」→ A 金屬＋非金屬 / B 非金屬＋非金屬 / C 只有金屬
2. MCQ2「上述化學鍵的特性」→ 電子轉移 / 電子共用 / 離域電子
3. MCQ3「屬於哪種化學鍵」→ ionic / covalent / metallic
4. **若判定為 covalent，還要填「___ lone pair(s)、___ bond pair(s)」**

現況：前三題完全對應 `_src/game.js:1174 optionSets()` 的 `s1/s2/s3`；第四項原本缺失（見第二節問題 6），現已補上 `pairs` 步驟，但**只對「有 `pairs` 資料的簡單分子」觸發**，這是 R2／R4 的實際風險點。

**1.4 指引要求的內容範圍 vs 目前可達性（真實缺口）**

指引列出的必備例子中，以下 11 個化合物**沒有任何任務點可以到達**：
`Na`、`CaO`、`CH₄`、`HCl`、`Zn`、`BCl₃`、`SO₂`、`PH₃`、`Mg₃N₂`、`graphite`、`Au`。

其中三個是**指引明文點名**的：`Mg₃N₂`（ionic 例子）、`BCl₃`、`SO₂`（covalent 例子），而 `graphite` 是「giant covalent」的代表——這是 R4「giant structures vs simple molecules」的直接扣分位。

**1.5 建議的修補（不改架構，只補節點）**

在 `_src/data.js` 的 `NODES` 陣列補 4 個 NPC 節點即可補齊最關鍵缺口（每個節點 3–5 題，約 40 秒）：

| 建議 id | zone | 座標 (x,z) | compound | 理由 |
|---|---|---|---|---|
| `s14` | A | (-24, 34) | `mg3n2` | 指引點名的 ionic 例子，且 `comp` 與 `bond` 不一致的教學價值高 |
| `s15` | B | (46, -22) | `so2` | 指引點名的 covalent 例子；同時可補 `pairs` 資料 |
| `s16` | C | (-92, 62) | `graphite` | giant covalent，補 R4 的結構對比 |
| `s17` | D | (88, 88) | `nh4cl` 已有 → 改放 `c60` | 第二個 giant 例子（`c60` 目前無節點） |

補完後 `pairs` 資料也要同步補：`so2` 加 `pairs:{sym:'S',lone:1,bond:2}`、`graphite`／`c60` 屬於 giant，依現有邏輯不會觸發 `pairs` 步驟（正確行為，因為它們不是簡單分子）。

**1.6 內容清點（實測，`_src/data.js`）**

| 項目 | 數量 | 明細 |
|---|---|---|
| 化合物總數 | 27 | 見下 |
| ionic | 6 | `nacl, na2o, mgcl2, cao, mg3n2, nh4cl` |
| covalent | 15 | `h2, o2, h2o, co2, ch4, cl2, hcl, nh3, bf3, bcl3, so2, ph3, diamond, graphite, c60` |
| metallic | 6 | `fe, na, cu, al, zn, au` |
| 有電子對資料（`pairs`） | 12 | `h2, o2, h2o, co2, ch4, cl2, hcl, nh3, bf3, bcl3, ph3, diamond` |
| 有迷思選項（`trap`） | 6 | `nacl, o2, co2, cu, nh3, bf3` |
| 任務節點 | 30 | 9 主線 + 16 NPC + 6 寶箱 + 6 水晶 |
| 可到達的化合物 | 16 / 27 | 11 個不可達（見 1.4） |
| 點叉板 | 8 | 6 塊有接線，`dc-h2`／`dc-cl2` 孤立 |
| 術語表 | 14 | `ionic, covalent, metallic, delocalised, cation, anion, lone, bondpair, octet, electrostatic, lattice, simplemol, giantcov, electroneg` |

> 對照 R4「三類均衡」：ionic 6 / covalent 15 / metallic 6。covalent 內部又分成 12 個簡單分子 + 3 個巨觀結構（diamond / graphite / c60），這個結構其實是健康的——但**graphite 與 c60 都沒有節點**，所以巨觀結構只剩 diamond 一個能玩到，這就是 R4 的實際缺口。

> **（待補充：是否要補齊全部 11 個不可達化合物，還是只補指引點名的 4 個？全部補齊約需 +2 小時資料工作與 4 個新節點，會把單輪遊玩時間從約 7 分鐘推到 10 分鐘以上，逼近 R5 的 6–10 分鐘上限。）**

---

## 二、現有答題玩法診斷（為何又怪又難玩）

### 問題

原版（`dist/index.html`，1,267,359 bytes，保留作為 before 證據）的答題畫面，實測數據如下：

```
卡片位置／尺寸：429,231,583,457      ← 583 px 寬
三個選項尺寸：518x45 / 518x45 / 518x45   ← 完全等寬等高
進度指示：.stepDots 3 個點
svg 數量：0        img 數量：0        ← 整題沒有一張圖
題目：What types of elements are in H₂O?
副標：Question 1 of 3 · Choose one answer.
按鈕文字：Non-metal atoms only / A metal + a non-metal / Metal atoms only
```

「又怪又難玩」不是單一 bug，是九個設計問題疊加：

**問題 1 — 化學是一門看圖的科目，題目卻是一張純文字卡。**
`svg=0, img=0`。dot-and-cross、離子晶格、電子海，全部只能靠文字描述。學生答題時腦中要自己「砌圖」，等於在考記憶而不是考理解；R2（20%）的「圖示與電子核算」根本沒有呈現媒介。

**問題 2 — 選項沒有視覺層級，三個按鈕一模一樣。**
518×45 的等寬等高等權重按鈕，沒有任何「這是主要選項」的引導，也沒有 A/B/C 字母標記。使用者在 13.5px 的文字牆裡逐個讀，視線沒有落點。

**問題 3 — 進度條只講「第幾題」，不講「你現在在做哪一種思考」。**
`Question 1 of 3` 是進度，不是目標。學生不知道自己此刻是被要求「辨認粒子」還是「追蹤電子」還是「下結論」——而這三步其實是有因果關係的一條推理鏈。

**問題 4 — 三題被呈現成三個獨立的常識題，而不是一條推理鏈。**
`comp → ebeh → bond` 的內在邏輯是：元素種類決定電子行為，電子行為決定鍵的種類。原版 UI 完全沒有把這個依賴關係畫出來，於是學生可以用「背答案」的方式三題全對而完全不懂。

**問題 5 — 答錯時，第一眼看到的是「正確答案」，而不是「你錯在哪」。**
原版 `renderDialogFeedback()` 的 HTML 順序是：先 `✓ Correct answer` + 正確選項 + 解釋，**然後** 才 `× Your answer`。紅色錯誤區塊在綠色正確區塊下面——使用者的注意力已經被正確答案吸走，R3「解釋為何錯的想法會失敗」的教育效果被稀釋。

**問題 6 — 沒有電子對的算術，指引要求的第四問被跳過。**
指引明文：「若判定為 covalent，學生還要填 ___ lone pair(s)、___ bond pair(s)」。原版完全沒有這個步驟。而且既使後來補了，`so2`／`graphite`／`c60` 三個 covalent 化合物**沒有 `pairs` 資料**，`dialogKinds()` 會靜默跳過 COUNT 步驟——學生不會知道少了一題，老師也不會知道。

**問題 7 — 第一次答題就懲罰玩家。**
原版第一次打開化學題時，答錯會呼叫 `breakStreak()` 直接斷連勝、扣獎勵。新手教學還沒教完就先被扣分，這是最典型的「教學敵意」設計。

**問題 8 — 彈窗是硬切換，動作遊戲的節奏被斬斷。**
遊戲是即時動作（WASD + 連擊 + 閃避），按 E 之後整個畫面被 583 px 的文字卡蓋住，沒有轉場、沒有音效過渡、沒有任何「你正在做一件重要的事」的儀式感。玩家從「打怪」掉進「填問卷」，兩種心智模型互相打架。

**問題 9 — 完全沒有 Boss 的血量與狀態讀數。**
原版連 `boss` 這個字在 `_src/template.html` 與 `_src/styles.css` 都搜不到。Boss 有攻擊預警動畫，但玩家不知道還有多少血、不知道牠正在蓄力還是恢復——R5「遊戲是否真的可用」直接受影響。

### 方案

以下九項全部已實作並通過實測，逐項對應上面的問題編號。

**方案 1（對應問題 1）— 左證據面板 + 右問題面板的雙欄課程版面**

新增 `_src/game.js:1386 chemistryDiagram(c, kind)`，為每一種題型產生一張 inline SVG 或 HTML 證據圖：

| kind | 證據圖內容 |
|---|---|
| `comp` | `.elementCards`：兩個元素卡（如 `O` NON-METAL ＋ `H` NON-METAL），中間 `+` |
| `ebeh` | 電子轉移箭頭（ionic）／共用電子對（covalent）／電子海（metallic） |
| `bond` | 離子晶格 ＋ 電荷（ionic）／兩核共用一對電子（covalent）／正離子浸在電子海（metallic） |
| `pairs` | `.moleculeSvg` 分子骨架，金點＝本原子電子、藍點＝另一原子電子，附顏色圖例 |
| `structure` | 簡單分子 vs 連續共價網狀結構對比 |

版面由 `_src/styles.css:182 .chemLessonGrid{display:grid;grid-template-columns:minmax(280px,.88fr) minmax(350px,1.12fr)}` 定義；左欄 `_src/styles.css:183 .chemVisual{position:sticky;top:0}` 讓證據圖在滾動時固定，右欄是題目。使用 `_src/game.js:1426 questionShell(c,kind,content)` 把「目標條 + 雙欄」包成每一題的外殼。

實測（1440×900）：`grid=261,376,914,291`、`visual=261,376,393,291`、`question=676,376,500,241`，選項高度 `53,53,53`。

**方案 2（對應問題 2）— 選項改為三欄網格加字母徽章**

`_src/styles.css:200` 起：`.opt` 改為 `grid-template-columns:30px 1fr 20px`，三個格子分別是

- `.optLetter`：30×30 圓角字母徽章（A / B / C）
- `.optText`：選項文字
- `.optArrow`：`→` 提示可點

高度由 `min-height` 統一為 53 px，不再是 45 px 的死板等寬條。

**方案 3（對應問題 3）— 每一題都有「思考動作」的目標條**

`_src/game.js:1426 questionShell()` 產生 `.lessonObjective`，格式為 `STEP n / total · 動作 · 說明`：

| 步驟 | 目標條文字 |
|---|---|
| 1 | `LOOK · Identify the elements` |
| 2 | `TRACE · Follow the outer electrons` |
| 3 | `CONCLUDE · Name the attraction` |
| 4 | `COUNT · Account for electron pairs` |
| 5 | `COMPARE · Molecule or giant structure?` |

**方案 4（對應問題 4）— 把三題的因果關係寫進畫面**

證據面板在每一題都保留同一張公式與粒子圖，只切換「聚焦層」。學生看到的是同一個物件被逐步追問，而不是三個互不相干的問題。配合步驟 5 的 `structure` 題（僅節點 `n9` 觸發，見 `_src/game.js:1350`），把「同一種鍵、不同結構」的對比做成最後一問。

**方案 5（對應問題 5）— 三段式回饋卡，順序改為「你答了什麼 → 為何失敗 → 正確規則」**

`_src/game.js:1232 wxCard(you, why, rule, title, opts)` 產生兩個色塊：

```
┌─────────────────────────────────────────┐
│ ✗ MISCONCEPTION REPAIR        （紅）      │
│ 你選的答案：Metal atoms only              │
│ 為何錯：There is no metal atom in H₂O;   │
│          all the atoms are non-metals.   │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ ✓ THE WORKING RULE            （綠）      │
│ 正確答案：Non-metal atoms only            │
│ 規則：All the atoms are non-metals, so   │
│       no atom easily loses electrons —   │
│       they share electrons instead.      │
└─────────────────────────────────────────┘
```

這正是指引 (h)「用同儕聽得懂的話解釋為何錯的答案是錯的」與 R3 的落地形式。實測輸出：

```
fb=MISCONCEPTION REPAIR | Metal atoms only | There is no metal atom in H₂O; all the atoms are non-metals.
fb=✓ THE WORKING RULE  | Non-metal atoms only | All the atoms are non-metals, so no atom easily
                                                loses electrons — they share electrons instead.
```

**方案 6（對應問題 6）— 補上電子對計數步驟（指引指定第四問）**

- `_src/game.js:1377 dialogKinds()`：`if (c.pairs && c.bond === 2 && !GIANT[c.id]) kinds.push('pairs')`
- `GIANT = { diamond: 1, graphite: 1, c60: 1 }`：巨觀結構不是簡單分子，正確地不問電子對
- 計數 UI 用 `_src/styles.css:218 .numberStepper{grid-template-columns:38px 1fr 38px}` 的 −／＋ 步進器，兩個輸入框（lone／bond），下方 `#electronTotal` 即時顯示算術：

```
electrons around O = 0×2 lone + 0×2 bond      ← 初始
→ 改成 2 / 2 後
electrons around O = 2×2 lone + 2×2 bond = 8  ← 即時更新
```

確認後回饋：`✓ REASONING LOCKED IN 2 lone pair(s) · 2 bond pair(s)`。

**必要的資料修補（R2 風險）**：`_src/data.js:80 so2` 目前無 `pairs`，需補 `pairs:{sym:'S',lone:1,bond:2}`，否則 SO₂ 永遠拿不到 COUNT 步驟。

**方案 7（對應問題 7）— 教學題零懲罰**

`_src/game.js:1346 openDialog()`：

```js
/* Genshin-style safe practice: the training question is a rehearsal, so a wrong
   pick costs nothing - no streak break, no score loss. */
const trainingRun = (tutStep === 4 || tutStep === 5);
dlg = { node, c, step: 0, ..., practice: trainingRun };
```

`_src/game.js:1635 pickOption()` 的錯誤分支改為 `if (!dlg.practice) breakStreak();`。

實測（`_qa-tut7`）：`beforeE step=4` → `afterE step=5 streak=7` → 教學中答錯 `streak=7`（維持）→ 非教學答錯 `streak=0`（正常扣）。**練習安全與正式計分同時成立。**

**方案 8（對應問題 8）— 彈窗改為 1050 px 課程卡，並讓世界繼續呼吸**

`#dialogModal .modalCard` 寬度改為 `min(1050px, 96vw)`、`max-height: 94vh`。進場用 `mo-in` 轉場，右上保留 `EN / 中文` 語言切換，左下 `Hint`、右下 `Leave`——把「離開」放在拇指／滑鼠最自然的位置，不逼玩家讀完才能走。

Boss 血條刻意放在 `top:78px`（`_src/styles.css:1245`），不與課程卡重疊，切題時世界不會被完全塗黑。

**方案 9（對應問題 9）— 新增 Boss HUD**

`_src/template.html:59` 新增：

```html
<div id="bossHud" aria-live="polite">
  <div class="bossTop"><span class="bossKicker" id="bossKicker">BOND GUARDIAN</span>
                       <span class="bossFamily" id="bossFamily">IONIC</span></div>
  <div class="bossName" id="bossName">Ionic Golem</div>
  <div class="bossBar"><i id="bossFill"></i><b id="bossCast"></b></div>
  <div class="bossFoot"><span id="bossHpText">330 / 330</span><span id="bossState">IDLE</span></div>
</div>
```

`_src/game.js:935 updateBossHUD()`：取 `WORLD.getBosses()`，選最近的存活 Boss，`BOSS_HUD_RANGE = 34` 公尺內才顯示；更新血量百分比、`hp / maxHp`、五段狀態（`HUNTING / STRIKING / CHARGING / RECOVER / HOLDING`）、蓄力條寬度 `cast / win`（golem 0.95s、hydra 0.72s、tyrant 0.82s），並在 12 公尺內把徽章改為 `BOND GUARDIAN · IN RANGE`。

實測：出現在 `440,78,560,101`；受傷時 `330 → 284 → 238 → 192` 對應 `100% → 86.1% → 72.1% → 58.2%`；擊殺後自動隱藏並交接下一個 Boss。

---

## 三、答題方法重新設計

### 問題

第二節列出的是症狀，這一節要處理的是**方法論**問題：原本的答題設計把「化學題」當成「知識問答」，而不是「推理訓練」。具體表現在三件事：

1. **選項設計沒有對錯的理由**——三個選項只是三個名詞，答錯不代表任何特定的迷思。
2. **答對沒有累積**——三步全部答對與三步猜對，得到的獎勵一樣。
3. **迷思沒有被命名**——指引要求「explicitly named（明確命名）」至少三個迷思，原版把它們藏在解釋文字裡，學生看完不知道「剛剛那個錯法叫什麼」。

### 方案

**3.1 答題流程（presentation）**

一輪完整答題 = 1 個化合物 × 3～5 步驟：

```
comp  → ebeh  → bond  → [pairs]  → [structure]
LOOK     TRACE    CONCLUDE  COUNT       COMPARE
（全化合物）（全化合物）（全化合物）（僅簡單分子）（僅節點 n9）
```

`_src/game.js:1377 dialogKinds()` 是唯一的流程來源。要新增／移除步驟只改這一個函式。

**3.2 互動設計（interaction）**

| 輸入 | 行為 |
|---|---|
| 滑鼠點擊 / 觸控 | 選項即時鎖定並展開回饋（`answerJuice()` 有震動、粒子、音效） |
| `↑` `↓` | 在選項間移動焦點，`.opt.kbdFocus` 顯示 `›` 游標 |
| `Enter` | 確認目前焦點選項 |
| `1` `2` `3` `4` | 直接選第 n 個選項（給鍵盤玩家） |
| `Esc` | 離開（等於 `Leave`） |

**3.3 一個關鍵的實作教訓（保留給後續維護者）**

`.opt` 是 `grid-template-columns:30px 1fr 20px` 的三欄網格。原本 `.opt.kbdFocus::before{content:'›'}` 使用 `display:inline-block`，等於**在網格裡插入了第四個流內項目**，把 `.optText` 擠進 20 px 的箭頭欄——第一個選項於是變成一條 406 px 高的垂直細條，文字一行一個字（`A / metal / + / a / non- / metal`）。

修法（`_src/styles.css:1298`）：把偽元素改成絕對定位，不參與網格排版。

```css
.opt{position:relative; ...}          /* _src/styles.css:146 */
.opt.kbdFocus::before{
  content:'›'; position:absolute; left:5px; top:50%;
  transform:translateY(-50%); color:#8ff0c8; font-weight:800; pointer-events:none;
}
```

修完後選項高度回到 `53,53,53`。**這條教訓適用於任何往 grid 容器加偽元素的情況。**

**3.4 迷思選項（R3 的落地）**

迷思不是寫在解釋裡，而是**做成第四個選項**。`_src/data.js` 的化合物可帶：

```js
trap:{ step: 3, en:'Covalent — NaCl is made of small molecules.',
       why:{ en:'NaCl is not molecular — it is a giant ionic lattice of Na⁺ and Cl⁻ ions. ...' } }
```

`_src/game.js:1463` 注入：`if (!pairsStep && c.trap && c.trap.step === dlg.step + 1) opts.push({ v:-1, ..., trap:true })`。
答對三個正常選項以外，還要「認得出這個錯法」。

目前已命名的迷思（6 個，超過指引要求的 3 個）：

| 化合物 | 步驟 | 迷思（錯的說法） | 為何失敗 |
|---|---|---|---|
| `nacl` | bond | 「NaCl 是小分子」 | 它是 Na⁺／Cl⁻ 的巨大離子晶格，化學式只表示 1:1 比例 |
| `o2` | bond | 「O₂ 是離子鍵」 | 兩個都是非金屬，沒有電子轉移 |
| `co2` | ebeh | 「CO₂ 靠離域電子」 | 沒有金屬，電子沒有海可以離域 |
| `cu` | ebeh | 「銅靠共用電子對」 | 金屬沒有共用電子對，是正離子浸在電子海 |
| `nh3` | ebeh | 「NH₃ 轉移電子」 | N 與 H 都是非金屬，只能共用 |
| `bf3` | bond | 「BF₃ 是離子化合物」 | B 與 F 都是非金屬 |

**實測輸出（NaCl 第三步）**：

```
選項：3=Metallic bond | 1=Ionic bond | -1=Covalent — NaCl is made of small molecules. | 2=Covalent bond
點 -1 →
MISCONCEPTION REPAIR | Covalent — NaCl is made of small molecules.
NaCl is not molecular — it is a giant ionic lattice of Na⁺ and Cl⁻ ions.
The formula only shows the ratio 1:1, not a molecule.
✓ THE WORKING RULE | Ionic bond | Oppositely charged ions attract each other electrostatically.
```

**3.5 計分（scoring）**

`_src/data.js` `REWARD_RULES`：

| 項目 | 數值 |
|---|---|
| 每答對一步 | +5 XP、+3 gold |
| 一次過完美（無錯、無提示） | +30 XP、+20 gold、+1 crystal |
| 連勝門檻 | 連續 3 步 |
| 連勝倍率 | ×1.5 |
| 每日首次 | ×2 |
| 每日自動補滿 crystal | 1 |

設計意圖：
- **步進獎勵**讓「答對第一步」也有回饋，不會因為最後一步答錯而全盤歸零；
- **完美獎勵**鼓勵「不按提示自己推理」，但**不懲罰**使用提示（只是拿不到 bonus）；
- **連勝 ×1.5** 只作用在獎勵倍率，不影響化學正確性——這點符合 `docs/BondRealm_Game_Requirements.md` 的紅線「化學正確性優先於樂趣，不做屬性抗性／等級壓制」。

**3.6 題目卡的實際版面（1440×900 實測）**

```
┌──────────────────────────────────────────────────────────────┐
│ HO  Water Nymph · H₂O                          [EN / 中文]   │
│ Goal: explain why H₂O has this bond type — not just its name. │
├──────────────────────────────────────────────────────────────┤
│ ① Elements │ ② Electrons │ ③ Bond type │ ④ Electron pairs    │
│ [STEP 1 / 4]  LOOK · Identify the elements                    │
├──────────────────────┬───────────────────────────────────────┤
│    H₂O               │ What types of elements are in H₂O?    │
│  ┌────┐ + ┌────┐     │ Choose the best answer. You will see  │
│  │ O  │   │ H  │     │ the reason immediately.               │
│  │NON-│   │NON-│     │ ┌──┬──────────────────────┬───┐       │
│  │METAL│   │METAL│    │ │ A│ A metal + a non-metal│ → │       │
│  └────┘   └────┘     │ ├──┼──────────────────────┼───┤       │
│ Identify the particles│ │ B│ Non-metal atoms only │ → │       │
│ ● electron           │ ├──┼──────────────────────┼───┤       │
│ ● electron from      │ │ C│ Metal atoms only     │ → │       │
│   another atom       │ └──┴──────────────────────┴───┘       │
│                      │ ↑ ↓ choose · Enter confirm             │
├──────────────────────┴───────────────────────────────────────┤
│ [Hint]                                          [Leave]      │
└──────────────────────────────────────────────────────────────┘
```

卡片 1050 px、左欄 393 px、右欄 500 px、選項 53 px 高。

---

## 四、新手教學重寫（原神式引導）

### 問題

原版教學（`TUT_KEY='bq_tut_v1'`，4 步）的問題：

1. **一步塞多個概念**。第 4 步用一句話講完「Elements → electrons → bond」，然後就叫玩家去答題——這是說明書，不是教學。
2. **沒有「做」的動作**。第 2 步只叫玩家「FOLLOW THE GREEN BEAM」，但沒有告訴玩家要走多遠、也沒有即時距離讀數，玩家不確定自己有沒有做對。
3. **沒有「看」的教學**。原版完全沒教鏡頭操作，但整個遊戲是 3D 的，不教轉視角等於讓玩家自己撞牆。
4. **沒有進度感**。`.bhBar` 只有一條 280 px 的進度條，只在第 1 步有用。
5. **第一次答錯就斷連勝**（見第二節問題 7）。
6. **通關沒有儀式**。答完就默默關窗，沒有任何「你學會了」的正回饋。

### 方案

**4.1 Genshin 式引導的五條原則 → 本專案的落地**

| 原則 | 落地做法 |
|---|---|
| 一次只教一個動作 | 5 步，每步只有**一個**動詞（走／看／靠近／按 E／選答案） |
| 即時、可見的回饋 | 每步都有 live 讀數：`0.0 / 8 m`、`37°`、`29 m` |
| 低風險練習 | `practice:true`，答錯零懲罰 |
| 視覺引導優先於文字 | 綠色光柱 + 距離讀數 + 按鍵膠囊 |
| 完成要有儀式 | 通關橫幅 + 音效 + 6.4 秒慶祝 |

**4.2 五步的內容（`_src/game.js:371 tutShow()`）**

| 步 | 按鍵膠囊 | 主標題 | 副標題（含 live 讀數） |
|---|---|---|---|
| 1 | `W` `A` `S` `D`（觸控：LEFT STICK） | `HOLD  W  TO WALK` | Walk 8 m and the bar fills. Nothing here can hurt you. **0.0 / 8 m** |
| 2 | `MOUSE`（觸控：RIGHT SIDE） | `MOVE THE MOUSE TO LOOK` | Sweep about a quarter turn. This is how you spot the green beam. **0°** |
| 3 | `W` `SHIFT` | `FOLLOW THE GREEN BEAM` | Talk to them: classify **NaCl** in 3 questions. **29 m** |
| 4 | `E` | `PRESS  E  TO TALK` | Close enough. E opens the chemistry question. |
| 5 | `CLICK` `↑` `↓` | `READ THE CLUE, THEN PICK` | Elements → electrons → bond type. A wrong pick costs nothing in training. |

**4.3 實作要點**

- `_src/game.js:354`：`const TUT_KEY = 'bq_tut_v2';` —— 換 key，讓舊存檔的玩家也會看到新教學。
- `_src/game.js:364`：`const TUT_LOOK_GOAL = 1.9;`（約 110°）與 `TUT_MOVE_GOAL = 8`（公尺）並列。
- `tutShow(step)` 改成資料表 `const S = {1:…, 2:…, 3:…, 4:…, 5:…}[step]`，每筆 `{step, keys:[…], text, sub}`；`keys.map(k => '<kbd>'+k+'</kbd>')` 產生按鍵膠囊。
- 新增 `_src/game.js:413 tutLive(msg)`：寫入 `#bhLive`，這是「即時讀數」的唯一出口。
- `_src/game.js:510 tickTutorial()`：
  - 第 1 步累加行走距離，`tutLive(tutMoved.toFixed(1) + ' / 8 m')`，≥8 m 進第 2 步；
  - 第 2 步累加 `Math.abs` 的 wrap 後 yaw 差（`while (dy>π) dy-=2π; while (dy<-π) dy+=2π;`），`tutLive(度數 + '°')`，≥1.9 rad 進第 3 步；
  - 第 3 步 `tutLive(Math.max(0, Math.round(d - 4)) + ' m')`，<7 m 進第 4 步；
  - 第 4 步用鄰近度填進度條。
- `_src/game.js:451 tutComplete()`：`🎉 TRAINING COMPLETE` / `YOU CAN READ A BOND` / 「Element types → electron behaviour → bond name → electron pairs. That is every question in this game. Open a dot-and-cross chest next.」，6.4 秒慶祝。

**4.4 UI 與 CSS**

`_src/template.html:39` 的 `#bigHint` 改為：

```html
<div id="bigHint" class="bh">
  <div class="bhStep">🎮 TRAINING · STEP 1 OF 5</div>
  <div class="bhKeys"></div>
  <div class="bhText">HOLD  W  TO WALK</div>
  <div class="bhSub">…<b class="bhLive" id="bhLive"></b></div>
  <div class="bhBar"><i id="bhFill"></i></div>
</div>
```

`.bhKeys` 用 flex + `min-height:0`，`:empty{display:none}` 讓沒有按鍵的步驟不留空白。`<kbd>` 樣式做成實體鍵帽（漸層底 + 底部陰影），是原神式教學最容易被辨識的視覺語言。

**4.5 實測結果**

| 檢查 | 結果 |
|---|---|
| 第 1 步渲染 | `TRAINING · STEP 1 OF 5`、keys `WASD`、banner rect `520,584,400,166`、kbd rect `651,624,30,27` |
| 走路推進 | 走 8 m → `afterWalk step=2 moved=8.00` |
| 轉視角推進（真實拖曳事件，非偽造 yaw） | `yawTurned=4.03rad look=1.92 step=3`，橫幅 `FOLLOW THE GREEN BEAM | live= 29 m` |
| 靠近推進 | `afterApproach step=4 banner=PRESS  E  TO TALK` |
| 練習零懲罰 | `afterE step=5 streak=7` → 教學中答錯 `streak=7` → 對照組答錯 `streak=0` |
| 通關 | `bh show s3 done` / `YOU CAN READ A BOND` / 進度 100% / `bq_tut_v2=1` |

**4.6 觸控裝置的差異**

`touch` 模式下同一張資料表換字：`WASD` → `LEFT STICK`、`MOUSE` → `RIGHT SIDE`。判定沿用專案既有規則 `pointer:coarse && !pointer:fine`（桌面可用 `?touch=1` 強制預覽）。這是 `README-Codex.md` 明文規定的偵測方式，不要改成 UA 判斷。

---

## 五、卡住、穿模、互相遮擋

### 問題

用三支自動化探針量測後，找到 8 個真實缺陷（不是感覺，是量出來的）：

| # | 物件 | 症狀 | 根因 |
|---|---|---|---|
| 1 | 主攝影機 | 站在建築旁，玩家完全被牆遮住 | `_src/world.js:3159 updateCamera()` 只有地板高度夾制，**完全沒有遮擋處理** |
| 2 | 樹幹 | 相機避讓生效了，但樹幹依然擋住畫面中央 | 避讓半徑門檻設 `c.r >= 1.2`，而樹幹碰撞半徑是 `0.75 × scale`（約 0.6–0.9），**被門檻濾掉** |
| 3 | 玩家模型自身 | 相機被擠到 2.11 m 時，畫面看到角色大衣的內面 | 避讓把手臂縮得太短，穿進模型內部 |
| 4 | 玩家 vs 建築 | 貼牆時會卡住／抖動 | 碰撞分離只跑 1 次，兩個碰撞體互推後又重疊 |
| 5 | 敵人 / Boss | 怪物會穿牆追擊，卡在房子裡出不來 | 敵人位移直接寫 `position.x/z`，**繞過碰撞檢測** |
| 6 | 任務點 `n3`（Gas Spirit, H₂） | 玩家走不到，NPC 埋在房子裡 | 節點 `(18,-16)` 落在 `(18,-13)` 房屋的 7.2×6.3 足跡內（`_src/data.js:234`） |
| 7 | Boss 競技場 | Golem 與 Hydra 腳下長滿樹，戰鬥時被樹卡住 | `reserve()` 只避開任務點與傳送點，**不知道 Boss 座標** |
| 8 | Boss 擊退 | 每第二次揮擊落空 | 離子系擊退 1.45 m ＋ 重擊 0.8 m = 2.25 m，把 Boss 推出劍的 3.4 m 觸及範圍 |

量化證據（`_qa-camocl.js` 從相機向玩家 4 個身體點（頭 3.0 / 胸 2.1 / 腰 1.5 / 膝 0.8）射線）：

```
修復前：hydra :: head=5m:ConeGeometry | chest=5m:ConeGeometry
                 waist=4m:ConeGeometry | knees=4m:ConeGeometry     ← 四個點全被遮
修復後：五個場景全部 clear
```

### 方案

**修復 1 — 相機遮擋行進器（`_src/world.js:3138`）**

```js
const CAM_MARGIN = 0.5, CAM_STEPS = 16, CAM_MIN = 2.2;
let camClear = 1;
function cameraClearance(fromX, fromY, fromZ, toX, toY, toZ) {
  for (let i = 1; i <= CAM_STEPS; i++) {
    const t = i / CAM_STEPS;
    const cx = fromX + (toX - fromX) * t;
    const cz = fromZ + (toZ - fromZ) * t;
    for (let k = 0; k < colliders.length; k++) {
      const c = colliders[k];
      if (c.halfX !== undefined) {                       // 方形碰撞體（房屋）
        if (Math.abs(cx - c.x) < c.halfX + CAM_MARGIN &&
            Math.abs(cz - c.z) < c.halfZ + CAM_MARGIN) return (i - 1) / CAM_STEPS;
      } else if ((c.r || 0) >= 0.45 &&                   // 圓形碰撞體（樹、石）
        (cx - c.x) ** 2 + (cz - c.z) ** 2 < (c.r + CAM_MARGIN) ** 2) {
        return (i - 1) / CAM_STEPS;
      }
    }
  }
  return 1;
}
```

`updateCamera()` 從玩家 `+ (0, 2.15, 0)` 的眼位出發，算出可用比例後縮短手臂，並夾在 `heightAt(wantX,wantZ) + 1.1` 之上，最短 `CAM_MIN = 2.2`。進場快（`1 - Math.exp(-26*dt)`）、退場慢（`-4*dt`），避免貼牆時抽搐。

**修復 2 — 樹幹門檻從 1.2 降到 0.45**

這是最關鍵的一行。`_src/world.js:879` 的樹幹是 `CylinderGeometry(0.46, 0.82, 5.6, 7)`，碰撞半徑 `0.75×sc`。門檻 1.2 會把所有樹濾掉，於是「相機避讓」在森林裡等於沒做。降到 0.45 後森林場景正常。

**教訓：避讓門檻必須低於場景中最小但可遮擋的碰撞體半徑；否則避讓邏輯會在視覺上完全失效，而程式碼看起來「有實作」。**

**修復 3 — 角色淡出（避免看到大衣內面）**

```js
const armNow = Math.hypot(camera.position.x - player.position.x,
                         camera.position.z - player.position.z);
if (armNow < 2.9) player.visible = false;
else if (armNow > 3.2) player.visible = true;
```

2.9 / 3.2 的滯後區間是為了防止在邊界來回閃爍。

**修復 4 — 玩家碰撞分離跑 3 次（`_src/world.js:3018`）**

```js
for (let pass = 0; pass < 3; pass++) {
  ...
  if (dist < 0.0001) { dx = 1; dz = 0; dist = 1; }   // 正中心逃逸向量
}
```

單次分離在「夾在兩個碰撞體之間」時會互相推回；3 次迭代即可收斂。正中心退化（`dist ≈ 0`）若不做逃逸向量會產生 `NaN`，角色會永久卡住——這是原版卡住的直接原因之一。

**修復 5 — 敵人位移改走 `moveMob()`（`_src/world.js:2969`）**

```js
function moveMob(en, x, z) {
  for (let pass = 0; pass < 2; pass++) { /* 用 en.bodyRadius || 0.65 做圓形分離 */ }
  return [nx, nz];
}
```

所有敵人的追擊與遊蕩位移都改為經過這個函式。`bodyRadius` 讓大型怪（Boss 為 1.15）用更大的半徑，不會半個身體插進牆。

**修復 6 — 任務點 `n3` 移出房屋（`_src/data.js:234`）**

`x:18, z:-16` → `x:18, z:-18`。房屋足跡是 `[18,-13,7,6.2]`（`_src/world.js:807` 的房屋表，`block()` 在 `:800`），`block()` 會額外擴 0.10/0.12，所以 `z=-18` 剛好在外。

驗證方式（`_qa-clip.js`，需先給 `colliders` 加 getter）：

- **假陽性陷阱**：初版報告「30/30 節點都在碰撞體內」——因為每個 NPC 都把自己的身體碰撞體註冊在節點正中心。加上 `if (Math.abs(c.x-n.x)<0.001 && Math.abs(c.z-n.z)<0.001) return false;` 排除自身後才看到真缺陷。
- 最終：`A) prop overlaps >35%: 0`、`B) quest nodes swallowed by a FOREIGN prop: 0 / 30`、`C) boss golem @-76,82 clear`、`C) boss hydra @74,-92 clear`。

**修復 7 — Boss 競技場保留空地（`_src/world.js:30`）**

```js
const BOSS_ARENAS = [
  { id:'golem',  x:-76, z: 82, r:17 },
  { id:'hydra',  x: 74, z:-92, r:17 },
  { id:'tyrant', x: 84, z: 70, r:17 }
];
```

並在 `reserve()` 的 `nearNode` 判斷加上 `|| BOSS_ARENAS.some(a => Math.hypot(a.x-x, a.z-z) < a.r + r*0.5)`。三個 17 公尺半徑的空地，足夠容納 Boss 的 28–34 公尺察覺範圍內的走位。

**修復 8 — Boss 擊退上限（`_src/world.js` `applyDamage()` 內）**

```js
/* Bosses are heavy: a full player knockback (2.2 m on an ionic hit) shoved
   the boss out of the player's own reach, so the follow-up swing whiffed.
   Cap boss displacement so the combo can continue. */
if (en.boss) {
  const kLen = Math.hypot(knockX || 0, knockZ || 0);
  if (kLen > 0.55) { const s = 0.55 / kLen; knockX *= s; knockZ *= s; }
}
```

**修復前後對照（同一支探針）**：

```
修復前：hit0 dmg=17 hp=313 gap=5.41 → hit1 dmg=0  gap=4.51   ← 每次第二下都落空
修復後：hit0 dmg=17 hp=313 gap=3.84 → hit3 dmg=17 hp=296 gap=3.85
```

**相機壓力測試（6 個惡劣位置，40 框後的實際手臂長度）**

| 場景 | 手臂長度 | 垂直差 | 中點是否在牆內 |
|---|---|---|---|
| 城鎮中心 | 9.99 | 4.18 | 否 |
| 貼正面牆 | 10.00 | 4.18 | 否 |
| 側巷 | 9.07 | 3.82 | 否 |
| 房屋夾縫 | 3.56 | 1.64 | 否 |
| 森林 | 9.05 | 3.81 | 否 |
| 密林 | 2.11 | 1.06 | 否 |

---

## 六、Boss 設計與實作

### 問題

1. **只有一個 Boss（Rift Tyrant），而且沒有 UI。** 原版 `_src/data.js` 的 `BOSS` 是單一常量（`hp:420, speed:2.4, damage:22`），打完就沒有了。
2. **Boss 與化學沒有關係。** 牠只是一個高血量的怪，不考驗任何化學概念。
3. **沒有難度曲線。** 420 血、22 傷害、2.4 移速，從頭到尾同一個難度。
4. **沒有「打不動」的機制。** 玩家只要一直普攻，Boss 一定會死，沒有戰術選擇。
5. **沒有視覺辨識。** 三個化學教師（ionic / covalent / metallic）在世界上有顏色編碼（cyan / green / gold），但 Boss 沒有沿用這套語言。

### 方案

**6.1 三個 Boss，對應三種化學鍵（已實作）**

`_src/world.js:5249 BOSS_VARIANTS`：

| | **Ionic Golem** | **Covalent Hydra** | **Rift Tyrant** |
|---|---|---|---|
| 對應鍵 | ionic（離子鍵） | covalent（共價鍵） | metallic（金屬鍵） |
| 顏色 | `0x72cfff`（cyan） | `0x66efb2`（green） | `0xff5b45`（紅） |
| 血量 | **330** | **270** | **420** |
| 移速 | 1.8（慢、重） | 2.7（快、靈活） | 2.4 |
| 傷害 | 18 | 14 | 22 |
| 攻擊距離 | `reach: 4.6` / `range: 28` | `reach: 3.0` / `range: 34` | `reach: 3.6` / `range: 26` |
| 預警時間 | **0.95 s**（最好躲） | **0.72 s**（最難躲） | **0.82 s** |
| 恢復時間 | 2.4 s | 1.9 s | 2.4 s |
| 獎勵 | 180 score / 110 gold | 200 score / 125 gold | 280 score / 180 gold |
| 體型 | 2.05× | 1.75× | 2.6× |
| 出場座標 | (-76, 82) | (74, -92) | (84, 70) |

**難度曲線設計意圖**：

- **Covalent Hydra 是「入門 Boss」**：血最少（270），但預警最短（0.72 s）、移速最快（2.7）、射程最遠（34）。牠考的是**反應**而不是**耐久**——因為共價鍵是學生最熟的題材（H₂O、CH₄），用在第一個 Boss 上認知負荷最低。
- **Ionic Golem 是「進階 Boss」**：血更多（330）、預警較長（0.95 s）但攻擊距離最遠（4.6）。牠考的是**站位與時機**——預警長看似好躲，但 4.6 m 的觸及範圍意味著「退兩步」不夠，必須真的用 Shift 閃避。
- **Rift Tyrant 是「終局 Boss」**：血最多（420）、傷害最高（22）、體型最大（2.6×）。牠對應 metallic——離域電子在所有方向自由移動，所以牠的設計是「全方位壓迫」。

**6.2 機制（`_src/world.js:5318 updateBoss()`）**

狀態機：`idle → chase → attack → telegraph → recover`

1. **Chase**：距離 > `reach × 0.72` 時，以 `D.speed` 追擊（`bindTimer > 0` 時降到 32% 速度——這讓「減速」類技能真的有用）。
2. **Telegraph（預警）**：進入 `reach` 後開始蓄力，地面圓環以 `1 + (1 - cast/telegraph) * 1.8` 放大作為可視預警。
   - Golem：雙臂 `rotation.x = -1.4 × min(1, phase/0.65)` 舉起砸下
   - Hydra：額外生 3 條 `addFxBolt` 電弧
   - Tyrant：碎片皇冠旋轉加快
3. **Attack**：只有 `dist <= radius && dashIFrames <= 0` 才造成傷害 → **閃避是真正的躲招，不是數值減傷**。
4. **Recover**：`atkCd` 期間不追擊，這是玩家的輸出窗口。
5. **不會穿牆**：所有位移走 `moveMob()`（見第五節修復 5），所以玩家可以靠建築繞圈。

**6.3 化學整合（不只是換皮）**

- **三色語言統一**：Boss 顏色 = 教師 NPC 顏色 = 化學鍵顏色 = HUD 家族徽章顏色。玩家看到 cyan 就知道是 ionic 題材（`trialFamily` 欄位就是這樣映射的：`hydra → covalent`、`golem → ionic`、其餘 `metallic`）。
- **Boss 是「結構分析戰」的載體**：`docs/BondRealm_Game_Requirements.md` 的 FR-CB 要求「3 回合：結構類型 → 正確的破壞條件 → 一句理由」。Boss 的預警—閃避—反擊節奏正好對應「讀結構 → 找弱點 → 下手」。
- **不引入非化學變數**：沒有屬性抗性、沒有等級壓制、沒有暴擊。傷害差異只來自武器（`_src/data.js:295-301`）與玩家操作。

**6.4 Boss HUD（新增，見第二節方案 9）**

- 只在 34 m 內顯示（`BOSS_HUD_RANGE`），避免探索時被 UI 佔畫面
- 五段狀態文字讓玩家知道「牠現在在蓄力」：`HUNTING / STRIKING / CHARGING / RECOVER / HOLDING`
- 蓄力條（`#bossCast`）與血條重疊繪製，用顏色區分「這是預警不是傷害」
- 擊殺後自動交接下一個 Boss 並顯示 `<NAME> DEFEATED`

實測交接：`Ionic Golem` 死亡 → `localStorage bq_boss_down_golem = 1` → HUD 隱藏 → `Covalent Hydra / COVALENT / 270 / 270` 接手。

**6.5 出場條件**

| Boss | 何時出現 |
|---|---|
| Golem + Hydra | 世界初始化時由 `spawnEnemies()` 生成（`_src/world.js:4100-4101`） |
| Tyrant | 主線 9 個節點全部完成後（`_src/game.js:2585`） |
| 全部 | 舊存檔已完成主線者，載入時直接生成三個（`_src/game.js:742`） |

注意：`spawnEnemies()` 會先清空 `bossEnemies`（`_src/world.js:4065`）再重新生成，所以 Boss **會隨怪物名冊重生**，不是一次性。這是刻意的——牠們是可重複挑戰的練習場，不是一次性劇情 Boss。

**6.6 建議追加的 Boss（未實作，需你確認）**

以下三個是針對評分表缺口設計的，**尚未實作**：

| 建議 Boss | 對應準則 | 機制構想 |
|---|---|---|
| **Lone Pair Wraith**（孤對電子幽靈） | R2 電子對計數 | 身上有 N 個未配對電子，玩家要在限時內選出正確的 lone pair 數才能造成傷害；答錯牠回血 |
| **Giant Lattice Colossus**（巨晶巨人） | R4 giant vs simple molecule | 兩階段：第一階段是「簡單分子」形態（可被打斷），第二階段變「巨大晶格」（只能打特定弱點） |
| **Delocalised Storm**（離域風暴） | R3 迷思糾正 | 每次攻擊前用文字喊出一個迷思（如「金屬靠共用電子」），玩家要用對應的鍵反擊 |

> **（待補充：Boss 總數要維持 3 個，還是擴到 6 個？）**
> 3 個的話，三種鍵各一，對稱完整，單輪遊玩時間約 7 分鐘（符合 R5 的 6–10 分鐘）。
> 6 個的話，每個鍵 2 個（基礎＋進階），但單輪會推到 11–13 分鐘，**超出 R5 上限**，需要壓縮其他內容。
>
> **（待補充：美術風格要沿用現有的 toon 低多邊形，還是另立一套？）**
> 現有三個 Boss 都用 `MeshToonMaterial` + 三階色階（`bossMat(color, emissive)`），與世界其他物件一致。若要更「Boss 感」，可加一層 rim light 與霧效，但會增加頂點數（目前單檔 1326 KB，上限 1.5 MB，餘裕約 174 KB）。

---

## 附錄、實測截圖

以下全部是自動化探針在 1440×900 下實際截取的畫面，不是示意圖。

![改版前的化學題](QA/qa-old-chem.png)

**圖 1 — 改版前的化學題（`dist/index.html`）**：583 px 寬卡片、三個 518×45 等寬按鈕、`svg=0 / img=0`，整題沒有一張圖。


![改版後的第 1 步](QA/qa-chemui2.png)

**圖 2 — 改版後的第 1 步**：左證據面板（元素卡 ＋ 顏色圖例）＋ 右題目（A/B/C 字母徽章），目標條 `STEP 1 / 4 · LOOK · Identify the elements`。


![三段式回饋卡](QA/qa-chemwrong.png)

**圖 3 — 三段式回饋卡**：先 `MISCONCEPTION REPAIR`（紅，含你所選與為何失敗），再 `✓ THE WORKING RULE`（綠，正確規則）。


![迷思選項](QA/qa-trap.png)

**圖 4 — 迷思選項接住（NaCl 第 3 步）**：「NaCl 由細小分子組成」被做成第四個選項，點下去直接命名迷思並解釋。


![五步流程](QA/qa-struct3.png)

**圖 5 — 五步流程的第 5 步（BF₃ vs diamond）**：`COMPARE · Molecule or giant structure?`，用來滿足 R4 的 giant vs simple。


![新手教學第 1 步](QA/qa-tut3-2.png)

**圖 6 — 新手教學第 1 步**：按鍵膠囊 `W A S D`、主標 `HOLD W TO WALK`、即時讀數 `0.0 / 8 m` 與進度條。


![Boss HUD](QA/qa-bosshud.png)

**圖 7 — Boss HUD**：`BOND GUARDIAN · IN RANGE` ＋ 家族徽章 `IONIC` ＋ 血條 ＋ `330 / 330`。


![戰鬥中的 Boss HUD](QA/qa-boss6.png)

**圖 8 — 戰鬥中的 Boss HUD**：血量降到 `296 / 330`、狀態 `RECOVER`，玩家角色在 Golem 前方可見。


![相機遮擋修復前](QA/qa-hydra-view.png)

**圖 9 — 相機遮擋修復前**：樹幹佔滿畫面中央，玩家完全被遮住（避讓門檻 `c.r >= 1.2` 把樹幹濾掉了）。


![相機遮擋修復後](QA/qa-hydra-view3.png)

**圖 10 — 修復後**：同一地點，門檻降到 0.45、Boss 競技場預留 17 m 空地，三個蛇頭與玩家都清楚可見。


![相機穿模](QA/qa-camstress.png)

**圖 11 — 相機被擠進角色內部**（修復 2 之前的過度修正）：手臂縮到 2.11 m 時看到大衣內面。


![角色淡出後](QA/qa-camstress2.png)

**圖 12 — 加上角色淡出後**（`armNow < 2.9` 隱藏、`> 3.2` 顯示）：同位置畫面乾淨。


---

## 七、驗收對照

| 你訂的驗收條件 | 對應章節 | 狀態 |
|---|---|---|
| 每一項改動都能追溯到指引或你給的背景 | 一、三、六 | ✅ 每個評分項都標了 R1–R5 與原文 |
| 新玩家能完成教學並理解答題規則，不需額外解釋 | 四 | ✅ 5 步全通，`_qa-tut7` 證明練習零懲罰 |
| 每個有問題的物件都列出並附修法 | 五 | ✅ 8 個缺陷，物件／根因／修法／量測齊全 |
| 每個 Boss 都有明確出場條件、行為機制、難度定位 | 六 | ✅ 三個 Boss 的數值表 + 狀態機 + 出場時機 |
| 每節先「問題」後「方案」 | 全部 | ✅ |
| 程式／UI 改動要給可執行指令，指名檔案／場景／組件 | 二、三、四、五、六 | ✅ 全部指向 `_src/*` 的具體行號 |
| 未指定參數要標 `(待補充：…)` 並與你確認 | 一、六 | ✅ Boss 數量、美術風格、是否補齊 11 個化合物 |
| .docx 讀不到要明說 | 一 | ✅ 已成功抽取 70 行，Table 1–4 全數解析 |
| 不發明實作細節 | 全部 | ✅ 只描述已存在或已實作的內容 |

### 建置狀態

```
built index.html  1326.4 KB
synced site/index.html  1326.4 KB
[PASS] 根目錄 index.html 存在
[PASS] 檔案體積 >= 600 KB
[PASS] site/index.html 與根目錄一致
[PASS] 沒有殘留佔位符
[PASS] script 標籤數量平衡
[PASS] HTML 結構完整
[PASS] 關鍵 UI 節點存在
[PASS] 原始 JS 語法正確
[PASS] 介面已全英文化
9/9 通過 · 產物 1326 KB
```

### 建議的下一步（依優先次序）

1. **補 `so2` 的 `pairs` 資料**（一行）—— 這是目前唯一會讓指引第四問靜默消失的簡單分子。
2. **補 4 個 NPC 節點**（`mg3n2` / `so2` / `graphite` / `c60`）—— 直接補 R4 的「指引點名例子」與「giant vs simple」。
3. **決定 Boss 總數與美術方向**（見第六節待補充）。
4. **接上試玩紀錄**（R5 要求 pilot evidence）—— 目前遊戲已有 `logEvent()` 與資料匯出，缺的只是「真的找一個同學玩一次並記錄」。

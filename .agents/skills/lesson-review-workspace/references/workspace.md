# 資料與指令

以下指令由 Agent 執行，使用者只透過對話和工作台操作。程式入口路徑以專案根目錄為基準。請用實際可用的 Node.js 與 Python 執行檔替換範例的 `node`、`python3`。

工作台上方按鈕依序為「上傳文件」、文件下拉選單、「參考文件」、「上傳新版」與「刪除文件」。

## 檔案位置

每份文件位於 `lessons/<id>/`。從「上傳文件」建立另一份文件時會產生新的識別碼，不會覆寫其他文件。從既有文件使用「上傳新版」時，會替換該文件的目前文件，不保存被替換的舊 PDF。

1. `document.pdf`：目前文件的 PDF。
2. `materials/`：使用者上傳的 PDF 參考資料。文件與參考資料皆只接受 PDF，並在保存前檢查有效性。顯示名稱及實際檔名記錄在 `lesson.json`。
3. `review/annotations.json`：`annotations` 為目前 PDF 的待討論項目，`history` 為目前 PDF 的處理記錄，`nextNumber` 保存下一個可用編號。
4. `lesson.json`：保存文件識別碼、標題、`format`、`originalName`、`pageCount`、`documentHash`、更新時間與參考資料清單。

`workbench/src/` 是預先完成的網站程式，分為 `app`、`components`、`hooks`、`lib/client` 和 `lib/server`。`.runtime/` 放啟動資訊與暫存資料。不要將使用者的文件或執行產物放進 skill。

使用者在上方的「參考文件」中查看清單、新增或逐筆刪除目前文件的資料。刪除會一併移除檔案與清單紀錄，不影響其他文件。Agent 開始檢視前直接重新讀取清單，避免引用已刪除的資料，不要求使用者複製檔案路徑或清單。

## 啟動與查找

```sh
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs start --project-root /absolute/project --python /absolute/python3
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs status --project-root /absolute/project
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs list --project-root /absolute/project
```

`start` 會健康檢查並重用服務。預設使用 8766 埠，已被其他服務使用時選擇可用埠，實際網址以輸出為準。`reopen` 不代表清除資料或強制重啟。若啟動失敗，先讀取 `.runtime/workbench.log` 診斷，不能只回報已執行指令。

生命週期操作共用同一個專案身份核對及啟停鎖定。`start`、`status`、`stop` 和 `reset` 不接受其他專案的狀態檔，停止或清空失敗時保留文件資料。

## 文件刪除

使用者點擊「刪除文件」時，網頁只開啟確認視窗，顯示目前選定文件的名稱與識別碼，說明會一併刪除該文件的 PDF、參考文件、註解與討論紀錄，不影響其他文件。視窗只提供「複製刪除提示」，不可直接從網頁刪除。

只有使用者把刪除提示貼回 Agent 對話，才算授權刪除指定文件。一般檢視、開始、重開或清理畫面都不授權刪除或清空文件。收到提示後先核對識別碼與名稱確定目標正確，不需再次詢問確認，再執行：

```sh
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs delete-document --lesson ID --confirm-delete
```

刪除提示為：

> 請刪除本專案工作台中的文件「NAME」（識別碼：ID）。我確認一併刪除這份文件的 PDF、參考文件、註解與討論紀錄。請保留其他文件。刪除後請確認這份文件已從工作台移除。

網站每 5 秒更新文件清單，刪除完成後自動移除已刪除文件。Agent 必要時讀取工作台畫面確認目標已消失。

## 關閉與清空

```sh
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs stop
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs reset --confirm-reset
```

`stop` 只停止經健康檢查與程序識別碼核對的本專案伺服器。`reset` 需要使用者明確授權清空，先停止伺服器，再移除 `lessons/` 的所有內容，連同目前 PDF、參考資料與註解。不變動程式、Git、skills 或已安裝環境。停止失敗時保留資料，重複執行空白重設可正常完成。兩者與啟動共用鎖定，已確認程序死亡的殘留鎖定會自動移除。`lessons/`、`.runtime/` 本身是符號連結，或專案不符合時會被拒絕。文件目錄內的連結只移除連結本身，不刪除目標。

## 檢查與更換 PDF

```sh
python3 .agents/skills/lesson-review-workspace/scripts/pdf_tools.py inspect lessons/LESSON_ID/document.pdf
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs replace-document --lesson LESSON_ID --file /absolute/new-document.pdf
```

PDF 檢查輸出包含頁數、頁面尺寸、旋轉角度、文字摘要與文件雜湊。文件與參考資料都須渲染頁面並以視覺方式閱讀後再提出問題，文字摘要只輔助搜尋與定位。使用者應在原本的編輯工具修改原稿，再匯出 PDF。Agent 不直接修改 Word 或 PDF，也不把 PDF 轉換回可編輯文件。

更換指令先驗證輸入檔案。驗證成功後才將輸入檔案寫入 `document.pdf`，更新 `lesson.json` 的 `format`、`originalName`、`pageCount` 與 `documentHash`，保留文件識別碼、標題和 `materials/`。同時清空 `review/annotations.json` 的 `annotations`、`history`、框選資料，將 `nextNumber` 重設為 1。即使輸入檔案與目前文件相同，也執行相同清空。驗證失敗時保留原本文件、註解、討論記錄與參考資料。

更換完成後，工作台開啟「重新檢視文件」視窗，提供可複製的重新檢視提示，不會自動呼叫 Agent：

> 請先以視覺方式閱讀目前文件與參考資料的 PDF 頁面，再重新檢視文件。文件用途與背景可以沿用，但不要預設先前的建議仍然成立。每個問題都須重新核對，只提出目前文件仍支持的問題，避免為了延續先前討論而重複舊建議。先指出問題與依據，再透過提問引導我討論，不直接提供解法。

## 註解與重新檢視

```sh
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs add-comment --lesson LESSON_ID --data /temporary/comment.json
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs add-comment --lesson LESSON_ID --id '#001' --data /temporary/updated-comment.json
node .agents/skills/lesson-review-workspace/scripts/workbench.mjs resolve-comment --lesson LESSON_ID --id '#001' --status resolved --note '使用者確認討論結果'
```

`--data` 接收包含 `anchorText`、`text`、`page` 和 `rects` 的 JSON 檔，適合多行或含引號的問題。`rects` 使用指定 PDF 頁面左上角起算的 0 至 1 相對座標。註解新增自動避開目前已用編號。更新目前註解時使用 `--id`，固定編號在目前 PDF 內不變。結案狀態可為 `resolved`、`dismissed` 或 `obsolete`。目前文件更換成功後，註解與處理記錄都會清空，下一個編號從 `#001` 開始。

```json
{
  "anchorText": "這份報告的主要結論",
  "text": "問題：目前結論段落中，尚未看到支持這項判斷的依據。\n理由與依據：結論與文件中提供的證據需要能核對的對應。\n開放問題：你原本希望用哪些資料支持這項結論？",
  "page": 1,
  "rects": [{"x": 0.12, "y": 0.25, "width": 0.65, "height": 0.04}]
}
```

先渲染並視覺閱讀完整頁面，再以該頁顯示後的寬高換算座標。`x` 和 `y` 分別是區域左上角除以頁面寬高，`width` 和 `height` 是區域寬高除以頁面寬高。旋轉頁面依實際顯示方向計算，範圍必須位於頁面內。同一頁跨行可列多個矩形，跨頁內容分開標示。不要僅憑擷取文字的順序猜測位置。寫入後在工作台逐一點擊核對框線，必要時以目前 PDF 的原編號更新。

腳本會自動將目前 PDF 的文件雜湊記錄為註解的 `documentSha256`，寫入前須確認剛閱讀的文件仍是目前 PDF。雜湊不符時，預覽不可直接使用舊座標。網頁會自動同步目前文件與註解，不需要手動重新讀取。

## 交付學生版本

需要交付乾淨專案時，使用 `node .agents/skills/lesson-review-workspace/scripts/workbench.mjs package`。輸出為 `dist/review-with-agent.zip`。打包腳本只收集指定的網站原始碼、依賴描述檔、skills 和使用說明，排除 `lessons/`、`.runtime/`、`dist/`、`node_modules/`、`.next/`、`.git/`、環境檔和密鑰，不依賴 Git 追蹤清單。

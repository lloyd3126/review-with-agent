export const reviewInstructions = '請先以視覺方式閱讀目前文件與參考資料的 PDF 頁面，再重新檢視文件。文件用途與背景可以沿用，但不要預設先前的建議仍然成立。每個問題都須重新核對，只提出目前文件仍支持的問題，避免為了延續先前討論而重複舊建議。先指出問題與依據，再透過提問引導我討論，不直接提供解法。';

export function reviewPrompt(title) {
  return `我已更換文件「${title}」的 PDF。\n\n${reviewInstructions}`;
}

export function deletionPrompt(lesson) {
  return `請刪除本專案工作台中的文件「${lesson.title}」（識別碼：${lesson.id}）。

我確認一併刪除這份文件的 PDF、參考文件、註解與討論紀錄。請保留其他文件。

刪除後請確認這份文件已從工作台移除。`;
}

export function discussionPrompt(lesson, comment) {
  return `我想討論文件「${lesson.title}」的 ${comment.id}。

問題位置：第 ${comment.page} 頁。
對應原文：${comment.anchorText}
問題：${comment.text}

請先以視覺方式閱讀目前文件與參考資料的 PDF 頁面，並核對當前註解，確認這個問題仍有文件依據，不要預設過去的建議仍然成立。請詢問我的文件撰寫意圖，一次只問一個問題。先不要提供完整解法或改寫內容，等我提出想法後再給回饋，協助我檢查理由與可能效果。我會自行修改原稿，匯出 PDF 後更換工作台中的文件。`;
}

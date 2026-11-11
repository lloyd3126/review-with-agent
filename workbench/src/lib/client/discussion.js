export function onboardingPrompt(lesson) {
  return `我已上傳文件「${lesson.title}」（識別碼：${lesson.id}）。請先簡短說明接下來如何使用工作台，目前先不要檢視或修改文件。

請說明：
1. 如何把參考資料交給你加入這份文件、在工作台查看清單，以及這一步可以略過。
2. 加入或更新參考資料後，如何在對話中請你檢視文件並指出問題。
3. 如何在工作台查看問題，並在對話中依 #001 等編號逐一或一次討論。
4. 如何自行修改原稿並匯出 PDF，再用「上傳新版」替換文件。更換時會清空註解與討論紀錄，保留參考資料，之後可複製重新檢視提示交給你。`;
}

export const reviewInstructions = '請先以視覺方式閱讀目前 PDF，並依格式閱讀這份文件的參考資料，再重新檢視文件。文件用途與背景可以沿用，但不要預設先前的建議仍然成立。每個問題都須重新核對，只提出目前文件仍支持的問題，避免為了延續先前討論而重複舊建議。先指出問題與依據，再透過提問引導我討論，不直接提供解法。';

export function reviewPrompt(lesson) {
  return `我已更換文件「${lesson.title}」（識別碼：${lesson.id}）的 PDF。\n\n${reviewInstructions}`;
}

export function deletionPrompt(lesson) {
  return `請刪除本專案工作台中的文件「${lesson.title}」（識別碼：${lesson.id}）。

我確認一併刪除這份文件的 PDF、參考文件、註解與討論紀錄。請保留其他文件。

刪除後請確認這份文件已從工作台移除。`;
}

export function discussionPrompt(lesson, comment) {
  return `我想討論文件「${lesson.title}」（識別碼：${lesson.id}）的 ${comment.id}。

問題位置：第 ${comment.page} 頁。
對應原文：${comment.anchorText}
問題：${comment.text}

請先以視覺方式閱讀目前 PDF，並依格式閱讀這份文件的參考資料、核對當前註解，確認這個問題仍有文件依據，不要預設過去的建議仍然成立。請詢問我的文件撰寫意圖，一次只問一個問題。先不要提供完整解法或改寫內容，等我提出想法後再給回饋，協助我檢查理由與可能效果。我會自行修改原稿，匯出 PDF 後更換工作台中的文件。`;
}

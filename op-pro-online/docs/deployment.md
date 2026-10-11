# 線上版部署

網站：https://optiona286.github.io/COP-Backtesting-Platform/op-pro-online/

GitHub Pages 原有設定為 `main` 分支、根目錄。本次只新增 `op-pro-online/` 子目錄，根目錄原版網站與程式不修改。線上版來源另保留在 `codex/op-pro-online` 分支。

資料來自 https://pub-f3c396bf9e7d49f3b0f9ff8815170fcd.r2.dev/ 。資料庫、憑證及上傳進度不進 Git。R2 CORS 必須允許 `https://optiona286.github.io`，不帶網站路徑或尾端斜線；可參照同目錄 `r2-cors.json`。

後續更新只提交線上版目錄，再以一般推送更新 Pages 的 main 分支，不強制推送，不修改原版檔案。GitHub Pages 會重新建置網站。

此次只確認部署狀態、網站回應及 R2 公開索引與 CORS，操作測試留給使用者。

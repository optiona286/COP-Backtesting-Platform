# 線上版部署

網站：https://optiona286.github.io/COP-Backtesting-Platform/op-pro-online/

GitHub Pages 原有設定為 `main` 分支、根目錄。本次只新增 `op-pro-online/` 子目錄，根目錄原版網站與程式不修改。線上版來源另保留在 `codex/op-pro-online` 分支。

資料來自 https://pub-f3c396bf9e7d49f3b0f9ff8815170fcd.r2.dev/ 。資料庫、憑證及上傳進度不進 Git。R2 CORS 必須允許 `https://optiona286.github.io`，不帶網站路徑或尾端斜線；可參照同目錄 `r2-cors.json`。

後續更新只提交線上版目錄，再以一般推送更新 Pages 的 main 分支，不強制推送，不修改原版檔案。GitHub Pages 會重新建置網站。

此次只確認部署狀態、網站回應及 R2 公開索引與 CORS，操作測試留給使用者。

## 手機安裝

線上版為 PWA，manifest 和 service worker 的範圍僅限 `op-pro-online/`，不控制原版網站。設定頁新增「安裝應用程式」。支援安裝提示的瀏覽器可直接安裝；iPhone 可在 Safari 分享選單加入主畫面。安裝後從桌面圖示開啟，以獨立視窗顯示。

圖示使用標題前方的原有 OP 標誌，產生 192、512、180 像素與安全留白的 maskable 圖示。切頁及帳戶分頁不再使用過場動畫；啟動時顯示品牌載入畫面，商品載入不再次蓋住全畫面。

Service worker 使用網路優先的介面快取，避免長期使用舊版介面；不快取 R2 全部行情。離線時可能開啟已保存介面，但無法重新載入 R2 行情。此次沒有執行手機安裝或操作測試。

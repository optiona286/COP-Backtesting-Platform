# 交易終端設計方向

目標：在同一屏內完成選履約價、看圖、下單、觀察回測；手機保持清楚的單一主要工作區。

參考：

- IBKR 可調整面板布局：https://www.ibkrguides.com/ibkrdesktop/my-layouts.htm
- TradingView 圖表周邊工具安排：https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/
- thinkorswim 手機選擇權與下單流程：https://advisorservices.schwab.com/story/single-options-on-thinkorswim-mobile-ipad

本版採用中性石墨灰、細分隔線、小圓角、等寬數字。桌面採左報價／中圖表／右交易，降低大標題與装飾的佔用。底部回測控制列及紀錄分頁集中管理時間與交易結果。

手機以圖表為預設畫面，底部切換報價、交易、帳戶。隱藏的操作區仍保留原 DOM 與狀態；重新進入時調整圖表尺寸。

保留原有下單、風控、回測、委託、損益、自動策略、圖表分頁及浮動工具的事件與計算。新增事件只負責布局、分頁與連線顯示。

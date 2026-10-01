# 訓練日誌 PWA

iPhone 用 Safari 開啟網址 → 分享 → 加入主畫面。

| 檔案 | 用途 |
| --- | --- |
| index.html | 頁面骨架、PWA 設定 |
| style.css | 樣式（含深色模式） |
| app.js | 全部程式邏輯 |
| firebase-config.js | Firebase 設定（需自行填入） |
| manifest.webmanifest | app 名稱、圖示、全螢幕 |
| sw.js | 離線快取 |
| icons/ | 主畫面圖示 |
| firestore.rules | 貼到 Firebase 主控台的安全規則（不必上傳） |

資料路徑：`users/<uid>/sessions/<YYYY-MM-DD>`、`users/<uid>/data/body`、`users/<uid>/data/template`。

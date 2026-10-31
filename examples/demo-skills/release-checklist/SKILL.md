---
name: release-checklist
description: 上線前檢查清單產生器。部署、發版前啟動，依專案類型列出必查項目。只要使用者提到「上線」「發版」「deploy」「release」等，也應主動調用此技能。
metadata:
  version: "0.3.1"
  layer: module
---

# 上線前檢查清單

## 流程
1. 判斷專案類型（網站／API／App）
2. 列出對應檢查項目
3. 逐項確認

## 規則與禁忌
- 不跳過備份與回滾計畫

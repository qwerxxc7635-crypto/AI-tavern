# Ember Tavern v0.4 Combat Runtime Assets — FINAL

这是 Ember Tavern v0.4 战斗系统 Runtime Source Asset 最终整合包。

## 总数量

- Common Combat VFX: 10
- Cultivation / 修仙: 27
- Fantasy / 西幻: 27
- Sci-Fi / 科幻: 28
- Urban / 都市: 27
- **Total Runtime Assets: 119**

## 整合范围

本包整合了：
1. 四套 Theme 的基础 Runtime UI Source Assets；
2. 四套 Theme 的 Hover / Selected / Disabled / Pressed / AP Empty 补全状态；
3. 四套世界专属 FX；
4. 四套 CombatResult Victory / Defeat / Escape 结算框；
5. 10 张 Common Combat VFX。

## 命名规则

最终文件名统一为：
- lowercase
- kebab-case
- 不使用中文文件名
- 不使用空格

Stable Asset Slot ID 保存在：
- `asset-manifest.json`
- 每个 Theme 的 `theme.json`
- `asset-slot-map.csv`

## 目录

```text
common/
  effects/

cultivation/
  theme.json
  assets/
    backgrounds/
    panels/
    timeline/
    ability-slot/
    buttons/
    resources/
    selection/
    intent/
    effects/
    results/

fantasy/
scifi/
urban/
```

## 说明

- 本包只收录 Runtime Source Assets。
- Visual Reference / 母版完整战斗页面、Contact Sheet、预览图、旧版返工失败素材、重复文件均未纳入 Runtime 包。
- 所有图片保持源文件内容，不进行重新绘制；整合过程仅复制与正式重命名。
- 科幻 `ap-node-empty.png` 使用最终像素级母版派生版本。
- 修仙 Hover / Selected / EndTurn Hover / EndTurn Pressed / Shield 使用最终返工通过版本。

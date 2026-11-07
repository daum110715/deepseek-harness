# @deepseek-ai/dsh-client-ui-polish

[English](README.md) | 中文

Web 客户端的设备适配、动效与触感。它是 web 套件的内置插件；从 `packages/bundle/web-app/cordis.patch.yml` 中删除 `ui-polish` 条目即可停用。

## 功能

- **`<html>` 上的设备信息**：`data-dsh-form-factor`（`phone`、`tablet`、`desktop`）、`data-dsh-pointer`（`coarse`、`fine`）、`data-dsh-input`（最近一次使用的指针，用于二合一设备）和 `data-dsh-standalone`。样式表依据这些属性适配，而不只靠宽度推测。
- **触屏操作**（粗指针设备）：没有点按闪色，控件上不触发双击缩放（双指缩放仍然可用），长按控件不会选中其文字。小于 44 px 的控件通过 `::after` 获得每边最多 8 px 的隐形点按区域；如果控件自己的 `::after` 已有内容，则保持不变。
- **适应软键盘的视口**：Chromium 通过 `interactive-widget=resizes-content` 在软键盘弹出时调整布局；在 Safari 中，键盘弹出期间应用会缩放到屏幕可见部分。
- **禁用下拉刷新**：文档不会过度滚动，因此在顶部下拉不会重新加载应用、中断正在运行的智能体。
- **按压反馈**：控件按下时轻微收缩，松开时带轻微回弹。它通过 Web Animations API 对独立的 `scale` 属性做动画，因此组件自身的过渡效果不受影响，大行与小图标移动的像素数相近。遵循 `prefers-reduced-motion`。
- **触感反馈**：手指点按控件时轻微振动，切换状态的控件振动稍长；需要设备支持 Vibration API（Android 浏览器支持，Safari 不支持）。
- **设置 → 通用 → 动效与触感**：“减少动效”无论系统如何设置都会关闭 DSH Web 的动画；“触感反馈”只在支持振动的设备上显示。两项都按设备保存在 `localStorage` 中。

## 排除元素

在元素上添加 `data-dsh-no-press`，即可让该元素及其内部不产生按压反馈。

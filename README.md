# Static Blog Theme

基于 Shirone 的静态博客主题工程，采用组件化设计与内容分离架构，支持 Markdown/MDX 渲染、静态全文搜索、响应式图片和页面切换。

[在线演示](https://yufu0u-blog-qogjsurz.edgeone.dev/)

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 静态站点框架 | Astro 7 |
| 交互组件 | Svelte 5 |
| 类型系统 | TypeScript 6 |
| 样式与设计 | Tailwind CSS 4、Material 3 Expressive |
| 内容与配置 | Markdown、MDX、YAML |
| 全文搜索 | Pagefind |
| 图片处理 | Sharp、Astro Assets |
| 页面切换 | Swup |
| 运行环境与包管理 | Node.js 24、pnpm 11.25.0 |

## 架构

主题代码与内容源独立管理，通过配置覆盖和构建期同步生成静态站点。持续集成使用中性示例进行类型检查、构建和产物验证。

支持本机可视化管理后台：配置独立内容目录后运行 `pnpm admin`，管理文章、瞬间、图片、站点介绍、页面文字、导航、侧栏开关与部署暂停/锁定。后台沿用主题的 Material 3 动态配色，仅在本机运行；配置和内容一起检查、备份与 Git 发布。详见 [后台说明](scripts/admin/README.md)。

## 许可证

主题基于 [Shirone](https://github.com/LyraVoid/Shirone)，采用 [MIT License](LICENSE)。第三方版权信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
